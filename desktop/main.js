import { app, BrowserWindow, ipcMain, Menu, nativeImage, powerMonitor, shell, Tray } from "electron";
import updater from "electron-updater";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = fileURLToPath(new URL(".", import.meta.url));
const { autoUpdater } = updater;
let runtime;
let tray;
let wizard;
let updateReady = false;
let updateTimer;
let phoneUpdateTimer;
let releaseUpdates;
let startServerFn;
let ReleaseUpdateManagerClass;
let restartingServer = false;

function bootLog(message) {
  if (!process.env.ENDODECK_BOOT_LOG) return;
  try { appendFileSync(process.env.ENDODECK_BOOT_LOG, `${new Date().toISOString()} ${message}\n`); } catch {}
}

bootLog("main module loaded");

app.setName("EndoDeck");
app.setAppUserModelId("pl.endozero.endodeck");
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
  process.exit(0);
}

function appIconPath(extension = "png") {
  return join(app.getAppPath(), "resources", `endodeck-icon.${extension}`);
}

function trayIcon() {
  const icon = nativeImage.createFromPath(appIconPath("png"));
  return icon.isEmpty() ? nativeImage.createFromPath(join(app.getAppPath(), "public", "favicon.svg")) : icon;
}

function configurePaths() {
  process.env.ENDODECK_DATA_DIR ||= app.getPath("userData");
  process.env.ENDODECK_RESOURCE_ROOT = app.getAppPath();
  if (app.isPackaged) {
    process.env.ENDODECK_ARTIFACTS_DIR = join(process.resourcesPath, "artifacts");
    process.env.ENDODECK_PLATFORM_TOOLS = join(process.resourcesPath, "platform-tools");
    process.env.ENDODECK_NATIVE_DIR = join(process.resourcesPath, "native");
    process.env.ENDODECK_SCRIPTS_DIR = join(process.resourcesPath, "scripts");
  }
}

function createWizard() {
  if (wizard && !wizard.isDestroyed()) {
    if (wizard.isMinimized()) wizard.restore();
    wizard.show();
    wizard.focus();
    return wizard;
  }
  wizard = new BrowserWindow({
    width: 940,
    height: 680,
    minWidth: 760,
    minHeight: 560,
    title: "EndoDeck Setup",
    backgroundColor: "#0a0d0b",
    icon: appIconPath("ico"),
    webPreferences: { preload: join(desktopDir, "preload.cjs"), contextIsolation: true, nodeIntegration: false }
  });
  wizard.removeMenu();
  wizard.loadFile(join(desktopDir, "wizard.html"));
  wizard.on("closed", () => { wizard = null; });
  return wizard;
}

function openDeck(path = "/editor.html") {
  return shell.openExternal(runtime.url(path));
}

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: runtime ? `Serwer: działa na 127.0.0.1:${runtime.port}` : restartingServer ? "Serwer: restart..." : "Serwer: offline", enabled: false },
    { label: runtime?.state.adb ? `Telefon: ${runtime.state.serial}` : runtime?.state.detectedSerials?.length ? `Inny telefon: ${runtime.state.detectedSerials.join(", ")}` : "Telefon: offline", enabled: false },
    { label: "Otwórz Studio", enabled: Boolean(runtime), click: () => openDeck("/editor.html") },
    { label: "Otwórz deck", enabled: Boolean(runtime), click: () => openDeck("/") },
    { label: "Konfiguracja telefonu", click: createWizard },
    { label: "Restartuj serwer", enabled: !restartingServer, click: () => restartRuntime().catch((error) => wizard?.webContents.send("update-status", { error: error.message })) },
    { type: "separator" },
    { label: updateReady ? "Zainstaluj pobraną aktualizację" : "Sprawdź aktualizacje", click: () => updateReady ? autoUpdater.quitAndInstall(false, true) : autoUpdater.checkForUpdates() },
    { label: "Uruchamiaj z Windows", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin, click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, path: process.execPath }) },
    { type: "separator" },
    { label: "Zakończ EndoDeck", click: () => app.quit() }
  ]);
}

function createTray() {
  const icon = trayIcon();
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 20, height: 20 }));
  updateTray();
  tray.on("double-click", createWizard);
}

function updateTray() {
  if (!tray) return;
  const serverLabel = runtime ? `serwer 127.0.0.1:${runtime.port}` : restartingServer ? "restart serwera" : "serwer offline";
  const phoneLabel = runtime?.state.adb ? `telefon ${runtime.state.serial}` : runtime?.state.detectedSerials?.length ? "podłączono inny telefon" : "telefon offline";
  tray.setToolTip(`EndoDeck Beta\n${serverLabel}\n${phoneLabel}`);
  tray.setContextMenu(trayMenu());
}

async function bootRuntime() {
  runtime = await startServerFn({ onState: updateTray });
  releaseUpdates = new ReleaseUpdateManagerClass({ adb: runtime.adb, currentVersion: app.getVersion(), channel: (await runtime.getConfig()).updates?.channel || "beta" });
  updateTray();
  return runtime;
}

async function restartRuntime() {
  if (restartingServer) return { ok: false, error: "Restart serwera już trwa" };
  restartingServer = true;
  updateTray();
  try {
    await runtime?.stop();
    runtime = null;
    await bootRuntime();
    return { ok: true, port: runtime.port, state: runtime.state };
  } finally {
    restartingServer = false;
    updateTray();
  }
}

function configureUpdates(config) {
  autoUpdater.allowPrerelease = config.updates?.channel !== "stable";
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-downloaded", () => {
    updateReady = true;
    tray?.setContextMenu(trayMenu());
  });
  autoUpdater.on("error", (error) => wizard?.webContents.send("update-status", { error: error.message }));
  if (app.isPackaged) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 15000);
    updateTimer = setInterval(() => {
      if (config.updates?.automaticDesktop && updateReady && powerMonitor.getSystemIdleTime() >= 300 && !wizard?.isVisible()) autoUpdater.quitAndInstall(false, true);
    }, 60000);
    const checkPhone = () => {
      if (!runtime?.state.serial || !releaseUpdates) return;
      releaseUpdates.checkPhone(runtime.state.serial, { automaticApk: config.updates?.automaticApk !== false })
        .then((result) => {
          if (result.apkUpdated || result.modulesPending) wizard?.webContents.send("update-status", { message: result.apkUpdated ? "APK telefonu zaktualizowane" : `Pobrano ${result.modulesPending} moduły Magisk` });
        })
        .catch(() => {});
    };
    setTimeout(checkPhone, 60000);
    phoneUpdateTimer = setInterval(checkPhone, 6 * 60 * 60 * 1000);
  }
}

function registerIpc() {
  ipcMain.handle("runtime-status", async () => ({ state: runtime?.state ?? { adb: false, serial: null }, health: runtime ? await fetch(`http://127.0.0.1:${runtime.port}/api/health`).then((response) => response.json()) : { ok: false, error: "Serwer offline" } }));
  ipcMain.handle("runtime-restart", async () => restartRuntime());
  ipcMain.handle("device-diagnose", (_, serial) => runtime.adb.diagnose(serial));
  ipcMain.handle("device-pair", (_, serial) => runtime.adb.pair(serial));
  ipcMain.handle("device-install-apk", (_, serial) => runtime.adb.installApplication(serial));
  ipcMain.handle("device-install", (_, request) => runtime.adb.installProfile(request.serial, request.options));
  ipcMain.handle("device-reboot", (_, serial) => runtime.adb.run(["-s", serial, "reboot"], 10000).then(() => ({ ok: true })));
  ipcMain.handle("open-studio", () => openDeck("/editor.html"));
  ipcMain.handle("open-data", () => shell.openPath(app.getPath("userData")));
  ipcMain.handle("set-autostart", (_, enabled) => { app.setLoginItemSettings({ openAtLogin: Boolean(enabled), path: process.execPath }); return app.getLoginItemSettings(); });
  ipcMain.handle("get-autostart", () => app.getLoginItemSettings());
  ipcMain.handle("check-updates", async () => {
    try {
      const config = await runtime.getConfig();
      const phone = await releaseUpdates.checkPhone(runtime.state.serial, { automaticApk: config.updates?.automaticApk !== false });
      if (app.isPackaged) await autoUpdater.checkForUpdates();
      return { ok: true, phone };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle("install-module-updates", (_, serial) => releaseUpdates.installPendingModules(serial));
}

app.on("second-instance", () => createWizard());
app.on("activate", () => createWizard());
app.on("window-all-closed", (event) => event.preventDefault());
app.on("before-quit", () => { clearInterval(updateTimer); clearInterval(phoneUpdateTimer); runtime?.stop(); });

app.whenReady().then(async () => {
  bootLog("electron ready");
  configurePaths();
  bootLog(`paths configured: ${process.env.ENDODECK_DATA_DIR}`);
  const { startServer } = await import("../src/server.js");
  startServerFn = startServer;
  bootLog("server module imported");
  const { ReleaseUpdateManager } = await import("../src/update-manager.js");
  ReleaseUpdateManagerClass = ReleaseUpdateManager;
  await bootRuntime();
  bootLog(`server listening: ${runtime.port}`);
  const config = await runtime.getConfig();
  registerIpc();
  bootLog("ipc registered");
  createTray();
  bootLog("tray created");
  configureUpdates(config);
  if (!runtime.state.serial) createWizard();
}).catch((error) => {
  bootLog(`fatal: ${error.stack || error.message}`);
  console.error(error);
  app.quit();
});
