/**
 * Start / wait / stop the local Cinekive engine (Docker or native).
 */

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");
const {
  stackRoot,
  envPath,
  defaultDataDir,
  defaultLibraryDir,
  readConfig,
  writeConfig,
  ensureDataDirs,
  ensureRuntimeSynced,
} = require("./paths");
const { buildCorsOrigins, getPrimaryLanIp, getLanUrls } = require("./network");

const WEB_URL = process.env.CINEKIVE_WEB_URL || "http://localhost:3000";
const API_HEALTH = process.env.CINEKIVE_API_URL || "http://localhost:8000/health";

const GHCR_API = "ghcr.io/gianluca-improta/cinekive-api";
const GHCR_WEB = "ghcr.io/gianluca-improta/cinekive-web";

function composeFile(root) {
  const desktop = path.join(root, "docker-compose.desktop.yml");
  if (fs.existsSync(desktop)) return desktop;
  return path.join(root, "docker-compose.yml");
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd || stackRoot(),
      shell: true,
      windowsHide: true,
      env: { ...process.env, ...(opts.env || {}) },
    });
    let out = "";
    let err = "";
    child.stdout?.on("data", (d) => {
      out += d.toString();
      opts.onOut?.(d.toString());
    });
    child.stderr?.on("data", (d) => {
      err += d.toString();
      opts.onOut?.(d.toString());
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ out, err });
      else reject(new Error((err || out || `${cmd} exited ${code}`).slice(0, 2000)));
    });
  });
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

async function waitFor(url, { tries = 90, intervalMs = 2000, onTick } = {}) {
  for (let i = 0; i < tries; i++) {
    if (await ping(url)) return true;
    onTick?.(i + 1, tries);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

async function checkDocker() {
  try {
    await run("docker", ["info"]);
    return { ok: true };
  } catch (e) {
    const msg = String(e.message || e);
    if (/not (found|recognized)|ENOENT|is not recognized/i.test(msg)) {
      return {
        ok: false,
        reason: "missing",
        message:
          "Docker Desktop is not installed.\n\nOn Windows or Mac, Cinekive can download a native engine instead — no Docker required.",
      };
    }
    return {
      ok: false,
      reason: "not_running",
      message:
        "Docker is installed but not running.\n\nStart Docker Desktop, or switch to native engine in the wizard.",
    };
  }
}

function toPosix(p) {
  return String(p).replace(/\\/g, "/");
}

function nativePackPlatform() {
  return process.platform === "win32" || process.platform === "darwin";
}

function writeEnvFile({ dataDir, libraryPath }) {
  const root = stackRoot();
  const example = path.join(root, ".env.example");
  const dest = envPath();
  let base = "";
  if (fs.existsSync(dest)) {
    base = fs.readFileSync(dest, "utf8");
  } else if (fs.existsSync(example)) {
    base = fs.readFileSync(example, "utf8");
  }

  const cfg = readConfig();
  const lanAccess = cfg.lanAccess !== false;
  const lanIp = getPrimaryLanIp();
  const cors = buildCorsOrigins(lanIp, lanAccess);
  const lan = getLanUrls(lanAccess);

  const setLine = (text, key, value) => {
    const line = `${key}=${value}`;
    if (new RegExp(`^${key}=.*`, "m").test(text)) {
      return text.replace(new RegExp(`^${key}=.*`, "m"), line);
    }
    return `${text.trimEnd()}\n${line}\n`;
  };

  let text = base || "# Cinekive desktop\n";
  text = setLine(text, "CINEKIVE_DATA_DIR", toPosix(dataDir));
  text = setLine(text, "LIBRARY_HOST_PATH", toPosix(libraryPath));
  text = setLine(text, "LIBRARY_DIR", "/data/library");
  text = setLine(text, "VLM_ENABLED", "true");
  text = setLine(text, "OLLAMA_URL", "http://host.docker.internal:11434");
  text = setLine(text, "CORS_ORIGINS", cors);
  text = setLine(text, "CINEKIVE_LAN_WEB_URL", lan.webUrl || "");
  text = setLine(text, "CINEKIVE_IMAGE_TAG", "latest");
  if (/^SHOTDECK_LIBRARY_HOST=.*/m.test(text)) {
    text = text.replace(/^SHOTDECK_LIBRARY_HOST=.*/m, "SHOTDECK_LIBRARY_HOST=");
  }
  fs.writeFileSync(dest, text, "utf8");
  return dest;
}

function setLibraryHostPath(hostPath) {
  const cfg = readConfig();
  const dataDir = cfg.dataDir || defaultDataDir();
  const dirs = ensureDataDirs(dataDir, hostPath);
  writeEnvFile(dirs);
  return dirs;
}

async function dockerImageExists(name) {
  try {
    const { out } = await run("docker", ["images", "-q", name]);
    return Boolean(out.trim());
  } catch {
    return false;
  }
}

async function imagesReady(root) {
  const hasGhcr = (await dockerImageExists(GHCR_API)) && (await dockerImageExists(GHCR_WEB));
  if (hasGhcr) return true;
  try {
    const { out } = await run("docker", ["images", "-q", "cinearchive-api:latest"], { cwd: root });
    const { out: out2 } = await run("docker", ["images", "-q", "cinearchive-web:latest"], {
      cwd: root,
    });
    return Boolean(out.trim() && out2.trim());
  } catch {
    return false;
  }
}

async function tryPullImages(root, onStatus) {
  const compose = composeFile(root);
  onStatus?.("Pulling pre-built images (GHCR)…");
  try {
    await run("docker", ["compose", "-f", compose, "pull"], {
      cwd: root,
      onOut: (chunk) => {
        const line = chunk.trim().split("\n").pop();
        if (line && line.length < 100) onStatus?.(line);
      },
    });
    return await imagesReady(root);
  } catch {
    return false;
  }
}

/**
 * Resolve engine: auto | docker | native
 */
async function resolveEngineMode() {
  const cfg = readConfig();
  const mode = cfg.engineMode || "auto";

  if (mode === "native") return "native";
  if (mode === "docker") {
    const docker = await checkDocker();
    if (docker.ok) return "docker";
    if (nativePackPlatform()) return "native";
    throw new Error(docker.message);
  }

  // auto
  const docker = await checkDocker();
  if (docker.ok) return "docker";
  if (nativePackPlatform()) return "native";
  throw new Error(
    `${docker.message}\n\nNative engine packs are available on Windows and Mac. Install Docker Desktop on Linux.`
  );
}

async function ensureNativeStack({ onStatus, onProgress } = {}) {
  const native = require("./engine-native");
  const pack = require("./engine-pack");

  if (!native.nativeReady()) {
    onStatus?.("Installing native engine (one-time download)…");
    await pack.ensureEnginePack({ onStatus, onProgress });
  }

  writeConfig({ engineMode: "native" });
  onStatus?.("Starting native engine (no Docker)…");
  const result = await native.startStack({ onStatus });
  return {
    root: native.engineRoot(),
    web: result.webUrl,
    alreadyRunning: false,
    mode: "native",
  };
}

async function ensureDockerStack({ onStatus, forceBuild = false } = {}) {
  const root = ensureRuntimeSynced();
  const cfg = readConfig();
  const dataDir = cfg.dataDir || defaultDataDir();
  const libraryPath = cfg.libraryPath || defaultLibraryDir();
  const dirs = ensureDataDirs(dataDir, libraryPath);
  writeEnvFile(dirs);

  onStatus?.("Checking if Cinekive is already running…");
  if ((await ping(WEB_URL)) && (await ping(API_HEALTH))) {
    onStatus?.("Stack is up.");
    return { root, web: WEB_URL, alreadyRunning: true, mode: "docker" };
  }

  const docker = await checkDocker();
  if (!docker.ok) throw new Error(docker.message);

  const compose = composeFile(root);
  if (!fs.existsSync(compose)) {
    throw new Error(`Missing compose file at ${compose}`);
  }

  let built = !forceBuild && (await imagesReady(root));
  if (!built) {
    const pulled = await tryPullImages(root, onStatus);
    built = pulled || (await imagesReady(root));
  }

  if (!built) {
    onStatus?.("Building Cinekive (first launch — can take 10–20 min)…");
  } else {
    onStatus?.("Starting Docker stack…");
  }

  const args = ["compose", "-f", compose, "up", "-d"];
  if (!built || forceBuild) args.push("--build");

  try {
    await run("docker", args, {
      cwd: root,
      onOut: (chunk) => {
        const line = chunk.trim().split("\n").pop();
        if (line && line.length < 120) onStatus?.(line);
      },
    });
  } catch (e) {
    const msg = String(e.message || e);
    if (/docker/i.test(msg) && /not (found|recognized)|ENOENT/i.test(msg)) {
      throw new Error(
        "Docker Desktop is required. Install it, start it, then open Cinekive again."
      );
    }
    throw e;
  }

  onStatus?.("Waiting for API…");
  const apiOk = await waitFor(API_HEALTH, {
    tries: 120,
    onTick: (n, t) => onStatus?.(`Waiting for API… (${n}/${t})`),
  });
  if (!apiOk) throw new Error("API did not become healthy. Check cinearchive-api in Docker Desktop.");

  onStatus?.("Waiting for web UI…");
  const webOk = await waitFor(WEB_URL, {
    tries: 90,
    onTick: (n, t) => onStatus?.(`Waiting for web… (${n}/${t})`),
  });
  if (!webOk) throw new Error("Web UI did not start. Check cinearchive-web in Docker Desktop.");

  onStatus?.("Ready.");
  writeConfig({ engineMode: "docker" });
  return { root, web: WEB_URL, alreadyRunning: false, mode: "docker" };
}

async function ensureStack({ onStatus, onProgress, forceBuild = false } = {}) {
  const mode = await resolveEngineMode();
  if (mode === "native") {
    return ensureNativeStack({ onStatus, onProgress });
  }
  return ensureDockerStack({ onStatus, forceBuild });
}

async function stopStack({ onStatus } = {}) {
  const cfg = readConfig();
  if (cfg.engineMode === "native") {
    onStatus?.("Stopping native engine…");
    try {
      require("./engine-native").stopStack();
    } catch (e) {
      onStatus?.(String(e.message || e));
    }
    return;
  }
  const root = ensureRuntimeSynced();
  const compose = composeFile(root);
  onStatus?.("Stopping Cinekive stack…");
  try {
    await run("docker", ["compose", "-f", compose, "stop"], { cwd: root });
  } catch (e) {
    onStatus?.(String(e.message || e));
  }
}

async function restartStack({ onStatus, onProgress } = {}) {
  await stopStack({ onStatus });
  return ensureStack({ onStatus, onProgress });
}

module.exports = {
  WEB_URL,
  API_HEALTH,
  stackRoot,
  ensureStack,
  stopStack,
  restartStack,
  setLibraryHostPath,
  checkDocker,
  ping,
  writeEnvFile,
  ensureDataDirs,
  ensureRuntimeSynced,
  resolveEngineMode,
  nativePackPlatform,
  getLanUrls,
};
