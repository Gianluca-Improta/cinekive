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
  return process.platform === "win32" || process.platform === "darwin";
}

function installedVersion() {
  const marker = path.join(engineRoot(), "version.txt");
  if (!fs.existsSync(marker)) return null;
  return fs.readFileSync(marker, "utf8").trim();
}

function appVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).version;
  } catch {
    return "0.5.1";
  }
}

/** True when pack is missing, outdated, or built with a non-relocatable CI venv. */
function needsEngineRefresh() {
  if (!nativeReady()) return true;
  const installed = installedVersion();
  const wanted = appVersion();
  if (installed && wanted && installed !== wanted) return true;
  if (!installed) return true;

  // Broken Windows/macOS venv from CI: pyvenv.cfg / python points at hostedtoolcache
  const root = engineRoot();
  const cfgPath = path.join(root, "python", "pyvenv.cfg");
  if (fs.existsSync(cfgPath)) {
    const cfg = fs.readFileSync(cfgPath, "utf8");
    if (/hostedtoolcache|\/Users\/runner|D:\\a\\|\/home\/runner/i.test(cfg)) return true;
  }
  try {
    const { execSync } = require("child_process");
    const py =
      process.platform === "win32"
        ? [
            path.join(root, "python", "python.exe"),
            path.join(root, "python", "Scripts", "python.exe"),
          ].find((p) => fs.existsSync(p))
        : [
            path.join(root, "python", "bin", "python3"),
            path.join(root, "python", "bin", "python"),
          ].find((p) => fs.existsSync(p));
    if (!py) return true;
    // Must import the API stack — bare `import sys` can pass on a dead venv redirector
    execSync(`"${py}" -c "import uvicorn, cinearchive"`, {
      cwd: path.join(root, "python"),
      windowsHide: true,
      stdio: "ignore",
      timeout: 20000,
    });
  } catch {
    return true;
  }
  return false;
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

async function extractArchive(archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  if (process.platform === "win32") {
    // Prefer tar (Windows 10+) — Expand-Archive is extremely slow on ~500MB packs
    try {
      await run("tar", ["-xf", archivePath, "-C", destDir]);
      return;
    } catch (e) {
      // Fall back to PowerShell only if tar missing
      await run("powershell", [
        "-NoProfile",
        "-Command",
        `Expand-Archive -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
      ]);
      return;
    }
  }
  if (archivePath.endsWith(".zip")) {
    await run("unzip", ["-o", archivePath, "-d", destDir]);
    return;
  }
  await run("tar", ["-xzf", archivePath, "-C", destDir]);
}

async function extractZip(zipPath, destDir) {
  return extractArchive(zipPath, destDir);
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
 * @param {{ version?: string, force?: boolean, onStatus?: (s: string) => void, onProgress?: (done: number, total: number) => void }} opts
 */
async function ensureEnginePack({ version, force = false, onStatus, onProgress } = {}) {
  if (!force && nativeReady() && !needsEngineRefresh()) {
    onStatus?.("Native engine ready");
    return { ok: true, alreadyInstalled: true };
  }

  if (!packSupported()) {
    throw new Error(
      "Native engine pack is not available for this platform yet.\n\nInstall Docker Desktop, or use the browser bootstrap."
    );
  }

  const ver =
    version ||
    (() => {
      try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).version;
      } catch {
        return "0.5.1";
      }
    })();
  const url = releaseDownloadUrl(ver);
  const root = engineRoot();
  const dataDir = readConfig().dataDir || defaultDataDir();
  fs.mkdirSync(path.dirname(root), { recursive: true });

  // Prefer latest release asset if tagged version 404s (e.g. mid-release)
  let downloadUrl = url;
  const tmpZip = path.join(dataDir, packAssetName());
  onStatus?.(`Downloading engine pack (${packAssetName()})…`);
  try {
    await downloadFile(downloadUrl, tmpZip, { onProgress });
  } catch (e) {
    // Fall back to latest release tag from GitHub
    try {
      onStatus?.("Versioned pack missing — trying latest release…");
      downloadUrl = `https://github.com/${REPO}/releases/latest/download/${packAssetName()}`;
      await downloadFile(downloadUrl, tmpZip, { onProgress });
    } catch (e2) {
      throw new Error(
        `Could not download engine pack for ${ver}.\n\n${e2.message || e.message}\n\nInstall Docker Desktop instead, or check your connection.`
      );
    }
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

  // Refuse to keep a broken CI venv pack
  if (needsEngineRefresh()) {
    throw new Error(
      "Downloaded engine pack still looks broken (non-relocatable Python).\n\n" +
        "Please reinstall from the latest GitHub release, or use Docker mode."
    );
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
  needsEngineRefresh,
  appVersion,
};
