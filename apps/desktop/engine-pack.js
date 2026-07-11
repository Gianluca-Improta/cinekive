/**
 * Download and extract the native engine pack from GitHub Releases.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { spawn } = require("child_process");
const { engineRoot, nativeReady } = require("./engine-native");
const { readConfig, defaultDataDir } = require("./paths");

const REPO = "Gianluca-Improta/cinekive";

function packAssetName() {
  if (process.platform === "win32") return "engine-win-x64.zip";
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "engine-mac-arm64.zip" : "engine-mac-x64.zip";
  }
  return "engine-linux-x64.zip";
}

function packSupported() {
  return process.platform === "win32";
}

function installedVersion() {
  const marker = path.join(engineRoot(), "version.txt");
  if (!fs.existsSync(marker)) return null;
  return fs.readFileSync(marker, "utf8").trim();
}

function releaseDownloadUrl(version) {
  const tag = version.startsWith("v") ? version : `v${version}`;
  const asset = packAssetName();
  return `https://github.com/${REPO}/releases/download/${tag}/${asset}`;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      shell: true,
      windowsHide: true,
      ...opts,
    });
    let err = "";
    child.stderr?.on("data", (d) => {
      err += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err || `${cmd} exited ${code}`));
    });
  });
}

function downloadFile(url, dest, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const follow = (u, redirects = 0) => {
      if (redirects > 8) return reject(new Error("Too many redirects"));
      const lib = u.startsWith("https") ? https : http;
      lib
        .get(u, { headers: { "User-Agent": "Cinekive-Desktop" } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            return follow(res.headers.location, redirects + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          }
          const total = Number(res.headers["content-length"] || 0);
          let done = 0;
          const file = fs.createWriteStream(dest);
          res.on("data", (chunk) => {
            done += chunk.length;
            if (total && onProgress) onProgress(done, total);
          });
          res.pipe(file);
          file.on("finish", () => file.close(() => resolve(dest)));
          file.on("error", reject);
        })
        .on("error", reject);
    };
    follow(url);
  });
}

async function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  if (process.platform === "win32") {
    await run("powershell", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
    ]);
  } else {
    await run("unzip", ["-o", zipPath, "-d", destDir]);
  }
}

function flattenEngineRoot(destDir) {
  const nested = path.join(destDir, "engine");
  if (fs.existsSync(path.join(nested, "qdrant")) || fs.existsSync(path.join(nested, "python"))) {
    for (const name of fs.readdirSync(nested)) {
      const src = path.join(nested, name);
      const dst = path.join(destDir, name);
      if (fs.existsSync(dst)) {
        fs.rmSync(dst, { recursive: true, force: true });
      }
      fs.renameSync(src, dst);
    }
    fs.rmSync(nested, { recursive: true, force: true });
  }
}

/**
 * @param {{ version?: string, onStatus?: (s: string) => void, onProgress?: (done: number, total: number) => void }} opts
 */
async function ensureEnginePack({ version, onStatus, onProgress } = {}) {
  if (nativeReady()) {
    onStatus?.("Native engine ready");
    return { ok: true, alreadyInstalled: true };
  }

  if (!packSupported()) {
    throw new Error(
      "Native engine pack is not available for this platform yet.\n\nInstall Docker Desktop, or use the browser bootstrap on macOS/Linux."
    );
  }

  const ver =
    version ||
    (() => {
      try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).version;
      } catch {
        return "0.4.0";
      }
    })();
  const url = releaseDownloadUrl(ver);
  const root = engineRoot();
  const dataDir = readConfig().dataDir || defaultDataDir();
  fs.mkdirSync(path.dirname(root), { recursive: true });

  const tmpZip = path.join(dataDir, packAssetName());
  onStatus?.(`Downloading engine pack (${packAssetName()})…`);
  try {
    await downloadFile(url, tmpZip, { onProgress });
  } catch (e) {
    throw new Error(
      `Could not download engine pack for ${ver}.\n\n${e.message}\n\nInstall Docker Desktop instead, or check your connection.`
    );
  }

  onStatus?.("Extracting engine pack…");
  const staging = path.join(dataDir, "engine-staging");
  if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });

  try {
    await extractZip(tmpZip, staging);
    flattenEngineRoot(staging);

    if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
    fs.renameSync(staging, root);
    fs.writeFileSync(path.join(root, "version.txt"), ver, "utf8");
  } finally {
    try {
      fs.unlinkSync(tmpZip);
    } catch (_) {}
    try {
      if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    } catch (_) {}
  }

  if (!nativeReady()) {
    throw new Error("Engine pack extracted but files are missing. Try again or use Docker.");
  }

  onStatus?.("Engine pack installed");
  return { ok: true, alreadyInstalled: false };
}

module.exports = {
  packAssetName,
  packSupported,
  installedVersion,
  releaseDownloadUrl,
  ensureEnginePack,
  nativeReady,
};
