import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataPath, projectRoot } from "./runtime-paths.js";
import { getSecret, hasSecret, setSecret } from "./secret-store.js";
import { TapoClient } from "./tapo-client.js";

const settingsPath = dataPath("devices.json");
const legacyPath = join(projectRoot, "devices.local.json");
const defaults = { schemaVersion: 1, tapo: { username: "" }, devices: {} };
let cachedSettings;
let settingsMtime = -1;
let stateCache = { at: 0, value: {} };
let tapoAuthBlock = null;
const clients = new Map();

function normalizeSettings(value = {}) {
  const devices = {};
  for (const [alias, device] of Object.entries(value.devices ?? {})) {
    const cleanAlias = String(alias).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 48);
    if (!cleanAlias || !device?.ip) continue;
    devices[cleanAlias] = {
      name: String(device.name || cleanAlias).slice(0, 48),
      provider: "tapo",
      model: String(device.model || "P100").slice(0, 24),
      ip: String(device.ip).trim()
    };
  }
  return { schemaVersion: 1, tapo: { username: String(value.tapo?.username ?? "") }, devices };
}

async function loadSettings() {
  try {
    const mtime = (await stat(settingsPath)).mtimeMs;
    if (cachedSettings && mtime === settingsMtime) return cachedSettings;
    cachedSettings = normalizeSettings(JSON.parse(await readFile(settingsPath, "utf8")));
    settingsMtime = mtime;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    let initial = defaults;
    try {
      const legacy = JSON.parse(await readFile(legacyPath, "utf8"));
      initial = normalizeSettings(legacy);
      if (legacy.tapo?.password) await setSecret("tapo.password", legacy.tapo.password);
    } catch {}
    cachedSettings = normalizeSettings(initial);
    await writeFile(settingsPath, `${JSON.stringify(cachedSettings, null, 2)}\n`, "utf8");
    settingsMtime = (await stat(settingsPath)).mtimeMs;
  }
  return cachedSettings;
}

function friendlyError(error) {
  const message = String(error?.message ?? error);
  if (/Third-Party|FORBIDDEN/i.test(message)) return "Tapo blokuje sterowanie lokalne. Włącz Third-Party Compatibility w aplikacji Tapo.";
  if (/auth|credential|HASH_MISMATCH|LOGIN_ERROR/i.test(message)) return "Nieprawidłowy e-mail lub hasło konta Tapo.";
  if (/timed out|connect|ECONN/i.test(message)) return "Brak odpowiedzi urządzenia w sieci lokalnej.";
  return message.slice(0, 240);
}

async function credentials(settings) {
  return { username: settings.tapo.username, password: await getSecret("tapo.password") };
}

async function clientFor(alias, device, settings) {
  const auth = await credentials(settings);
  if (!auth.username || !auth.password) throw new Error("Brak danych konta Tapo");
  const cacheKey = `${alias}|${device.ip}|${auth.username}`;
  if (!clients.has(cacheKey)) clients.set(cacheKey, new TapoClient(device.ip, auth.username, auth.password));
  return clients.get(cacheKey);
}

function publicDevice(alias, device, configured) {
  return { alias, ...device, configured };
}

export async function getLocalDeviceSetup() {
  const settings = await loadSettings();
  const hasPassword = await hasSecret("tapo.password");
  const configured = Boolean(settings.tapo.username && hasPassword);
  return {
    tapo: { username: settings.tapo.username, hasPassword },
    devices: Object.entries(settings.devices).map(([alias, device]) => publicDevice(alias, device, configured))
  };
}

export async function saveLocalDeviceSetup(input = {}) {
  const current = await loadSettings();
  const next = normalizeSettings({
    ...current,
    tapo: { username: typeof input.tapo?.username === "string" ? input.tapo.username.trim() : current.tapo.username },
    devices: input.devices && typeof input.devices === "object" ? input.devices : current.devices
  });
  if (typeof input.tapo?.password === "string" && input.tapo.password) await setSecret("tapo.password", input.tapo.password);
  await writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  cachedSettings = next;
  settingsMtime = (await stat(settingsPath)).mtimeMs;
  clients.clear();
  stateCache = { at: 0, value: {} };
  tapoAuthBlock = null;
  return getLocalDeviceSetup();
}

export async function getLocalDeviceStates(aliases = [], { force = false } = {}) {
  const wanted = [...new Set(aliases.map(String))];
  if (force) tapoAuthBlock = null;
  if (!force && Date.now() - stateCache.at < 7000 && wanted.every((alias) => stateCache.value[alias])) {
    return Object.fromEntries(wanted.map((alias) => [alias, stateCache.value[alias]]));
  }
  const settings = await loadSettings();
  const result = {};
  if (tapoAuthBlock && !force) return Object.fromEntries(wanted.map((alias) => [alias, { active: false, available: false, provider: "tapo", source: "local-device", error: tapoAuthBlock }]));
  await Promise.all(wanted.map(async (alias) => {
    const device = settings.devices[alias];
    if (!device) return;
    try {
      result[alias] = { active: await (await clientFor(alias, device, settings)).getState(), available: true, provider: "tapo", source: "local-device" };
    } catch (error) {
      const message = friendlyError(error);
      if (/e-mail|Third-Party/i.test(message)) tapoAuthBlock = message;
      result[alias] = { active: false, available: false, provider: "tapo", source: "local-device", error: message };
    }
  }));
  stateCache = { at: Date.now(), value: { ...stateCache.value, ...result } };
  return result;
}

export async function testLocalDevices() {
  const settings = await loadSettings();
  return getLocalDeviceStates(Object.keys(settings.devices), { force: true });
}

export async function toggleLocalDevice(alias) {
  const settings = await loadSettings();
  const device = settings.devices[String(alias)];
  if (!device) throw new Error("Nie znaleziono lokalnego urządzenia");
  if (tapoAuthBlock) throw new Error(tapoAuthBlock);
  try {
    const active = await (await clientFor(alias, device, settings)).toggle();
    const result = { active, available: true, provider: "tapo", source: "local-device" };
    stateCache = { at: Date.now(), value: { ...stateCache.value, [alias]: result } };
    return result;
  } catch (error) {
    const message = friendlyError(error);
    if (/e-mail|Third-Party/i.test(message)) tapoAuthBlock = message;
    throw new Error(message);
  }
}

export async function getOfflineDeviceSettings() {
  const settings = await loadSettings();
  const auth = await credentials(settings);
  return { ...settings, tapo: auth };
}
