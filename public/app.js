import { iconSvg } from "./icon-ui.js";

const $ = (selector) => document.querySelector(selector);
const grid = $("#button-grid");
const toast = $("#toast");
const settingsPanel = $("#settings-panel");
const settingsForm = $("#settings-form");
const screensaver = $("#screensaver");
const fields = {
  accent: $("#edit-accent"),
  dim: $("#edit-dim"),
  saver: $("#edit-saver")
};

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

function showToast(message, error = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast show${error ? " error" : ""}`;
  toastTimer = setTimeout(() => toast.className = "toast", 1800);
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
  element.addEventListener("click", () => trigger(button, element));
  return element;
}

function render(pageName) {
  clearInterval(audioRefreshTimer);
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
  } catch (error) { showToast(error.message, true); }
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

function renderMixer(page) {
  grid.className = "button-grid audio-grid";
  grid.classList.add("page-entering");
  const board = document.createElement("section");
  board.className = "mixer-board";
  board.innerHTML = '<div class="mixer-loading">ODCZYTUJĘ MIKSER WINDOWS…</div>';
  const actions = document.createElement("aside");
  actions.className = "mixer-actions";
  actions.append(...page.buttons.map((button, index) => createDeckButton({ ...button, position: index + 1 })));
  grid.replaceChildren(board, actions);
  loadMixer(board);
  applyControlStates();
  audioRefreshTimer = setInterval(() => { if (!document.querySelector(".mixer-range:active")) loadMixer(board); }, 7000);
}

async function trigger(button, element) {
  if (button.action.type === "page") return render(button.action.page);
  element.classList.add("pressed");
  navigator.vibrate?.(24);
  try {
    const response = await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: button.id }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Błąd akcji");
    if (result.page) render(result.page);
  } catch (error) { showToast(error.message, true); }
  finally { setTimeout(() => element.classList.remove("pressed"), 140); }
}

function openSettings() {
  fields.accent.value = config.accent;
  fields.dim.value = String(config.ui?.dimAfterSeconds ?? 90);
  fields.saver.value = String(config.ui?.screensaverAfterSeconds ?? 300);
  settingsPanel.classList.remove("hidden"); settingsPanel.setAttribute("aria-hidden", "false");
}

function closeSettings() { settingsPanel.classList.add("hidden"); settingsPanel.setAttribute("aria-hidden", "true"); }

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    config.accent = fields.accent.value;
    config.ui = {
      dimAfterSeconds: Math.max(10, Number(fields.dim.value) || 90),
      screensaverAfterSeconds: Math.max(30, Number(fields.saver.value) || 300)
    };
    const response = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Nie udało się zapisać");
    config = result.config;
    document.documentElement.style.setProperty("--accent", config.accent);
    render(currentPage);
    resetIdle();
    closeSettings();
    showToast("Zapisano ustawienia");
  } catch (error) { showToast(error.message, true); }
});

$("#settings-trigger").addEventListener("click", openSettings); $("#settings-close").addEventListener("click", closeSettings);

function updateState(state) {
  latestState = state;
  $("#usb-status").classList.toggle("online", Boolean(state.adb)); $("#saver-pc").classList.toggle("online", Boolean(state.adb));
  const battery = state.battery;
  $("#power-status").textContent = battery ? `${battery.currentMa >= 0 ? "+" : ""}${battery.currentMa} mA` : "-- mA";
  $("#battery-status").textContent = battery ? `${battery.percent}%` : "--%";
  $("#saver-power").textContent = $("#power-status").textContent; $("#saver-battery").textContent = $("#battery-status").textContent;
  applyControlStates();
  if (state.error) showToast(state.error, true);
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

function applyConfig(nextConfig, resetTimers = true) {
  config = nextConfig;
  if (!config.pages[currentPage]) currentPage = "home";
  document.documentElement.style.setProperty("--accent", config.accent);
  $("#deck-title").textContent = config.title;
  cacheAccent(config.accent);
  render(currentPage);
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

function screensaverBrightness(weather, offline = false) {
  const { date, minute } = cityTime(weather);
  const today = weather?.daily?.find((day) => day.date === date) ?? weather?.daily?.[0];
  const sunrise = eventMinute(today?.sunrise);
  const sunset = eventMinute(today?.sunset);
  const levels = offline ? { night: .052, day: .060, twilight: .068 } : { night: .062, day: .070, twilight: .078 };
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
  const phase = Math.floor(Date.now() / 120_000);
  const positions = [[-12, -8], [10, -6], [-8, 10], [12, 8], [0, -12], [0, 12]];
  const [x, y] = positions[phase % positions.length];
  screensaver.style.setProperty("--burn-x", `${x}px`);
  screensaver.style.setProperty("--burn-y", `${y}px`);
  screensaver.classList.toggle("layout-swapped", phase % 2 === 1);
}

function showScreensaver() {
  screensaverActive = true;
  document.body.classList.remove("dimmed");
  rotateScreensaver();
  clearInterval(burnInTimer);
  burnInTimer = setInterval(rotateScreensaver, 60_000);
  screensaver.classList.remove("hidden");
  screensaver.setAttribute("aria-hidden", "false");
  setDeckBrightness(screensaverBrightness(latestWeather));
  loadWeather();
}
function resetIdle() {
  clearTimeout(inactivityTimer); clearTimeout(screensaverTimer); clearInterval(burnInTimer);
  if (screensaverActive) setDeckBrightness(-1);
  screensaverActive = false;
  document.body.classList.remove("dimmed"); screensaver.classList.add("hidden"); screensaver.setAttribute("aria-hidden", "true");
  inactivityTimer = setTimeout(() => document.body.classList.add("dimmed"), Math.max(10, config.ui?.dimAfterSeconds ?? 90) * 1000);
  screensaverTimer = setTimeout(showScreensaver, Math.max(30, config.ui?.screensaverAfterSeconds ?? 300) * 1000);
}

async function boot() {
  applyConfig(await fetch("/api/config").then((response) => response.json()), false);
  $("#settings-trigger").innerHTML = iconSvg("gear");
  updateState(await fetch("/api/state").then((response) => response.json())); updateClock(); loadWeather(); resetIdle();
  const events = new EventSource("/api/events"); events.addEventListener("message", (event) => updateState(JSON.parse(event.data)));
  events.addEventListener("config", (event) => applyConfig(JSON.parse(event.data)));
  setInterval(updateClock, 1000); setInterval(loadWeather, 15 * 60_000);
  for (const event of ["pointerdown", "touchstart", "keydown"]) document.addEventListener(event, resetIdle, { passive: true });
}

boot().catch((error) => showToast(error.message, true));
