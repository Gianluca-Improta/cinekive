/**
 * Native (no-Docker) engine — spawns Qdrant + FastAPI + Next.js as host processes.
 *
 * Layout under {dataDir}/engine/:
 *   qdrant/qdrant(.exe)
 *   python/  (venv with cinearchive)
 *   web/server.js + .next/static
 *   ffmpeg/bin/ffmpeg(.exe)
 *   logs/*.log
 */

const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { readConfig, defaultDataDir, ensureDataDirs } = require("./paths");
const { buildCorsOrigins, getBindHost, getLanUrls, getPrimaryLanIp } = require("./network");

const WEB_URL = process.env.CINEKIVE_WEB_URL || "http://localhost:3000";
const API_HEALTH = process.env.CINEKIVE_API_URL || "http://localhost:8000/health";
const QDRANT_HEALTH = "http://127.0.0.1:6333/readyz";

function engineRoot() {
  const cfg = readConfig();
  return path.join(cfg.dataDir || defaultDataDir(), "engine");
}

function logsDir() {
  const dir = path.join(engineRoot(), "logs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function toPosix(p) {
  return String(p).replace(/\\/g, "/");
}

function ping(url, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(Boolean(res.statusCode && res.statusCode < 500));
    });
    req.on("error", () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** Kill whatever is listening on a TCP port (Windows / Unix). Used when a hung engine blocks restart. */
function freeListenPort(port) {
  try {
    if (process.platform === "win32") {
      execSync(
        `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`,
        { stdio: "ignore", windowsHide: true }
      );
    } else {
      execSync(`sh -c 'fuser -k ${port}/tcp 2>/dev/null || true'`, { stdio: "ignore" });
    }
  } catch {
    /* ignore */
  }
}

/**
 * If health URL is down but the port is still bound (zombie uvicorn / Next), reclaim it.
 * @returns {Promise<boolean>} true if something was killed
 */
async function reclaimPortIfUnhealthy(port, healthUrl, { onStatus } = {}) {
  if (await ping(healthUrl, 1200)) return false;
  let listening = false;
  try {
    if (process.platform === "win32") {
      const out = execSync(
        `powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count"`,
        { encoding: "utf8", windowsHide: true }
      );
      listening = Number(String(out).trim()) > 0;
    } else {
      execSync(`sh -c 'ss -ltn sport = :${port} | grep -q LISTEN'`, { stdio: "ignore" });
      listening = true;
    }
  } catch {
    listening = false;
  }
  if (!listening) return false;
  onStatus?.(`Clearing stuck process on port ${port}…`);
  freeListenPort(port);
  await new Promise((r) => setTimeout(r, 800));
  return true;
}

function qdrantBin(root) {
  return path.join(root, "qdrant", process.platform === "win32" ? "qdrant.exe" : "qdrant");
}

function pythonBin(root) {
  if (process.platform === "win32") {
    // Prefer standalone root python.exe (DLLs live beside it). Scripts\ copy breaks with STATUS_DLL_NOT_FOUND.
    const candidates = [
      path.join(root, "python", "python.exe"),
      path.join(root, "python", "Scripts", "python.exe"),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return candidates[0];
  }
  const candidates = [
    path.join(root, "python", "bin", "python3"),
    path.join(root, "python", "bin", "python"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

function pythonCwd(root, pythonPath) {
  // Always run from the python pack root so python3xx.dll resolves
  const pyRoot = path.join(root, "python");
  if (fs.existsSync(pyRoot)) return pyRoot;
  return path.dirname(pythonPath);
}

function webServerPath(root) {
  return path.join(root, "web", "server.js");
}

/** Packaged or locally built Next standalone (always newer than GitHub engine zip UI). */
function bundledWebUiRoot() {
  try {
    const { app } = require("electron");
    if (app?.isPackaged) {
      const p = path.join(process.resourcesPath, "cinekive", "web-ui");
      if (fs.existsSync(path.join(p, "server.js"))) return p;
    }
  } catch {
    /* not in Electron */
  }
  const dist = path.join(__dirname, "web-ui-dist");
  if (fs.existsSync(path.join(dist, "server.js"))) return dist;
  return null;
}

/**
 * Copy installer/dev web UI over engine/web so the shell version matches the product UI.
 * @returns {boolean} true if files were updated
 */
function syncWebUiFromBundle({ onStatus } = {}) {
  const src = bundledWebUiRoot();
  if (!src) return false;

  const dest = path.join(engineRoot(), "web");
  let wantVer = "0";
  try {
    const { app } = require("electron");
    wantVer = app.getVersion();
  } catch {
    try {
      wantVer = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).version;
    } catch {
      /* ignore */
    }
  }
  const srcMarker = path.join(src, ".ui-version");
  const srcVer = fs.existsSync(srcMarker) ? fs.readFileSync(srcMarker, "utf8").trim() : wantVer;
  const marker = path.join(dest, ".ui-version");
  const cur = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim() : "";
  if (cur === srcVer && fs.existsSync(path.join(dest, "server.js"))) return false;

  onStatus?.(`Updating app UI (${srcVer})…`);
  // Drop listeners on :3000 that would lock files on Windows
  if (process.platform === "win32") {
    try {
      execSync(
        `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`,
        { stdio: "ignore", windowsHide: true }
      );
    } catch {
      /* ignore */
    }
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  fs.writeFileSync(marker, srcVer, "utf8");
  return true;
}

function ffmpegDir(root) {
  const candidates = [
    path.join(root, "ffmpeg", "bin"),
    path.join(root, "ffmpeg"),
  ];
  for (const d of candidates) {
    const exe = path.join(d, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    if (fs.existsSync(exe)) return d;
  }
  return null;
}

function nativeReady() {
  const root = engineRoot();
  return (
    fs.existsSync(qdrantBin(root)) &&
    fs.existsSync(pythonBin(root)) &&
    fs.existsSync(webServerPath(root))
  );
}

/**
 * @returns {{ ok: boolean, reason?: string, message?: string }}
 */
async function checkNative() {
  if (!nativeReady()) {
    return {
      ok: false,
      reason: "not_installed",
      message:
        "Native engine not installed yet.\n\nCinekive will download it on first start (Windows or Mac, no Docker), or install Docker Desktop.",
    };
  }
  return { ok: true };
}

const children = [];

function attachLog(child, name) {
  const dir = logsDir();
  const out = fs.createWriteStream(path.join(dir, `${name}.log`), { flags: "a" });
  const stamp = `[${new Date().toISOString()}] ${name} started\n`;
  out.write(stamp);
  child.stdout?.pipe(out);
  child.stderr?.pipe(out);
  child.on("exit", (code) => {
    out.write(`[${new Date().toISOString()}] exited ${code}\n`);
    out.end();
  });
}

function spawnTracked(cmd, args, opts, logName) {
  const spawnOpts = {
    ...opts,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  };
  if (process.platform !== "win32") {
    spawnOpts.detached = true;
  }
  const child = spawn(cmd, args, spawnOpts);
  child._cinekiveExited = false;
  child._cinekiveExitCode = null;
  child.on("exit", (code) => {
    child._cinekiveExited = true;
    child._cinekiveExitCode = code;
  });
  if (logName) attachLog(child, logName);
  children.push(child);
  return child;
}

function killTree(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "ignore", windowsHide: true });
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }
  } catch {
    try {
      child.kill("SIGKILL");
    } catch (_) {}
  }
}

function buildPythonEnv(root, dataDir, libraryPath, { lanAccess = true, vlmEnabled = false } = {}) {
  const isWin = process.platform === "win32";
  const pyRoot = path.join(root, "python");
  const pyBinDir = isWin ? path.join(pyRoot, "Scripts") : path.join(pyRoot, "bin");

  let sitePackages = "";
  if (isWin) {
    sitePackages = path.join(pyRoot, "Lib", "site-packages");
  } else {
    const libDir = path.join(pyRoot, "lib");
    if (fs.existsSync(libDir)) {
      const ver = fs.readdirSync(libDir).find((n) => n.startsWith("python3"));
      if (ver) sitePackages = path.join(libDir, ver, "site-packages");
    }
  }

  const ff = ffmpegDir(root);
  const pathParts = [ff, pyBinDir, process.env.PATH].filter(Boolean);

  const dbFile = path.join(dataDir, "db", "cinearchive.db");
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });

  const lanIp = lanAccess ? getPrimaryLanIp() : null;
  const lan = getLanUrls(lanAccess);

  return {
    ...process.env,
    PATH: pathParts.join(path.delimiter),
    PYTHONPATH: sitePackages || undefined,
    PYTHONUNBUFFERED: "1",
    DATABASE_URL: `sqlite+aiosqlite:///${toPosix(dbFile)}`,
    QDRANT_URL: "http://127.0.0.1:6333",
    QDRANT_COLLECTION: process.env.QDRANT_COLLECTION || "cinearchive_shots_v1",
    VIDEOS_DIR: path.join(dataDir, "videos"),
    ARTIFACTS_DIR: path.join(dataDir, "artifacts"),
    MODELS_DIR: path.join(dataDir, "models"),
    LIBRARY_DIR: libraryPath,
    HF_HOME: path.join(dataDir, "models", "huggingface"),
    CORS_ORIGINS: buildCorsOrigins(lanIp, lanAccess),
    OLLAMA_URL: process.env.OLLAMA_URL || "http://127.0.0.1:11434",
    OLLAMA_MODEL: process.env.OLLAMA_MODEL || "qwen3-vl:8b",
    VLM_ENABLED: vlmEnabled ? "true" : "false",
    CINEKIVE_LAN_WEB_URL: lan.webUrl || "",
    DEVICE: process.env.DEVICE || "cpu",
    SEEK_ENABLED: "true",
    LOG_LEVEL: process.env.LOG_LEVEL || "INFO",
    CINEKIVE_LICENSE_ENFORCE: "true",
    CINEKIVE_ALLOW_DEV_LICENSE: process.env.CINEKIVE_ALLOW_DEV_LICENSE || "false",
    CINEKIVE_LICENSE_PATH: path.join(require("./paths").userDataRoot(), "license.json"),
    CINEKIVE_USER_DATA: require("./paths").userDataRoot(),
    CINEKIVE_PRO_URL:
      process.env.CINEKIVE_PRO_URL || "https://gianlucaimprota.gumroad.com/l/cinekive-pro",
    GUMROAD_PRODUCT_ID: process.env.GUMROAD_PRODUCT_ID || "",
    GUMROAD_PRODUCT_PERMALINK:
      process.env.GUMROAD_PRODUCT_PERMALINK || "cinekive-pro,cinekive-pro-annual",
    CINEKIVE_TRIAL_SECRET: process.env.CINEKIVE_TRIAL_SECRET || "",
    CINEKIVE_LICENSE_SECRET: process.env.CINEKIVE_LICENSE_SECRET || "",
    APPDATA: process.env.APPDATA || require("./paths").userDataRoot(),
  };
}

async function waitForService(url, label, { tries = 60, intervalMs = 2000, onStatus, child } = {}) {
  for (let i = 0; i < tries; i++) {
    if (child && (child._cinekiveExited || child.exitCode !== null)) {
      const code = child._cinekiveExitCode ?? child.exitCode;
      throw new Error(
        `${label} exited before becoming healthy (code ${code}).\n\n` +
          "Open Help → Open engine logs for details."
      );
    }
    if (await ping(url)) return true;
    onStatus?.(`Waiting for ${label}… (${i + 1}/${tries})`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/** Stop tracked children + common orphaned engine binaries (Windows file locks). */
function stopHostEngineBinaries() {
  for (const child of children.splice(0)) {
    killTree(child);
  }
  if (process.platform === "win32") {
    try {
      execSync("taskkill /IM qdrant.exe /F", { stdio: "ignore", windowsHide: true });
    } catch (_) {}
  }
  // Hung API / web from a previous session often leave ports bound without answering health.
  freeListenPort(8000);
  freeListenPort(3000);
}

async function startStack({ onStatus } = {}) {
  const cfg = readConfig();
  const dataDir = cfg.dataDir || defaultDataDir();
  const libraryPath = cfg.libraryPath || path.join(dataDir, "library");
  ensureDataDirs(dataDir, libraryPath);
  fs.mkdirSync(path.join(dataDir, "qdrant"), { recursive: true });
  const root = engineRoot();

  // Keep product UI in lockstep with the desktop build (engine zip UI is often older)
  try {
    syncWebUiFromBundle({ onStatus });
  } catch (e) {
    onStatus?.(`UI sync skipped: ${e.message || e}`);
  }

  const qBin = qdrantBin(root);
  const python = pythonBin(root);
  const webServer = webServerPath(root);
  let nodeBin = path.join(root, "node", process.platform === "win32" ? "node.exe" : "node");
  if (!fs.existsSync(nodeBin)) {
    nodeBin = path.join(root, "node", "bin", "node");
  }
  if (!fs.existsSync(nodeBin)) {
    nodeBin = process.env.CINEKIVE_NODE || "node";
  }

  // If a previous launch already brought everything up, reuse it.
  if ((await ping(API_HEALTH)) && (await ping(WEB_URL))) {
    onStatus?.("Engine already running.");
    return { webUrl: WEB_URL, mode: "native", lan: getLanUrls(cfg.lanAccess !== false) };
  }

  if (!fs.existsSync(qBin)) {
    throw new Error("Qdrant binary missing from engine pack. Reinstall Cinekive or re-download the engine.");
  }
  if (!fs.existsSync(python)) {
    throw new Error("Python missing from engine pack. Reinstall Cinekive or re-download the engine.");
  }
  if (!fs.existsSync(webServer)) {
    throw new Error("Web server missing from engine pack. Reinstall Cinekive or re-download the engine.");
  }

  // Fail fast if the pack was built with a non-relocatable CI venv.
  try {
    execSync(`"${python}" -c "import uvicorn, cinearchive"`, {
      cwd: pythonCwd(root, python),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 25000,
    });
  } catch (e) {
    const detail = String(e.stderr || e.message || e);
    const err = new Error(
      "Engine Python failed to start (broken pack).\n\n" +
        "Download the latest Cinekive release and delete:\n" +
        `  ${root}\n` +
        "then reopen the app so it re-downloads the engine.\n\n" +
        detail.slice(0, 400)
    );
    err.code = "BROKEN_ENGINE_PACK";
    throw err;
  }

  const lanAccess = cfg.lanAccess !== false;
  const bindHost = getBindHost(lanAccess);
  const lan = getLanUrls(lanAccess);

  onStatus?.("Checking local AI (Ollama)…");
  const ollamaOk = await ping("http://127.0.0.1:11434/api/tags", 1500);
  if (ollamaOk) {
    onStatus?.("Ollama found — VLM enrichment enabled");
  } else {
    onStatus?.("Ollama not running — search still works; install Ollama for craft AI tags");
  }

  let qdrantOk = await ping(QDRANT_HEALTH, 1200);
  let qdrantChild = null;
  if (!qdrantOk) {
    await reclaimPortIfUnhealthy(6333, QDRANT_HEALTH, { onStatus });
    onStatus?.("Starting Qdrant…");
    qdrantChild = spawnTracked(
      qBin,
      [],
      {
        cwd: path.join(root, "qdrant"),
        env: {
          ...process.env,
          QDRANT__STORAGE__STORAGE_PATH: path.join(dataDir, "qdrant"),
        },
      },
      "qdrant"
    );
    qdrantOk = await waitForService(QDRANT_HEALTH, "Qdrant", {
      onStatus,
      // Large libraries can take 30–90s to load shards on disk
      tries: 90,
      intervalMs: 2000,
      child: qdrantChild,
    });
  } else {
    onStatus?.("Qdrant already running");
  }
  if (!qdrantOk) {
    throw new Error(
      "Qdrant did not start.\n\n" +
        "Another app may be using port 6333, or the vector DB is locked.\n" +
        "Quit other Cinekive / Docker instances, then try again.\n" +
        "Logs: Help → Open engine logs → qdrant.log"
    );
  }

  let apiOk = await ping(API_HEALTH, 1200);
  let apiChild = null;
  if (!apiOk) {
    await reclaimPortIfUnhealthy(8000, API_HEALTH, { onStatus });
    onStatus?.("Starting API…");
    const pyEnv = buildPythonEnv(root, dataDir, libraryPath, { lanAccess, vlmEnabled: ollamaOk });
    apiChild = spawnTracked(
      python,
      ["-m", "uvicorn", "cinearchive.main:app", "--host", bindHost, "--port", "8000"],
      {
        cwd: pythonCwd(root, python),
        env: pyEnv,
      },
      "api"
    );
    apiOk = await waitForService(API_HEALTH, "API", {
      onStatus,
      tries: 60,
      intervalMs: 1500,
      child: apiChild,
    });
  } else {
    onStatus?.("API already running");
  }
  if (!apiOk) {
    const err = new Error(
      "API did not become healthy.\n\n" +
        "Usually a broken engine Python pack or a stuck process on port 8000.\n" +
        "Delete the engine folder and reopen Cinekive, or reboot once:\n" +
        `  ${root}\n` +
        "Check engine/logs/api.log for details."
    );
    err.code = "BROKEN_ENGINE_PACK";
    throw err;
  }

  let webOk = await ping(WEB_URL, 1200);
  let webChild = null;
  if (!webOk) {
    await reclaimPortIfUnhealthy(3000, WEB_URL, { onStatus });
    onStatus?.("Starting web…");
    webChild = spawnTracked(
      nodeBin,
      [webServer],
      {
        cwd: path.join(root, "web"),
        env: {
          ...process.env,
          PORT: "3000",
          HOSTNAME: bindHost,
          NEXT_PUBLIC_API_URL: "http://localhost:8000",
        },
      },
      "web"
    );
    webOk = await waitForService(WEB_URL, "web UI", {
      onStatus,
      tries: 40,
      intervalMs: 1000,
      child: webChild,
    });
  } else {
    onStatus?.("Web UI already running");
  }
  if (!webOk) {
    throw new Error("Web UI did not start. Check engine/logs/web.log");
  }

  onStatus?.("Ready");
  if (lan.webUrl) {
    onStatus?.(`Phone on WiFi: ${lan.webUrl}`);
  }
  return { webUrl: WEB_URL, mode: "native", lan };
}

async function stopStack() {
  stopHostEngineBinaries();
}

function openLogsDir() {
  const dir = logsDir();
  return dir;
}

module.exports = {
  checkNative,
  nativeReady,
  startStack,
  stopStack,
  stopHostEngineBinaries,
  syncWebUiFromBundle,
  bundledWebUiRoot,
  engineRoot,
  logsDir,
  openLogsDir,
  WEB_URL,
  API_HEALTH,
  QDRANT_HEALTH,
  ping,
};
