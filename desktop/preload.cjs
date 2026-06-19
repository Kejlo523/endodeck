const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("EndoDeckDesktop", {
  status: () => ipcRenderer.invoke("runtime-status"),
  restartServer: () => ipcRenderer.invoke("runtime-restart"),
  diagnose: (serial) => ipcRenderer.invoke("device-diagnose", serial),
  pair: (serial) => ipcRenderer.invoke("device-pair", serial),
  installApk: (serial) => ipcRenderer.invoke("device-install-apk", serial),
  install: (request) => ipcRenderer.invoke("device-install", request),
  reboot: (serial) => ipcRenderer.invoke("device-reboot", serial),
  openStudio: () => ipcRenderer.invoke("open-studio"),
  openDevicePanel: () => ipcRenderer.invoke("open-device-panel"),
  openData: () => ipcRenderer.invoke("open-data"),
  getAutostart: () => ipcRenderer.invoke("get-autostart"),
  setAutostart: (enabled) => ipcRenderer.invoke("set-autostart", enabled),
  checkUpdates: () => ipcRenderer.invoke("check-updates"),
  installModuleUpdates: (serial) => ipcRenderer.invoke("install-module-updates", serial),
  onUpdateStatus: (callback) => ipcRenderer.on("update-status", (_, value) => callback(value))
});
