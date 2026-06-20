import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { executeAction } from "./actions.js";
import { AdbBridge } from "./adb.js";
import { getAudioSnapshot, getOutputDevices, setDefaultOutputDevice, setMasterVolume, setSessionVolume } from "./audio.js";
import { getWeather } from "./weather.js";
import { getControlStates } from "./control-status.js";
import { getNowPlaying } from "./now-playing.js";
import { reversePlace, searchPlaces } from "./geocode.js";
import { getLocalDeviceSetup, saveLocalDeviceSetup, testLocalDevices, toggleLocalDevice } from "./local-devices.js";
import { getSystemStats } from "./system-stats.js";
import { buildOfflineBundle } from "./offline-bundle.js";
import { initializeConfigStore, loadConfig, saveConfig } from "./config-store.js";
import { loadApiToken, requestToken, tokenMatches } from "./api-auth.js";
import { listInstalledApps } from "./windows-apps.js";
import { deleteScreensaverAsset, listScreensaverAssets, readScreensaverAsset, saveScreensaverAsset } from "./screensaver-assets.js";
import { publicDir } from "./runtime-paths.js";

const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

function numberSetting(value, fallback, minimum = 500) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum ? number : fallback;
}

function isLoopbackRequest(request) {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress);
}

function sessionCookie(token) {
  return `endodeck_session=${token}; HttpOnly; SameSite=Strict; Path=/`;
}

function shouldBootstrapSession(request, url, authenticated) {
  if (authenticated || request.method !== "GET" || !isLoopbackRequest(request)) return false;
  return url.pathname === "/" || url.pathname.endsWith(".html");
}

function sendJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(data));
}

function slug(value, fallback = "page") {
  const normalized = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return (normalized || fallback).slice(0, 48);
}

function ensureDomPage(nextConfig, localSetup) {
  const devices = localSetup?.devices ?? [];
  if (!devices.length) return nextConfig;
  const config = structuredClone(nextConfig);
  config.pages ??= {};
  config.pages.dom ??= { label: "Dom", buttons: [] };
  config.pages.dom.label ||= "Dom";
  config.pages.dom.buttons ??= [];

  for (const device of devices) {
    const id = `lan-${slug(device.alias, "device")}`;
    if (config.pages.dom.buttons.some((button) => button.id === id || button.action?.device === device.alias)) continue;
    config.pages.dom.buttons.push({
      id,
      label: String(device.name || device.alias).slice(0, 22).toUpperCase(),
      hint: "Tapo LAN",
      icon: "plug",
      tone: "green",
      action: { type: "localDeviceToggle", device: device.alias },
      status: { type: "localDevice", device: device.alias }
    });
  }

  if (!config.pages.dom.buttons.some((button) => button.action?.type === "page" && button.action.page === "home")) {
    config.pages.dom.buttons.push({ id: "dom-home", label: "WRÓĆ", hint: "Codzienny", icon: "back", tone: "accent", action: { type: "page", page: "home" } });
  }

  const home = config.pages.home;
  if (home?.buttons && !home.buttons.some((button) => button.action?.type === "page" && button.action.page === "dom")) {
    home.buttons.push({ id: "open-dom", label: "DOM", hint: "Urządzenia LAN", icon: "house", tone: "green", action: { type: "page", page: "dom" } });
  }
  return config;
}

async function bodyJson(request, maxBytes = 200000) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > maxBytes) throw new Error("Żądanie jest za duże");
  }
  return JSON.parse(body || "{}");
}

export async function startServer({ onReady, onState, version } = {}) {
  const runtimeVersion = version ?? process.env.ENDODECK_VERSION ?? process.env.npm_package_version ?? "dev";
  let config = await initializeConfigStore();
  const apiToken = await loadApiToken();
  const clients = new Set();
  const state = { adb: false, serial: null, pairedSerial: null, detectedSerials: [], ignoredSerials: [], battery: null, controls: {}, nowPlaying: null, systemStats: null, lastAction: null, error: null };
  let stopped = false;

  function publish() {
    const payload = `data: ${JSON.stringify(state)}\n\n`;
    for (const client of clients) client.write(payload);
    onState?.(structuredClone(state));
  }

  function publishConfig() {
    const payload = `event: config\ndata: ${JSON.stringify(config)}\n\n`;
    for (const client of clients) client.write(payload);
  }

  function findButton(id) {
    for (const page of Object.values(config.pages ?? {})) {
      const button = page.buttons.find((entry) => entry.id === id);
      if (button) return button;
    }
    return null;
  }

  const adb = new AdbBridge({
    port: config.port,
    token: apiToken,
    pollMs: config.runtime?.adbPollMs,
    getConfig: loadConfig,
    saveConfig,
    onState: ({ connected, serial, pairedSerial, detectedSerials, ignoredSerials, battery }) => {
      state.adb = connected;
      state.serial = serial;
      state.pairedSerial = pairedSerial ?? null;
      state.detectedSerials = detectedSerials ?? [];
      state.ignoredSerials = ignoredSerials ?? [];
      state.battery = battery;
      publish();
    }
  });

  const server = createServer(async (request, response) => {
    try {
      config = await loadConfig();
      const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
      const suppliedToken = requestToken(request, url);
      const authenticated = tokenMatches(apiToken, suppliedToken);
      const bootstrapSession = shouldBootstrapSession(request, url, authenticated);

      if (url.searchParams.has("token") && authenticated && request.method === "GET") {
        url.searchParams.delete("token");
        response.writeHead(302, { Location: `${url.pathname}${url.search}`, "Set-Cookie": sessionCookie(apiToken) });
        return response.end();
      }

      if (request.method === "GET" && url.pathname === "/api/health") {
        return sendJson(response, 200, { ok: true, version: runtimeVersion, schemaVersion: config.schemaVersion, android: { minSdk: 24, maxSdk: 30 }, state: { adb: state.adb, serial: state.serial, pairedSerial: state.pairedSerial, detectedSerials: state.detectedSerials } });
      }

      if (url.pathname.startsWith("/api/") && !authenticated) return sendJson(response, 401, { ok: false, error: "Brak ważnej sesji EndoDeck" });

      if (request.method === "GET" && url.pathname === "/api/config") return sendJson(response, 200, config);
      if (request.method === "GET" && url.pathname === "/api/config/export") return sendJson(response, 200, config);
      if (request.method === "POST" && url.pathname === "/api/config/import") {
        config = await saveConfig(await bodyJson(request));
        publishConfig();
        return sendJson(response, 200, { ok: true, config });
      }
      if (request.method === "PUT" && url.pathname === "/api/config") {
        config = await saveConfig(await bodyJson(request));
        if (state.serial) adb.syncRuntimeOptions(state.serial, config).catch(() => {});
        publishConfig();
        return sendJson(response, 200, { ok: true, config });
      }
      if (request.method === "GET" && url.pathname === "/api/assets/screensavers") return sendJson(response, 200, await listScreensaverAssets());
      if (request.method === "POST" && url.pathname === "/api/assets/screensavers") return sendJson(response, 200, await saveScreensaverAsset(await bodyJson(request, 12 * 1024 * 1024)));
      if (url.pathname.startsWith("/api/assets/screensavers/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/assets/screensavers/".length));
        if (request.method === "DELETE") return sendJson(response, 200, await deleteScreensaverAsset(id));
        if (request.method === "GET") {
          const asset = await readScreensaverAsset(id);
          response.writeHead(200, { "Content-Type": asset.mime, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" });
          response.end(asset.data);
          return;
        }
      }
      if (request.method === "GET" && url.pathname === "/api/state") return sendJson(response, 200, state);
      if (request.method === "GET" && url.pathname === "/api/apps") {
        return sendJson(response, 200, { apps: await listInstalledApps({
          force: url.searchParams.get("refresh") === "1",
          cacheTtlMs: config.runtime?.appsCacheTtlMs,
          scanTimeoutMs: config.runtime?.appsScanTimeoutMs
        }) });
      }
      if (request.method === "GET" && url.pathname === "/api/weather") return sendJson(response, 200, await getWeather(config.weather));
      if (request.method === "GET" && url.pathname === "/api/geocode/search") return sendJson(response, 200, await searchPlaces(url.searchParams.get("q")));
      if (request.method === "GET" && url.pathname === "/api/geocode/reverse") return sendJson(response, 200, await reversePlace(url.searchParams.get("lat"), url.searchParams.get("lon")));
      if (request.method === "GET" && url.pathname === "/api/audio") return sendJson(response, 200, await getAudioSnapshot());
      if (request.method === "GET" && url.pathname === "/api/audio/devices") return sendJson(response, 200, await getOutputDevices());
      if (request.method === "GET" && url.pathname === "/api/nowplaying") return sendJson(response, 200, await getNowPlaying());
      if (request.method === "GET" && url.pathname === "/api/local-devices") return sendJson(response, 200, await getLocalDeviceSetup());
      if (request.method === "PUT" && url.pathname === "/api/local-devices") {
        const setup = await saveLocalDeviceSetup(await bodyJson(request));
        const merged = ensureDomPage(config, setup);
        if (JSON.stringify(merged.pages) !== JSON.stringify(config.pages)) {
          config = await saveConfig(merged);
          publishConfig();
        }
        return sendJson(response, 200, setup);
      }
      if (request.method === "POST" && url.pathname === "/api/local-devices/test") return sendJson(response, 200, await testLocalDevices());
      if (request.method === "GET" && url.pathname === "/api/offline-bundle") return sendJson(response, 200, await buildOfflineBundle(config));
      if (request.method === "POST" && url.pathname === "/api/offline/toggle") {
        const alias = String((await bodyJson(request)).alias ?? "").trim();
        if (!alias) return sendJson(response, 400, { ok: false, error: "Nie wskazano urządzenia" });
        return sendJson(response, 200, { ok: true, alias, ...(await toggleLocalDevice(alias)) });
      }
      if (request.method === "POST" && url.pathname === "/api/audio") {
        const body = await bodyJson(request);
        const volume = Math.max(0, Math.min(100, Number(body.volume)));
        if (!Number.isFinite(volume)) return sendJson(response, 400, { ok: false, error: "Nieprawidłowa głośność" });
        if (body.target === "master") await setMasterVolume(volume);
        else if (body.target === "session" && Number.isInteger(Number(body.id))) await setSessionVolume(Number(body.id), volume);
        else return sendJson(response, 400, { ok: false, error: "Nieprawidłowy kanał audio" });
        return sendJson(response, 200, { ok: true, volume });
      }
      if (request.method === "POST" && url.pathname === "/api/audio/devices") {
        const deviceId = String((await bodyJson(request)).deviceId ?? "").trim();
        if (!deviceId) return sendJson(response, 400, { ok: false, error: "Nie wybrano urządzenia" });
        await setDefaultOutputDevice(deviceId);
        return sendJson(response, 200, { ok: true });
      }
      if (request.method === "GET" && url.pathname === "/api/events") {
        response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        clients.add(response);
        response.write(`data: ${JSON.stringify(state)}\n\n`);
        response.write(`event: config\ndata: ${JSON.stringify(config)}\n\n`);
        request.on("close", () => clients.delete(response));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/action") {
        const button = findButton((await bodyJson(request)).id);
        if (!button) return sendJson(response, 404, { ok: false, error: "Nie znaleziono przycisku" });
        try {
          const result = await executeAction(button.action, {});
          state.lastAction = button.id;
          state.error = null;
          state.controls = await getControlStates(config).catch(() => state.controls);
          publish();
          return sendJson(response, 200, { ok: true, ...result });
        } catch (error) {
          state.error = error.message;
          publish();
          state.error = null;
          return sendJson(response, 500, { ok: false, error: error.message });
        }
      }

      const relative = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
      const filePath = normalize(`${publicDir}${sep}${relative}`);
      if (!filePath.startsWith(`${publicDir}${sep}`)) return sendJson(response, 403, { error: "Forbidden" });
      const data = await readFile(filePath);
      const headers = { "Content-Type": mime[extname(filePath)] ?? "application/octet-stream", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" };
      if (bootstrapSession) headers["Set-Cookie"] = sessionCookie(apiToken);
      response.writeHead(200, headers);
      response.end(data);
    } catch (error) {
      if (error.code === "ENOENT") return sendJson(response, 404, { error: "Not found" });
      sendJson(response, 500, { error: error.message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, "127.0.0.1", resolve);
  });
  adb.start();

  const controlTimer = setInterval(async () => {
    try {
      const [controls, nowPlaying] = await Promise.all([getControlStates(config), getNowPlaying().catch(() => state.nowPlaying)]);
      if (JSON.stringify(controls) !== JSON.stringify(state.controls) || JSON.stringify(nowPlaying) !== JSON.stringify(state.nowPlaying)) {
        state.controls = controls;
        state.nowPlaying = nowPlaying;
        publish();
      }
    } catch {}
  }, numberSetting(config.runtime?.controlPollMs, 2200));
  const statsTimer = setInterval(async () => {
    state.systemStats = await getSystemStats().catch(() => state.systemStats);
    publish();
  }, numberSetting(config.runtime?.statsPollMs, 4000));

  const runtime = {
    port: config.port,
    token: apiToken,
    adb,
    state,
    getConfig: loadConfig,
    url(path = "/") { return `http://127.0.0.1:${config.port}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(apiToken)}`; },
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(controlTimer);
      clearInterval(statsTimer);
      adb.stop();
      for (const client of clients) client.end();
      clients.clear();
      await new Promise((resolve) => server.close(resolve));
    }
  };
  onReady?.(runtime);
  return runtime;
}

const direct = process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase();
if (direct) {
  startServer().then((runtime) => {
    console.log(`EndoDeck działa na ${runtime.url()}`);
    const shutdown = () => runtime.stop().finally(() => process.exit(0));
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }).catch((error) => { console.error(error); process.exit(1); });
}
