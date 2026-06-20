import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { artifactsDir, platformToolsDir } from "./runtime-paths.js";
import { matchDeviceProfile } from "./device-profiles.js";

const execFileAsync = promisify(execFile);
const PACKAGE = "pl.endozero.endodeck";
const COMPONENT = `${PACKAGE}/.MainActivity`;

async function findAdb() {
  const candidates = [
    process.env.ADB_PATH,
    join(platformToolsDir, "adb.exe"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", "adb.exe"),
    "adb"
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate === "adb") return candidate;
    try { await access(candidate); return candidate; } catch {}
  }
  return "adb";
}

function parseDevices(stdout) {
  return stdout.split(/\r?\n/).slice(1).map((line) => line.trim().split(/\s+/)).filter(([serial]) => serial).map(([serial, state]) => ({ serial, state }));
}

function parseWebView(output) {
  const version = String(output).match(/(?:Current|Preferred) WebView package[^\n]*?([0-9]+(?:\.[0-9]+){2,})/i)?.[1]
    ?? String(output).match(/versionName=([0-9]+(?:\.[0-9]+){2,})/i)?.[1];
  return version || null;
}

function versionAtLeast(value, minimumMajor, minimumMinor = 0) {
  const match = String(value).match(/(\d+)(?:\.(\d+))?/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2] || 0);
  return major > minimumMajor || (major === minimumMajor && minor >= minimumMinor);
}

function parseScheduleMinute(value, fallback) {
  const match = String(value ?? "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hour = Math.min(23, Math.max(0, Number(match[1])));
  const minute = Math.min(59, Math.max(0, Number(match[2])));
  return hour * 60 + minute;
}

function nightOptionLines(config = {}) {
  const nightStandby = config.ui?.display?.nightStandby ?? config.ui?.nightStandby ?? {};
  const startMinute = parseScheduleMinute(nightStandby.start, 0);
  const endMinute = parseScheduleMinute(nightStandby.end, 7 * 60);
  return [
    `NIGHT_STANDBY_ENABLED=${nightStandby.enabled === false ? 0 : 1}`,
    `NIGHT_STANDBY_START_MINUTE=${startMinute}`,
    `NIGHT_STANDBY_END_MINUTE=${endMinute}`,
    `NIGHT_STANDBY_START_HOUR=${Math.floor(startMinute / 60)}`,
    `NIGHT_STANDBY_END_HOUR=${Math.floor(endMinute / 60)}`
  ];
}

function pollInterval(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1000 ? number : 4000;
}

export class AdbBridge {
  constructor({ port, token, pollMs, getConfig, saveConfig, onState }) {
    this.port = port;
    this.token = token;
    this.pollMs = pollInterval(pollMs);
    this.getConfig = getConfig;
    this.saveConfig = saveConfig;
    this.onState = onState;
    this.adb = null;
    this.timer = null;
    this.connected = false;
    this.configuredSerial = null;
    this.lastDevice = null;
    this.installing = false;
  }

  async run(args, timeout = 8000) {
    this.adb ??= await findAdb();
    return execFileAsync(this.adb, args, { timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  }

  async listDevices() {
    return parseDevices((await this.run(["devices", "-l"])).stdout);
  }

  async shell(serial, command, timeout = 8000) {
    return (await this.run(["-s", serial, "shell", command], timeout)).stdout.trim();
  }

  async diagnose(serial) {
    const selected = serial || (await this.listDevices()).find((device) => device.state === "device")?.serial;
    if (!selected) return { connected: false, authorized: false, errors: ["Nie znaleziono autoryzowanego telefonu ADB"] };
    const values = await Promise.all([
      this.shell(selected, "getprop ro.product.manufacturer"),
      this.shell(selected, "getprop ro.product.model"),
      this.shell(selected, "getprop ro.build.version.release"),
      this.shell(selected, "getprop ro.build.version.sdk"),
      this.shell(selected, "getprop ro.product.cpu.abilist"),
      this.shell(selected, "su -c id").catch(() => ""),
      this.shell(selected, "su -c 'magisk -v'").catch(() => ""),
      this.shell(selected, "dumpsys webviewupdate").catch(() => ""),
      this.shell(selected, "dumpsys package com.google.android.webview | grep versionName | head -n 1").catch(() => ""),
      this.shell(selected, `dumpsys package ${PACKAGE} | grep versionName | head -n 1`).catch(() => "")
    ]);
    const device = {
      connected: true,
      authorized: true,
      serial: selected,
      manufacturer: values[0],
      model: values[1],
      android: values[2],
      sdk: Number(values[3]),
      abis: values[4].split(",").filter(Boolean),
      root: /uid=0/.test(values[5]),
      magisk: values[6],
      webView: parseWebView(values[7]) || parseWebView(values[8]),
      installedApk: values[9].replace(/^.*versionName=/, "").trim() || null
    };
    device.magiskCompatible = versionAtLeast(device.magisk, 22, 1);
    device.webViewCompatible = versionAtLeast(device.webView, 119);
    device.androidCompatible = device.sdk >= 24 && device.sdk <= 30;
    device.profile = await matchDeviceProfile(device);
    device.apkInstallable = device.androidCompatible && Boolean(device.profile);
    device.supported = device.apkInstallable && device.root && device.magiskCompatible && device.webViewCompatible;
    device.errors = [
      ...(device.sdk < 24 || device.sdk > 30 ? ["Wymagany Android 7-11 (API 24-30)"] : []),
      ...(!device.root ? ["Root przez su jest niedostępny"] : []),
      ...(!device.magisk ? ["Nie wykryto Magiska"] : !device.magiskCompatible ? ["Wymagany Magisk 22.1 lub nowszy"] : []),
      ...(!device.webView ? ["Nie wykryto Android System WebView"] : !device.webViewCompatible ? ["Wymagany WebView 119 lub nowszy"] : [])
    ];
    return device;
  }

  async pair(serial) {
    const diagnosis = await this.diagnose(serial);
    if (!diagnosis.supported) throw new Error(diagnosis.errors.join("; ") || "Telefon nie jest zgodny");
    await this.rememberDevice(diagnosis);
    return diagnosis;
  }

  async rememberDevice(diagnosis) {
    const config = await this.getConfig();
    config.device = { ...config.device, serial: diagnosis.serial, profile: diagnosis.profile.id, apkVariant: diagnosis.profile.apkVariant };
    await this.saveConfig(config);
  }

  artifact(name) {
    return join(artifactsDir, name);
  }

  async installApk(serial, variant = "universal") {
    const file = this.artifact(variant === "legacy-arm32" ? "EndoDeck-legacy-arm32.apk" : "EndoDeck-universal.apk");
    await this.installApkFile(serial, file);
    return file;
  }

  async installApkFile(serial, file) {
    await access(file);
    try {
      await this.run(["-s", serial, "install", "-r", file], 120000);
    } catch (error) {
      if (!/INSTALL_FAILED_UPDATE_INCOMPATIBLE/.test(`${error.stdout || ""}\n${error.stderr || ""}`)) throw error;
      const backup = "/data/local/tmp/endodeck-shared-prefs.tgz";
      const data = `/data/user/0/${PACKAGE}`;
      await this.shell(serial, `su -c 'rm -f ${backup}; if [ -d ${data}/shared_prefs ]; then tar -czf ${backup} -C ${data} shared_prefs; fi'`, 30000);
      await this.run(["-s", serial, "uninstall", PACKAGE], 60000);
      await this.run(["-s", serial, "install", file], 120000);
      await this.shell(serial, `su -c 'if [ -f ${backup} ]; then uid=$(stat -c %u ${data}); tar -xzf ${backup} -C ${data}; chown -R $uid:$uid ${data}/shared_prefs; restorecon -RF ${data}/shared_prefs >/dev/null 2>&1; rm -f ${backup}; fi'`, 30000);
    }
  }

  async installApplication(serial) {
    const diagnosis = await this.diagnose(serial);
    if (!diagnosis.apkInstallable) throw new Error("Telefon nie obsługuje APK EndoDeck");
    await this.rememberDevice(diagnosis);
    await this.installApk(serial, diagnosis.profile.apkVariant);
    await this.configureConnection(serial);
    const health = await this.diagnose(serial);
    if (!health.installedApk) throw new Error("Nie udało się potwierdzić instalacji APK");
    return health;
  }

  async installModule(serial, fileName) {
    const local = this.artifact(fileName);
    return this.installModuleFile(serial, local, fileName);
  }

  async installModuleFile(serial, local, fileName) {
    await access(local);
    const remote = `/data/local/tmp/${fileName}`;
    await this.run(["-s", serial, "push", local, remote], 120000);
    await this.shell(serial, `su -c 'magisk --install-module ${remote}'`, 120000);
  }

  async writeOptionLines(serial, lines) {
    const commands = [
      "mkdir -p /data/adb/endodeck",
      "touch /data/adb/endodeck/options.conf",
      ...lines.map((line) => {
        const [key, value] = line.split("=");
        return `if grep -q "^${key}=" /data/adb/endodeck/options.conf; then sed -i "s|^${key}=.*|${key}=${value}|" /data/adb/endodeck/options.conf; else echo "${key}=${value}" >> /data/adb/endodeck/options.conf; fi`;
      })
    ].join("; ");
    await this.shell(serial, `su -c '${commands}'`, 30000);
  }

  async syncRuntimeOptions(serial, config = null) {
    await this.writeOptionLines(serial, nightOptionLines(config ?? await this.getConfig().catch(() => ({}))));
  }

  async installProfile(serial, options = {}) {
    const diagnosis = await this.pair(serial);
    await this.installApk(serial, diagnosis.profile.apkVariant);
    await this.shell(serial, "su -c 'for old in endodeck_power_guard endodeck_touch_wake p8_battery_tweaks; do [ -d /data/adb/modules/$old ] && touch /data/adb/modules/$old/remove; done'").catch(() => {});
    const config = await this.getConfig().catch(() => ({}));
    const optionLines = [
      `ENABLE_LOCKSCREEN_BYPASS=${options.lockscreenBypass ? 1 : 0}`,
      `ENABLE_DT2W=${options.doubleTapWake ? 1 : 0}`,
      `ENABLE_BATTERY_GUARD=${options.batteryGuard ? 1 : 0}`,
      ...nightOptionLines(config)
    ];
    await this.writeOptionLines(serial, optionLines);
    const moduleFiles = {
      "endodeck-core": "EndoDeck-Core-Magisk.zip",
      "endodeck-balanced": "EndoDeck-Balanced-Magisk.zip",
      "endodeck-oem-huawei-ale-l21": "EndoDeck-OEM-Huawei-ALE-L21-Magisk.zip"
    };
    for (const moduleId of diagnosis.profile.modules) {
      if (moduleId === "endodeck-core" && options[moduleId] === false) continue;
      if (moduleId !== "endodeck-core" && !options[moduleId]) continue;
      await this.installModule(serial, moduleFiles[moduleId]);
    }
    return { ...diagnosis, rebootRequired: true };
  }

  async configureConnection(serial) {
    await this.run(["-s", serial, "reverse", `tcp:${this.port}`, `tcp:${this.port}`]);
    await this.syncRuntimeOptions(serial).catch(() => {});
    await this.shell(serial, "settings put system accelerometer_rotation 0");
    await this.shell(serial, "settings put system user_rotation 1");
    await this.shell(serial, `su -c '/system/bin/endodeckctl wake' >/dev/null 2>&1 || input keyevent 224`).catch(() => {});
    await this.run(["-s", serial, "shell", "am", "start", "-n", COMPONENT, "--es", "endodeck_token", this.token]);
    this.configuredSerial = serial;
  }

  async battery(serial) {
    try {
      const [current, voltage, capacity, status] = await Promise.all([
        this.shell(serial, "cat /sys/class/power_supply/Battery/current_now", 2500),
        this.shell(serial, "cat /sys/class/power_supply/Battery/voltage_now", 2500),
        this.shell(serial, "cat /sys/class/power_supply/Battery/capacity", 2500),
        this.shell(serial, "cat /sys/class/power_supply/Battery/status", 2500)
      ]);
      const rawCurrent = Number(current);
      const rawVoltage = Number(voltage);
      const currentMa = Math.abs(rawCurrent) > 10000 ? rawCurrent / 1000 : rawCurrent;
      const voltageV = rawVoltage > 100000 ? rawVoltage / 1000000 : rawVoltage / 1000;
      return { currentMa: Math.round(currentMa), voltageV: Number(voltageV.toFixed(2)), powerW: Number((Math.abs(currentMa) * voltageV / 1000).toFixed(2)), percent: Number(capacity), status };
    } catch { return null; }
  }

  async tick() {
    try {
      const config = await this.getConfig();
      const devices = await this.listDevices();
      const available = devices.filter((device) => device.state === "device");
      const pairedSerial = config.device?.serial || null;
      const serial = pairedSerial ? available.find((device) => device.serial === pairedSerial)?.serial : available[0]?.serial;
      const detectedSerials = available.map((device) => device.serial);
      const ignoredSerials = serial ? detectedSerials.filter((detectedSerial) => detectedSerial !== serial) : detectedSerials;
      this.connected = Boolean(serial);
      if (serial && this.configuredSerial !== serial) await this.configureConnection(serial);
      if (!serial) this.configuredSerial = null;
      const battery = serial ? await this.battery(serial) : null;
      this.lastDevice = serial ? { serial, battery } : null;
      this.onState?.({ connected: this.connected, serial: serial ?? null, pairedSerial, detectedSerials, ignoredSerials, battery });
    } catch {
      this.connected = false;
      this.configuredSerial = null;
      this.onState?.({ connected: false, serial: null, pairedSerial: null, detectedSerials: [], ignoredSerials: [], battery: null });
    }
  }

  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), this.pollMs);
  }

  stop() {
    clearInterval(this.timer);
  }
}
