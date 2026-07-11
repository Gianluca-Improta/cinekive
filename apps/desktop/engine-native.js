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

function qdrantBin(root) {
  return path.join(root, "qdrant", process.platform === "win32" ? "qdrant.exe" : "qdrant");
}

function pythonBin(root) {
  return path.join(
    root,
    "python",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python"
  );
}

function webServerPath(root) {
  return path.join(root, "web", "server.js");
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
  };
}

async function waitForService(url, label, { tries = 60, intervalMs = 2000, onStatus } = {}) {
  for (let i = 0; i < tries; i++) {
    if (await ping(url)) return true;
    onStatus?.(`Waiting for ${label}… (${i + 1}/${tries})`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

async function startStack({ onStatus } = {}) {
  const cfg = readConfig();
  const dataDir = cfg.dataDir || defaultDataDir();
  const libraryPath = cfg.libraryPath || path.join(dataDir, "library");
  ensureDataDirs(dataDir, libraryPath);
  fs.mkdirSync(path.join(dataDir, "qdrant"), { recursive: true });
  const root = engineRoot();
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

  const lanAccess = cfg.lanAccess !== false;
  const bindHost = getBindHost(lanAccess);
  const lan = getLanUrls(lanAccess);

  onStatus?.("Checking local AI (Ollama)…");
  const ollamaOk = await ping("http://127.0.0.1:11434/api/tags", 2500);
  if (ollamaOk) {
    onStatus?.("Ollama found — VLM enrichment enabled");
  } else {
    onStatus?.("Ollama not running — search still works; install Ollama for craft AI tags");
  }

  onStatus?.("Starting Qdrant…");
  spawnTracked(
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

  const qdrantOk = await waitForService(QDRANT_HEALTH, "Qdrant", { onStatus, tries: 45 });
  if (!qdrantOk) {
    throw new Error("Qdrant did not start. Open engine logs in Help → Open engine logs.");
  }

  onStatus?.("Starting API…");
  const pyEnv = buildPythonEnv(root, dataDir, libraryPath, { lanAccess, vlmEnabled: ollamaOk });
  spawnTracked(
    python,
    ["-m", "uvicorn", "cinearchive.main:app", "--host", bindHost, "--port", "8000"],
    {
      cwd: path.join(root, "python"),
      env: pyEnv,
    },
    "api"
  );

  const apiOk = await waitForService(API_HEALTH, "API", { onStatus, tries: 90, intervalMs: 2000 });
  if (!apiOk) {
    throw new Error("API did not become healthy. Check engine/logs/api.log");
  }

  onStatus?.("Starting web…");
  spawnTracked(
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

  const webOk = await waitForService(WEB_URL, "web UI", { onStatus, tries: 60 });
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
  for (const child of children.splice(0)) {
    killTree(child);
  }
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
  engineRoot,
  logsDir,
  openLogsDir,
  WEB_URL,
  API_HEALTH,
  QDRANT_HEALTH,
  ping,
};
