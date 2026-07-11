# Native (no-Docker) engine — experimental
#
# Goal: Electron spawns Qdrant + FastAPI + Next.js as host processes.
# Status: scaffold. Prefer Docker desktop builds until this is marked stable.
#
# Layout after setup (under %APPDATA%/Cinekive or ./data):
#   engine/
#     qdrant/qdrant(.exe)
#     python/  (venv with cinearchive)
#     web/     (Next.js standalone)
#     ffmpeg/

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { readConfig, defaultDataDir, ensureDataDirs } = require("./paths");

const WEB_URL = process.env.CINEKIVE_WEB_URL || "http://localhost:3000";
const API_HEALTH = process.env.CINEKIVE_API_URL || "http://localhost:8000/health";

function engineRoot() {
  const cfg = readConfig();
  return path.join(cfg.dataDir || defaultDataDir(), "engine");
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

function nativeReady() {
  const root = engineRoot();
  const qdrant = process.platform === "win32" ? "qdrant.exe" : "qdrant";
  const checks = [
    path.join(root, "qdrant", qdrant),
    path.join(root, "python", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
    path.join(root, "web", "server.js"),
  ];
  return checks.every((p) => fs.existsSync(p));
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
        "Native engine not installed yet.\n\nRun scripts/native-setup.ps1 (or .sh), or use Docker Desktop for now.",
    };
  }
  return { ok: true };
}

const children = [];

function spawnTracked(cmd, args, opts) {
  const child = spawn(cmd, args, {
    ...opts,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  return child;
}

async function startStack({ onStatus } = {}) {
  ensureDataDirs();
  const root = engineRoot();
  const dataDir = readConfig().dataDir || defaultDataDir();
  const qdrantBin = path.join(
    root,
    "qdrant",
    process.platform === "win32" ? "qdrant.exe" : "qdrant"
  );
  const python = path.join(
    root,
    "python",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python"
  );
  const webServer = path.join(root, "web", "server.js");
  const nodeBin = process.env.CINEKIVE_NODE || "node";

  onStatus?.("Starting Qdrant…");
  spawnTracked(qdrantBin, [], {
    cwd: path.join(root, "qdrant"),
    env: {
      ...process.env,
      QDRANT__STORAGE__STORAGE_PATH: path.join(dataDir, "qdrant"),
    },
  });

  onStatus?.("Starting API…");
  spawnTracked(
    python,
    ["-m", "uvicorn", "cinearchive.main:app", "--host", "127.0.0.1", "--port", "8000"],
    {
      cwd: path.join(root, "python"),
      env: {
        ...process.env,
        DATABASE_URL: `sqlite+aiosqlite:///${path.join(dataDir, "db", "cinearchive.db").replace(/\\/g, "/")}`,
        QDRANT_URL: "http://127.0.0.1:6333",
        VIDEOS_DIR: path.join(dataDir, "videos"),
        ARTIFACTS_DIR: path.join(dataDir, "artifacts"),
        MODELS_DIR: path.join(dataDir, "models"),
        LIBRARY_DIR: readConfig().libraryDir || path.join(dataDir, "library"),
        CORS_ORIGINS: "http://localhost:3000",
        VLM_ENABLED: "false",
        PYTHONPATH: path.join(root, "python", "Lib", "site-packages"),
      },
    }
  );

  onStatus?.("Starting web…");
  spawnTracked(nodeBin, [webServer], {
    cwd: path.join(root, "web"),
    env: {
      ...process.env,
      PORT: "3000",
      HOSTNAME: "127.0.0.1",
      NEXT_PUBLIC_API_URL: "http://localhost:8000",
    },
  });

  onStatus?.("Waiting for engine…");
  for (let i = 0; i < 90; i++) {
    if ((await ping(API_HEALTH)) && (await ping(WEB_URL))) {
      onStatus?.("Ready");
      return { webUrl: WEB_URL };
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Native engine did not become ready in time.");
}

async function stopStack() {
  for (const child of children.splice(0)) {
    try {
      child.kill();
    } catch (_) {}
  }
}

module.exports = {
  checkNative,
  nativeReady,
  startStack,
  stopStack,
  engineRoot,
  WEB_URL,
  API_HEALTH,
};
