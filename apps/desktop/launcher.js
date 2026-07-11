/**
 * Start / wait / stop the local Cinekive Docker stack.
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
  ensureDataDirs,
  ensureRuntimeSynced,
} = require("./paths");

const WEB_URL = process.env.CINEKIVE_WEB_URL || "http://localhost:3000";
const API_HEALTH = process.env.CINEKIVE_API_URL || "http://localhost:8000/health";

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
          "Docker Desktop is not installed (or not on PATH).\n\nInstall from https://www.docker.com/products/docker-desktop/ then start it and open Cinekive again.",
      };
    }
    return {
      ok: false,
      reason: "not_running",
      message:
        "Docker is installed but not running.\n\nStart Docker Desktop, wait until it says Running, then open Cinekive again.",
    };
  }
}

function toPosix(p) {
  return String(p).replace(/\\/g, "/");
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
  text = setLine(text, "VLM_ENABLED", "false");
  text = setLine(text, "CORS_ORIGINS", "http://localhost:3000");
  // Avoid broken default ShotDeck mount from repo .env.example if present
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

async function imagesReady(root) {
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

async function ensureStack({ onStatus, forceBuild = false } = {}) {
  const root = ensureRuntimeSynced();
  const cfg = readConfig();
  const dataDir = cfg.dataDir || defaultDataDir();
  const libraryPath = cfg.libraryPath || defaultLibraryDir();
  const dirs = ensureDataDirs(dataDir, libraryPath);
  writeEnvFile(dirs);

  onStatus?.("Checking if Cinekive is already running…");
  if ((await ping(WEB_URL)) && (await ping(API_HEALTH))) {
    onStatus?.("Stack is up.");
    return { root, web: WEB_URL, alreadyRunning: true };
  }

  const docker = await checkDocker();
  if (!docker.ok) throw new Error(docker.message);

  const compose = composeFile(root);
  if (!fs.existsSync(compose)) {
    throw new Error(`Missing compose file at ${compose}`);
  }

  const built = !forceBuild && (await imagesReady(root));
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
  if (!apiOk) throw new Error("API did not become healthy. Open Docker Desktop and check cinearchive-api logs.");

  onStatus?.("Waiting for web UI…");
  const webOk = await waitFor(WEB_URL, {
    tries: 90,
    onTick: (n, t) => onStatus?.(`Waiting for web… (${n}/${t})`),
  });
  if (!webOk) throw new Error("Web UI did not start. Check cinearchive-web in Docker Desktop.");

  onStatus?.("Ready.");
  return { root, web: WEB_URL, alreadyRunning: false };
}

async function stopStack({ onStatus } = {}) {
  const root = ensureRuntimeSynced();
  const compose = composeFile(root);
  onStatus?.("Stopping Cinekive stack…");
  try {
    await run("docker", ["compose", "-f", compose, "stop"], { cwd: root });
  } catch (e) {
    onStatus?.(String(e.message || e));
  }
}

async function restartStack({ onStatus } = {}) {
  const root = ensureRuntimeSynced();
  const compose = composeFile(root);
  onStatus?.("Restarting stack…");
  await run("docker", ["compose", "-f", compose, "up", "-d"], { cwd: root });
  await waitFor(API_HEALTH, {
    tries: 60,
    onTick: (n, t) => onStatus?.(`Waiting for API… (${n}/${t})`),
  });
  await waitFor(WEB_URL, {
    tries: 45,
    onTick: (n, t) => onStatus?.(`Waiting for web… (${n}/${t})`),
  });
  onStatus?.("Ready.");
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
};
