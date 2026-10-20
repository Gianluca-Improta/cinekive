/**
 * Build apps/web standalone into apps/desktop/web-ui-dist for packaging.
 * Run before electron-builder so the installer ships the latest UI.
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");
const webRoot = path.join(repoRoot, "apps", "web");
const outDir = path.join(desktopRoot, "web-ui-dist");

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || webRoot,
    stdio: "inherit",
    shell: false,
    env: { ...process.env, ...(opts.env || {}) },
  });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed with ${r.status}`);
  }
}

/** npm needs a shell on Windows (npm is a .cmd shim). */
function runNpm(args, opts = {}) {
  const cmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || webRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...(opts.env || {}) },
  });
  if (r.status !== 0) {
    throw new Error(`npm ${args.join(" ")} failed with ${r.status}`);
  }
}

function main() {
  if (!fs.existsSync(webRoot)) {
    throw new Error(`Web app missing at ${webRoot}`);
  }

  console.log("Building Cinekive web UI (standalone)…");
  if (!fs.existsSync(path.join(webRoot, "node_modules"))) {
    runNpm(["install", "--legacy-peer-deps"]);
  }

  // Call the Next CLI directly — no npm wrapper, no shell.
  const nextBin = path.join(webRoot, "node_modules", "next", "dist", "bin", "next");
  if (!fs.existsSync(nextBin)) {
    throw new Error(`Next CLI not found at ${nextBin} — run npm install in apps/web first.`);
  }
  run(process.execPath, [nextBin, "build"], {
    env: { NEXT_PUBLIC_API_URL: "http://localhost:8000" },
  });

  const standalone = path.join(webRoot, ".next", "standalone");
  if (!fs.existsSync(standalone)) {
    throw new Error("Next standalone output missing — check next.config output: 'standalone'");
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  // Next's standalone output contains symlinks into node_modules. Copying them
  // as links leaves broken relative paths, and electron-builder then fails with
  // "not a file" while packaging — so the links are resolved into real files.
  fs.cpSync(standalone, outDir, { recursive: true, dereference: true });

  // Flatten nested server.js to web-ui-dist/server.js (engine-native expects this)
  const nestedServer = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name === "server.js") nestedServer.push(p);
    }
  };
  walk(outDir);
  const rootServer = path.join(outDir, "server.js");
  if (!fs.existsSync(rootServer) && nestedServer[0]) {
    fs.copyFileSync(nestedServer[0], rootServer);
  }

  const staticSrc = path.join(webRoot, ".next", "static");
  const staticDest = path.join(outDir, ".next", "static");
  fs.mkdirSync(path.dirname(staticDest), { recursive: true });
  fs.cpSync(staticSrc, staticDest, { recursive: true });

  const publicSrc = path.join(webRoot, "public");
  if (fs.existsSync(publicSrc)) {
    fs.cpSync(publicSrc, path.join(outDir, "public"), { recursive: true });
  }

  const ver = JSON.parse(fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8")).version;
  fs.writeFileSync(path.join(outDir, ".ui-version"), ver, "utf8");
  console.log(`Web UI ready → ${outDir} (ui ${ver})`);
}

main();
