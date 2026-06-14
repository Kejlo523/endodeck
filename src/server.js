import { createServer } from "node:http";
import { readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { executeAction } from "./actions.js";
import { AdbBridge } from "./adb.js";
import { getAudioSnapshot, setMasterVolume, setSessionVolume } from "./audio.js";
import { getWeather } from "./weather.js";
import { getControlStates } from "./control-status.js";
import { getNowPlaying } from "./now-playing.js";
import { reversePlace, searchPlaces } from "./geocode.js";
import { getTuyaSetup } from "./tuya.js";
import { getLocalDeviceSetup, saveLocalDeviceSetup, testLocalDevices } from "./local-devices.js";
import { getSystemStats } from "./system-stats.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const publicDir = join(root, "public");
const configPath = join(root, "config.json");
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };

let config = JSON.parse(await readFile(configPath, "utf8"));
let configMtime = (await stat(configPath)).mtimeMs;
const clients = new Set();
const state = { adb: false, serial: null, battery: null, controls: {}, nowPlaying: null, systemStats: null, lastAction: null, error: null };

function sendJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(data));
}

function publish() {
  const payload = `data: ${JSON.stringify(state)}\n\n`;
  for (const client of clients) client.write(payload);
}

function publishConfig() {
  const payload = `event: config\ndata: ${JSON.stringify(config)}\n\n`;
  for (const client of clients) client.write(payload);
}

async function refreshConfig() {
  const nextMtime = (await stat(configPath)).mtimeMs;
  if (nextMtime === configMtime) return;
  config = JSON.parse(await readFile(configPath, "utf8"));
  configMtime = nextMtime;
  publishConfig();
}

function validateConfig(nextConfig) {
  if (!nextConfig || typeof nextConfig !== "object" || !nextConfig.pages || typeof nextConfig.pages !== "object") {
    throw new Error("Nieprawidłowa konfiguracja");
  }
  for (const [pageName, page] of Object.entries(nextConfig.pages)) {
    if (!pageName || !page || !Array.isArray(page.buttons)) throw new Error("Nieprawidłowa strona przycisków");
    for (const button of page.buttons) {
      if (!button.id || !button.label || !button.action?.type) throw new Error("Każdy przycisk musi mieć ID, nazwę i akcję");
    }
  }
}

async function saveConfig(nextConfig) {
  validateConfig(nextConfig);
  nextConfig.port = config.port;
  await writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
  config = nextConfig;
  configMtime = (await stat(configPath)).mtimeMs;
}

function findButton(id) {
  for (const page of Object.values(config.pages)) {
    const button = page.buttons.find((entry) => entry.id === id);
    if (button) return button;
  }
  return null;
}

async function bodyJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 100_000) throw new Error("Żądanie jest za duże");
  }
  return JSON.parse(body || "{}");
}

const adb = new AdbBridge(config.port, ({ connected, serial, battery }) => {
  state.adb = connected;
  state.serial = serial;
  state.battery = battery;
  publish();
});

const server = createServer(async (request, response) => {
  try {
    await refreshConfig();
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);

    if (request.method === "GET" && url.pathname === "/api/config") return sendJson(response, 200, config);
    if (request.method === "PUT" && url.pathname === "/api/config") {
      const nextConfig = await bodyJson(request);
      await saveConfig(nextConfig);
      publishConfig();
      return sendJson(response, 200, { ok: true, config });
    }
    if (request.method === "GET" && url.pathname === "/api/state") return sendJson(response, 200, state);
    if (request.method === "GET" && url.pathname === "/api/weather") {
      return sendJson(response, 200, await getWeather(config.weather));
    }
    if (request.method === "GET" && url.pathname === "/api/geocode/search") {
      return sendJson(response, 200, await searchPlaces(url.searchParams.get("q")));
    }
    if (request.method === "GET" && url.pathname === "/api/geocode/reverse") {
      return sendJson(response, 200, await reversePlace(url.searchParams.get("lat"), url.searchParams.get("lon")));
    }
    if (request.method === "GET" && url.pathname === "/api/audio") {
      return sendJson(response, 200, await getAudioSnapshot());
    }
    if (request.method === "GET" && url.pathname === "/api/nowplaying") {
      return sendJson(response, 200, await getNowPlaying());
    }
    if (request.method === "GET" && url.pathname === "/api/tuya") {
      return sendJson(response, 200, await getTuyaSetup());
    }
    if (request.method === "GET" && url.pathname === "/api/local-devices") {
      return sendJson(response, 200, await getLocalDeviceSetup());
    }
    if (request.method === "PUT" && url.pathname === "/api/local-devices") {
      return sendJson(response, 200, await saveLocalDeviceSetup(await bodyJson(request)));
    }
    if (request.method === "POST" && url.pathname === "/api/local-devices/test") {
      return sendJson(response, 200, await testLocalDevices());
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
    if (request.method === "GET" && url.pathname === "/api/events") {
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      clients.add(response);
      response.write(`data: ${JSON.stringify(state)}\n\n`);
      response.write(`event: config\ndata: ${JSON.stringify(config)}\n\n`);
      request.on("close", () => clients.delete(response));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/action") {
      const body = await bodyJson(request);
      const button = findButton(body.id);
      if (!button) return sendJson(response, 404, { ok: false, error: "Nie znaleziono przycisku" });

      try {
        const result = await executeAction(button.action, {});
        state.lastAction = button.id;
        state.error = null;
        state.controls = await getControlStates(config).catch(() => state.controls);
        publish();
        return sendJson(response, 200, { ok: true, ...result });
      } catch (error) {
        const message = error.message;
        state.error = message;
        publish();
        state.error = null;
        return sendJson(response, 500, { ok: false, error: message });
      }
    }

    const relative = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    const filePath = normalize(join(publicDir, relative));
    if (!filePath.startsWith(publicDir)) return sendJson(response, 403, { error: "Forbidden" });
    const data = await readFile(filePath);
    response.writeHead(200, { "Content-Type": mime[extname(filePath)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
    response.end(data);
  } catch (error) {
    if (error.code === "ENOENT") return sendJson(response, 404, { error: "Not found" });
    sendJson(response, 500, { error: error.message });
  }
});

server.listen(config.port, "127.0.0.1", () => {
  console.log(`EndoDeck działa na http://127.0.0.1:${config.port}`);
  adb.start();
});

let statusPolling = false;
setInterval(async () => {
  if (statusPolling) return;
  statusPolling = true;
  try {
    const [controls, nowPlaying] = await Promise.all([
      getControlStates(config),
      getNowPlaying().catch(() => state.nowPlaying)
    ]);
    let changed = false;
    if (JSON.stringify(controls) !== JSON.stringify(state.controls)) {
      state.controls = controls;
      changed = true;
    }
    if (JSON.stringify(nowPlaying) !== JSON.stringify(state.nowPlaying)) {
      state.nowPlaying = nowPlaying;
      changed = true;
    }
    if (changed) publish();
  } catch { }
  statusPolling = false;
}, 2200);

async function refreshSystemStats() {
  const next = await getSystemStats().catch(() => state.systemStats);
  if (!next) return;
  state.systemStats = next;
  publish();
}

refreshSystemStats();
setInterval(refreshSystemStats, 8000);

process.on("SIGINT", () => {
  adb.stop();
  server.close(() => process.exit(0));
});
