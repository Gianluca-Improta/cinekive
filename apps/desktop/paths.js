/**
 * Resolve install / data / config paths for dev vs packaged Electron.
 */

const path = require("path");
const fs = require("fs");
const { app } = require("electron");

function isPackaged() {
  return Boolean(app && app.isPackaged);
}

function userDataRoot() {
  if (process.env.CINEKIVE_USER_DATA) return process.env.CINEKIVE_USER_DATA;
  try {
    return path.join(app.getPath("appData"), "Cinekive");
  } catch {
    return path.join(process.env.APPDATA || process.env.HOME || ".", "Cinekive");
  }
}

/** Read-only bundle shipped inside the installer. */
function bundledStackRoot() {
  if (process.env.CINEKIVE_ROOT) return process.env.CINEKIVE_ROOT;
  if (isPackaged()) return path.join(process.resourcesPath, "cinekive");
  return path.resolve(__dirname, "..", "..");
}

/**
 * Writable stack root (compose + Docker build context).
 * Packaged apps copy the bundle into %APPDATA%/Cinekive/runtime so .env is writable.
 */
function stackRoot() {
  if (process.env.CINEKIVE_ROOT) return process.env.CINEKIVE_ROOT;
  if (isPackaged()) return path.join(userDataRoot(), "runtime");
  return path.resolve(__dirname, "..", "..");
}

function ensureRuntimeSynced() {
  if (!isPackaged()) return stackRoot();
  const src = bundledStackRoot();
  const dest = stackRoot();
  const ver = app.getVersion();
  const marker = path.join(dest, ".bundle-version");
  const needsCopy =
    !fs.existsSync(path.join(dest, "docker-compose.desktop.yml")) ||
    !fs.existsSync(marker) ||
    fs.readFileSync(marker, "utf8").trim() !== ver;

  if (needsCopy) {
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(src, dest, { recursive: true, force: true });
    fs.writeFileSync(marker, ver, "utf8");
  }
  return dest;
}

function configPath() {
  return path.join(userDataRoot(), "config.json");
}

function envPath() {
  return path.join(stackRoot(), ".env");
}

function defaultDataDir() {
  return path.join(userDataRoot(), "data");
}

function defaultLibraryDir() {
  return path.join(defaultDataDir(), "library");
}

function readConfigDefaults() {
  return {
    firstRunComplete: false,
    libraryPath: null,
    dataDir: null,
    stopStackOnQuit: false,
    /** "auto" | "docker" | "native" */
    engineMode: "auto",
  };
}

function readConfig() {
  const p = configPath();
  if (!fs.existsSync(p)) return readConfigDefaults();
  try {
    return { ...readConfigDefaults(), ...JSON.parse(fs.readFileSync(p, "utf8")) };
  } catch {
    return readConfigDefaults();
  }
}

function writeConfig(partial) {
  const root = userDataRoot();
  fs.mkdirSync(root, { recursive: true });
  const next = { ...readConfig(), ...partial, updatedAt: new Date().toISOString() };
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

function ensureDataDirs(dataDir, libraryPath) {
  const base = dataDir || defaultDataDir();
  const lib = libraryPath || defaultLibraryDir();
  for (const sub of ["qdrant", "db", "models", "artifacts", "videos"]) {
    fs.mkdirSync(path.join(base, sub), { recursive: true });
  }
  fs.mkdirSync(lib, { recursive: true });
  return { dataDir: base, libraryPath: lib };
}

module.exports = {
  isPackaged,
  bundledStackRoot,
  stackRoot,
  ensureRuntimeSynced,
  userDataRoot,
  configPath,
  envPath,
  defaultDataDir,
  defaultLibraryDir,
  readConfig,
  writeConfig,
  ensureDataDirs,
};
