/**
 * Engine health snapshot for wizard and settings.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { checkDocker, ping, API_HEALTH, WEB_URL, getLanUrls } = require("./launcher");
const { readConfig, defaultDataDir, defaultLibraryDir, userDataRoot } = require("./paths");

function diskFreeGb(dir) {
  try {
    if (process.platform === "win32") {
      const { execSync } = require("child_process");
      const out = execSync(`powershell -NoProfile -Command "(Get-PSDrive -Name ($env:SystemDrive).TrimEnd(':')).Free"`, {
        encoding: "utf8",
        windowsHide: true,
      });
      const bytes = Number(out.trim());
      if (Number.isFinite(bytes)) return Math.round((bytes / 1024 ** 3) * 10) / 10;
    }
  } catch (_) {}
  return null;
}

async function getHealthStatus() {
  const cfg = readConfig();
  const dataDir = cfg.dataDir || defaultDataDir();
  let native;
  let pack;
  try {
    native = require("./engine-native");
    pack = require("./engine-pack");
  } catch {
    native = { nativeReady: () => false, logsDir: () => null };
    pack = { packSupported: () => false, installedVersion: () => null };
  }

  const docker = await checkDocker();
  const [apiUp, webUp] = await Promise.all([ping(API_HEALTH), ping(WEB_URL)]);
  const lan = getLanUrls(cfg.lanAccess !== false);

  return {
    version: require("electron").app?.getVersion?.() || (() => {
      try {
        return JSON.parse(
          fs.readFileSync(path.join(__dirname, "package.json"), "utf8")
        ).version;
      } catch {
        return "0.4.0";
      }
    })(),
    engineMode: cfg.engineMode || "auto",
    docker,
    nativeReady: native.nativeReady(),
    packSupported: pack.packSupported(),
    packVersion: pack.installedVersion(),
    packAsset: pack.packAssetName?.() || null,
    apiUp,
    webUp,
    dataDir,
    libraryPath: cfg.libraryPath || defaultLibraryDir(),
    userData: userDataRoot(),
    logsDir: native.logsDir?.() || path.join(dataDir, "engine", "logs"),
    diskFreeGb: diskFreeGb(dataDir),
    platform: process.platform,
    arch: process.arch,
    lanAccess: cfg.lanAccess !== false,
    lan,
  };
}

module.exports = { getHealthStatus, diskFreeGb };
