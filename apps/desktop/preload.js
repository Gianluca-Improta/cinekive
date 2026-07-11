const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cinekive", {
  getInfo: () => ipcRenderer.invoke("get-info"),
  getSetupInfo: () => ipcRenderer.invoke("get-setup-info"),
  checkDocker: () => ipcRenderer.invoke("check-docker"),
  pickLibraryFolder: () => ipcRenderer.invoke("pick-library-folder"),
  completeFirstRun: (libraryPath) => ipcRenderer.invoke("complete-first-run", libraryPath),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  quit: () => ipcRenderer.invoke("quit-app"),
  onStatus: (cb) => {
    const handler = (_e, msg) => cb(msg);
    ipcRenderer.on("status", handler);
    return () => ipcRenderer.removeListener("status", handler);
  },
});
