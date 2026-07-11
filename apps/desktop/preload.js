const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cinekive", {
  getInfo: () => ipcRenderer.invoke("get-info"),
  getSetupInfo: () => ipcRenderer.invoke("get-setup-info"),
  getHealthStatus: () => ipcRenderer.invoke("get-health-status"),
  checkDocker: () => ipcRenderer.invoke("check-docker"),
  pickLibraryFolder: () => ipcRenderer.invoke("pick-library-folder"),
  completeFirstRun: (opts) => ipcRenderer.invoke("complete-first-run", opts),
  setEngineMode: (mode) => ipcRenderer.invoke("set-engine-mode", mode),
  openEngineLogs: () => ipcRenderer.invoke("open-engine-logs"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  quit: () => ipcRenderer.invoke("quit-app"),
  onStatus: (cb) => {
    const handler = (_e, msg) => cb(msg);
    ipcRenderer.on("status", handler);
    return () => ipcRenderer.removeListener("status", handler);
  },
  onDownloadProgress: (cb) => {
    const handler = (_e, done, total) => cb(done, total);
    ipcRenderer.on("download-progress", handler);
    return () => ipcRenderer.removeListener("download-progress", handler);
  },
});
