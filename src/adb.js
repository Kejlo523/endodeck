import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function findAdb() {
  const candidates = [
    process.env.ADB_PATH,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", "adb.exe"),
    "adb"
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === "adb") return candidate;
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  return "adb";
}

export class AdbBridge {
  constructor(port, onState) {
    this.port = port;
    this.onState = onState;
    this.adb = null;
    this.timer = null;
    this.connected = false;
    this.configuredSerial = null;
  }

  async run(args, timeout = 7000) {
    this.adb ??= await findAdb();
    return execFileAsync(this.adb, args, { timeout, windowsHide: true });
  }

  async tick() {
    try {
      const { stdout } = await this.run(["devices"]);
      const serial = stdout.split(/\r?\n/).slice(1).map((line) => line.trim().split(/\s+/)).find((entry) => entry[1] === "device")?.[0];
      this.connected = Boolean(serial);

      if (serial && this.configuredSerial !== serial) {
        await this.run(["-s", serial, "reverse", `tcp:${this.port}`, `tcp:${this.port}`]);
        await this.run(["-s", serial, "shell", "settings", "put", "system", "accelerometer_rotation", "0"]);
        await this.run(["-s", serial, "shell", "settings", "put", "system", "user_rotation", "1"]);
        await this.run(["-s", serial, "shell", "settings", "put", "global", "stay_on_while_plugged_in", "2"]);
        await this.run(["-s", serial, "shell", "input", "keyevent", "224"]);
        await this.run(["-s", serial, "shell", "am", "start", "-n", "pl.endozero.endodeck/.MainActivity"]);
        this.configuredSerial = serial;
      }

      if (!serial) this.configuredSerial = null;
      let battery = null;
      if (serial) {
        try {
          const [currentResult, voltageResult, capacityResult, statusResult] = await Promise.all([
            this.run(["-s", serial, "shell", "cat", "/sys/class/power_supply/Battery/current_now"], 2500),
            this.run(["-s", serial, "shell", "cat", "/sys/class/power_supply/Battery/voltage_now"], 2500),
            this.run(["-s", serial, "shell", "cat", "/sys/class/power_supply/Battery/capacity"], 2500),
            this.run(["-s", serial, "shell", "cat", "/sys/class/power_supply/Battery/status"], 2500)
          ]);
          const rawCurrent = Number(currentResult.stdout.trim());
          const rawVoltage = Number(voltageResult.stdout.trim());
          const currentMa = Math.abs(rawCurrent) > 10_000 ? rawCurrent / 1000 : rawCurrent;
          const voltageV = rawVoltage > 100_000 ? rawVoltage / 1_000_000 : rawVoltage / 1000;
          battery = {
            currentMa: Math.round(currentMa),
            voltageV: Number(voltageV.toFixed(2)),
            powerW: Number((Math.abs(currentMa) * voltageV / 1000).toFixed(2)),
            percent: Number(capacityResult.stdout.trim()),
            status: statusResult.stdout.trim()
          };
        } catch {}
      }

      this.onState?.({ connected: this.connected, serial: serial ?? null, battery });
    } catch {
      this.connected = false;
      this.configuredSerial = null;
      this.onState?.({ connected: false, serial: null, battery: null });
    }
  }

  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), 4000);
  }

  stop() {
    clearInterval(this.timer);
  }
}
