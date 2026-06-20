import { iconNames, iconSvg, renderIconPicker, resolveIcon } from "./icon-ui.js";
import { ELEMENT_TYPES, PRESET_LABELS, cloneScreensaver, createDefaultScreensavers, ensureScreensaverConfig, normalizeScreensaver } from "./screensaver-presets.js";
import { calculateScreensaverBrightness, demoScreensaverContext, getDisplayConfig, renderScreensaver } from "./screensaver-renderer.js";

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
let studioMode = "deck";
let selectedScreensaverId = "classic-orbit";
let selectedSaverElementId = null;
let screensaverAssets = [];
let saverPointerState = null;
let saverUndoStack = [];
let saverRedoStack = [];
let saverAddType = "clock";
const saverHistoryLimit = 80;

const toneLabels = { accent: "Akcent", blue: "Niebieski", green: "Zielony", red: "Czerwony", amber: "Bursztynowy", violet: "Fioletowy", neutral: "Szary" };
const elementTypeLabels = Object.fromEntries(ELEMENT_TYPES);
const elementTypeValues = new Set(ELEMENT_TYPES.map(([value]) => value));

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
function screensavers() { ensureScreensaverConfig(config); return config.ui.screensavers; }
function selectedScreensaver() {
  const profiles = screensavers();
  return profiles.find((profile) => profile.id === selectedScreensaverId) ?? profiles.find((profile) => profile.id === config.ui.screensaverProfile) ?? profiles[0];
}
function selectedSaverElement() { return selectedScreensaver()?.elements?.find((entry) => entry.id === selectedSaverElementId) ?? null; }

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function readNumberField(selector, current, { min = -Infinity, max = Infinity } = {}) {
  const field = $(selector);
  if (!field || field.disabled || String(field.value).trim() === "") return current;
  const numeric = Number(field.value);
  return Number.isFinite(numeric) ? clampNumber(numeric, min, max) : current;
}

function saverSnapshot() {
  ensureScreensaverConfig(config);
  return structuredClone({
    activeProfile: config.ui.screensaverProfile,
    selectedProfile: selectedScreensaverId,
    selectedElement: selectedSaverElementId,
    screensavers: config.ui.screensavers
  });
}

function sameSaverSnapshot(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pushSaverHistorySnapshot(snapshot, label = "zmiana", options = {}) {
  if (!snapshot || (options.skipIfCurrent && sameSaverSnapshot(snapshot, saverSnapshot()))) return;
  const last = saverUndoStack.at(-1)?.snapshot;
  if (last && sameSaverSnapshot(last, snapshot)) return;
  saverUndoStack.push({ label, snapshot });
  if (saverUndoStack.length > saverHistoryLimit) saverUndoStack.shift();
  saverRedoStack = [];
}

function pushSaverHistory(label = "zmiana") {
  pushSaverHistorySnapshot(saverSnapshot(), label);
}

function clearSaverHistory() {
  saverUndoStack = [];
  saverRedoStack = [];
}

function restoreSaverSnapshot(snapshot) {
  config.ui.screensavers = structuredClone(snapshot.screensavers);
  config.ui.screensaverProfile = snapshot.activeProfile;
  selectedScreensaverId = snapshot.selectedProfile;
  selectedSaverElementId = snapshot.selectedElement;
  if (!config.ui.screensavers.some((profile) => profile.id === selectedScreensaverId)) selectedScreensaverId = config.ui.screensaverProfile;
  const profile = selectedScreensaver();
  if (!profile?.elements?.some((entry) => entry.id === selectedSaverElementId)) selectedSaverElementId = profile?.elements?.[0]?.id ?? null;
  renderSaverStudio();
}

function undoSaverEdit() {
  if (!saverUndoStack.length) return notify("Nie ma czego cofnąć");
  const current = saverSnapshot();
  const previous = saverUndoStack.pop();
  saverRedoStack.push({ label: previous.label, snapshot: current });
  restoreSaverSnapshot(previous.snapshot);
  notify(`Cofnięto: ${previous.label}`);
}

function redoSaverEdit() {
  if (!saverRedoStack.length) return notify("Nie ma czego przywrócić");
  const current = saverSnapshot();
  const next = saverRedoStack.pop();
  saverUndoStack.push({ label: next.label, snapshot: current });
  restoreSaverSnapshot(next.snapshot);
  notify(`Przywrócono: ${next.label}`);
}

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

function renderAll() { renderTabs(); renderPreview(); loadTile(); renderSaverStudio(); }

function setStudioMode(mode) {
  studioMode = mode === "screensavers" ? "screensavers" : "deck";
  $("#deck-studio")?.classList.toggle("hidden", studioMode !== "deck");
  $("#screensaver-studio")?.classList.toggle("hidden", studioMode !== "screensavers");
  for (const button of document.querySelectorAll("[data-studio-mode]")) button.classList.toggle("active", button.dataset.studioMode === studioMode);
  if (studioMode === "screensavers") renderSaverStudio();
}

function uniqueScreensaverId(label) {
  const base = slug(label, "screensaver");
  const existing = new Set(screensavers().map((profile) => profile.id));
  let candidate = base;
  let index = 2;
  while (existing.has(candidate)) candidate = `${base}-${index++}`;
  return candidate;
}

function uniqueElementId(type, profile = selectedScreensaver()) {
  const existing = new Set(profile?.elements?.map((entry) => entry.id) ?? []);
  const base = slug(type, "element");
  let candidate = base;
  let index = 2;
  while (existing.has(candidate)) candidate = `${base}-${index++}`;
  return candidate;
}

function readSaverProfileControls(profile = selectedScreensaver()) {
  if (!profile) return;
  profile.background ??= {};
  profile.theme ??= {};
  profile.protection ??= {};
  profile.background.type = $("#saver-background-type")?.value || profile.background.type || "gradient";
  profile.background.value = $("#saver-background-value")?.value || profile.background.value || "#050705";
  profile.theme.accent = $("#saver-theme-accent")?.value || config.accent;
  profile.protection.pixelShift = $("#protect-pixel-shift")?.checked ?? true;
  profile.protection.subtleRotation = $("#protect-subtle-rotation")?.checked ?? true;
  profile.protection.compositionRotation = $("#protect-composition-rotation")?.checked ?? false;
  profile.protection.lowBrightnessOled = $("#protect-oled")?.checked ?? false;
  profile.protection.staticElementLimitMinutes = Math.max(1, Number($("#protect-static-limit")?.value) || 12);
}

function loadSaverProfileControls() {
  const profile = selectedScreensaver();
  if (!profile) return;
  $("#preview-active-label").textContent = `${profile.label}${profile.id === config.ui.screensaverProfile ? " · aktywny" : ""}`;
  $("#saver-background-type").value = profile.background?.type ?? "gradient";
  $("#saver-background-value").value = profile.background?.value ?? "#050705";
  $("#saver-theme-accent").value = profile.theme?.accent ?? config.accent;
  $("#protect-pixel-shift").checked = profile.protection?.pixelShift !== false;
  $("#protect-subtle-rotation").checked = profile.protection?.subtleRotation !== false;
  $("#protect-composition-rotation").checked = profile.protection?.compositionRotation === true;
  $("#protect-oled").checked = profile.protection?.lowBrightnessOled === true;
  $("#protect-static-limit").value = profile.protection?.staticElementLimitMinutes ?? 12;
}

function readBrightnessControls() {
  return {
    night: readNumberField("#brightness-night", 6, { min: 1, max: 100 }),
    twilight: readNumberField("#brightness-twilight", 9, { min: 1, max: 100 }),
    day: readNumberField("#brightness-day", 13, { min: 1, max: 100 }),
    offlineNight: readNumberField("#brightness-offline-night", 5, { min: 1, max: 100 }),
    offlineDay: readNumberField("#brightness-offline-day", 10, { min: 1, max: 100 })
  };
}

function loadScreensaverDisplayControls() {
  const display = getDisplayConfig(config);
  const profile = selectedScreensaver();
  const brightness = { ...(display.screensaverBrightness ?? {}), ...(profile?.brightness ?? {}) };
  const night = display.nightStandby ?? {};
  $("#global-dim").value = display.dimAfterSeconds;
  $("#global-saver").value = display.screensaverAfterSeconds;
  $("#show-now-playing").checked = display.showNowPlaying !== false;
  $("#show-equalizer").checked = display.showEqualizer !== false && display.visualizer?.enabled !== false;
  $("#brightness-night").value = brightness.night ?? 6;
  $("#brightness-twilight").value = brightness.twilight ?? 9;
  $("#brightness-day").value = brightness.day ?? 13;
  $("#brightness-offline-night").value = brightness.offlineNight ?? 5;
  $("#brightness-offline-day").value = brightness.offlineDay ?? 10;
  $("#night-enabled").checked = night.enabled !== false;
  $("#night-start").value = night.start ?? "00:00";
  $("#night-end").value = night.end ?? "07:00";
}

function applyScreensaverDisplayControls({ syncProfileBrightness = true } = {}) {
  ensureScreensaverConfig(config);
  const current = getDisplayConfig(config);
  const brightness = readBrightnessControls();
  const dimAfterSeconds = readNumberField("#global-dim", current.dimAfterSeconds, { min: 1, max: 3600 });
  const screensaverAfterSeconds = readNumberField("#global-saver", current.screensaverAfterSeconds, { min: 1, max: 7200 });
  const showNowPlaying = $("#show-now-playing")?.checked ?? current.showNowPlaying;
  const showEqualizer = $("#show-equalizer")?.checked ?? current.showEqualizer;
  const nightStandby = {
    enabled: $("#night-enabled")?.checked ?? current.nightStandby.enabled,
    start: $("#night-start")?.value || current.nightStandby.start || "00:00",
    end: $("#night-end")?.value || current.nightStandby.end || "07:00"
  };
  const display = {
    ...current,
    dimAfterSeconds,
    screensaverAfterSeconds,
    showNowPlaying,
    showEqualizer,
    visualizer: { ...(current.visualizer ?? {}), enabled: showEqualizer },
    screensaverBrightness: brightness,
    nightStandby
  };
  config.ui = {
    ...(config.ui ?? {}),
    display,
    dimAfterSeconds,
    screensaverAfterSeconds,
    showNowPlaying,
    showEqualizer,
    screensaverBrightness: brightness,
    nightStandby
  };
  if (syncProfileBrightness) {
    const profile = selectedScreensaver();
    if (profile) profile.brightness = { ...brightness };
  }
}

function readSaverElementForm(element = selectedSaverElement()) {
  if (!element || !$("#saver-element-label")) return;
  const label = $("#saver-element-label");
  if (label && !label.disabled) element.label = label.value.trim() || element.label;
  element.x = readNumberField("#saver-element-x", element.x, { min: -50, max: 150 });
  element.y = readNumberField("#saver-element-y", element.y, { min: -50, max: 150 });
  element.w = readNumberField("#saver-element-w", element.w, { min: 1, max: 200 });
  element.h = readNumberField("#saver-element-h", element.h, { min: 1, max: 200 });
  element.zIndex = readNumberField("#saver-element-z", element.zIndex ?? 10, { min: -100, max: 999 });
  const visible = $("#saver-element-visible");
  const locked = $("#saver-element-locked");
  if (visible && !visible.disabled) element.visible = visible.checked;
  if (locked && !locked.disabled) element.locked = locked.checked;
  element.style ??= {};
  const color = $("#saver-element-color");
  if (color && !color.disabled && color.value) element.style.color = color.value;
  const align = $("#saver-element-align");
  if (align && !align.disabled) element.style.align = align.value || undefined;
  const size = readNumberField("#saver-element-size", element.style.size, { min: .5, max: 24 });
  if (Number.isFinite(size) && size > 0) element.style.size = size;
  const opacity = readNumberField("#saver-element-opacity", element.style.opacity, { min: 0, max: 1 });
  if (Number.isFinite(opacity)) element.style.opacity = Math.max(0, Math.min(1, opacity));
  element.data ??= {};
  if (["text", "image"].includes(element.type)) {
    const textField = $("#saver-element-text");
    const text = textField && !textField.disabled ? textField.value.trim() : "";
    if (element.type === "text") element.data.text = text || element.data.text || element.label;
    if (element.type === "image") element.data.src = text || element.data.src || "";
  }
}

function loadSaverElementForm() {
  const element = selectedSaverElement();
  $("#saver-selected-id").textContent = element?.id ?? "BRAK";
  const selectors = ["#saver-element-label", "#saver-element-x", "#saver-element-y", "#saver-element-w", "#saver-element-h", "#saver-element-z", "#saver-element-size", "#saver-element-color", "#saver-element-align", "#saver-element-opacity", "#saver-element-text", "#saver-element-visible", "#saver-element-locked", "#duplicate-saver-element", "#delete-saver-element"];
  for (const selector of selectors) {
    const field = $(selector);
    if (field) field.disabled = !element;
  }
  if (!element) return;
  $("#saver-element-label").value = element.label ?? "";
  $("#saver-element-x").value = Math.round(element.x);
  $("#saver-element-y").value = Math.round(element.y);
  $("#saver-element-w").value = Math.round(element.w);
  $("#saver-element-h").value = Math.round(element.h);
  $("#saver-element-z").value = element.zIndex ?? 10;
  $("#saver-element-size").value = element.style?.size ?? "";
  $("#saver-element-color").value = element.style?.color && /^#[0-9a-f]{6}$/i.test(element.style.color) ? element.style.color : (selectedScreensaver()?.theme?.accent ?? config.accent);
  $("#saver-element-align").value = element.style?.align ?? "";
  $("#saver-element-opacity").value = element.style?.opacity ?? 1;
  $("#saver-element-text").value = element.type === "image" ? (element.data?.src ?? "") : (element.data?.text ?? "");
  $("#saver-element-visible").checked = element.visible !== false;
  $("#saver-element-locked").checked = element.locked === true;
}

function renderSaverPresetOptions() {
  const select = $("#saver-add-type");
  const previous = elementTypeValues.has(select?.value) ? select.value : saverAddType;
  select.replaceChildren(...ELEMENT_TYPES.map(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }));
  saverAddType = elementTypeValues.has(previous) ? previous : "clock";
  select.value = saverAddType;
}

function saverPreviewBackground(profile) {
  const background = profile.background ?? {};
  if (background.type === "image" && background.value) {
    return `${background.overlay || "linear-gradient(rgba(0,0,0,.2),rgba(0,0,0,.35))"}, url("${background.value}") center / cover no-repeat`;
  }
  return background.value || "#050705";
}

function renderSaverCardPreview(preview, profile) {
  const accent = profile.theme?.accent || config.accent;
  preview.className = `screensaver-card-preview saver-thumb saver-thumb-${profile.preset || profile.id}`;
  preview.style.background = saverPreviewBackground(profile);
  preview.style.setProperty("--thumb-accent", accent);
  preview.innerHTML = `
    <span class="thumb-noise"></span>
    <span class="thumb-orb"></span>
    <span class="thumb-time">21:59</span>
    <span class="thumb-date">${escapeHtml(profile.label)}</span>
    <span class="thumb-weather">24°</span>
    <span class="thumb-bars"><i></i><i></i><i></i><i></i></span>
    <span class="thumb-strip"><i></i><i></i><i></i><i></i><i></i></span>
    <span class="thumb-dots"><i></i><i></i><i></i></span>
  `;
}

function renderSaverList() {
  $("#screensaver-list").replaceChildren(...screensavers().map((profile, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `screensaver-card${profile.id === selectedScreensaverId ? " active" : ""}${profile.id === config.ui.screensaverProfile ? " current" : ""}`;
    button.dataset.saverId = profile.id;
    button.dataset.saverIndex = String(index);
    const preview = document.createElement("div");
    renderSaverCardPreview(preview, profile);
    const info = document.createElement("div");
    info.className = "screensaver-card-info";
    info.innerHTML = `<strong>${escapeHtml(profile.label)}</strong><span>${profile.id === config.ui.screensaverProfile ? "AKTYWNY" : "WYBIERZ"}</span><small>${escapeHtml(PRESET_LABELS[profile.preset] || profile.preset)} · ${profile.elements?.length ?? 0} elementów</small>`;
    button.append(preview, info);
    button.addEventListener("click", () => {
      readSaverProfileControls();
      readSaverElementForm();
      selectedScreensaverId = profile.id;
      selectedSaverElementId = profile.elements?.[0]?.id ?? null;
      renderSaverStudio();
    });
    return button;
  }));
}

function renderSaverElementList() {
  const profile = selectedScreensaver();
  const elements = (profile?.elements ?? []).slice().sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0));
  $("#saver-element-list").replaceChildren(...elements.map((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `saver-element-choice${entry.id === selectedSaverElementId ? " active" : ""}`;
    button.dataset.elementId = entry.id;
    button.innerHTML = `<strong>${escapeHtml(entry.label || entry.type)}</strong><span>${entry.visible === false ? "UKRYTY" : entry.locked ? "LOCK" : `Z ${entry.zIndex ?? 0}`}</span><small>${escapeHtml(elementTypeLabels[entry.type] || entry.type)} · ${Math.round(entry.x)}:${Math.round(entry.y)} · ${Math.round(entry.w)}x${Math.round(entry.h)}</small>`;
    button.addEventListener("click", () => { readSaverElementForm(); selectedSaverElementId = entry.id; renderSaverStudio(); });
    return button;
  }));
}

function addSelectionToPreview() {
  const preview = $("#screensaver-preview");
  preview.querySelector(".saver-resize-overlay")?.remove();
  let selectedNode = null;
  preview.querySelectorAll(".screen-element").forEach((node) => {
    const selected = node.dataset.elementId === selectedSaverElementId;
    node.classList.toggle("selected", selected);
    if (selected) selectedNode = node;
    node.querySelector(".saver-hitbox")?.remove();
    node.querySelector(".saver-resize-handle")?.remove();
    if (!node.classList.contains("is-locked")) {
      const hitbox = document.createElement("span");
      hitbox.className = "saver-hitbox";
      hitbox.setAttribute("aria-hidden", "true");
      node.prepend(hitbox);
    }
    node.removeEventListener("pointerdown", startSaverPointer);
    node.addEventListener("pointerdown", startSaverPointer);
  });
  if (selectedNode && !selectedNode.classList.contains("is-locked")) {
    const overlay = document.createElement("span");
    overlay.className = "saver-resize-overlay";
    overlay.dataset.elementId = selectedSaverElementId;
    overlay.setAttribute("aria-hidden", "true");
    positionResizeOverlay(overlay, selectedNode);
    overlay.addEventListener("pointerdown", startSaverPointer);
    preview.append(overlay);
  }
}

function renderSaverPreview() {
  const profile = selectedScreensaver();
  if (!profile) return;
  const context = {
    config,
    ...demoScreensaverContext(config.accent)
  };
  const preview = $("#screensaver-preview");
  renderScreensaver(preview, profile, context, { preview: true, editing: true });
  const brightness = calculateScreensaverBrightness(config, context.weather, false, context.now, profile);
  preview.style.filter = `brightness(${(.58 + brightness * 3.2).toFixed(3)})`;
  preview.dataset.previewBrightness = String(Math.round(brightness * 100));
  addSelectionToPreview();
}

function renderSaverAssets() {
  const list = $("#saver-asset-list");
  if (!screensaverAssets.length) {
    list.innerHTML = '<div class="asset-empty">Brak obrazów. Wrzuć PNG, JPG, WEBP albo GIF i użyj jako tła lub elementu.</div>';
    return;
  }
  list.replaceChildren(...screensaverAssets.map((asset) => {
    const button = document.createElement("div");
    button.className = "asset-choice";
    button.innerHTML = `<img src="${escapeHtml(asset.url)}" alt=""><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(asset.id)}</small><button type="button">UŻYJ</button>`;
    button.querySelector("button").addEventListener("click", () => useAsset(asset));
    return button;
  }));
}

function captureSaverScrollState() {
  return Array.from(document.querySelectorAll("#screensaver-studio .panel-scroll, #screensaver-list, #saver-element-list")).map((element) => ({
    element,
    top: element.scrollTop,
    left: element.scrollLeft
  }));
}

function restoreSaverScrollState(scrollState) {
  for (const { element, top, left } of scrollState) {
    element.scrollTop = top;
    element.scrollLeft = left;
  }
}

function renderSaverStudio() {
  if (!config || !$("#screensaver-studio")) return;
  const scrollState = captureSaverScrollState();
  ensureScreensaverConfig(config);
  if (!screensavers().some((profile) => profile.id === selectedScreensaverId)) selectedScreensaverId = config.ui.screensaverProfile;
  const profile = selectedScreensaver();
  if (!selectedSaverElementId || !profile?.elements?.some((entry) => entry.id === selectedSaverElementId)) selectedSaverElementId = profile?.elements?.[0]?.id ?? null;
  renderSaverPresetOptions();
  renderSaverList();
  renderSaverElementList();
  loadScreensaverDisplayControls();
  loadSaverProfileControls();
  loadSaverElementForm();
  renderSaverPreview();
  renderSaverAssets();
  restoreSaverScrollState(scrollState);
  requestAnimationFrame(() => restoreSaverScrollState(scrollState));
}

function setActiveScreensaver() {
  readSaverProfileControls();
  readSaverElementForm();
  pushSaverHistory("aktywny wygaszacz");
  config.ui.screensaverProfile = selectedScreensaver()?.id ?? config.ui.screensaverProfile;
  renderSaverStudio();
  notify("Ustawiono aktywny wygaszacz");
}

function addScreensaverFromPreset(presetId) {
  readSaverProfileControls();
  readSaverElementForm();
  pushSaverHistory("dodanie wygaszacza");
  const preset = createDefaultScreensavers(config.accent).find((profile) => profile.id === (presetId || "classic-orbit")) ?? createDefaultScreensavers(config.accent)[0];
  const next = cloneScreensaver(preset);
  next.id = uniqueScreensaverId(next.label);
  next.label = `${next.label} copy`;
  config.ui.screensavers.push(next);
  selectedScreensaverId = next.id;
  selectedSaverElementId = next.elements?.[0]?.id ?? null;
  renderSaverStudio();
  notify("Dodano wygaszacz z presetu");
}

function addBlankScreensaver() {
  readSaverProfileControls();
  readSaverElementForm();
  pushSaverHistory("nowy wygaszacz");
  const next = normalizeScreensaver({
    schemaVersion: 4,
    id: uniqueScreensaverId("Mój wygaszacz"),
    label: "Mój wygaszacz",
    preset: "custom-freeform",
    background: { type: "solid", value: "#050705" },
    theme: { accent: config.accent, ink: "#f4f6ef", muted: "#777d73", surface: "#080a08" },
    elements: [
      { id: "custom-clock", type: "clock", label: "Zegar", x: 12, y: 18, w: 42, h: 14, zIndex: 10, visible: true, locked: false, style: { size: 5.6, seconds: true, align: "left" }, data: {} },
      { id: "custom-date", type: "date", label: "Data", x: 13, y: 35, w: 38, h: 5, zIndex: 11, visible: true, locked: false, style: { align: "left", opacity: .68 }, data: {} },
      { id: "custom-weather", type: "weatherNow", label: "Pogoda", x: 56, y: 18, w: 36, h: 16, zIndex: 12, visible: true, locked: false, style: {}, data: {} },
      { id: "custom-now", type: "nowPlaying", label: "Teraz gra", x: 12, y: 76, w: 52, h: 8, zIndex: 13, visible: true, locked: false, style: {}, data: {} },
      { id: "custom-pc", type: "pcStatus", label: "PC", x: 74, y: 82, w: 14, h: 4, zIndex: 14, visible: true, locked: false, style: {}, data: {} }
    ]
  }, config.accent);
  next.custom = true;
  config.ui.screensavers.push(next);
  selectedScreensaverId = next.id;
  selectedSaverElementId = next.elements?.[0]?.id ?? null;
  renderSaverStudio();
  notify("Dodano pusty wygaszacz do własnej edycji");
}

function duplicateScreensaver() {
  readSaverProfileControls();
  readSaverElementForm();
  const source = selectedScreensaver();
  if (!source) return;
  pushSaverHistory("duplikowanie wygaszacza");
  const next = cloneScreensaver(source);
  next.id = uniqueScreensaverId(next.label);
  next.label = `${next.label} copy`;
  config.ui.screensavers.push(next);
  selectedScreensaverId = next.id;
  selectedSaverElementId = next.elements?.[0]?.id ?? null;
  renderSaverStudio();
  notify("Zduplikowano wygaszacz");
}

function deleteScreensaver() {
  if (screensavers().length <= 1) return notify("Musi zostać przynajmniej jeden wygaszacz", true);
  const profile = selectedScreensaver();
  if (!profile || !confirm(`Usunąć wygaszacz "${profile.label}"?`)) return;
  pushSaverHistory("usunięcie wygaszacza");
  config.ui.screensavers = screensavers().filter((entry) => entry.id !== profile.id);
  if (config.ui.screensaverProfile === profile.id) config.ui.screensaverProfile = config.ui.screensavers[0].id;
  selectedScreensaverId = config.ui.screensaverProfile;
  selectedSaverElementId = config.ui.screensavers[0]?.elements?.[0]?.id ?? null;
  renderSaverStudio();
  notify("Usunięto wygaszacz");
}

function resetScreensaver() {
  const profile = selectedScreensaver();
  if (!profile || !confirm(`Przywrócić preset "${profile.label}" do domyślnego układu?`)) return;
  const preset = createDefaultScreensavers(config.accent).find((entry) => entry.preset === profile.preset || entry.id === profile.preset || entry.id === profile.id);
  if (!preset) return notify("Nie znaleziono bazowego presetu", true);
  pushSaverHistory("reset motywu");
  const replacement = normalizeScreensaver({ ...cloneScreensaver(preset), id: profile.id, label: profile.label }, config.accent);
  const index = config.ui.screensavers.findIndex((entry) => entry.id === profile.id);
  config.ui.screensavers[index] = replacement;
  selectedSaverElementId = replacement.elements?.[0]?.id ?? null;
  renderSaverStudio();
  notify("Preset przywrócony");
}

function addSaverElement() {
  const selectedType = $("#saver-add-type")?.value;
  const type = elementTypeValues.has(selectedType) ? selectedType : elementTypeValues.has(saverAddType) ? saverAddType : "text";
  readSaverProfileControls();
  readSaverElementForm();
  if (!selectedScreensaver()) return notify("Najpierw wybierz wygaszacz", true);
  pushSaverHistory("dodanie elementu");
  const profile = selectedScreensaver();
  profile.elements ??= [];
  const entry = {
    id: uniqueElementId(type, profile),
    type,
    label: elementTypeLabels[type] || type,
    x: 34,
    y: 34,
    w: type === "forecast" ? 58 : 28,
    h: type === "forecast" ? 18 : 10,
    zIndex: Math.max(10, ...profile.elements.map((item) => Number(item.zIndex) || 0)) + 1,
    visible: true,
    locked: false,
    style: { size: type === "clock" ? 6 : 1.5, align: "center" },
    data: type === "text" ? { text: "Nowy tekst" } : {}
  };
  profile.elements.push(entry);
  selectedSaverElementId = entry.id;
  saverAddType = type;
  renderSaverStudio();
  notify("Dodano element do wygaszacza");
}

function duplicateSaverElement() {
  readSaverElementForm();
  const entryId = selectedSaverElementId;
  if (!selectedScreensaver()?.elements?.some((item) => item.id === entryId)) return;
  pushSaverHistory("duplikowanie elementu");
  const profile = selectedScreensaver();
  const entry = profile?.elements?.find((item) => item.id === entryId);
  if (!profile || !entry) return;
  const copy = structuredClone(entry);
  copy.id = uniqueElementId(entry.type, profile);
  copy.label = `${entry.label} copy`;
  copy.x = Math.min(96, copy.x + 4);
  copy.y = Math.min(96, copy.y + 4);
  copy.zIndex = (Number(copy.zIndex) || 10) + 1;
  profile.elements.push(copy);
  selectedSaverElementId = copy.id;
  renderSaverStudio();
  notify("Zduplikowano element");
}

function deleteSaverElement() {
  const entryId = selectedSaverElementId;
  if (!selectedScreensaver()?.elements?.some((item) => item.id === entryId)) return;
  pushSaverHistory("usunięcie elementu");
  const profile = selectedScreensaver();
  const entry = profile?.elements?.find((item) => item.id === entryId);
  if (!profile || !entry) return;
  profile.elements = profile.elements.filter((item) => item.id !== entry.id);
  selectedSaverElementId = profile.elements[0]?.id ?? null;
  renderSaverStudio();
  notify("Usunięto element");
}

function updateElementFieldsFromModel(entry) {
  if (!entry) return;
  const format = (value) => Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
  $("#saver-element-x").value = format(entry.x);
  $("#saver-element-y").value = format(entry.y);
  $("#saver-element-w").value = format(entry.w);
  $("#saver-element-h").value = format(entry.h);
}

function snap(value, event) {
  if (event?.shiftKey) return Math.round(value / 2) * 2;
  return Math.round(value * 10) / 10;
}

function saverCanvasRect() {
  return ($("#screensaver-preview .screen-stage") ?? $("#screensaver-preview")).getBoundingClientRect();
}

function clientPointToCanvasPercent(event, rect = saverCanvasRect()) {
  const width = rect.width || 1;
  const height = rect.height || 1;
  return {
    x: ((event.clientX - rect.left) / width) * 100,
    y: ((event.clientY - rect.top) / height) * 100
  };
}

function clampElementToCanvas(entry) {
  entry.w = clampNumber(entry.w, 3, 100);
  entry.h = clampNumber(entry.h, 3, 100);
  entry.x = clampNumber(entry.x, 0, Math.max(0, 100 - entry.w));
  entry.y = clampNumber(entry.y, 0, Math.max(0, 100 - entry.h));
}

function positionResizeOverlay(overlay = $("#screensaver-preview .saver-resize-overlay"), node = $("#screensaver-preview .screen-element.selected")) {
  const preview = $("#screensaver-preview");
  if (!overlay || !node || !preview) return;
  const rootRect = preview.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  overlay.style.left = `${nodeRect.right - rootRect.left}px`;
  overlay.style.top = `${nodeRect.bottom - rootRect.top}px`;
}

function startSaverPointer(event) {
  readSaverElementForm();
  const overlay = event.currentTarget.classList?.contains("saver-resize-overlay") ? event.currentTarget : null;
  const node = overlay ? $("#screensaver-preview .screen-element.selected") : event.currentTarget;
  const entryId = overlay?.dataset.elementId ?? node?.dataset.elementId;
  const entry = selectedScreensaver()?.elements?.find((item) => item.id === entryId);
  if (!entry) return;
  const resize = Boolean(overlay || event.target.closest(".saver-resize-handle"));
  selectedSaverElementId = entry.id;
  loadSaverElementForm();
  addSelectionToPreview();
  if (entry.locked) return;
  const canvasRect = saverCanvasRect();
  saverPointerState = {
    mode: resize ? "resize" : "move",
    entry,
    node,
    canvasRect,
    startPoint: clientPointToCanvasPercent(event, canvasRect),
    start: { x: entry.x, y: entry.y, w: entry.w, h: entry.h },
    history: saverSnapshot(),
    pointerTarget: overlay ?? node
  };
  saverPointerState.pointerTarget?.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function moveSaverPointer(event) {
  if (!saverPointerState) return;
  const { mode, entry, node, canvasRect, startPoint, start } = saverPointerState;
  const point = clientPointToCanvasPercent(event, canvasRect);
  const dx = point.x - startPoint.x;
  const dy = point.y - startPoint.y;
  if (mode === "resize") {
    entry.x = start.x;
    entry.y = start.y;
    entry.w = snap(start.w + dx, event);
    entry.h = snap(start.h + dy, event);
  } else {
    entry.x = snap(start.x + dx, event);
    entry.y = snap(start.y + dy, event);
  }
  clampElementToCanvas(entry);
  node.style.left = `${entry.x}%`;
  node.style.top = `${entry.y}%`;
  node.style.width = `${entry.w}%`;
  node.style.height = `${entry.h}%`;
  positionResizeOverlay(undefined, node);
  updateElementFieldsFromModel(entry);
}

function endSaverPointer() {
  if (!saverPointerState) return;
  readSaverElementForm();
  pushSaverHistorySnapshot(saverPointerState.history, saverPointerState.mode === "resize" ? "zmiana rozmiaru elementu" : "przesunięcie elementu", { skipIfCurrent: true });
  saverPointerState = null;
  renderSaverElementList();
}

async function loadScreensaverAssets() {
  try {
    screensaverAssets = await fetchJson("/api/assets/screensavers").then((result) => result.assets ?? []);
    renderSaverAssets();
  } catch (error) {
    notify(error.message, true);
  }
}

async function uploadScreensaverAsset(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("Nie udało się odczytać obrazu"));
      reader.readAsDataURL(file);
    });
    const result = await fetchJson("/api/assets/screensavers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, mime: file.type, data }) });
    screensaverAssets.unshift(result.asset);
    renderSaverAssets();
    notify("Obraz dodany do assetów");
  } catch (error) {
    notify(error.message, true);
  }
}

function useAsset(asset) {
  pushSaverHistory("asset wygaszacza");
  const element = selectedSaverElement();
  if (element?.type === "image") {
    element.data ??= {};
    element.data.src = asset.url;
    $("#saver-element-text").value = asset.url;
  } else {
    const profile = selectedScreensaver();
    profile.background = { type: "image", value: asset.url, overlay: "linear-gradient(rgba(0,0,0,.22),rgba(0,0,0,.22))" };
    $("#saver-background-type").value = "image";
    $("#saver-background-value").value = asset.url;
  }
  renderSaverPreview();
  notify("Asset przypisany do wygaszacza");
}

function isTypingTarget(target) {
  return Boolean(target?.closest?.("input, textarea, select, [contenteditable='true']"));
}

function moveSelectedSaverElement(dx, dy, event) {
  const entry = selectedSaverElement();
  if (!entry) return false;
  if (entry.locked) {
    notify("Element jest zablokowany");
    return true;
  }
  const step = event.altKey ? .1 : event.shiftKey ? 5 : 1;
  pushSaverHistory("przesunięcie elementu");
  entry.x = Math.max(-20, Math.min(120, Math.round((entry.x + dx * step) * 10) / 10));
  entry.y = Math.max(-20, Math.min(120, Math.round((entry.y + dy * step) * 10) / 10));
  updateElementFieldsFromModel(entry);
  renderSaverPreview();
  renderSaverElementList();
  return true;
}

function handleSaverKeyboard(event) {
  if (studioMode !== "screensavers" || event.defaultPrevented || isTypingTarget(event.target)) return;
  const key = event.key;
  const normalized = key.toLowerCase();
  const control = event.ctrlKey || event.metaKey;

  if (control && normalized === "z") {
    event.preventDefault();
    if (event.shiftKey) redoSaverEdit();
    else undoSaverEdit();
    return;
  }
  if (control && normalized === "y") {
    event.preventDefault();
    redoSaverEdit();
    return;
  }
  if (control && event.altKey && normalized === "r") {
    event.preventDefault();
    resetScreensaver();
    return;
  }
  if (key === "Delete" || key === "Backspace") {
    event.preventDefault();
    deleteSaverElement();
    return;
  }

  const moves = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1]
  };
  const move = moves[key];
  if (!move || control) return;
  event.preventDefault();
  moveSelectedSaverElement(move[0], move[1], event);
}

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

function loadGlobals(options = {}) {
  const previousProfile = selectedScreensaverId;
  const previousElement = selectedSaverElementId;
  ensureScreensaverConfig(config);
  const display = getDisplayConfig(config);
  $("#global-accent").value = config.accent; $("#accent-value").textContent = config.accent;
  loadScreensaverDisplayControls();
  document.documentElement.style.setProperty("--accent", config.accent); setPlace(config.weather ?? { city: "Warszawa", latitude: 52.2297, longitude: 21.0122 }, false);
  if (options.preserveScreensaverSelection && config.ui.screensavers.some((profile) => profile.id === previousProfile)) {
    selectedScreensaverId = previousProfile;
    const profile = config.ui.screensavers.find((entry) => entry.id === previousProfile);
    selectedSaverElementId = profile?.elements?.some((entry) => entry.id === previousElement) ? previousElement : profile?.elements?.[0]?.id ?? null;
  } else {
    selectedScreensaverId = config.ui.screensaverProfile ?? "classic-orbit";
  }
  renderTemplates();
  renderSaverStudio();
}

function readGlobals() {
  config.accent = $("#global-accent").value;
  applyScreensaverDisplayControls({ syncProfileBrightness: true });
  config.weather = { city: $("#weather-city").textContent, latitude: Number($("#weather-lat").value), longitude: Number($("#weather-lon").value) };
  readSaverProfileControls();
  readSaverElementForm();
  ensureScreensaverConfig(config);
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
    ensureScreensaverConfig(config);
    clearSaverHistory();
    pageName = config.pages[pageName] ? pageName : "home";
    tileIndex = 0;
    loadGlobals();
    renderAll();
    notify("Konfiguracja zaimportowana i zapisana");
  } catch (error) { notify(error.message, true); }
}

async function save() {
  try {
    if (studioMode === "deck") applyTile();
    readGlobals();
    const result = await fetchJson("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
    config = assertConfigShape(result.config);
    ensureScreensaverConfig(config);
    loadGlobals({ preserveScreensaverSelection: true });
    renderAll();
    notify("Konfiguracja zapisana na EndoDeck");
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
  ensureScreensaverConfig(config);
  clearSaverHistory();
  selectedScreensaverId = config.ui.screensaverProfile;
  await refreshApps(false);
  await loadScreensaverAssets();
  $("#icon-search").placeholder = `Szukaj w ${iconNames.length} ikonach`; loadGlobals(); renderAll(); initMap();
  updateConnection(await fetchJson("/api/state")); new EventSource("/api/events").addEventListener("message", (event) => updateConnection(JSON.parse(event.data)));
}

$("#tile-form").addEventListener("submit", applyTile); $("#tile-type").addEventListener("change", updateActionFields); $("#icon-search").addEventListener("input", () => renderIconPicker($("#icon-picker"), $("#icon-search").value, selectedIcon, chooseIcon));
$("#move-left").addEventListener("click", () => move(-1)); $("#move-right").addEventListener("click", () => move(1)); $("#delete-tile").addEventListener("click", deleteTile); $("#save-config").addEventListener("click", save); $("#place-search").addEventListener("submit", searchPlaces);
$("#add-tile").addEventListener("click", addTile); $("#add-page").addEventListener("click", addPage); $("#delete-page").addEventListener("click", deletePage);
$("#export-config").addEventListener("click", exportConfig); $("#import-config").addEventListener("click", () => $("#import-config-file").click()); $("#import-config-file").addEventListener("change", importConfigFile);
for (const button of document.querySelectorAll("[data-studio-mode]")) button.addEventListener("click", () => setStudioMode(button.dataset.studioMode));
$("#set-active-screensaver").addEventListener("click", setActiveScreensaver);
$("#add-screensaver-blank")?.addEventListener("click", addBlankScreensaver);
if ($("#add-screensaver-preset")) $("#add-screensaver-preset").addEventListener("click", () => addScreensaverFromPreset());
$("#duplicate-screensaver").addEventListener("click", duplicateScreensaver);
$("#delete-screensaver").addEventListener("click", deleteScreensaver);
$("#reset-screensaver").addEventListener("click", resetScreensaver);
$("#saver-add-type").addEventListener("change", (event) => {
  saverAddType = elementTypeValues.has(event.target.value) ? event.target.value : "clock";
});
$("#add-saver-element").addEventListener("click", addSaverElement);
$("#duplicate-saver-element").addEventListener("click", duplicateSaverElement);
$("#delete-saver-element").addEventListener("click", deleteSaverElement);
$("#saver-asset-upload").addEventListener("change", uploadScreensaverAsset);
document.addEventListener("pointermove", moveSaverPointer);
document.addEventListener("pointerup", endSaverPointer);
document.addEventListener("pointercancel", endSaverPointer);
document.addEventListener("keydown", handleSaverKeyboard);
for (const selector of ["#saver-background-type", "#saver-background-value", "#saver-theme-accent", "#protect-pixel-shift", "#protect-subtle-rotation", "#protect-composition-rotation", "#protect-oled", "#protect-static-limit"]) {
  $(selector)?.addEventListener("input", () => { readSaverProfileControls(); renderSaverPreview(); renderSaverList(); });
  $(selector)?.addEventListener("change", () => { readSaverProfileControls(); renderSaverPreview(); renderSaverList(); });
}
for (const selector of ["#saver-element-label", "#saver-element-x", "#saver-element-y", "#saver-element-w", "#saver-element-h", "#saver-element-z", "#saver-element-size", "#saver-element-color", "#saver-element-align", "#saver-element-opacity", "#saver-element-text", "#saver-element-visible", "#saver-element-locked"]) {
  $(selector)?.addEventListener("input", () => { readSaverElementForm(); renderSaverPreview(); renderSaverElementList(); });
  $(selector)?.addEventListener("change", () => { readSaverElementForm(); renderSaverPreview(); renderSaverElementList(); });
}
for (const selector of ["#global-dim", "#global-saver", "#show-now-playing", "#show-equalizer", "#brightness-night", "#brightness-twilight", "#brightness-day", "#brightness-offline-night", "#brightness-offline-day", "#night-enabled", "#night-start", "#night-end"]) {
  $(selector)?.addEventListener("input", () => { applyScreensaverDisplayControls({ syncProfileBrightness: true }); renderSaverPreview(); renderSaverList(); });
  $(selector)?.addEventListener("change", () => { applyScreensaverDisplayControls({ syncProfileBrightness: true }); renderSaverPreview(); renderSaverList(); });
}
$("#open-device-panel").addEventListener("click", () => {
  if (window.EndoDeckDesktop?.openDevicePanel) window.EndoDeckDesktop.openDevicePanel();
  else notify("Panel urządzenia jest dostępny z aplikacji EndoDeck w trayu.", true);
});
$("#global-accent").addEventListener("input", (event) => {
  $("#accent-value").textContent = event.target.value;
  document.documentElement.style.setProperty("--accent", event.target.value);
  const profile = selectedScreensaver();
  if (profile) profile.theme = { ...(profile.theme ?? {}), accent: event.target.value };
  renderSaverPreview();
});
boot().catch(showBootError);
