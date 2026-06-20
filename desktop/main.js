import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, powerMonitor, shell, Tray } from "electron";
import updater from "electron-updater";
import { existsSync, appendFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = fileURLToPath(new URL(".", import.meta.url));
const { autoUpdater } = updater;
let runtime;
let tray;
let mainWindow;
let updateReady = false;
let updateTimer;
let phoneUpdateTimer;
let runtimeHealthTimer;
let releaseUpdates;
let startServerFn;
let ReleaseUpdateManagerClass;
let restartingServer = false;
let runtimeRecoveryTimer;
let runtimeHealthFailedOnce = false;

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
  const candidates = [
    join(app.getAppPath(), "resources", `endodeck-icon.${extension}`),
    join(process.resourcesPath || "", "resources", `endodeck-icon.${extension}`),
    join(process.resourcesPath || "", `endodeck-icon.${extension}`)
  ];
  return candidates.find((path) => path && existsSync(path)) ?? candidates[0];
}

function trayIcon() {
  const icon = nativeImage.createFromPath(appIconPath("png"));
  if (!icon.isEmpty()) return icon;
  const fallback = nativeImage.createFromPath(join(app.getAppPath(), "public", "favicon.svg"));
  return fallback.isEmpty() ? nativeImage.createEmpty() : fallback;
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

function runtimeDelay(config, key, fallback, minimum = 1000) {
  const value = Number(config.runtime?.[key]);
  return Number.isFinite(value) && value >= minimum ? value : fallback;
}

function backgroundLaunch() {
  const loginState = app.getLoginItemSettings();
  return process.argv.includes("--background") || process.argv.includes("--hidden") || Boolean(loginState.wasOpenedAtLogin);
}

function wantsWindow(argv = process.argv) {
  return argv.includes("--open") || argv.includes("--setup") || argv.includes("--studio") || argv.includes("--deck");
}

function openRequestedWindow(argv = process.argv) {
  if (argv.includes("--studio")) return openDeck("/editor.html");
  if (argv.includes("--deck")) return openDeck("/");
  return openSetup();
}

function autostartSettings(enabled) {
  return { openAtLogin: Boolean(enabled), path: app.getPath("exe"), args: enabled ? ["--background"] : [] };
}

function autostartPreferencePath() {
  return join(app.getPath("userData"), "autostart.json");
}

function readAutostartPreference() {
  try {
    const value = JSON.parse(readFileSync(autostartPreferencePath(), "utf8"));
    return typeof value.enabled === "boolean" && value.userConfigured === true ? value : null;
  } catch {
    return null;
  }
}

function writeAutostartPreference(enabled) {
  try {
    mkdirSync(app.getPath("userData"), { recursive: true });
    writeFileSync(autostartPreferencePath(), `${JSON.stringify({ enabled: Boolean(enabled), userConfigured: true, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  } catch (error) {
    bootLog(`autostart preference write failed: ${error.message}`);
  }
}

function queryRunValue(name) {
  if (process.platform !== "win32") return "";
  const result = spawnSync("reg.exe", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", name], {
    encoding: "utf8",
    windowsHide: true
  });
  return result.status === 0 ? `${result.stdout}\n${result.stderr}` : "";
}

function deleteRunValue(name) {
  if (process.platform !== "win32") return;
  spawnSync("reg.exe", ["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", name, "/f"], {
    encoding: "utf8",
    windowsHide: true
  });
}

function cleanupLegacyAutostart() {
  if (process.platform !== "win32") return;
  const startupShortcut = join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "EndoDeck.lnk");
  try {
    if (startupShortcut && existsSync(startupShortcut)) {
      unlinkSync(startupShortcut);
      bootLog(`removed legacy startup shortcut: ${startupShortcut}`);
    }
  } catch (error) {
    bootLog(`legacy startup shortcut cleanup failed: ${error.message}`);
  }

  const runValue = queryRunValue("pl.endozero.endodeck");
  if (/node_modules\\electron|scripts\\start-endodeck\.ps1|powershell\.exe|node\.exe/i.test(runValue)) {
    deleteRunValue("pl.endozero.endodeck");
    bootLog("removed legacy HKCU Run autostart");
  }
}

function getAutostartState() {
  const state = app.getLoginItemSettings();
  return { ...state, unsupportedDevAutostart: !app.isPackaged };
}

function setAutostart(enabled) {
  cleanupLegacyAutostart();
  if (!app.isPackaged) {
    return { ...getAutostartState(), openAtLogin: false, unsupportedDevAutostart: true };
  }
  app.setLoginItemSettings(autostartSettings(enabled));
  writeAutostartPreference(enabled);
  return getAutostartState();
}

function ensureDefaultAutostart() {
  cleanupLegacyAutostart();
  if (!app.isPackaged) return;
  const preference = readAutostartPreference();
  if (preference) {
    app.setLoginItemSettings(autostartSettings(preference.enabled));
    return;
  }
  if (!app.getLoginItemSettings().openAtLogin) {
    app.setLoginItemSettings(autostartSettings(true));
    bootLog("enabled default packaged autostart");
  }
}

function focusWindow(window) {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function createMainWindow({ show = true } = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (show) focusWindow(mainWindow);
    return mainWindow;
  }
  mainWindow = new BrowserWindow({
    width: 940,
    height: 680,
    minWidth: 760,
    minHeight: 560,
    title: "EndoDeck",
    show,
    backgroundColor: "#0a0d0b",
    icon: appIconPath("ico"),
    webPreferences: { preload: join(desktopDir, "preload.cjs"), contextIsolation: true, nodeIntegration: false }
  });
  mainWindow.removeMenu();
  mainWindow.on("closed", () => { mainWindow = null; });
  return mainWindow;
}

function openSetup() {
  const window = createMainWindow();
  window.loadFile(join(desktopDir, "wizard.html"));
  focusWindow(window);
  return window;
}

function openDeck(path = "/editor.html") {
  if (!runtime) return openSetup();
  const window = createMainWindow();
  window.loadURL(runtime.url(path));
  focusWindow(window);
  return window;
}

function trayMenu() {
  const autostart = getAutostartState();
  return Menu.buildFromTemplate([
    { label: runtime ? `Serwer: działa na 127.0.0.1:${runtime.port}` : restartingServer ? "Serwer: restart..." : "Serwer: offline", enabled: false },
    { label: runtime?.state.adb ? `Telefon: ${runtime.state.serial}` : runtime?.state.detectedSerials?.length ? `Inny telefon: ${runtime.state.detectedSerials.join(", ")}` : "Telefon: offline", enabled: false },
    { label: "Otwórz Studio", enabled: Boolean(runtime), click: () => openDeck("/editor.html") },
    { label: "Otwórz deck", enabled: Boolean(runtime), click: () => openDeck("/") },
    { label: "Konfiguracja telefonu", click: openSetup },
    { label: "Restartuj serwer", enabled: !restartingServer, click: () => restartRuntime().catch((error) => mainWindow?.webContents.send("update-status", { error: error.message })) },
    { type: "separator" },
    { label: updateReady ? "Zainstaluj pobraną aktualizację" : "Sprawdź aktualizacje", click: () => updateReady ? autoUpdater.quitAndInstall(false, true) : autoUpdater.checkForUpdates() },
    { label: app.isPackaged ? "Uruchamiaj z Windows" : "Uruchamiaj z Windows (tylko po instalacji)", type: "checkbox", enabled: app.isPackaged, checked: !autostart.unsupportedDevAutostart && Boolean(autostart.openAtLogin), click: (item) => setAutostart(item.checked) },
    { type: "separator" },
    { label: "Zakończ EndoDeck", click: () => app.quit() }
  ]);
}

function createTray() {
  const icon = trayIcon();
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 20, height: 20 }));
  updateTray();
  tray.on("double-click", openSetup);
}

function updateTray() {
  if (!tray) return;
  const serverLabel = runtime ? `serwer 127.0.0.1:${runtime.port}` : restartingServer ? "restart serwera" : "serwer offline";
  const phoneLabel = runtime?.state.adb ? `telefon ${runtime.state.serial}` : runtime?.state.detectedSerials?.length ? "podłączono inny telefon" : "telefon offline";
  tray.setToolTip(`EndoDeck Beta\n${serverLabel}\n${phoneLabel}`);
  tray.setContextMenu(trayMenu());
}

async function bootRuntime() {
  runtime = await startServerFn({ onState: updateTray, version: app.getVersion() });
  releaseUpdates = new ReleaseUpdateManagerClass({ adb: runtime.adb, currentVersion: app.getVersion(), channel: (await runtime.getConfig()).updates?.channel || "beta" });
  updateTray();
  return runtime;
}

async function restartRuntime() {
  if (restartingServer) return { ok: false, error: "Restart serwera już trwa" };
  restartingServer = true;
  updateTray();
  try {
    try { await runtime?.stop(); }
    catch (error) { bootLog(`runtime stop failed during restart: ${error.stack || error.message}`); }
    runtime = null;
    await bootRuntime();
    return { ok: true, port: runtime.port, state: runtime.state };
  } finally {
    restartingServer = false;
    updateTray();
  }
}

function scheduleRuntimeRecovery(reason) {
  if (!startServerFn) return;
  clearTimeout(runtimeRecoveryTimer);
  bootLog(`runtime recovery scheduled: ${reason}`);
  runtimeRecoveryTimer = setTimeout(async () => {
    try {
      await restartRuntime();
      bootLog(`runtime recovery finished: ${reason}`);
    } catch (error) {
      bootLog(`runtime recovery failed: ${reason}: ${error.stack || error.message}`);
    }
  }, 2500);
}

async function runtimeHealthCheck() {
  if (!runtime || restartingServer) return;
  let timeout;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 2500);
    const response = await fetch(`http://127.0.0.1:${runtime.port}/api/health`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    runtimeHealthFailedOnce = false;
  } catch (error) {
    bootLog(`runtime health failed: ${error.message}`);
    if (runtimeHealthFailedOnce) scheduleRuntimeRecovery("health-watchdog");
    runtimeHealthFailedOnce = true;
  } finally {
    clearTimeout(timeout);
  }
}

function configureRuntimeWatchdog(config) {
  clearInterval(runtimeHealthTimer);
  runtimeHealthTimer = setInterval(runtimeHealthCheck, runtimeDelay(config, "runtimeHealthPollMs", 30_000, 10_000));
}

function configureUpdates(config) {
  autoUpdater.allowPrerelease = config.updates?.channel !== "stable";
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-downloaded", () => {
    updateReady = true;
    tray?.setContextMenu(trayMenu());
  });
  autoUpdater.on("error", (error) => mainWindow?.webContents.send("update-status", { error: error.message }));
  if (app.isPackaged) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), runtimeDelay(config, "desktopUpdateDelayMs", 15_000));
    updateTimer = setInterval(() => {
      if (config.updates?.automaticDesktop && updateReady && powerMonitor.getSystemIdleTime() >= 300 && !mainWindow?.isVisible()) autoUpdater.quitAndInstall(false, true);
    }, runtimeDelay(config, "desktopUpdatePollMs", 60_000));
    const checkPhone = () => {
      if (!runtime?.state.serial || !releaseUpdates) return;
      releaseUpdates.checkPhone(runtime.state.serial, { automaticApk: config.updates?.automaticApk !== false })
        .then((result) => {
          if (result.apkUpdated || result.modulesPending) mainWindow?.webContents.send("update-status", { message: result.apkUpdated ? "APK telefonu zaktualizowane" : `Pobrano ${result.modulesPending} moduły Magisk` });
        })
        .catch(() => {});
    };
    setTimeout(checkPhone, runtimeDelay(config, "phoneUpdateDelayMs", 60_000));
    phoneUpdateTimer = setInterval(checkPhone, runtimeDelay(config, "phoneUpdatePollMs", 6 * 60 * 60_000));
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
  ipcMain.handle("open-device-panel", () => openSetup());
  ipcMain.handle("open-data", () => shell.openPath(app.getPath("userData")));
  ipcMain.handle("set-autostart", (_, enabled) => setAutostart(enabled));
  ipcMain.handle("get-autostart", () => getAutostartState());
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

app.on("second-instance", (_event, argv) => {
  if (wantsWindow(argv)) openRequestedWindow(argv);
  else updateTray();
});
app.on("activate", () => {
  if (process.platform === "darwin") openSetup();
});
app.on("window-all-closed", (event) => event.preventDefault());
app.on("before-quit", () => { clearInterval(updateTimer); clearInterval(phoneUpdateTimer); clearInterval(runtimeHealthTimer); clearTimeout(runtimeRecoveryTimer); runtime?.stop(); });

app.whenReady().then(async () => {
  bootLog("electron ready");
  configurePaths();
  ensureDefaultAutostart();
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
  powerMonitor.on("resume", () => scheduleRuntimeRecovery("system-resume"));
  powerMonitor.on("unlock-screen", () => scheduleRuntimeRecovery("unlock-screen"));
  configureRuntimeWatchdog(config);
  configureUpdates(config);
  if (wantsWindow()) openRequestedWindow();
  else if (backgroundLaunch()) bootLog("started in background");
  else bootLog("started tray-only");
}).catch((error) => {
  bootLog(`fatal: ${error.stack || error.message}`);
  console.error(error);
  if (error?.code === "EADDRINUSE") {
    dialog.showErrorBox(
      "EndoDeck nie może wystartować",
      "Port 8765 jest już zajęty przez inny proces (zwykle stary serwer EndoDeck uruchomiony ręcznie).\n\nZamknij go w Menedżerze zadań albo uruchom ponownie komputer, a potem odpal EndoDeck jeszcze raz."
    );
  }
  app.quit();
});
