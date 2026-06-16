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
import { publicDir } from "./runtime-paths.js";

const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

function sendJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(data));
}

async function bodyJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 200000) throw new Error("Żądanie jest za duże");
  }
  return JSON.parse(body || "{}");
}

export async function startServer({ onReady, onState } = {}) {
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

      if (url.searchParams.has("token") && authenticated && request.method === "GET") {
        url.searchParams.delete("token");
        response.writeHead(302, { Location: `${url.pathname}${url.search}`, "Set-Cookie": `endodeck_session=${apiToken}; HttpOnly; SameSite=Strict; Path=/` });
        return response.end();
      }

      if (request.method === "GET" && url.pathname === "/api/health") {
        return sendJson(response, 200, { ok: true, version: process.env.npm_package_version ?? "dev", schemaVersion: config.schemaVersion, android: { minSdk: 24, maxSdk: 30 }, state: { adb: state.adb, serial: state.serial, pairedSerial: state.pairedSerial, detectedSerials: state.detectedSerials } });
      }

      if (url.pathname.startsWith("/api/") && !authenticated) return sendJson(response, 401, { ok: false, error: "Brak ważnej sesji EndoDeck" });

      if (request.method === "GET" && url.pathname === "/api/config") return sendJson(response, 200, config);
      if (request.method === "PUT" && url.pathname === "/api/config") {
        config = await saveConfig(await bodyJson(request));
        publishConfig();
        return sendJson(response, 200, { ok: true, config });
      }
      if (request.method === "GET" && url.pathname === "/api/state") return sendJson(response, 200, state);
      if (request.method === "GET" && url.pathname === "/api/weather") return sendJson(response, 200, await getWeather(config.weather));
      if (request.method === "GET" && url.pathname === "/api/geocode/search") return sendJson(response, 200, await searchPlaces(url.searchParams.get("q")));
      if (request.method === "GET" && url.pathname === "/api/geocode/reverse") return sendJson(response, 200, await reversePlace(url.searchParams.get("lat"), url.searchParams.get("lon")));
      if (request.method === "GET" && url.pathname === "/api/audio") return sendJson(response, 200, await getAudioSnapshot());
      if (request.method === "GET" && url.pathname === "/api/audio/devices") return sendJson(response, 200, await getOutputDevices());
      if (request.method === "GET" && url.pathname === "/api/nowplaying") return sendJson(response, 200, await getNowPlaying());
      if (request.method === "GET" && url.pathname === "/api/local-devices") return sendJson(response, 200, await getLocalDeviceSetup());
      if (request.method === "PUT" && url.pathname === "/api/local-devices") return sendJson(response, 200, await saveLocalDeviceSetup(await bodyJson(request)));
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
      response.writeHead(200, { "Content-Type": mime[extname(filePath)] ?? "application/octet-stream", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
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
  }, 2200);
  const statsTimer = setInterval(async () => {
    state.systemStats = await getSystemStats().catch(() => state.systemStats);
    publish();
  }, 4000);

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
