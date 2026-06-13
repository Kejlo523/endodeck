import { iconSvg, renderIconPicker, resolveIcon } from "./icon-ui.js";

const $ = (selector) => document.querySelector(selector);
const grid = $("#button-grid");
const toast = $("#toast");
const settingsPanel = $("#settings-panel");
const settingsForm = $("#settings-form");
const screensaver = $("#screensaver");
const fields = {
  page: $("#edit-page"), button: $("#edit-button"), label: $("#edit-label"), hint: $("#edit-hint"),
  tone: $("#edit-tone"), accent: $("#edit-accent"), type: $("#edit-type"), primary: $("#edit-primary"),
  detail: $("#edit-detail"), primaryLabel: $("#edit-primary-label"), detailLabel: $("#edit-detail-label"),
  iconSearch: $("#quick-icon-search"), iconGrid: $("#quick-icon-grid"), selectedIcon: $("#quick-selected-icon")
};

let config;
let currentPage = "home";
let selectedIcon = "wand-magic-sparkles";
let latestState = {};
let toastTimer;
let audioRefreshTimer;
let inactivityTimer;
let screensaverTimer;

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

function selectedButton() { return config.pages[fields.page.value].buttons[Number(fields.button.value)]; }

function selectQuickIcon(name) {
  selectedIcon = resolveIcon(name);
  fields.selectedIcon.innerHTML = `${iconSvg(selectedIcon)}<span>${selectedIcon}</span>`;
  renderIconPicker(fields.iconGrid, fields.iconSearch.value, selectedIcon, selectQuickIcon);
}

function fillButtonOptions() {
  fields.button.replaceChildren(...config.pages[fields.page.value].buttons.map((button, index) => new Option(button.label, String(index))));
  loadEditor();
}

function updateActionLabels() {
  const labels = {
    hotkey: ["Klawisze, np. CTRL + SHIFT + P", "Nie używane"], processHotkey: ["Proces, np. Discord", "Klawisze, np. CTRL + SHIFT + M"],
    launch: ["Program lub adres", "Argumenty jako JSON"], command: ["Polecenie", "Argumenty jako JSON"], media: ["playPause / next / previous", "Nie używane"],
    page: ["Nazwa strony, np. home", "Nie używane"], sequence: ["Sekwencja", "Lista akcji jako JSON"], microphoneMute: ["Sterowanie mikrofonem systemowym", "Stan jest odczytywany z Windows"]
  };
  [fields.primaryLabel.textContent, fields.detailLabel.textContent] = labels[fields.type.value];
  const noInput = fields.type.value === "microphoneMute";
  fields.primary.disabled = fields.type.value === "sequence" || noInput;
  fields.detail.closest("label").classList.toggle("muted-field", ["hotkey", "media", "page", "microphoneMute"].includes(fields.type.value));
}

function loadEditor() {
  const button = selectedButton();
  if (!button) return;
  fields.label.value = button.label; fields.hint.value = button.hint ?? ""; fields.tone.value = button.tone ?? "neutral"; fields.type.value = button.action.type;
  selectedIcon = resolveIcon(button.icon); fields.iconSearch.value = ""; selectQuickIcon(selectedIcon);
  const action = button.action;
  fields.primary.value = action.type === "hotkey" ? (action.keys ?? []).join(" + ") : action.type === "processHotkey" ? action.process ?? "" : action.type === "media" ? action.key ?? "" : action.type === "page" ? action.page ?? "" : action.command ?? "";
  fields.detail.value = action.type === "processHotkey" ? (action.keys ?? []).join(" + ") : action.type === "sequence" ? JSON.stringify(action.actions ?? [], null, 2) : ["launch", "command"].includes(action.type) ? JSON.stringify(action.args ?? []) : "";
  updateActionLabels();
}

function buildAction() {
  const type = fields.type.value;
  if (type === "microphoneMute") return { type };
  if (type === "hotkey") return { type, keys: fields.primary.value.split(/[+,\s]+/).filter(Boolean).map((key) => key.toUpperCase()) };
  if (type === "processHotkey") return { type, process: fields.primary.value.trim(), keys: fields.detail.value.split(/[+,\s]+/).filter(Boolean).map((key) => key.toUpperCase()) };
  if (type === "media") return { type, key: fields.primary.value.trim() };
  if (type === "page") return { type, page: fields.primary.value.trim() };
  if (type === "sequence") return { type, actions: JSON.parse(fields.detail.value || "[]") };
  return { type, command: fields.primary.value.trim(), args: JSON.parse(fields.detail.value || "[]") };
}

function openSettings() {
  fields.page.replaceChildren(...Object.entries(config.pages).map(([name, page]) => new Option(page.label, name)));
  fields.page.value = currentPage; fields.accent.value = config.accent; fillButtonOptions();
  settingsPanel.classList.remove("hidden"); settingsPanel.setAttribute("aria-hidden", "false");
}

function closeSettings() { settingsPanel.classList.add("hidden"); settingsPanel.setAttribute("aria-hidden", "true"); }

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const button = selectedButton();
    button.label = fields.label.value.trim(); button.hint = fields.hint.value.trim(); button.icon = selectedIcon; button.tone = fields.tone.value; button.action = buildAction(); config.accent = fields.accent.value;
    const response = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Nie udało się zapisać");
    config = result.config; document.documentElement.style.setProperty("--accent", config.accent); render(currentPage); fillButtonOptions(); showToast("Zapisano przycisk");
  } catch (error) { showToast(error.message, true); }
});

$("#settings-trigger").addEventListener("click", openSettings); $("#settings-close").addEventListener("click", closeSettings);
fields.page.addEventListener("change", fillButtonOptions); fields.button.addEventListener("change", loadEditor); fields.type.addEventListener("change", updateActionLabels);
fields.iconSearch.addEventListener("input", () => renderIconPicker(fields.iconGrid, fields.iconSearch.value, selectedIcon, selectQuickIcon));

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
function renderWeather(weather) {
  const [label, symbol] = weatherInfo(weather.current.code);
  $("#weather-symbol").textContent = symbol; $("#weather-temp").textContent = `${weather.current.temperature}°`; $("#weather-city").textContent = weather.city;
  $("#weather-description").textContent = `${label} · ODCZUWALNA ${weather.current.apparent}° · WIATR ${weather.current.wind} KM/H`;
  $("#forecast").innerHTML = weather.daily.map((day) => { const date = new Date(`${day.date}T12:00:00`); const [, daySymbol] = weatherInfo(day.code); return `<div class="forecast-day"><b>${new Intl.DateTimeFormat("pl-PL", { weekday: "short" }).format(date)}</b><span>${daySymbol}</span><strong>${day.max}°</strong><small>${day.min}° · ${day.rain}%</small></div>`; }).join("");
}

async function loadWeather() { try { const response = await fetch("/api/weather"); if (response.ok) renderWeather(await response.json()); } catch { } }

function showScreensaver() { document.body.classList.remove("dimmed"); screensaver.classList.remove("hidden"); screensaver.setAttribute("aria-hidden", "false"); loadWeather(); }
function resetIdle() {
  clearTimeout(inactivityTimer); clearTimeout(screensaverTimer); document.body.classList.remove("dimmed"); screensaver.classList.add("hidden"); screensaver.setAttribute("aria-hidden", "true");
  inactivityTimer = setTimeout(() => document.body.classList.add("dimmed"), Math.max(10, config.ui?.dimAfterSeconds ?? 90) * 1000);
  screensaverTimer = setTimeout(showScreensaver, Math.max(30, config.ui?.screensaverAfterSeconds ?? 300) * 1000);
}

async function boot() {
  config = await fetch("/api/config").then((response) => response.json());
  document.documentElement.style.setProperty("--accent", config.accent); $("#deck-title").textContent = config.title; $("#settings-trigger").innerHTML = iconSvg("gear");
  render("home"); updateState(await fetch("/api/state").then((response) => response.json())); updateClock(); loadWeather(); resetIdle();
  const events = new EventSource("/api/events"); events.addEventListener("message", (event) => updateState(JSON.parse(event.data)));
  setInterval(updateClock, 1000); setInterval(loadWeather, 15 * 60_000);
  for (const event of ["pointerdown", "touchstart", "keydown"]) document.addEventListener(event, resetIdle, { passive: true });
}

boot().catch((error) => showToast(error.message, true));
