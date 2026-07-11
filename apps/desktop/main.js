/**
 * Cinekive desktop — Electron main process.
 * First-run wizard → Docker stack → app window. No terminal required.
 */

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  dialog,
  shell,
  ipcMain,
  nativeImage,
  clipboard,
} = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const {
  ensureStack,
  stopStack,
  restartStack,
  setLibraryHostPath,
  checkDocker,
  ping,
  resolveEngineMode,
  WEB_URL,
  API_HEALTH,
  getLanUrls,
} = require("./launcher");
const {
  stackRoot,
  readConfig,
  writeConfig,
  defaultLibraryDir,
  defaultDataDir,
  ensureDataDirs,
  userDataRoot,
} = require("./paths");

const isDev = process.argv.includes("--dev");

let mainWindow = null;
let splashWindow = null;
let wizardWindow = null;
let tray = null;
let shareProc = null;
let quitting = false;

function iconPath() {
  const ico = path.join(__dirname, "assets", "icon.ico");
  const png = path.join(__dirname, "assets", "icon.png");
  if (fs.existsSync(ico)) return ico;
  if (fs.existsSync(png)) return png;
  return null;
}

function loadIcon() {
  const p = iconPath();
  if (!p) return undefined;
  return nativeImage.createFromPath(p);
}

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 440,
    height: 260,
    frame: false,
    resizable: false,
    show: true,
    backgroundColor: "#050505",
    icon: loadIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  splashWindow.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(`<!doctype html>
<html><head><style>
  html,body{margin:0;height:100%;background:#050505;color:#8a8a8a;
  font:14px "Segoe UI",system-ui;display:flex;align-items:center;justify-content:center}
  .box{text-align:center;padding:28px}
  h1{color:#fff;font-size:22px;font-weight:650;margin:0 0 10px;letter-spacing:.02em}
  #s{color:#00E5FF;font-size:12px;min-height:1.4em}
  .bar{margin:18px auto 0;width:180px;height:2px;background:#1a1a1a;overflow:hidden;border-radius:2px}
  .bar i{display:block;height:100%;width:40%;background:#00E5FF;animation:s 1.2s ease-in-out infinite}
  @keyframes s{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}
</style></head><body><div class="box">
  <h1>Cinekive</h1>
  <div id="s">Starting…</div>
  <div class="bar"><i></i></div>
</div>
<script>
  window.cinekive?.onStatus?.((msg)=> { document.getElementById('s').textContent = msg; });
</script></body></html>`)
  );
}

function setSplashStatus(msg) {
  splashWindow?.webContents.send("status", msg);
}

function createWizard() {
  wizardWindow = new BrowserWindow({
    width: 620,
    height: 720,
    resizable: false,
    show: true,
    backgroundColor: "#050505",
    title: "Welcome to Cinekive",
    icon: loadIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  wizardWindow.loadFile(path.join(__dirname, "wizard.html"));
  wizardWindow.on("closed", () => {
    wizardWindow = null;
    if (!mainWindow && !quitting && !splashWindow) app.quit();
  });
}

function createMain() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: "#000000",
    title: "Cinekive",
    show: false,
    icon: loadIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    splashWindow?.close();
    splashWindow = null;
    wizardWindow?.close();
    wizardWindow = null;
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: "detach" });
  });

  mainWindow.loadURL(WEB_URL);
  mainWindow.on("close", (e) => {
    if (!quitting && process.platform === "win32" && tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createTray() {
  const icon = loadIcon();
  if (!icon || icon.isEmpty()) return;
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip("Cinekive");
  const menu = Menu.buildFromTemplate([
    {
      label: "Show Cinekive",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: "Open in browser",
      click: () => shell.openExternal(WEB_URL),
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on("double-click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

function buildMenu() {
  const template = [
    {
      label: "Cinekive",
      submenu: [
        {
          label: "Choose library folder…",
          click: async () => {
            const res = await dialog.showOpenDialog({
              title: "Visual archive folder",
              properties: ["openDirectory", "createDirectory"],
            });
            if (res.canceled || !res.filePaths[0]) return;
            const lib = res.filePaths[0];
            setLibraryHostPath(lib);
            writeConfig({ libraryPath: lib });
            const restart = await dialog.showMessageBox({
              type: "info",
              buttons: ["Restart stack", "Later"],
              defaultId: 0,
              message: "Library path saved",
              detail:
                "Docker needs a restart to mount the new folder. Existing files are not moved automatically.",
            });
            if (restart.response === 0) {
              try {
                createSplash();
                await restartStack({ onStatus: setSplashStatus });
                splashWindow?.close();
                splashWindow = null;
                mainWindow?.reload();
              } catch (e) {
                splashWindow?.close();
                dialog.showErrorBox("Restart failed", String(e.message || e));
              }
            }
          },
        },
        {
          label: "Open library folder",
          click: () => {
            const cfg = readConfig();
            shell.openPath(cfg.libraryPath || defaultLibraryDir());
          },
        },
        {
          label: "Engine mode…",
          click: async () => {
            const health = await require("./health").getHealthStatus();
            const modes = ["auto", "docker", "native"];
            const current = readConfig().engineMode || "auto";
            const idx = modes.indexOf(current);
            const pick = await dialog.showMessageBox({
              type: "question",
              buttons: ["Auto (recommended)", "Docker", "Native (no Docker)", "Cancel"],
              defaultId: idx >= 0 ? idx : 0,
              cancelId: 3,
              title: "Engine mode",
              detail: `Current: ${current}\nDocker: ${health.docker?.ok ? "ready" : "not available"}\nNative pack: ${health.nativeReady ? "installed" : "not installed"}`,
            });
            if (pick.response === 3) return;
            writeConfig({ engineMode: modes[pick.response] });
            const go = await dialog.showMessageBox({
              type: "info",
              buttons: ["Restart now", "Later"],
              defaultId: 0,
              message: "Engine mode saved",
              detail: "Restart the engine for the change to take effect.",
            });
            if (go.response === 0) {
              createSplash();
              await restartStack({ onStatus: setSplashStatus });
              splashWindow?.close();
              mainWindow?.reload();
            }
          },
        },
        {
          label: "Open engine logs",
          click: () => {
            const dir = require("./engine-native").openLogsDir?.() || require("./engine-native").logsDir();
            shell.openPath(dir);
          },
        },
        { type: "separator" },
        {
          label: "Open in browser",
          click: () => shell.openExternal(WEB_URL),
        },
        {
          label: "Open Settings",
          click: () => {
            mainWindow?.show();
            mainWindow?.loadURL(`${WEB_URL}/settings`);
          },
        },
        { type: "separator" },
        {
          label: "Restart engine",
          click: async () => {
            try {
              createSplash();
              await restartStack({ onStatus: setSplashStatus });
              splashWindow?.close();
              splashWindow = null;
              mainWindow?.reload();
            } catch (e) {
              splashWindow?.close();
              dialog.showErrorBox("Restart failed", String(e.message || e));
            }
          },
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Share",
      submenu: [
        {
          label: "Copy phone URL (WiFi)…",
          click: () => {
            const cfg = readConfig();
            const lan = getLanUrls(cfg.lanAccess !== false);
            if (!lan.webUrl) {
              dialog.showMessageBox({
                type: "info",
                title: "WiFi access",
                message: "LAN URL not available",
                detail:
                  "Could not detect your WiFi IP. Make sure you are on a network and LAN access is enabled in settings.",
              });
              return;
            }
            clipboard.writeText(lan.webUrl);
            dialog.showMessageBox({
              type: "info",
              title: "Phone on WiFi",
              message: "URL copied",
              detail: `On your phone (same WiFi), open:\n\n${lan.webUrl}\n\nAPI: ${lan.apiUrl}`,
            });
          },
        },
        { type: "separator" },
        { label: "Create view link…", click: () => startShareTunnel() },
        { label: "Stop view link", click: () => stopShareTunnel() },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Getting started",
          click: () => shell.openPath(path.join(stackRoot(), "docs", "DESKTOP.md")),
        },
        {
          label: "API docs",
          click: () => shell.openExternal("http://localhost:8000/docs"),
        },
        {
          label: "Open user data folder",
          click: () => shell.openPath(userDataRoot()),
        },
        { type: "separator" },
        {
          label: "About Cinekive",
          click: () =>
            dialog.showMessageBox({
              type: "info",
              title: "About Cinekive",
              message: "Cinekive",
              detail: `Version ${app.getVersion()}\nLocal-first cinematic archive.\nStack: ${stackRoot()}`,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function startShareTunnel() {
  if (shareProc) {
    dialog.showMessageBox({
      type: "info",
      message: "A view link is already running.",
      detail: "Use Share → Stop view link first.",
    });
    return;
  }
  const bin = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  try {
    shareProc = spawn(bin, ["tunnel", "--url", WEB_URL], {
      shell: true,
      windowsHide: false,
    });
  } catch {
    dialog.showErrorBox(
      "cloudflared not found",
      "Install Cloudflare Tunnel:\n  winget install Cloudflare.cloudflared\n\nThen try again."
    );
    shareProc = null;
    return;
  }

  let buf = "";
  let announced = false;
  const onData = (d) => {
    buf += d.toString();
    const m = buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !announced) {
      announced = true;
      const url = m[0];
      dialog
        .showMessageBox({
          type: "info",
          buttons: ["Copy link", "Open", "OK"],
          defaultId: 0,
          message: "View link ready",
          detail: `${url}\n\nAnyone with this link can browse your library while Cinekive stays open.`,
        })
        .then((r) => {
          if (r.response === 0) clipboard.writeText(url);
          else if (r.response === 1) shell.openExternal(url);
        });
    }
  };
  shareProc.stdout?.on("data", onData);
  shareProc.stderr?.on("data", onData);
  shareProc.on("error", () => {
    dialog.showErrorBox(
      "cloudflared not found",
      "Install with:\n  winget install Cloudflare.cloudflared"
    );
    shareProc = null;
  });
  shareProc.on("exit", () => {
    shareProc = null;
  });
}

function stopShareTunnel() {
  if (!shareProc) {
    dialog.showMessageBox({ message: "No view link is running." });
    return;
  }
  shareProc.kill();
  shareProc = null;
}

async function bootStackAndMain() {
  createSplash();
  try {
    await ensureStack({
      onStatus: setSplashStatus,
      onProgress: (done, total) => {
        splashWindow?.webContents.send("download-progress", done, total);
        setSplashStatus(`Downloading engine… ${total ? Math.round((done / total) * 100) : 0}%`);
      },
    });
    createMain();
    createTray();
  } catch (e) {
    splashWindow?.close();
    splashWindow = null;
    const msg = String(e.message || e);
    const box = await dialog.showMessageBox({
      type: "error",
      title: "Cinekive failed to start",
      message: "Could not start the local engine",
      detail: msg,
      buttons: ["Open setup", "Quit"],
      defaultId: 0,
    });
    if (box.response === 0) {
      writeConfig({ firstRunComplete: false });
      createWizard();
    } else {
      app.quit();
    }
  }
}

// --- IPC ---
ipcMain.handle("get-info", async () => ({
  webUrl: WEB_URL,
  root: stackRoot(),
  apiUp: await ping(API_HEALTH),
  version: app.getVersion(),
  engineMode: readConfig().engineMode || "auto",
  resolvedEngine: await resolveEngineMode().catch(() => "unknown"),
}));

ipcMain.handle("get-health-status", async () => require("./health").getHealthStatus());

ipcMain.handle("set-engine-mode", async (_e, mode) => {
  if (!["auto", "docker", "native"].includes(mode)) throw new Error("Invalid engine mode");
  writeConfig({ engineMode: mode });
  return readConfig();
});

ipcMain.handle("open-engine-logs", async () => {
  const native = require("./engine-native");
  const dir = native.logsDir();
  await shell.openPath(dir);
  return dir;
});

ipcMain.handle("get-setup-info", async () => {
  const cfg = readConfig();
  const pack = require("./engine-pack");
  return {
    libraryPath: cfg.libraryPath,
    defaultLibraryPath: defaultLibraryDir(),
    dataDir: cfg.dataDir || defaultDataDir(),
    userData: userDataRoot(),
    engineMode: cfg.engineMode || "auto",
    packSupported: pack.packSupported(),
    nativeReady: require("./engine-native").nativeReady(),
  };
});

ipcMain.handle("check-docker", async () => checkDocker());

ipcMain.handle("pick-library-folder", async () => {
  const win = wizardWindow || mainWindow;
  const res = await dialog.showOpenDialog(win, {
    title: "Visual archive folder",
    properties: ["openDirectory", "createDirectory"],
    defaultPath: readConfig().libraryPath || defaultLibraryDir(),
  });
  if (res.canceled || !res.filePaths[0]) return null;
  return res.filePaths[0];
});

ipcMain.handle("complete-first-run", async (_e, opts) => {
  const libraryPath = (typeof opts === "string" ? opts : opts?.libraryPath) || defaultLibraryDir();
  const engineMode = (typeof opts === "object" && opts?.engineMode) || "auto";
  const dataDir = defaultDataDir();
  ensureDataDirs(dataDir, libraryPath);
  setLibraryHostPath(libraryPath);
  writeConfig({
    firstRunComplete: true,
    libraryPath,
    dataDir,
    engineMode,
  });
  if (wizardWindow) {
    wizardWindow.webContents.send("download-progress", 0, 0);
    wizardWindow.hide();
  }
  await bootStackAndMain();
});

ipcMain.handle("open-external", async (_e, url) => {
  await shell.openExternal(url);
});

ipcMain.handle("quit-app", async () => {
  quitting = true;
  app.quit();
});

app.whenReady().then(async () => {
  buildMenu();
  const cfg = readConfig();
  if (!cfg.firstRunComplete) {
    // Seed defaults so wizard shows a sensible path
    ensureDataDirs(defaultDataDir(), cfg.libraryPath || defaultLibraryDir());
    createWizard();
    return;
  }
  await bootStackAndMain();
});

app.on("before-quit", async (e) => {
  quitting = true;
  stopShareTunnel();
  const cfg = readConfig();
  if (cfg.stopStackOnQuit) {
    e.preventDefault();
    try {
      await stopStack();
    } catch {
      /* ignore */
    }
    app.exit(0);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !tray) {
    quitting = true;
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const cfg = readConfig();
    if (cfg.firstRunComplete) createMain();
    else createWizard();
  } else {
    mainWindow?.show();
  }
});
