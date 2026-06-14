import { iconSvg, renderIconPicker, resolveIcon } from "./icon-ui.js";

const $ = (selector) => document.querySelector(selector);
let config;
let pageName = "home";
let tileIndex = 0;
let selectedIcon = "wand-magic-sparkles";
let tuyaSetup = { configured: false, devices: [] };
let map;
let marker;
let toastTimer;

const toneLabels = { accent: "Akcent", blue: "Niebieski", green: "Zielony", red: "Czerwony", amber: "Bursztynowy", violet: "Fioletowy", neutral: "Szary" };

function notify(message, error = false) {
  clearTimeout(toastTimer);
  const toast = $("#studio-toast");
  toast.textContent = message; toast.className = `studio-toast show${error ? " error" : ""}`;
  toastTimer = setTimeout(() => toast.className = "studio-toast", 2200);
}

function currentPage() { return config.pages[pageName]; }
function currentTile() { return currentPage().buttons[tileIndex]; }

function renderTabs() {
  $("#page-tabs").replaceChildren(...Object.entries(config.pages).map(([name, page]) => {
    const button = document.createElement("button"); button.type = "button"; button.textContent = page.label; button.classList.toggle("active", name === pageName);
    button.addEventListener("click", () => { pageName = name; tileIndex = 0; renderAll(); }); return button;
  }));
}

function renderPreview() {
  const preview = $("#deck-preview");
  preview.classList.toggle("mixer-preview", currentPage().layout === "mixer");
  preview.replaceChildren(...currentPage().buttons.map((tile, index) => {
    const button = document.createElement("button"); button.type = "button"; button.className = `preview-tile tone-${tile.tone ?? "neutral"}${index === tileIndex ? " selected" : ""}`;
    button.innerHTML = `<span class="preview-index">${String(index + 1).padStart(2, "0")}</span><span class="preview-icon">${iconSvg(tile.icon)}</span><span class="preview-copy"><strong>${tile.label}</strong><small>${tile.hint ?? ""}</small></span>`;
    button.addEventListener("click", () => { tileIndex = index; renderPreview(); loadTile(); }); return button;
  }));
}

function chooseIcon(name) {
  selectedIcon = resolveIcon(name);
  $("#selected-icon-name").textContent = selectedIcon;
  $("#selected-icon-preview").innerHTML = iconSvg(selectedIcon);
  renderIconPicker($("#icon-picker"), $("#icon-search").value, selectedIcon, chooseIcon);
}

function actionValues(action) {
  if (action.type === "hotkey") return [(action.keys ?? []).join(" + "), ""];
  if (["processHotkey", "backgroundProcessHotkey"].includes(action.type)) return [action.process ?? "", (action.keys ?? []).join(" + ")];
  if (action.type === "processAudioMute") return [action.process ?? "", ""];
  if (action.type === "tuyaToggle") return [action.device ?? "", ""];
  if (action.type === "media") return [action.key ?? "", ""];
  if (action.type === "page") return [action.page ?? "", ""];
  if (action.type === "sequence") return ["", JSON.stringify(action.actions ?? [], null, 2)];
  if (action.type === "microphoneMute") return ["", ""];
  return [action.command ?? "", JSON.stringify(action.args ?? [])];
}

function updateActionFields() {
  const type = $("#tile-type").value;
  const labels = {
    hotkey: ["Klawisze", "np. CTRL + SHIFT + P", false], processHotkey: ["Proces i skrót", "Discord", true], backgroundProcessHotkey: ["Proces bez przełączania okna", "Discord", true], processAudioMute: ["Proces audio", "Discord", false], launch: ["Program lub URL", "C:\\Program Files\\...", true],
    command: ["Polecenie", "powershell.exe", true], media: ["Klawisz multimedia", "playPause", false], page: ["Nazwa strony", "home", false], tuyaToggle: ["Alias urządzenia Tuya", "np. salon", false],
    sequence: ["Sekwencja JSON", "", true], microphoneMute: ["Mikrofon systemowy", "Stan jest odczytywany na żywo z Windows", false]
  };
  const [label, placeholder, detail] = labels[type];
  if (type === "microphoneMute") {
    $("#action-fields").innerHTML = '<div class="action-note">Ten kafel wycisza domyślne urządzenie wejściowe Windows. Stan kafla jest odczytywany bezpośrednio z Core Audio, więc pozostaje poprawny także po zmianie poza EndoDeck.</div>';
    return;
  }
  if (type === "sequence") {
    $("#action-fields").innerHTML = `<label>${label}<textarea id="action-detail" rows="5" placeholder="[]"></textarea></label>`;
    return;
  }
  if (type === "tuyaToggle" && tuyaSetup.devices.length) {
    const options = tuyaSetup.devices.map((device) => `<option value="${device.alias}">${device.name} (${device.alias})</option>`).join("");
    $("#action-fields").innerHTML = `<label>${label}<select id="action-primary">${options}</select></label>`;
    return;
  }
  if (type === "tuyaToggle") {
    $("#action-fields").innerHTML = `<label>${label}<input id="action-primary" placeholder="${placeholder}"></label><div class="action-note">Najpierw skonfiguruj urządzenia w lokalnym pliku tuya.local.json. Dane dostępowe nie są zapisywane w konfiguracji decka ani w Git.</div>`;
    return;
  }
  $("#action-fields").innerHTML = `<label>${label}<input id="action-primary" placeholder="${placeholder}"></label>${detail ? '<label>Argumenty lub skrót<textarea id="action-detail" rows="3"></textarea></label>' : ""}`;
}

function loadTile() {
  const tile = currentTile();
  $("#selected-id").textContent = tile.id; $("#tile-label").value = tile.label; $("#tile-hint").value = tile.hint ?? ""; $("#tile-tone").value = tile.tone ?? "neutral"; $("#tile-type").value = tile.action.type;
  $("#icon-search").value = ""; chooseIcon(tile.icon); updateActionFields();
  const [primary, detail] = actionValues(tile.action);
  if ($("#action-primary")) $("#action-primary").value = primary;
  if ($("#action-detail")) $("#action-detail").value = detail;
}

function renderAll() { renderTabs(); renderPreview(); loadTile(); }

function buildAction() {
  const type = $("#tile-type").value;
  const primary = $("#action-primary")?.value.trim() ?? "";
  const detail = $("#action-detail")?.value.trim() ?? "";
  if (type === "microphoneMute") return { type };
  if (type === "hotkey") return { type, keys: primary.split(/[+,\s]+/).filter(Boolean).map((key) => key.toUpperCase()) };
  if (["processHotkey", "backgroundProcessHotkey"].includes(type)) return { type, process: primary, keys: detail.split(/[+,\s]+/).filter(Boolean).map((key) => key.toUpperCase()) };
  if (type === "processAudioMute") return { type, process: primary };
  if (type === "tuyaToggle") return { type, device: primary };
  if (type === "media") return { type, key: primary };
  if (type === "page") return { type, page: primary };
  if (type === "sequence") return { type, actions: JSON.parse(detail || "[]") };
  return { type, command: primary, args: JSON.parse(detail || "[]") };
}

function applyTile(event) {
  event?.preventDefault();
  try {
    const tile = currentTile();
    tile.label = $("#tile-label").value.trim(); tile.hint = $("#tile-hint").value.trim(); tile.icon = selectedIcon; tile.tone = $("#tile-tone").value; tile.action = buildAction();
    if (tile.action.type === "microphoneMute") tile.status = { type: "microphoneMute" };
    else if (tile.action.type === "tuyaToggle") tile.status = { type: "tuya", device: tile.action.device };
    else if (["microphoneMute", "tuya"].includes(tile.status?.type)) delete tile.status;
    renderPreview(); notify("Kafel zaktualizowany w podglądzie");
  } catch (error) { notify(error.message, true); }
}

function move(direction) {
  const buttons = currentPage().buttons; const target = tileIndex + direction;
  if (target < 0 || target >= buttons.length) return;
  [buttons[tileIndex], buttons[target]] = [buttons[target], buttons[tileIndex]]; tileIndex = target; renderAll();
}

function loadGlobals() {
  $("#global-accent").value = config.accent; $("#accent-value").textContent = config.accent; $("#global-dim").value = config.ui?.dimAfterSeconds ?? 90; $("#global-saver").value = config.ui?.screensaverAfterSeconds ?? 300;
  document.documentElement.style.setProperty("--accent", config.accent); setPlace(config.weather ?? { city: "Warszawa", latitude: 52.2297, longitude: 21.0122 }, false);
}

function readGlobals() {
  config.accent = $("#global-accent").value; config.ui = { dimAfterSeconds: Number($("#global-dim").value), screensaverAfterSeconds: Number($("#global-saver").value) };
  config.weather = { city: $("#weather-city").textContent, latitude: Number($("#weather-lat").value), longitude: Number($("#weather-lon").value) };
}

async function save() {
  try {
    applyTile(); readGlobals();
    const response = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || "Nie udało się zapisać"); config = result.config; notify("Konfiguracja zapisana na EndoDeck");
  } catch (error) { notify(error.message, true); }
}

function updateConnection(state) {
  const online = Boolean(state.adb); $(".connection-card").classList.toggle("online", online); $(".header-status").classList.toggle("online", online);
  $("#connection-label").textContent = online ? "TELEFON PODŁĄCZONY" : "TELEFON OFFLINE"; $("#header-device").textContent = online ? "Telefon połączony" : "Telefon offline";
  $("#connection-detail").textContent = online ? `${state.battery?.percent ?? "--"}% · ${state.battery?.currentMa ?? "--"} mA` : "Podłącz przewód USB";
  for (const tile of document.querySelectorAll(".preview-tile")) tile.classList.toggle("is-on", Boolean(state.controls?.[currentPage().buttons[Number(tile.querySelector(".preview-index").textContent) - 1]?.id]?.active));
}

function setPlace(place, moveMap = true) {
  const lat = Number(place.latitude); const lon = Number(place.longitude);
  $("#weather-city").textContent = place.city; $("#weather-coordinates").textContent = `${lat.toFixed(4)}, ${lon.toFixed(4)}`; $("#weather-lat").value = String(lat); $("#weather-lon").value = String(lon);
  if (map) {
    if (!marker) marker = window.L.marker([lat, lon]).addTo(map); else marker.setLatLng([lat, lon]);
    marker.bindTooltip(place.city, { permanent: false }); if (moveMap) map.flyTo([lat, lon], 9, { duration: .65 });
  }
}

async function reverseMap(lat, lon) {
  try { setPlace(await fetch(`/api/geocode/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`).then((response) => { if (!response.ok) throw new Error("Nie udało się odczytać lokalizacji"); return response.json(); }), false); }
  catch (error) { notify(error.message, true); }
}

async function searchPlaces(event) {
  event.preventDefault(); const query = $("#place-query").value.trim(); if (query.length < 2) return;
  try {
    const results = await fetch(`/api/geocode/search?q=${encodeURIComponent(query)}`).then((response) => response.json());
    $("#place-results").replaceChildren(...results.map((place) => { const button = document.createElement("button"); button.type = "button"; button.innerHTML = `<strong>${place.city}</strong><span>${place.label}</span>`; button.addEventListener("click", () => { setPlace(place); $("#place-results").replaceChildren(); }); return button; }));
    if (!results.length) $("#place-results").innerHTML = '<div class="place-empty">Nie znaleziono miasta</div>';
  } catch (error) { notify(error.message, true); }
}

function initMap() {
  const lat = Number(config.weather?.latitude ?? 52.2297); const lon = Number(config.weather?.longitude ?? 21.0122);
  map = window.L.map("location-map", { zoomControl: true, attributionControl: false }).setView([lat, lon], 6);
  window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18 }).addTo(map);
  marker = window.L.marker([lat, lon]).addTo(map); map.on("click", (event) => { marker.setLatLng(event.latlng); reverseMap(event.latlng.lat, event.latlng.lng); });
}

async function boot() {
  [config, tuyaSetup] = await Promise.all([
    fetch("/api/config").then((response) => response.json()),
    fetch("/api/tuya").then((response) => response.json()).catch(() => ({ configured: false, devices: [] }))
  ]); loadGlobals(); renderAll(); initMap();
  updateConnection(await fetch("/api/state").then((response) => response.json())); new EventSource("/api/events").addEventListener("message", (event) => updateConnection(JSON.parse(event.data)));
}

$("#tile-form").addEventListener("submit", applyTile); $("#tile-type").addEventListener("change", updateActionFields); $("#icon-search").addEventListener("input", () => renderIconPicker($("#icon-picker"), $("#icon-search").value, selectedIcon, chooseIcon));
$("#move-left").addEventListener("click", () => move(-1)); $("#move-right").addEventListener("click", () => move(1)); $("#save-config").addEventListener("click", save); $("#place-search").addEventListener("submit", searchPlaces);
$("#global-accent").addEventListener("input", (event) => { $("#accent-value").textContent = event.target.value; document.documentElement.style.setProperty("--accent", event.target.value); });
boot().catch((error) => notify(error.message, true));
