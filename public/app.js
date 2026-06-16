import { iconSvg } from "./icon-ui.js";

const $ = (selector) => document.querySelector(selector);
const grid = $("#button-grid");
const toast = $("#toast");
const settingsPanel = $("#settings-panel");
const sourcePanel = $("#source-panel");
const sourceList = $("#source-list");
const settingsForm = $("#settings-form");
const screensaver = $("#screensaver");
const fields = {
  accent: $("#edit-accent"),
  dim: $("#edit-dim"),
  saver: $("#edit-saver"),
  nowPlaying: $("#edit-nowplaying"),
  equalizer: $("#edit-equalizer")
};
const nowPlayingBar = $("#now-playing");
const saverNowPlaying = $("#saver-now-playing");

let config;
let currentPage = "home";
let latestState = {};
let toastTimer;
let audioRefreshTimer;
let inactivityTimer;
let screensaverTimer;
let burnInTimer;
let screensaverActive = false;
let latestWeather;
let suppressDeckClickUntil = 0;
let lastShownError = null;
const nowPlayingAnimationTimers = new WeakMap();

function showToast(message, error = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast show${error ? " error" : ""}`;
  toastTimer = setTimeout(() => toast.className = "toast", 1800);
}

function showErrorOnce(message) {
  const normalized = String(message || "Błąd akcji");
  if (normalized === lastShownError) return;
  lastShownError = normalized;
  showToast(normalized, true);
}

function controlActive(id) {
  return Boolean(latestState.controls?.[id]?.active);
}

function applyControlStates() {
  for (const element of document.querySelectorAll(".deck-button[data-id]")) {
    const active = controlActive(element.dataset.id);
    element.classList.toggle("is-on", active);
    element.setAttribute("aria-pressed", String(active));
    const badge = element.querySelector(".live-badge");
    if (badge) badge.textContent = active ? "AKTYWNE" : "";
  }
}

function createDeckButton(button) {
  const element = document.createElement("button");
  element.className = `deck-button tone-${button.tone ?? "neutral"}`;
  element.dataset.id = button.id;
  element.style.setProperty("--enter-delay", `${Math.min(11, Math.max(0, Number(button.position ?? 1) - 1)) * 24}ms`);
  element.setAttribute("aria-label", `${button.label} ${button.hint ?? ""}`.trim());
  element.innerHTML = `<span class="tile-number">${String(button.position ?? "").padStart(2, "0")}</span><span class="live-badge"></span><span class="icon">${iconSvg(button.icon)}</span><span class="tile-copy"><strong>${button.label}</strong><small>${button.hint ?? ""}</small></span>`;
  element.addEventListener("pointerdown", () => element.classList.add("pressed"));
  element.addEventListener("pointerup", () => element.classList.remove("pressed"));
  element.addEventListener("pointerleave", () => element.classList.remove("pressed"));
  element.addEventListener("pointercancel", () => element.classList.remove("pressed"));
  element.addEventListener("click", () => trigger(button, element));
  return element;
}

function render(pageName) {
  clearInterval(audioRefreshTimer);
  closeSourceDialog();
  const page = config.pages[pageName] ?? config.pages.home;
  currentPage = pageName in config.pages ? pageName : "home";
  $("#page-label").textContent = page.label;
  if (page.layout === "mixer") return renderMixer(page);
  grid.className = "button-grid";
  grid.classList.add("page-entering");
  grid.replaceChildren(...page.buttons.map((button, index) => createDeckButton({ ...button, position: index + 1 })));
  applyControlStates();
}

function mixerName(session) {
  if (session.id === 0) return "Dźwięki systemowe";
  const names = { chrome: "Google Chrome", discord: "Discord", msedge: "Microsoft Edge", spotify: "Spotify", steam: "Steam", firefox: "Firefox" };
  return names[String(session.process || "").toLowerCase()] ?? (session.name && !String(session.name).startsWith("@") ? session.name : session.process || `Proces ${session.id}`);
}

function createRangeChannel({ id, name, process, volume, master = false }) {
  const channel = document.createElement("label");
  channel.className = `mixer-channel${master ? " master-channel" : ""}`;
  channel.innerHTML = `<span class="channel-heading"><strong>${name}</strong><small>${master ? "GŁOŚNOŚĆ GŁÓWNA" : process}</small><output>${volume}%</output></span>`;
  const range = document.createElement("input");
  range.className = "mixer-range";
  range.type = "range"; range.min = "0"; range.max = "100"; range.value = String(volume);
  range.style.setProperty("--level", `${volume}%`);
  range.setAttribute("aria-label", `Głośność ${name}`);
  range.addEventListener("input", () => { channel.querySelector("output").textContent = `${range.value}%`; range.style.setProperty("--level", `${range.value}%`); });
  range.addEventListener("change", () => updateVolume(master ? "master" : "session", id, Number(range.value)));
  channel.append(range);
  return channel;
}

async function updateVolume(target, id, volume) {
  try {
    const response = await fetch("/api/audio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target, id, volume }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Nie udało się zmienić głośności");
    navigator.vibrate?.(12);
  } catch (error) { showErrorOnce(error.message); }
}

async function loadMixer(board) {
  try {
    const response = await fetch("/api/audio", { cache: "no-store" });
    const snapshot = await response.json();
    if (!response.ok) throw new Error(snapshot.error || "Mikser Windows jest niedostępny");
    if (!board.isConnected || currentPage !== "audio") return;
    const channels = document.createElement("div");
    channels.className = "mixer-channels";
    channels.append(...snapshot.sessions.map((session) => createRangeChannel({ id: session.id, name: mixerName(session), process: session.process, volume: session.volume })));
    if (!snapshot.sessions.length) channels.innerHTML = '<div class="mixer-empty">Uruchom aplikację odtwarzającą dźwięk, a jej suwak pojawi się tutaj.</div>';
    board.replaceChildren(createRangeChannel({ name: "SYSTEM WINDOWS", volume: snapshot.master, master: true }), channels);
  } catch (error) { board.innerHTML = `<div class="mixer-empty">${error.message}</div>`; }
}

function createSourceTile(button) {
  const element = document.createElement("div");
  element.className = `deck-button tone-${button.tone ?? "neutral"} source-tile`;
  element.dataset.id = button.id;
  element.setAttribute("role", "button");
  element.setAttribute("aria-label", `${button.label} ${button.hint ?? ""}`.trim());
  element.innerHTML = `<span class="tile-number">${String(button.position ?? "").padStart(2, "0")}</span><span class="icon">${iconSvg(button.icon)}</span><span class="tile-copy"><strong>${button.label}</strong><small>${button.hint ?? ""}</small></span>`;
  element.addEventListener("pointerdown", () => element.classList.add("pressed"));
  element.addEventListener("pointerup", () => element.classList.remove("pressed"));
  element.addEventListener("pointerleave", () => element.classList.remove("pressed"));
  element.addEventListener("pointercancel", () => element.classList.remove("pressed"));
  element.addEventListener("click", () => {
    navigator.vibrate?.(12);
    openSourceDialog();
  });
  return element;
}

function openSourceDialog() {
  sourcePanel.classList.remove("hidden");
  sourcePanel.setAttribute("aria-hidden", "false");
  loadAudioSources();
}

function closeSourceDialog() {
  sourcePanel.classList.add("hidden");
  sourcePanel.setAttribute("aria-hidden", "true");
}

async function loadAudioSources() {
  sourceList.innerHTML = '<div class="source-empty">ŁADUJĘ URZĄDZENIA…</div>';
  try {
    const response = await fetch("/api/audio/devices", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Nie udało się pobrać urządzeń audio");
    if (sourcePanel.classList.contains("hidden")) return;
    if (!data.devices?.length) {
      sourceList.innerHTML = '<div class="source-empty">Brak aktywnych wyjść audio</div>';
      return;
    }
    sourceList.replaceChildren(...data.devices.map((device) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = `source-option${device.isDefault ? " is-active" : ""}`;
      const dot = document.createElement("span");
      dot.className = "source-dot";
      const name = document.createElement("span");
      name.className = "source-name";
      name.textContent = device.name;
      option.append(dot, name);
      option.addEventListener("click", () => selectAudioSource(device.id));
      return option;
    }));
  } catch (error) {
    sourceList.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "source-empty";
    empty.textContent = error.message;
    sourceList.append(empty);
  }
}

async function selectAudioSource(deviceId) {
  try {
    const response = await fetch("/api/audio/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Nie udało się zmienić źródła audio");
    navigator.vibrate?.(24);
    showToast("Źródło audio ustawione");
    loadAudioSources();
  } catch (error) { showErrorOnce(error.message); }
}

function renderMixer(page) {
  grid.className = "button-grid audio-grid";
  grid.classList.add("page-entering");
  const board = document.createElement("section");
  board.className = "mixer-board";
  board.innerHTML = '<div class="mixer-loading">ODCZYTUJĘ MIKSER WINDOWS…</div>';
  const actions = document.createElement("aside");
  actions.className = "mixer-actions";
  const backButton = page.buttons.at(-1);
  const sourceButton = page.buttons.at(-2);
  const mediaButtons = page.buttons.slice(0, -2);
  actions.append(
    ...mediaButtons.map((button, index) => createDeckButton({ ...button, position: index + 1 })),
    createSourceTile({ ...sourceButton, position: mediaButtons.length + 1 }),
    createDeckButton({ ...backButton, position: mediaButtons.length + 2 })
  );
  grid.replaceChildren(board, actions);
  loadMixer(board);
  applyControlStates();
  audioRefreshTimer = setInterval(() => {
    if (!document.querySelector(".mixer-range:active")) loadMixer(board);
  }, 7000);
}

async function trigger(button, element) {
  if (button.action.type === "page") return render(button.action.page);
  navigator.vibrate?.(24);
  try {
    const response = await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: button.id }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Błąd akcji");
    lastShownError = null;
    if (result.page) render(result.page);
    if (result.message) showToast(result.message);
  } catch (error) { showErrorOnce(error.message); }
}

function openSettings() {
  fields.accent.value = config.accent;
  fields.dim.value = String(config.ui?.dimAfterSeconds ?? 90);
  fields.saver.value = String(config.ui?.screensaverAfterSeconds ?? 300);
  fields.nowPlaying.checked = nowPlayingEnabled();
  fields.equalizer.checked = equalizerEnabled();
  settingsPanel.classList.remove("hidden"); settingsPanel.setAttribute("aria-hidden", "false");
}

function closeSettings() { settingsPanel.classList.add("hidden"); settingsPanel.setAttribute("aria-hidden", "true"); }

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    config.accent = fields.accent.value;
    config.ui = {
      ...(config.ui ?? {}),
      dimAfterSeconds: Math.max(10, Number(fields.dim.value) || 90),
      screensaverAfterSeconds: Math.max(30, Number(fields.saver.value) || 300),
      showNowPlaying: fields.nowPlaying.checked,
      showEqualizer: fields.equalizer.checked
    };
    const response = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Nie udało się zapisać");
    config = result.config;
    document.documentElement.style.setProperty("--accent", config.accent);
    render(currentPage);
    renderNowPlaying();
    resetIdle();
    closeSettings();
    showToast("Zapisano ustawienia");
  } catch (error) { showErrorOnce(error.message); }
});

$("#settings-trigger").addEventListener("click", openSettings); $("#settings-close").addEventListener("click", closeSettings);
$("#source-close").addEventListener("click", closeSourceDialog);

function nowPlayingEnabled() { return config?.ui?.showNowPlaying !== false; }
function equalizerEnabled() { return config?.ui?.showEqualizer !== false; }

function syncEqualizerActivity() {
  const playing = Boolean(latestState.nowPlaying?.playing) && equalizerEnabled() && !document.hidden;
  $("#now-playing-eq").classList.toggle("playing", playing && !screensaverActive);
  $("#saver-now-playing-eq").classList.toggle("playing", playing && screensaverActive);
}

let nowPlayingVisible = false;

function animateNowPlayingBar(element, show) {
  clearTimeout(nowPlayingAnimationTimers.get(element));
  element.classList.remove("np-entering", "np-leaving");
  if (show) {
    element.classList.remove("hidden");
    element.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => element.classList.add("np-entering"));
    nowPlayingAnimationTimers.set(element, setTimeout(() => element.classList.remove("np-entering"), 520));
    return;
  }
  element.classList.add("np-leaving");
  element.setAttribute("aria-hidden", "true");
  nowPlayingAnimationTimers.set(element, setTimeout(() => {
    element.classList.remove("np-leaving");
    element.classList.add("hidden");
  }, 400));
}

function renderNowPlaying() {
  const track = latestState.nowPlaying;
  const enabled = nowPlayingEnabled();
  const hasTrack = enabled && track && track.title && track.playing;
  const showEq = equalizerEnabled();

  if (hasTrack !== nowPlayingVisible) {
    nowPlayingVisible = hasTrack;
    animateNowPlayingBar(nowPlayingBar, hasTrack);
    animateNowPlayingBar(saverNowPlaying, hasTrack);
  }

  syncEqualizerActivity();
  if (!hasTrack) return;

  $("#now-playing-title").textContent = track.title;
  $("#now-playing-artist").textContent = track.artist || "";
  $("#saver-now-playing-title").textContent = track.title;
  $("#saver-now-playing-artist").textContent = track.artist || "";

  const barEq = $("#now-playing-eq");
  const saverEq = $("#saver-now-playing-eq");
  barEq.classList.toggle("hidden", !showEq);
  saverEq.classList.toggle("hidden", !showEq);
}

function updateState(state) {
  latestState = state;
  $("#usb-status").classList.toggle("online", Boolean(state.adb)); $("#saver-pc").classList.toggle("online", Boolean(state.adb));
  const battery = state.battery;
  $("#power-status").textContent = battery ? `${battery.currentMa >= 0 ? "+" : ""}${battery.currentMa} mA` : "-- mA";
  $("#battery-status").textContent = battery ? `${battery.percent}%` : "--%";
  $("#saver-power").textContent = $("#power-status").textContent; $("#saver-battery").textContent = $("#battery-status").textContent;
  applyControlStates();
  renderNowPlaying();
  renderSystemStats(state.systemStats);
  if (state.error) showErrorOnce(state.error);
  else lastShownError = null;
}

function dataRateParts(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) {
    return {
      value: (value / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1),
      unit: "MB/s"
    };
  }
  if (value >= 1024) return { value: String(Math.round(value / 1024)), unit: "KB/s" };
  return { value: String(Math.round(value)), unit: "B/s" };
}

function gibibytes(bytes) {
  return `${(Number(bytes || 0) / 1024 ** 3).toFixed(1)} GB`;
}

const metricRingCircumference = 100.53;
const netRingCap = 100 * 1024 * 1024;

function setMetricRing(selector, value) {
  const numeric = Number(value);
  const percent = Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : 0;
  $(selector).style.strokeDashoffset = String(metricRingCircumference * (1 - percent / 100));
}

function setNetRing(selector, bytes) {
  const value = Number(bytes) || 0;
  const percent = Math.min(100, (value / netRingCap) * 100);
  $(selector).style.strokeDashoffset = String(metricRingCircumference * (1 - percent / 100));
}

function renderSystemStats(stats) {
  if (!stats) return;
  const cpuUsage = stats.cpu?.usage;
  const gpuUsage = stats.gpu?.usage;
  const ramUsage = stats.memory?.usage;
  $("#metric-gpu-card").classList.toggle("hidden", !stats.gpu);
  $("#metric-cpu").textContent = `${cpuUsage ?? "--"}%`;
  $("#metric-cpu-temp").textContent = stats.cpu?.temperature ? `${stats.cpu.temperature}°C` : "—";
  $("#metric-gpu").textContent = `${gpuUsage ?? "--"}%`;
  $("#metric-gpu-temp").textContent = stats.gpu?.temperature ? `${stats.gpu.temperature}°C` : (stats.gpu?.name ? "OK" : "—");
  $("#metric-ram").textContent = `${ramUsage ?? "--"}%`;
  $("#metric-ram-used").textContent = gibibytes(stats.memory?.used);
  setMetricRing("#metric-cpu-ring", cpuUsage);
  setMetricRing("#metric-gpu-ring", gpuUsage);
  setMetricRing("#metric-ram-ring", ramUsage);
  setNetRing("#metric-net-down-ring", stats.network?.received);
  setNetRing("#metric-net-up-ring", stats.network?.sent);
  const netDown = dataRateParts(stats.network?.received);
  const netUp = dataRateParts(stats.network?.sent);
  $("#metric-net-down-value").textContent = netDown.value;
  $("#metric-net-down-unit").textContent = netDown.unit;
  $("#metric-net-up-value").textContent = netUp.value;
  $("#metric-net-up-unit").textContent = netUp.unit;
}

function updateClock() {
  const now = new Date();
  const main = new Intl.DateTimeFormat("pl-PL", { hour: "2-digit", minute: "2-digit" }).format(now);
  $("#clock").textContent = main; $("#saver-main-time").textContent = main; $("#saver-seconds").textContent = String(now.getSeconds()).padStart(2, "0");
  $("#saver-date").textContent = new Intl.DateTimeFormat("pl-PL", { weekday: "long", day: "numeric", month: "long" }).format(now);
}

const weatherLabels = { 0:["SŁONECZNIE","☀"],1:["PRAWIE BEZCHMURNIE","◒"],2:["CZĘŚCIOWE ZACHMURZENIE","◑"],3:["POCHMURNO","☁"],45:["MGŁA","≋"],48:["SZADŹ","≋"],51:["MŻAWKA","⋰"],53:["MŻAWKA","⋰"],55:["MŻAWKA","⋰"],61:["DESZCZ","↯"],63:["DESZCZ","↯"],65:["ULEWA","↯"],71:["ŚNIEG","✦"],73:["ŚNIEG","✦"],75:["ŚNIEŻYCA","✦"],80:["PRZELOTNY DESZCZ","↯"],81:["PRZELOTNY DESZCZ","↯"],82:["ULEWA","↯"],95:["BURZA","ϟ"],96:["BURZA Z GRADEM","ϟ"],99:["BURZA Z GRADEM","ϟ"] };
function weatherInfo(code) { return weatherLabels[code] ?? ["ZMIENNA POGODA", "·"]; }
function shortTime(value) { return String(value ?? "").split("T")[1]?.slice(0, 5) ?? "--:--"; }
function renderWeather(weather) {
  const [label, symbol] = weatherInfo(weather.current.code);
  $("#weather-symbol").textContent = symbol; $("#weather-temp").textContent = `${weather.current.temperature}°`; $("#weather-city").textContent = weather.city;
  $("#weather-description").textContent = `${label} · ODCZUWALNA ${weather.current.apparent}° · WIATR ${weather.current.wind} KM/H`;
  $("#forecast").innerHTML = weather.daily.map((day) => { const date = new Date(`${day.date}T12:00:00`); const [, daySymbol] = weatherInfo(day.code); return `<div class="forecast-day"><b>${new Intl.DateTimeFormat("pl-PL", { weekday: "short" }).format(date)}</b><span>${daySymbol}</span><strong>${day.max}°</strong><small class="forecast-meta">${day.min}° · ${day.rain}%</small><small class="sun-times"><span>↑ ${shortTime(day.sunrise)}</span><span>↓ ${shortTime(day.sunset)}</span></small></div>`; }).join("");
}

function cacheAccent(accent) {
  try { window.NativeDeck?.cacheAccent(accent); } catch { }
}

async function syncOfflineBundle() {
  try {
    const response = await fetch("/api/offline-bundle", { cache: "no-store" });
    if (!response.ok) return;
    const bundle = await response.json();
    window.NativeDeck?.cacheOfflineBundle?.(JSON.stringify(bundle));
  } catch { }
}

function applyConfig(nextConfig, resetTimers = true) {
  config = nextConfig;
  if (!config.pages[currentPage]) currentPage = "home";
  document.documentElement.style.setProperty("--accent", config.accent);
  $("#deck-title").textContent = config.title;
  cacheAccent(config.accent);
  syncOfflineBundle();
  render(currentPage);
  renderNowPlaying();
  if (resetTimers) resetIdle();
}

function cityTime(weather) {
  const shifted = new Date(Date.now() + Number(weather?.utcOffsetSeconds ?? 0) * 1000);
  return {
    date: shifted.toISOString().slice(0, 10),
    minute: shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  };
}

function eventMinute(value) {
  const match = String(value ?? "").match(/T(\d{2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function brightnessPercent(value, fallback) {
  const numeric = Number(value);
  return Math.max(.01, Math.min(1, (Number.isFinite(numeric) ? numeric : fallback) / 100));
}

function screensaverBrightness(weather, offline = false) {
  const { date, minute } = cityTime(weather);
  const today = weather?.daily?.find((day) => day.date === date) ?? weather?.daily?.[0];
  const sunrise = eventMinute(today?.sunrise);
  const sunset = eventMinute(today?.sunset);
  const brightness = config?.ui?.screensaverBrightness ?? {};
  const levels = offline
    ? { night: brightnessPercent(brightness.offlineNight, 5), day: brightnessPercent(brightness.offlineDay, 10), twilight: brightnessPercent(brightness.twilight, 9) }
    : { night: brightnessPercent(brightness.night, 6), day: brightnessPercent(brightness.day, 13), twilight: brightnessPercent(brightness.twilight, 9) };
  if (sunrise === null || sunset === null) return levels.night;
  if (Math.abs(minute - sunrise) <= 45 || Math.abs(minute - sunset) <= 45) return levels.twilight;
  return minute > sunrise && minute < sunset ? levels.day : levels.night;
}

async function loadWeather() {
  try {
    const response = await fetch("/api/weather");
    if (!response.ok) return;
    const weather = await response.json();
    latestWeather = weather;
    renderWeather(weather);
    try { window.NativeDeck?.cacheWeather(JSON.stringify(weather)); } catch { }
    if (screensaverActive) setDeckBrightness(screensaverBrightness(weather));
  } catch { }
}

function setDeckBrightness(value) {
  try { window.NativeDeck?.setBrightness(value); } catch { }
}

function rotateScreensaver() {
  const phase = Math.floor(Date.now() / 300_000);
  const positions = [[-5, -3], [4, -4], [-3, 4], [5, 3], [0, -5], [-4, 2], [3, 5], [0, 0]];
  const [x, y] = positions[phase % positions.length];
  screensaver.style.setProperty("--burn-x", `${x}px`);
  screensaver.style.setProperty("--burn-y", `${y}px`);
}

function showScreensaver() {
  screensaverActive = true;
  document.body.classList.remove("dimmed");
  rotateScreensaver();
  clearInterval(burnInTimer);
  burnInTimer = setInterval(rotateScreensaver, 300_000);
  screensaver.classList.remove("hidden");
  screensaver.setAttribute("aria-hidden", "false");
  syncEqualizerActivity();
  setDeckBrightness(screensaverBrightness(latestWeather));
  loadWeather();
}
function resetIdle() {
  clearTimeout(inactivityTimer); clearTimeout(screensaverTimer); clearInterval(burnInTimer);
  if (screensaverActive) setDeckBrightness(-1);
  screensaverActive = false;
  syncEqualizerActivity();
  document.body.classList.remove("dimmed"); screensaver.classList.add("hidden"); screensaver.setAttribute("aria-hidden", "true");
  inactivityTimer = setTimeout(() => document.body.classList.add("dimmed"), Math.max(10, config.ui?.dimAfterSeconds ?? 90) * 1000);
  screensaverTimer = setTimeout(showScreensaver, Math.max(30, config.ui?.screensaverAfterSeconds ?? 300) * 1000);
}

function wakeFromScreensaver(event) {
  if (!screensaverActive) return;
  suppressDeckClickUntil = Date.now() + 700;
  event.preventDefault();
  event.stopImmediatePropagation();
  resetIdle();
}

function suppressWakeClick(event) {
  if (Date.now() >= suppressDeckClickUntil) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

async function boot() {
  applyConfig(await fetch("/api/config").then((response) => response.json()), false);
  $("#settings-trigger").innerHTML = iconSvg("gear");
  updateState(await fetch("/api/state").then((response) => response.json())); updateClock(); loadWeather(); resetIdle();
  const events = new EventSource("/api/events"); events.addEventListener("message", (event) => updateState(JSON.parse(event.data)));
  events.addEventListener("config", (event) => applyConfig(JSON.parse(event.data)));
  setInterval(updateClock, 1000); setInterval(loadWeather, 15 * 60_000); setInterval(syncOfflineBundle, 60_000);
  document.addEventListener("pointerdown", wakeFromScreensaver, { capture: true, passive: false });
  document.addEventListener("touchstart", wakeFromScreensaver, { capture: true, passive: false });
  document.addEventListener("click", suppressWakeClick, { capture: true, passive: false });
  for (const event of ["pointerdown", "touchstart", "keydown"]) document.addEventListener(event, resetIdle, { passive: true });
  document.addEventListener("visibilitychange", syncEqualizerActivity);
}

boot().catch((error) => showErrorOnce(error.message));
