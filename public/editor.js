import { iconNames, iconSvg, renderIconPicker, resolveIcon } from "./icon-ui.js";

const $ = (selector) => document.querySelector(selector);
let config;
let pageName = "home";
let tileIndex = 0;
let selectedIcon = "wand-magic-sparkles";
let localDeviceSetup = { devices: [] };
let installedApps = [];
let map;
let marker;
let toastTimer;
let draggedTileIndex = null;

const toneLabels = { accent: "Akcent", blue: "Niebieski", green: "Zielony", red: "Czerwony", amber: "Bursztynowy", violet: "Fioletowy", neutral: "Szary" };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function notify(message, error = false) {
  clearTimeout(toastTimer);
  const toast = $("#studio-toast");
  toast.textContent = message; toast.className = `studio-toast show${error ? " error" : ""}`;
  toastTimer = setTimeout(() => toast.className = "studio-toast", 2200);
}

function currentPage() { return config.pages[pageName]; }
function currentTile() { return currentPage().buttons[tileIndex]; }

function slug(value, fallback = "page") {
  const normalized = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return (normalized || fallback).slice(0, 48);
}

function uniqueId(base) {
  const existing = new Set(Object.values(config.pages ?? {}).flatMap((page) => (page.buttons ?? []).map((button) => button.id)));
  let candidate = slug(base, "tile");
  let index = 2;
  while (existing.has(candidate)) candidate = `${slug(base, "tile")}-${index++}`;
  return candidate;
}

function uniquePageId(label) {
  let candidate = slug(label, "page");
  let index = 2;
  while (config.pages[candidate]) candidate = `${slug(label, "page")}-${index++}`;
  return candidate;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; }
  catch { throw new Error(`Nieprawidłowa odpowiedź JSON z ${url}`); }
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

function assertConfigShape(nextConfig) {
  if (!nextConfig?.pages || !Object.keys(nextConfig.pages).length) throw new Error("Konfiguracja decka nie zawiera stron");
  for (const [name, page] of Object.entries(nextConfig.pages)) {
    if (!Array.isArray(page.buttons)) throw new Error(`Strona ${name} nie zawiera listy kafelków`);
  }
  return nextConfig;
}

function friendlyError(error) {
  return error.message === "Brak ważnej sesji EndoDeck"
    ? "Brak lokalnej sesji EndoDeck. Odśwież stronę albo otwórz Studio z ikonki EndoDeck w trayu."
    : error.message;
}

function showBootError(error) {
  const message = friendlyError(error);
  notify(message, true);
  $("#page-tabs").replaceChildren();
  $("#selected-id").textContent = "BŁĄD";
  const preview = $("#deck-preview");
  preview.classList.remove("mixer-preview");
  const card = document.createElement("section");
  card.className = "editor-error-card";
  const title = document.createElement("strong");
  title.textContent = "Nie udało się załadować edytora";
  const copy = document.createElement("p");
  copy.textContent = message;
  const hint = document.createElement("small");
  hint.textContent = "Studio działa lokalnie na 127.0.0.1. Jeśli serwer był restartowany, odśwież tę kartę.";
  card.replaceChildren(title, copy, hint);
  preview.replaceChildren(card);
}

function renderTabs() {
  $("#page-tabs").replaceChildren(...Object.entries(config.pages).map(([name, page]) => {
    const button = document.createElement("button"); button.type = "button"; button.textContent = page.label; button.classList.toggle("active", name === pageName);
    button.addEventListener("click", () => { pageName = name; tileIndex = 0; renderAll(); }); return button;
  }));
}

function renderTemplates() {
  const options = [
    ["blank", "Pusty kafel"],
    ["mic", "Specjalny: mikrofon Windows"],
    ["discord-audio", "Specjalny: wycisz Discord"],
    ["mixer", "Specjalny: mikser audio"],
    ["play", "Media: play / pauza"],
    ["next", "Media: następny utwór"],
    ["screenshot", "Windows: zrzut ekranu"],
    ["codex", "Dev: Codex"],
    ["app", "Program z listy Windows"]
  ];
  if (localDeviceSetup.devices?.length) options.push(["local-device", "LAN: pierwsze urządzenie Tapo"]);
  $("#tile-template").replaceChildren(...options.map(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }));
}

function renderPreview() {
  const preview = $("#deck-preview");
  const buttons = currentPage().buttons ?? [];
  preview.classList.toggle("mixer-preview", currentPage().layout === "mixer");
  if (!buttons.length) {
    const empty = document.createElement("section");
    empty.className = "preview-empty";
    empty.innerHTML = "<strong>TA STRONA JEST PUSTA</strong><span>Dodaj kafel z panelu po prawej. Możesz zacząć od kafla specjalnego, aplikacji Windows albo skrótu klawiszowego.</span>";
    preview.replaceChildren(empty);
    return;
  }
  preview.replaceChildren(...buttons.map((tile, index) => {
    const button = document.createElement("button"); button.type = "button"; button.className = `preview-tile tone-${tile.tone ?? "neutral"}${index === tileIndex ? " selected" : ""}`;
    button.draggable = true;
    button.dataset.index = String(index);
    button.setAttribute("aria-label", `Kafel ${index + 1}: ${tile.label}. Przeciągnij, aby zamienić miejscami.`);
    button.innerHTML = `<span class="preview-index">${String(index + 1).padStart(2, "0")}</span><span class="preview-icon">${iconSvg(tile.icon)}</span><span class="preview-copy"><strong>${tile.label}</strong><small>${tile.hint ?? ""}</small></span>`;
    button.addEventListener("click", () => { tileIndex = index; renderPreview(); loadTile(); });
    button.addEventListener("dragstart", (event) => {
      draggedTileIndex = index;
      button.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
    });
    button.addEventListener("dragend", () => {
      draggedTileIndex = null;
      preview.querySelectorAll(".dragging,.drop-target").forEach((tileButton) => tileButton.classList.remove("dragging", "drop-target"));
    });
    button.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (draggedTileIndex !== null && draggedTileIndex !== index) button.classList.add("drop-target");
      event.dataTransfer.dropEffect = "move";
    });
    button.addEventListener("dragleave", () => button.classList.remove("drop-target"));
    button.addEventListener("drop", (event) => {
      event.preventDefault();
      button.classList.remove("drop-target");
      const source = Number(event.dataTransfer.getData("text/plain"));
      swapTiles(Number.isInteger(source) ? source : draggedTileIndex, index);
    });
    return button;
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
  if (action.type === "localDeviceToggle") return [action.device ?? "", ""];
  if (action.type === "media") return [action.key ?? "", ""];
  if (action.type === "page") return [action.page ?? "", ""];
  if (action.type === "sequence") return ["", JSON.stringify(action.actions ?? [], null, 2)];
  if (action.type === "microphoneMute") return ["", ""];
  return [action.command ?? "", JSON.stringify(action.args ?? [])];
}

function setTileFormEnabled(enabled) {
  for (const selector of ["#tile-label", "#tile-hint", "#tile-tone", "#tile-type", "#move-left", "#move-right", "#delete-tile", ".apply-tile"]) {
    const element = $(selector);
    if (element) element.disabled = !enabled;
  }
}

function matchesApp(app, query) {
  const haystack = `${app.name} ${app.command} ${(app.args ?? []).join(" ")}`.toLowerCase();
  return query.split(/\s+/).filter(Boolean).every((part) => haystack.includes(part));
}

function selectApp(app) {
  $("#action-primary").value = app.command;
  $("#action-detail").value = JSON.stringify(app.args ?? []);
  $("#tile-label").value = app.name.slice(0, 22).toUpperCase();
  $("#tile-hint").value = "Aplikacja Windows";
  chooseIcon("launch");
  renderAppChoices();
}

function renderAppChoices() {
  const list = $("#app-list");
  if (!list) return;
  const query = ($("#app-search")?.value ?? "").trim().toLowerCase();
  const currentCommand = $("#action-primary")?.value ?? "";
  const apps = installedApps.filter((app) => !query || matchesApp(app, query)).slice(0, 120);
  const count = $("#app-count");
  if (count) count.textContent = query ? `${apps.length} / ${installedApps.length} programów` : `${installedApps.length} programów`;
  if (!installedApps.length) {
    list.innerHTML = '<div class="app-empty">Nie udało się wczytać listy programów. Użyj ODŚWIEŻ albo wpisz ścieżkę ręcznie powyżej.</div>';
    return;
  }
  if (!apps.length) {
    list.innerHTML = '<div class="app-empty">Nie znaleziono programu. Możesz nadal wpisać ścieżkę ręcznie powyżej.</div>';
    return;
  }
  list.replaceChildren(...apps.map((app) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "app-choice";
    button.innerHTML = `<strong>${escapeHtml(app.name)}</strong><span>${app.command === currentCommand ? "WYBRANE" : "UŻYJ"}</span><small>${escapeHtml(app.command)} ${escapeHtml((app.args ?? []).join(" "))}</small>`;
    button.addEventListener("click", () => selectApp(app));
    return button;
  }));
}

async function refreshApps(force = true) {
  const button = $("#refresh-apps");
  if (button) button.disabled = true;
  try {
    installedApps = await fetchJson(`/api/apps${force ? "?refresh=1" : ""}`).then((result) => result.apps ?? []);
    renderTemplates();
    if ($("#tile-type")?.value === "launch") {
      if ($("#app-search")) renderAppChoices();
      else updateActionFields();
    }
    if (force) notify(`Wczytano ${installedApps.length} programów`);
  } catch (error) {
    notify(error.message, true);
  } finally {
    if (button) button.disabled = false;
  }
}

function updateActionFields() {
  const type = $("#tile-type").value;
  const labels = {
    hotkey: ["Klawisze", "np. CTRL + SHIFT + P", false], processHotkey: ["Proces i skrót", "Discord", true], backgroundProcessHotkey: ["Proces bez przełączania okna", "Discord", true], processAudioMute: ["Proces audio", "Discord", false], launch: ["Program lub URL", "C:\\Program Files\\...", true],
    command: ["Polecenie", "powershell.exe", true], media: ["Klawisz multimedia", "playPause", false], page: ["Nazwa strony", "home", false], localDeviceToggle: ["Urządzenie w sieci lokalnej", "", false],
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
  if (type === "localDeviceToggle") {
    const options = localDeviceSetup.devices.map((device) => `<option value="${escapeHtml(device.alias)}">${escapeHtml(device.name)} · ${escapeHtml(device.ip)}${device.configured ? "" : " · wymaga konfiguracji"}</option>`).join("");
    $("#action-fields").innerHTML = `<label>${label}<select id="action-primary">${options || '<option value="">Brak urządzeń LAN</option>'}</select></label><div class="action-note">Sterowanie bezpośrednio w LAN. Dane dostępowe ustawisz na stronie <a href="/devices.html">Urządzenia LAN</a>.</div>`;
    return;
  }
  if (type === "launch") {
    $("#action-fields").innerHTML = `<label>${label}<input id="action-primary" placeholder="${placeholder}"></label><label>Argumenty<textarea id="action-detail" rows="3"></textarea></label><div class="app-picker-box"><div class="section-heading"><strong>APLIKACJE WINDOWS</strong><span id="app-count">${installedApps.length} programów</span></div><div class="app-search-row"><input id="app-search" type="search" placeholder="Szukaj programu, np. Discord, Code, Steam"><button type="button" id="refresh-apps">ODŚWIEŻ</button><button type="button" id="clear-app-search">WYCZYŚĆ</button></div><div id="app-list" class="app-list" role="listbox"></div><div class="action-note">Lista obejmuje skróty, programy użytkownika, rejestr i aplikacje ze Start. Pierwsze skanowanie może chwilę potrwać.</div></div>`;
    $("#app-search").addEventListener("input", renderAppChoices);
    $("#refresh-apps").addEventListener("click", () => refreshApps(true));
    $("#clear-app-search").addEventListener("click", () => { $("#app-search").value = ""; renderAppChoices(); });
    renderAppChoices();
    return;
  }
  $("#action-fields").innerHTML = `<label>${label}<input id="action-primary" placeholder="${placeholder}"></label>${detail ? '<label>Argumenty lub skrót<textarea id="action-detail" rows="3"></textarea></label>' : ""}`;
}

function loadTile() {
  const tile = currentTile();
  setTileFormEnabled(Boolean(tile));
  if (!tile) {
    $("#selected-id").textContent = "BRAK";
    $("#tile-label").value = ""; $("#tile-hint").value = ""; $("#tile-tone").value = "neutral"; $("#tile-type").value = "hotkey";
    $("#action-fields").innerHTML = '<div class="action-note">Ta strona nie ma jeszcze kafelków. Dodaj nowy kafel z gotowego szablonu powyżej.</div>';
    return;
  }
  $("#selected-id").textContent = tile.id; $("#tile-label").value = tile.label; $("#tile-hint").value = tile.hint ?? ""; $("#tile-tone").value = tile.tone ?? "neutral"; $("#tile-type").value = tile.action.type;
  $("#icon-search").value = ""; chooseIcon(tile.icon); updateActionFields();
  const [primary, detail] = actionValues(tile.action);
  if ($("#action-primary")) $("#action-primary").value = primary;
  if ($("#action-detail")) $("#action-detail").value = detail;
  if ($("#app-search")) renderAppChoices();
}

function renderAll() { renderTabs(); renderPreview(); loadTile(); }

function tileTemplate(kind) {
  const firstDevice = localDeviceSetup.devices?.[0];
  const firstApp = installedApps[0];
  const templates = {
    blank: { label: "NOWY", hint: "Skonfiguruj", icon: "plus", tone: "neutral", action: { type: "hotkey", keys: ["CTRL", "SHIFT", "P"] } },
    mic: { label: "MIKROFON", hint: "Windows", icon: "microphone-slash", tone: "red", action: { type: "microphoneMute" }, status: { type: "microphoneMute" } },
    "discord-audio": { label: "WYCISZENIE", hint: "Discord", icon: "headset", tone: "red", action: { type: "processAudioMute", process: "Discord" }, status: { type: "processAudioMute", process: "Discord" } },
    mixer: { label: "MIKSER", hint: "Audio", icon: "sliders", tone: "accent", action: { type: "page", page: "audio" } },
    play: { label: "PLAY / PAUZA", hint: "Media", icon: "play", tone: "green", action: { type: "media", key: "playPause" } },
    next: { label: "NASTĘPNY", hint: "Media", icon: "next", tone: "green", action: { type: "media", key: "next" } },
    screenshot: { label: "ZRZUT", hint: "Win + Shift + S", icon: "crop-simple", tone: "blue", action: { type: "hotkey", keys: ["WIN", "SHIFT", "S"] } },
    codex: { label: "CODEX", hint: "AI pair dev", icon: "laptop-code", tone: "accent", action: { type: "launch", command: "wt.exe", args: ["codex"] } },
    app: { label: firstApp?.name?.slice(0, 22).toUpperCase() || "APLIKACJA", hint: "Windows", icon: "launch", tone: "blue", action: { type: "launch", command: firstApp?.command || "explorer.exe", args: firstApp?.args ?? [] } },
    "local-device": { label: firstDevice?.name?.slice(0, 22).toUpperCase() || "TAPO", hint: "LAN", icon: "plug", tone: "green", action: { type: "localDeviceToggle", device: firstDevice?.alias || "" }, status: { type: "localDevice", device: firstDevice?.alias || "" } }
  };
  const base = structuredClone(templates[kind] ?? templates.blank);
  base.id = uniqueId(base.label);
  return base;
}

function addTile() {
  const page = currentPage();
  page.buttons ??= [];
  page.buttons.push(tileTemplate($("#tile-template").value));
  tileIndex = page.buttons.length - 1;
  renderAll();
  notify("Dodano nowy kafel do aktualnej strony");
}

function addPage() {
  const label = $("#new-page-label").value.trim();
  if (!label) return notify("Podaj nazwę nowej strony", true);
  const id = uniquePageId(label);
  config.pages[id] = { label, buttons: [tileTemplate("blank")] };
  $("#new-page-label").value = "";
  pageName = id;
  tileIndex = 0;
  renderAll();
  notify(`Dodano stronę ${label}`);
}

function deletePage() {
  if (pageName === "home") return notify("Strony głównej nie można usunąć", true);
  if (!confirm(`Usunąć stronę "${currentPage().label}"?`)) return;
  delete config.pages[pageName];
  pageName = "home";
  tileIndex = 0;
  renderAll();
  notify("Strona usunięta z konfiguracji");
}

function deleteTile() {
  const page = currentPage();
  if (!page.buttons?.length) return notify("Nie ma kafelka do usunięcia", true);
  const removed = page.buttons.splice(tileIndex, 1)[0];
  tileIndex = Math.max(0, Math.min(tileIndex, page.buttons.length - 1));
  renderAll();
  notify(`Usunięto kafel ${removed?.label ?? ""}`.trim());
}

function buildAction() {
  const type = $("#tile-type").value;
  const primary = $("#action-primary")?.value.trim() ?? "";
  const detail = $("#action-detail")?.value.trim() ?? "";
  if (type === "microphoneMute") return { type };
  if (type === "hotkey") return { type, keys: primary.split(/[+,\s]+/).filter(Boolean).map((key) => key.toUpperCase()) };
  if (["processHotkey", "backgroundProcessHotkey"].includes(type)) return { type, process: primary, keys: detail.split(/[+,\s]+/).filter(Boolean).map((key) => key.toUpperCase()) };
  if (type === "processAudioMute") return { type, process: primary };
  if (type === "localDeviceToggle") return { type, device: primary };
  if (type === "media") return { type, key: primary };
  if (type === "page") return { type, page: primary };
  if (type === "sequence") return { type, actions: JSON.parse(detail || "[]") };
  return { type, command: primary, args: JSON.parse(detail || "[]") };
}

function applyTile(event) {
  event?.preventDefault();
  try {
    const tile = currentTile();
    if (!tile) return notify("Dodaj kafel, zanim zaczniesz edycję", true);
    tile.label = $("#tile-label").value.trim(); tile.hint = $("#tile-hint").value.trim(); tile.icon = selectedIcon; tile.tone = $("#tile-tone").value; tile.action = buildAction();
    if (tile.action.type === "microphoneMute") tile.status = { type: "microphoneMute" };
    else if (tile.action.type === "processAudioMute") tile.status = { type: "processAudioMute", process: tile.action.process };
    else if (tile.action.type === "localDeviceToggle") tile.status = { type: "localDevice", device: tile.action.device };
    else if (["microphoneMute", "processAudioMute", "localDevice"].includes(tile.status?.type)) delete tile.status;
    renderPreview(); notify("Kafel zaktualizowany w podglądzie");
  } catch (error) { notify(error.message, true); }
}

function move(direction) {
  swapTiles(tileIndex, tileIndex + direction);
}

function swapTiles(source, target) {
  const buttons = currentPage().buttons;
  if (!Number.isInteger(source) || !Number.isInteger(target) || source === target || source < 0 || target < 0 || source >= buttons.length || target >= buttons.length) return false;
  [buttons[source], buttons[target]] = [buttons[target], buttons[source]];
  tileIndex = target;
  renderAll();
  notify(`Zamieniono kafel ${source + 1} z ${target + 1}`);
  return true;
}

function loadGlobals() {
  const brightness = config.ui?.screensaverBrightness ?? {};
  const night = config.ui?.nightStandby ?? {};
  $("#global-accent").value = config.accent; $("#accent-value").textContent = config.accent; $("#global-dim").value = config.ui?.dimAfterSeconds ?? 90; $("#global-saver").value = config.ui?.screensaverAfterSeconds ?? 300;
  $("#show-now-playing").checked = config.ui?.showNowPlaying !== false; $("#show-equalizer").checked = config.ui?.showEqualizer !== false;
  $("#brightness-night").value = brightness.night ?? 6; $("#brightness-twilight").value = brightness.twilight ?? 9; $("#brightness-day").value = brightness.day ?? 13; $("#brightness-offline-night").value = brightness.offlineNight ?? 5; $("#brightness-offline-day").value = brightness.offlineDay ?? 10;
  $("#night-enabled").checked = night.enabled !== false; $("#night-start").value = night.start ?? "00:00"; $("#night-end").value = night.end ?? "07:00";
  document.documentElement.style.setProperty("--accent", config.accent); setPlace(config.weather ?? { city: "Warszawa", latitude: 52.2297, longitude: 21.0122 }, false);
  renderTemplates();
}

function readGlobals() {
  config.accent = $("#global-accent").value; config.ui = {
    ...(config.ui ?? {}),
    dimAfterSeconds: Number($("#global-dim").value),
    screensaverAfterSeconds: Number($("#global-saver").value),
    showNowPlaying: $("#show-now-playing").checked,
    showEqualizer: $("#show-equalizer").checked,
    screensaverBrightness: {
      night: Number($("#brightness-night").value),
      twilight: Number($("#brightness-twilight").value),
      day: Number($("#brightness-day").value),
      offlineNight: Number($("#brightness-offline-night").value),
      offlineDay: Number($("#brightness-offline-day").value)
    },
    nightStandby: { enabled: $("#night-enabled").checked, start: $("#night-start").value || "00:00", end: $("#night-end").value || "07:00" }
  };
  config.weather = { city: $("#weather-city").textContent, latitude: Number($("#weather-lat").value), longitude: Number($("#weather-lon").value) };
}

async function exportConfig() {
  try {
    const exported = await fetchJson("/api/config/export");
    const blob = new Blob([`${JSON.stringify(exported, null, 2)}\n`], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `endodeck-config-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    notify("Eksport konfiguracji gotowy");
  } catch (error) { notify(error.message, true); }
}

async function importConfigFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const imported = assertConfigShape(JSON.parse(await file.text()));
    const result = await fetchJson("/api/config/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(imported) });
    config = assertConfigShape(result.config);
    pageName = config.pages[pageName] ? pageName : "home";
    tileIndex = 0;
    loadGlobals();
    renderAll();
    notify("Konfiguracja zaimportowana i zapisana");
  } catch (error) { notify(error.message, true); }
}

async function save() {
  try {
    applyTile(); readGlobals();
    const result = await fetchJson("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
    config = assertConfigShape(result.config); notify("Konfiguracja zapisana na EndoDeck");
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
  try { setPlace(await fetchJson(`/api/geocode/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`), false); }
  catch (error) { notify(error.message, true); }
}

async function searchPlaces(event) {
  event.preventDefault(); const query = $("#place-query").value.trim(); if (query.length < 2) return;
  try {
    const results = await fetchJson(`/api/geocode/search?q=${encodeURIComponent(query)}`);
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
  [config, localDeviceSetup] = await Promise.all([
    fetchJson("/api/config").then(assertConfigShape),
    fetchJson("/api/local-devices").catch(() => ({ devices: [] }))
  ]);
  await refreshApps(false);
  $("#icon-search").placeholder = `Szukaj w ${iconNames.length} ikonach`; loadGlobals(); renderAll(); initMap();
  updateConnection(await fetchJson("/api/state")); new EventSource("/api/events").addEventListener("message", (event) => updateConnection(JSON.parse(event.data)));
}

$("#tile-form").addEventListener("submit", applyTile); $("#tile-type").addEventListener("change", updateActionFields); $("#icon-search").addEventListener("input", () => renderIconPicker($("#icon-picker"), $("#icon-search").value, selectedIcon, chooseIcon));
$("#move-left").addEventListener("click", () => move(-1)); $("#move-right").addEventListener("click", () => move(1)); $("#delete-tile").addEventListener("click", deleteTile); $("#save-config").addEventListener("click", save); $("#place-search").addEventListener("submit", searchPlaces);
$("#add-tile").addEventListener("click", addTile); $("#add-page").addEventListener("click", addPage); $("#delete-page").addEventListener("click", deletePage);
$("#export-config").addEventListener("click", exportConfig); $("#import-config").addEventListener("click", () => $("#import-config-file").click()); $("#import-config-file").addEventListener("change", importConfigFile);
$("#open-device-panel").addEventListener("click", () => {
  if (window.EndoDeckDesktop?.openDevicePanel) window.EndoDeckDesktop.openDevicePanel();
  else notify("Panel urządzenia jest dostępny z aplikacji EndoDeck w trayu.", true);
});
$("#global-accent").addEventListener("input", (event) => { $("#accent-value").textContent = event.target.value; document.documentElement.style.setProperty("--accent", event.target.value); });
boot().catch(showBootError);
