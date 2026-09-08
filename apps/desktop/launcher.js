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
  userDataRoot,
} = require("./paths");
const { buildCorsOrigins, getPrimaryLanIp, getLanUrls } = require("./network");

const WEB_URL = process.env.CINEKIVE_WEB_URL || "http://localhost:3000";
const API_HEALTH = process.env.CINEKIVE_API_URL || "http://localhost:8000/health";

const GHCR_API = "ghcr.io/gianluca-improta/cinekive-api";
const GHCR_WEB = "ghcr.io/gianluca-improta/cinekive-web";

function appVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).version;
  } catch {
    return "0.5.3";
  }
}

function ghcrTag() {
  return appVersion();
}

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
          "Docker Desktop is not installed.\n\nCinekive will use the native engine instead — no Docker required.",
      };
    }
    return {
      ok: false,
      reason: "not_running",
      message:
        "Docker is installed but not running.\n\nStart Docker Desktop, or use the native engine (no Docker).",
    };
  }
}

/** Best-effort start of Docker Desktop on Windows when user chose Docker mode. */
async function tryStartDockerDesktop() {
  if (process.platform !== "win32") return false;
  const exe = path.join(process.env.ProgramFiles || "C:\\Program Files", "Docker", "Docker", "Docker Desktop.exe");
  if (!fs.existsSync(exe)) return false;
  try {
    spawn(exe, [], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        await run("docker", ["info"]);
        return true;
      } catch {
        /* still starting */
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

function toPosix(p) {
  return String(p).replace(/\\/g, "/");
}

function nativePackPlatform() {
  return process.platform === "win32" || process.platform === "darwin";
}

function writeEnvFile({ dataDir, libraryPath }) {
  // Packaged apps write to ~/Library/Application Support/Cinekive/runtime/.env
  // (or %APPDATA%\Cinekive\runtime\.env). Ensure that folder exists first.
  const root = ensureRuntimeSynced();
  const example = path.join(root, ".env.example");
  const dest = envPath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
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
  text = setLine(text, "CINEKIVE_IMAGE_TAG", ghcrTag());
  // Packaged desktop enforces Free vs Pro; self-built Docker leaves this unset (unlocked).
  try {
    const { app } = require("electron");
    if (app?.isPackaged) {
      text = setLine(text, "CINEKIVE_LICENSE_ENFORCE", "true");
      text = setLine(text, "CINEKIVE_ALLOW_DEV_LICENSE", "false");
      text = setLine(text, "CINEKIVE_LICENSE_PATH", toPosix(path.join(userDataRoot(), "license.json")));
      text = setLine(text, "CINEKIVE_USER_DATA", toPosix(userDataRoot()));
      if (process.env.CINEKIVE_TRIAL_SECRET) {
        text = setLine(text, "CINEKIVE_TRIAL_SECRET", process.env.CINEKIVE_TRIAL_SECRET);
      }
      if (process.env.CINEKIVE_LICENSE_SECRET) {
        text = setLine(text, "CINEKIVE_LICENSE_SECRET", process.env.CINEKIVE_LICENSE_SECRET);
      }
      if (process.env.GUMROAD_PRODUCT_ID) {
        text = setLine(text, "GUMROAD_PRODUCT_ID", process.env.GUMROAD_PRODUCT_ID);
      }
      text = setLine(
        text,
        "GUMROAD_PRODUCT_PERMALINK",
        process.env.GUMROAD_PRODUCT_PERMALINK || "cinekive-pro,cinekive-pro-annual"
      );
    }
  } catch {
    /* not in Electron */
  }
  if (/^SHOTDECK_LIBRARY_HOST=.*/m.test(text)) {
    text = text.replace(/^SHOTDECK_LIBRARY_HOST=.*/m, "SHOTDECK_LIBRARY_HOST=");
  }
  fs.writeFileSync(dest, text, "utf8");
  return dest;
}

function setLibraryHostPath(hostPath) {
  ensureRuntimeSynced();
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
  const tag = ghcrTag();
  const ghcrApi = `${GHCR_API}:${tag}`;
  const ghcrWeb = `${GHCR_WEB}:${tag}`;
  const hasGhcr =
    (await dockerImageExists(ghcrApi)) && (await dockerImageExists(ghcrWeb));
  if (hasGhcr) return true;
  // Also accept :latest if version-tagged images were pulled previously
  const hasGhcrLatest =
    (await dockerImageExists(`${GHCR_API}:latest`)) &&
    (await dockerImageExists(`${GHCR_WEB}:latest`));
  if (hasGhcrLatest) return true;
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

  let docker = await checkDocker();
  if (!docker.ok && mode === "docker") {
    const started = await tryStartDockerDesktop();
    if (started) docker = await checkDocker();
  }

  if (mode === "docker") {
    if (!docker.ok) throw new Error(docker.message);
    return "docker";
  }

  // auto — prefer native on Windows/Mac (Docker often "installed but slow/broken")
  if (nativePackPlatform()) {
    if (docker.ok) {
      // Keep Docker available as an explicit choice; auto uses native for reliability
      return "native";
    }
    return "native";
  }
  if (docker.ok) return "docker";
  throw new Error(
    `${docker.message}\n\nNative engine packs are available on Windows and Mac. Install Docker Desktop on Linux.`
  );
}

async function ensureNativeStack({ onStatus, onProgress } = {}) {
  const native = require("./engine-native");
  const pack = require("./engine-pack");

  const refresh = async (reason) => {
    onStatus?.(reason || "Updating native engine…");
    try {
      native.stopStack();
    } catch (_) {}
    // Give Windows a moment to release file locks
    await new Promise((r) => setTimeout(r, 800));
    try {
      const root = native.engineRoot();
      if (fs.existsSync(root)) {
        fs.rmSync(root, { recursive: true, force: true });
      }
    } catch (e) {
      onStatus?.(`Could not clear old engine: ${e.message || e}`);
      // Retry once after another kill
      try {
        native.stopStack();
        await new Promise((r) => setTimeout(r, 1200));
        fs.rmSync(native.engineRoot(), { recursive: true, force: true });
      } catch (e2) {
        throw new Error(
          `Could not replace the broken engine pack (files locked).\n\n${e2.message || e2}\n\nQuit Cinekive fully, delete:\n  ${native.engineRoot()}\nand reopen.`
        );
      }
    }
    await pack.ensureEnginePack({ force: true, onStatus, onProgress });
  };

  const needsPack = !native.nativeReady() || pack.needsEngineRefresh?.();
  if (needsPack) {
    if (native.nativeReady() && pack.needsEngineRefresh?.()) {
      await refresh("Broken or outdated engine detected — downloading fix…");
    } else {
      onStatus?.("Installing native engine (one-time download)…");
      await pack.ensureEnginePack({ force: true, onStatus, onProgress });
    }
  }

  writeConfig({ engineMode: "native" });
  onStatus?.("Starting native engine (no Docker)…");
  try {
    const result = await native.startStack({ onStatus });
    return {
      root: native.engineRoot(),
      web: result.webUrl,
      alreadyRunning: false,
      mode: "native",
    };
  } catch (e) {
    // Auto-heal once: broken CI pack that slipped past detection
    if (e && (e.code === "BROKEN_ENGINE_PACK" || /broken pack|hostedtoolcache/i.test(String(e.message || e)))) {
      await refresh("Engine Python broken — re-downloading pack…");
      onStatus?.("Starting native engine…");
      const result = await native.startStack({ onStatus });
      return {
        root: native.engineRoot(),
        web: result.webUrl,
        alreadyRunning: false,
        mode: "native",
      };
    }
    throw e;
  }
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
