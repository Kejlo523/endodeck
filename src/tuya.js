import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const settingsPath = fileURLToPath(new URL("../tuya.local.json", import.meta.url));
const statusCache = new Map();
const statusTtlMs = 5000;
let settingsCache = null;
let settingsMtime = -1;
let tokenCache = null;

function normalizeEndpoint(endpoint) {
  return String(endpoint || "https://openapi.tuyaeu.com").replace(/\/$/, "");
}

async function loadSettings() {
  let fileSettings = {};
  try {
    const fileStat = await stat(settingsPath);
    if (!settingsCache || fileStat.mtimeMs !== settingsMtime) {
      fileSettings = JSON.parse(await readFile(settingsPath, "utf8"));
      settingsCache = fileSettings;
      settingsMtime = fileStat.mtimeMs;
      tokenCache = null;
      statusCache.clear();
    } else {
      fileSettings = settingsCache;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  return {
    endpoint: normalizeEndpoint(process.env.TUYA_ENDPOINT || fileSettings.endpoint),
    accessId: process.env.TUYA_ACCESS_ID || fileSettings.accessId || "",
    accessSecret: process.env.TUYA_ACCESS_SECRET || fileSettings.accessSecret || "",
    devices: fileSettings.devices && typeof fileSettings.devices === "object" ? fileSettings.devices : {}
  };
}

function assertCredentials(settings) {
  if (!settings.accessId || !settings.accessSecret) {
    throw new Error("Tuya nie jest skonfigurowana. Uzupełnij plik tuya.local.json");
  }
}

function signature(settings, method, path, body, token, timestamp, nonce) {
  const contentHash = createHash("sha256").update(body).digest("hex");
  const stringToSign = `${method}\n${contentHash}\n\n${path}`;
  const payload = `${settings.accessId}${token}${timestamp}${nonce}${stringToSign}`;
  return createHmac("sha256", settings.accessSecret).update(payload).digest("hex").toUpperCase();
}

async function tuyaRequest(settings, method, path, bodyValue, token = "") {
  assertCredentials(settings);
  const body = bodyValue === undefined ? "" : JSON.stringify(bodyValue);
  const timestamp = String(Date.now());
  const nonce = randomUUID().replaceAll("-", "");
  const headers = {
    client_id: settings.accessId,
    sign: signature(settings, method, path, body, token, timestamp, nonce),
    sign_method: "HMAC-SHA256",
    t: timestamp,
    nonce,
    lang: "en"
  };
  if (token) headers.access_token = token;
  if (body) headers["content-type"] = "application/json";

  const response = await fetch(`${settings.endpoint}${path}`, {
    method,
    headers,
    body: body || undefined,
    signal: AbortSignal.timeout(8000)
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) {
    throw new Error(result?.msg || `Tuya API zwróciło HTTP ${response.status}`);
  }
  return result.result;
}

async function accessToken(settings) {
  const cacheKey = `${settings.endpoint}:${settings.accessId}`;
  if (tokenCache?.key === cacheKey && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const result = await tuyaRequest(settings, "GET", "/v1.0/token?grant_type=1");
  tokenCache = {
    key: cacheKey,
    value: result.access_token,
    expiresAt: Date.now() + Math.max(60, Number(result.expire_time || 7200)) * 1000
  };
  return tokenCache.value;
}

function configuredDevice(settings, alias) {
  const device = settings.devices[String(alias)];
  if (!device?.id) throw new Error(`Nieznane urządzenie Tuya: ${alias}`);
  return {
    alias: String(alias),
    id: String(device.id),
    name: String(device.name || alias),
    switchCode: String(device.switchCode || "switch_1")
  };
}

function statusValue(item, code) {
  return item?.status?.find((entry) => entry.code === code)?.value;
}

export async function getTuyaStates(aliases, { force = false } = {}) {
  const settings = await loadSettings();
  const uniqueAliases = [...new Set(aliases.map(String))];
  const states = {};
  const stale = [];

  for (const alias of uniqueAliases) {
    try {
      const device = configuredDevice(settings, alias);
      const cached = statusCache.get(alias);
      if (!force && cached && Date.now() - cached.timestamp < statusTtlMs) states[alias] = cached.state;
      else stale.push(device);
    } catch (error) {
      states[alias] = { active: false, available: false, source: "tuya", error: error.message };
    }
  }

  if (stale.length) {
    try {
      const token = await accessToken(settings);
      for (let offset = 0; offset < stale.length; offset += 20) {
        const batch = stale.slice(offset, offset + 20);
        const ids = batch.map((device) => device.id).join(",");
        const result = await tuyaRequest(settings, "GET", `/v1.0/iot-03/devices/status?device_ids=${encodeURIComponent(ids)}`, undefined, token);
        const byId = new Map((result || []).map((item) => [String(item.id), item]));
        for (const device of batch) {
          const item = byId.get(device.id);
          const value = statusValue(item, device.switchCode);
          const state = { active: value === true, available: typeof value === "boolean", source: "tuya" };
          states[device.alias] = state;
          statusCache.set(device.alias, { timestamp: Date.now(), state });
        }
      }
    } catch (error) {
      for (const device of stale) {
        const state = { active: false, available: false, source: "tuya", error: error.message };
        states[device.alias] = state;
        statusCache.set(device.alias, { timestamp: Date.now(), state });
      }
    }
  }

  return states;
}

export async function toggleTuyaDevice(alias) {
  const settings = await loadSettings();
  const device = configuredDevice(settings, alias);
  const current = (await getTuyaStates([device.alias], { force: true }))[device.alias];
  if (!current.available) throw new Error(current.error || `${device.name} jest niedostępne`);
  const active = !current.active;
  const token = await accessToken(settings);
  await tuyaRequest(settings, "POST", `/v1.0/iot-03/devices/${encodeURIComponent(device.id)}/commands`, {
    commands: [{ code: device.switchCode, value: active }]
  }, token);
  const state = { active, available: true, source: "tuya" };
  statusCache.set(device.alias, { timestamp: Date.now(), state });
  return { active, device: device.alias, message: `${device.name}: ${active ? "włączono" : "wyłączono"}` };
}

export async function getTuyaSetup() {
  const settings = await loadSettings();
  return {
    configured: Boolean(settings.accessId && settings.accessSecret),
    endpoint: settings.endpoint,
    devices: Object.entries(settings.devices).map(([alias, device]) => ({
      alias,
      name: String(device.name || alias),
      switchCode: String(device.switchCode || "switch_1")
    }))
  };
}
