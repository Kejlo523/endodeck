import os from "node:os";
import { getOfflineDeviceSettings } from "./local-devices.js";

export function getLanHost() {
  const preferred = [];
  const fallback = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const net of ifaces ?? []) {
      if (net.family !== "IPv4" && net.family !== 4) continue;
      if (net.internal || String(net.address).startsWith("169.254.")) continue;
      if (String(net.address).startsWith("192.168.") || String(net.address).startsWith("10.")) preferred.push(net.address);
      else fallback.push(net.address);
    }
  }
  return preferred[0] ?? fallback[0] ?? null;
}

async function loadDeviceSettings() {
  return getOfflineDeviceSettings().catch(() => ({ tapo: { username: "", password: "" }, devices: {} }));
}

function collectSwitchButtons(config) {
  const switches = [];
  for (const page of Object.values(config.pages ?? {})) {
    for (const button of page.buttons ?? []) {
      if (button.action?.type !== "localDeviceToggle") continue;
      switches.push({
        id: button.id,
        alias: button.action.device,
        label: button.label,
        hint: button.hint ?? "",
        tone: button.tone ?? "green"
      });
    }
  }
  return switches;
}

export async function buildOfflineBundle(config) {
  const settings = await loadDeviceSettings();
  const configured = Boolean(settings.tapo.username && settings.tapo.password);
  const switches = collectSwitchButtons(config).filter((entry) => {
    const device = settings.devices[entry.alias];
    return configured && device?.ip && device?.provider === "tapo";
  });
  const devices = {};
  for (const entry of switches) {
    const device = settings.devices[entry.alias];
    devices[entry.alias] = {
      name: device.name ?? entry.label,
      ip: device.ip,
      provider: device.provider ?? "tapo"
    };
  }
  return {
    ready: switches.length > 0,
    lanHost: getLanHost(),
    port: Number(config.port) || 8765,
    ui: {
      screensaverBrightness: config.ui?.screensaverBrightness ?? null,
      nightStandby: config.ui?.nightStandby ?? null
    },
    switches,
    tapo: configured ? { username: settings.tapo.username, password: settings.tapo.password } : null,
    devices
  };
}
