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
  const switches = new Map();
  for (const page of Object.values(config.pages ?? {})) {
    for (const button of page.buttons ?? []) {
      if (button.action?.type !== "localDeviceToggle") continue;
      const alias = String(button.action.device || "").trim();
      if (!alias || switches.has(alias)) continue;
      switches.set(alias, {
        id: button.id,
        alias,
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
  const buttonOverrides = collectSwitchButtons(config);
  const switches = [];
  const devices = {};
  if (configured) {
    for (const [alias, device] of Object.entries(settings.devices ?? {})) {
      if (!device?.ip || device?.provider !== "tapo") continue;
      const button = buttonOverrides.get(alias);
      const label = button?.label || device.name || alias;
      switches.push({
        id: button?.id || `local-${alias}`,
        alias,
        label,
        hint: button?.hint || device.model || device.ip,
        tone: button?.tone || "green"
      });
      devices[alias] = {
        name: device.name ?? label,
        model: device.model ?? "",
        ip: device.ip,
        provider: device.provider ?? "tapo"
      };
    }
  }
  return {
    ready: configured && switches.length > 0,
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
