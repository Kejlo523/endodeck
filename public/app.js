const grid = document.querySelector("#button-grid");
const title = document.querySelector("#deck-title");
const pageLabel = document.querySelector("#page-label");
const usbStatus = document.querySelector("#usb-status");
const toast = document.querySelector("#toast");
const settingsPanel = document.querySelector("#settings-panel");
const settingsForm = document.querySelector("#settings-form");
const editPage = document.querySelector("#edit-page");
const editButton = document.querySelector("#edit-button");
const editLabel = document.querySelector("#edit-label");
const editHint = document.querySelector("#edit-hint");
const editIcon = document.querySelector("#edit-icon");
const editTone = document.querySelector("#edit-tone");
const editAccent = document.querySelector("#edit-accent");
const editType = document.querySelector("#edit-type");
const editPrimary = document.querySelector("#edit-primary");
const editDetail = document.querySelector("#edit-detail");
const editPrimaryLabel = document.querySelector("#edit-primary-label");
const editDetailLabel = document.querySelector("#edit-detail-label");
const powerStatus = document.querySelector("#power-status");
const batteryStatus = document.querySelector("#battery-status");
const screensaver = document.querySelector("#screensaver");
let config;
let currentPage = "home";
let toastTimer;
let audioRefreshTimer;
let inactivityTimer;
let screensaverTimer;
let latestState = {};
let latestWeather = null;

const icons = {
  code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 4l-4 16"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M12 16h5"/>',
  folder: '<path d="M3 7.5h7l2-2h9v13H3z"/>',
  github: '<path d="M9 19c-4 .8-4-2-5-2.5M14 22v-3.5c0-1 .1-1.5-.5-2 3-.3 6.2-1.5 6.2-6.6A5.2 5.2 0 0 0 18.3 6c.1-.3.6-1.8-.1-3.6 0 0-1.1-.4-3.7 1.4a12.7 12.7 0 0 0-6.7 0C5.2 2 4 2.4 4 2.4 3.3 4.2 3.8 5.7 3.9 6a5.2 5.2 0 0 0-1.4 3.7c0 5.1 3.2 6.3 6.2 6.6-.5.4-.8 1.1-.8 2.2V22"/>',
  discord: '<path d="M8 7a13 13 0 0 1 8 0l1.5-2.2A16 16 0 0 1 21 18a11 11 0 0 1-4 2l-1.3-1.8M8 7 6.5 4.8A16 16 0 0 0 3 18a11 11 0 0 0 4 2l1.3-1.8M8.5 14h.1M15.5 14h.1"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/>',
  spotify: '<circle cx="12" cy="12" r="9"/><path d="M7.5 9.5c3.5-1 7.6-.6 10.2.9M8.3 13c3-.8 6.4-.4 8.8.8M9 16.2c2.4-.6 5-.3 7 .7"/>',
  micOff: '<path d="M9 9v3a3 3 0 0 0 4.8 2.4M15 10V6a3 3 0 0 0-5.6-1.5M6.5 11.5a5.5 5.5 0 0 0 9.6 3.7M17.5 11.5c0 .8-.2 1.6-.5 2.3M12 17v4M9 21h6M3 3l18 18"/>',
  headset: '<path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14h4v6H6a2 2 0 0 1-2-2zM20 14h-4v6h2a2 2 0 0 0 2-2z"/>',
  crop: '<path d="M7 3v14a2 2 0 0 0 2 2h12M3 7h14a2 2 0 0 1 2 2v12"/>',
  save: '<path d="M4 3h13l3 3v15H4zM8 3v6h8V3M8 21v-7h8v7"/>',
  command: '<path d="M9 6V5a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v14a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
  automation: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10M8 7a2 2 0 1 0 0 .1M8 17a2 2 0 1 0 0 .1M12 12h8M4 12h4"/>',
  rocket: '<path d="M14 5c3-3 6-2 6-2s1 3-2 6l-5 5-4-4zM9 10l-4 1-2 3 6 1M13 14l1 6 3-2 1-5M7 17l-3 3"/>',
  activity: '<path d="M3 12h4l2-7 4 14 2-7h6"/>',
  inspect: '<path d="M4 4h7M4 4v7M20 20h-7M20 20v-7M9 15l6-6M11 9h4v4"/>',
  display: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 22h8M12 18v4"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  paste: '<path d="M9 5h6v4H9zM8 7H5v14h14V7h-3"/>',
  undo: '<path d="M9 7 4 12l5 5M5 12h8a6 6 0 0 1 6 6"/>',
  redo: '<path d="m15 7 5 5-5 5M19 12h-8a6 6 0 0 0-6 6"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="13" cy="18" r="2"/>',
  volumeDown: '<path d="M5 10h4l5-4v12l-5-4H5zM17 10a3 3 0 0 1 0 4"/>',
  volumeMute: '<path d="M5 10h4l5-4v12l-5-4H5zM18 10l4 4M22 10l-4 4"/>',
  volumeUp: '<path d="M5 10h4l5-4v12l-5-4H5zM17 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/>',
  previous: '<path d="M7 6v12M18 6l-8 6 8 6z"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  next: '<path d="M17 6v12M6 6l8 6-8 6z"/>',
  back: '<path d="m10 6-6 6 6 6M4 12h16"/>'
};

function showToast(message, error = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast show${error ? " error" : ""}`;
  toastTimer = setTimeout(() => toast.className = "toast", 1800);
}

function createDeckButton(button) {
  const element = document.createElement("button");
  element.className = `deck-button tone-${button.tone ?? "neutral"}`;
  element.setAttribute("aria-label", `${button.label} ${button.hint ?? ""}`.trim());
  element.innerHTML = `<span class="icon"><svg viewBox="0 0 24 24" aria-hidden="true">${icons[button.icon] ?? icons.automation}</svg></span><span class="label">${button.label}</span><span class="hint">${button.hint ?? ""}</span>`;
  element.addEventListener("click", () => trigger(button, element));
  return element;
}

function render(pageName) {
  clearInterval(audioRefreshTimer);
  const page = config.pages[pageName] ?? config.pages.home;
  currentPage = pageName in config.pages ? pageName : "home";
  pageLabel.textContent = page.label;
  if (page.layout === "mixer") return renderMixer(page);
  grid.className = "button-grid";
  grid.replaceChildren(...page.buttons.map(createDeckButton));
}

function mixerName(session) {
  if (session.id === 0) return "Dźwięki systemowe";
  const names = { chrome: "Google Chrome", discord: "Discord", msedge: "Microsoft Edge", spotify: "Spotify", steam: "Steam", firefox: "Firefox" };
  const process = String(session.process || "").toLowerCase();
  if (names[process]) return names[process];
  if (session.name && !String(session.name).startsWith("@")) return session.name;
  return session.process || `Proces ${session.id}`;
}

function createRangeChannel({ id, name, process, volume, master = false }) {
  const channel = document.createElement("label");
  channel.className = `mixer-channel${master ? " master-channel" : ""}`;
  const heading = document.createElement("span");
  heading.className = "channel-heading";
  const label = document.createElement("strong");
  label.textContent = name;
  const detail = document.createElement("small");
  detail.textContent = master ? "GŁOŚNOŚĆ GŁÓWNA" : process;
  const output = document.createElement("output");
  output.textContent = `${volume}%`;
  heading.append(label, detail, output);
  const range = document.createElement("input");
  range.className = "mixer-range";
  range.type = "range";
  range.min = "0";
  range.max = "100";
  range.value = String(volume);
  range.style.setProperty("--level", `${volume}%`);
  range.setAttribute("aria-label", `Głośność ${name}`);
  range.addEventListener("input", () => {
    output.textContent = `${range.value}%`;
    range.style.setProperty("--level", `${range.value}%`);
  });
  range.addEventListener("change", () => updateVolume(master ? "master" : "session", id, Number(range.value)));
  channel.append(heading, range);
  return channel;
}

async function updateVolume(target, id, volume) {
  try {
    const response = await fetch("/api/audio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, id, volume })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Nie udało się zmienić głośności");
    navigator.vibrate?.(12);
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadMixer(board) {
  try {
    const response = await fetch("/api/audio", { cache: "no-store" });
    const snapshot = await response.json();
    if (!response.ok) throw new Error(snapshot.error || "Mikser Windows jest niedostępny");
    if (!board.isConnected || currentPage !== "audio") return;
    const channels = document.createElement("div");
    channels.className = "mixer-channels";
    channels.append(...snapshot.sessions.map((session) => createRangeChannel({
      id: session.id,
      name: mixerName(session),
      process: session.process,
      volume: session.volume
    })));
    if (!snapshot.sessions.length) {
      const empty = document.createElement("div");
      empty.className = "mixer-empty";
      empty.textContent = "Uruchom aplikację odtwarzającą dźwięk, a jej suwak pojawi się tutaj.";
      channels.append(empty);
    }
    board.replaceChildren(
      createRangeChannel({ name: "SYSTEM WINDOWS", volume: snapshot.master, master: true }),
      channels
    );
  } catch (error) {
    board.innerHTML = `<div class="mixer-empty">${error.message}</div>`;
  }
}

function renderMixer(page) {
  grid.className = "button-grid audio-grid";
  const board = document.createElement("section");
  board.className = "mixer-board";
  board.innerHTML = '<div class="mixer-loading">ODCZYTUJĘ MIKSER WINDOWS…</div>';
  const actions = document.createElement("aside");
  actions.className = "mixer-actions";
  actions.append(...page.buttons.map(createDeckButton));
  grid.replaceChildren(board, actions);
  loadMixer(board);
  audioRefreshTimer = setInterval(() => {
    if (!document.querySelector(".mixer-range:active")) loadMixer(board);
  }, 7000);
}

async function trigger(button, element) {
  if (button.action.type === "page") return render(button.action.page);
  element.classList.add("active");
  navigator.vibrate?.(24);
  try {
    const response = await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: button.id }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Błąd akcji");
    if (result.page) render(result.page);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setTimeout(() => element.classList.remove("active"), 130);
  }
}

function selectedButton() {
  return config.pages[editPage.value].buttons[Number(editButton.value)];
}

function fillButtonOptions() {
  const buttons = config.pages[editPage.value].buttons;
  editButton.replaceChildren(...buttons.map((button, index) => new Option(button.label, String(index))));
  loadEditor();
}

function updateActionLabels() {
  const labels = {
    hotkey: ["Klawisze, np. CTRL + SHIFT + P", "Nie używane"],
    processHotkey: ["Proces, np. Discord", "Klawisze, np. CTRL + SHIFT + M"],
    launch: ["Program lub adres", "Argumenty jako JSON, np. [\"--new-window\"]"],
    command: ["Polecenie", "Argumenty jako JSON"],
    media: ["playPause / next / previous / volumeUp…", "Nie używane"],
    page: ["Nazwa strony, np. home", "Nie używane"],
    sequence: ["Sekwencja", "Lista akcji jako JSON"]
  };
  [editPrimaryLabel.textContent, editDetailLabel.textContent] = labels[editType.value];
  editPrimary.disabled = editType.value === "sequence";
  editDetail.closest("label").classList.toggle("muted-field", ["hotkey", "media", "page"].includes(editType.value));
}

function loadEditor() {
  const button = selectedButton();
  if (!button) return;
  editLabel.value = button.label;
  editHint.value = button.hint ?? "";
  editIcon.value = button.icon in icons ? button.icon : "automation";
  editTone.value = button.tone ?? "neutral";
  editType.value = button.action.type;
  const action = button.action;
  editPrimary.value = action.type === "hotkey" ? (action.keys ?? []).join(" + ")
    : action.type === "processHotkey" ? action.process ?? ""
    : action.type === "media" ? action.key ?? ""
    : action.type === "page" ? action.page ?? ""
    : action.command ?? "";
  editDetail.value = action.type === "processHotkey" ? (action.keys ?? []).join(" + ")
    : action.type === "sequence" ? JSON.stringify(action.actions ?? [], null, 2)
    : ["launch", "command"].includes(action.type) ? JSON.stringify(action.args ?? []) : "";
  updateActionLabels();
}

function buildAction() {
  const type = editType.value;
  if (type === "hotkey") return { type, keys: editPrimary.value.split(/[+,\s]+/).filter(Boolean).map((key) => key.toUpperCase()) };
  if (type === "processHotkey") return { type, process: editPrimary.value.trim(), keys: editDetail.value.split(/[+,\s]+/).filter(Boolean).map((key) => key.toUpperCase()) };
  if (type === "media") return { type, key: editPrimary.value.trim() };
  if (type === "page") return { type, page: editPrimary.value.trim() };
  if (type === "sequence") return { type, actions: JSON.parse(editDetail.value || "[]") };
  return { type, command: editPrimary.value.trim(), args: JSON.parse(editDetail.value || "[]") };
}

function openSettings() {
  editPage.replaceChildren(...Object.entries(config.pages).map(([name, page]) => new Option(page.label, name)));
  editPage.value = currentPage;
  editIcon.replaceChildren(...Object.keys(icons).map((name) => new Option(name, name)));
  editAccent.value = config.accent;
  fillButtonOptions();
  settingsPanel.classList.remove("hidden");
  settingsPanel.setAttribute("aria-hidden", "false");
}

function closeSettings() {
  settingsPanel.classList.add("hidden");
  settingsPanel.setAttribute("aria-hidden", "true");
}

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const button = selectedButton();
    button.label = editLabel.value.trim();
    button.hint = editHint.value.trim();
    button.icon = editIcon.value;
    button.tone = editTone.value;
    button.action = buildAction();
    config.accent = editAccent.value;
    const response = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Nie udało się zapisać");
    config = result.config;
    document.documentElement.style.setProperty("--accent", config.accent);
    render(currentPage);
    fillButtonOptions();
    showToast("Zapisano przycisk");
  } catch (error) {
    showToast(error.message, true);
  }
});

document.querySelector("#settings-trigger").addEventListener("click", openSettings);
document.querySelector("#settings-close").addEventListener("click", closeSettings);
editPage.addEventListener("change", fillButtonOptions);
editButton.addEventListener("change", loadEditor);
editType.addEventListener("change", updateActionLabels);

function updateState(state) {
  latestState = state;
  usbStatus.classList.toggle("online", Boolean(state.adb));
  document.querySelector("#saver-pc").classList.toggle("online", Boolean(state.adb));
  const battery = state.battery;
  powerStatus.textContent = battery ? `${battery.currentMa >= 0 ? "+" : ""}${battery.currentMa} mA` : "-- mA";
  batteryStatus.textContent = battery ? `${battery.percent}%` : "--%";
  document.querySelector("#saver-power").textContent = powerStatus.textContent;
  document.querySelector("#saver-battery").textContent = batteryStatus.textContent;
  if (state.error) showToast(state.error, true);
}

function updateClock() {
  const now = new Date();
  const time = new Intl.DateTimeFormat("pl-PL", { hour: "2-digit", minute: "2-digit" }).format(now);
  document.querySelector("#clock").textContent = time;
  document.querySelector("#saver-clock").textContent = time;
  document.querySelector("#saver-date").textContent = new Intl.DateTimeFormat("pl-PL", { weekday: "long", day: "numeric", month: "long" }).format(now);
}

const weatherLabels = {
  0: ["SŁONECZNIE", "☀"], 1: ["PRAWIE BEZCHMURNIE", "◒"], 2: ["CZĘŚCIOWE ZACHMURZENIE", "◑"], 3: ["POCHMURNO", "☁"],
  45: ["MGŁA", "≋"], 48: ["MGŁA", "≋"], 51: ["MŻAWKA", "⋰"], 53: ["MŻAWKA", "⋰"], 55: ["MŻAWKA", "⋰"],
  61: ["DESZCZ", "↯"], 63: ["DESZCZ", "↯"], 65: ["ULEWA", "↯"], 71: ["ŚNIEG", "✳"], 73: ["ŚNIEG", "✳"], 75: ["ŚNIEG", "✳"],
  80: ["PRZELOTNY DESZCZ", "↯"], 81: ["PRZELOTNY DESZCZ", "↯"], 82: ["ULEWA", "↯"], 95: ["BURZA", "ϟ"], 96: ["BURZA", "ϟ"], 99: ["BURZA", "ϟ"]
};

function weatherInfo(code) {
  return weatherLabels[code] ?? ["ZMIENNA POGODA", "·"];
}

function renderWeather(weather) {
  latestWeather = weather;
  const [description, symbol] = weatherInfo(weather.current.code);
  document.querySelector("#weather-symbol").textContent = symbol;
  document.querySelector("#weather-temp").textContent = `${weather.current.temperature}°`;
  document.querySelector("#weather-city").textContent = weather.city;
  document.querySelector("#weather-description").textContent = `${description} · ODCZUWALNA ${weather.current.apparent}° · WIATR ${weather.current.wind} KM/H`;
  const dayFormat = new Intl.DateTimeFormat("pl-PL", { weekday: "short" });
  document.querySelector("#forecast").replaceChildren(...weather.daily.map((day) => {
    const item = document.createElement("div");
    item.className = "forecast-day";
    item.innerHTML = `<b>${dayFormat.format(new Date(`${day.date}T12:00:00`)).replace(".", "")}</b><span>${weatherInfo(day.code)[1]}</span><strong>${day.max}°</strong><small>${day.min}° · ${day.rain}%</small>`;
    return item;
  }));
}

async function loadWeather() {
  try {
    const response = await fetch("/api/weather", { cache: "no-store" });
    if (!response.ok) throw new Error();
    renderWeather(await response.json());
  } catch {
    document.querySelector("#weather-description").textContent = "POGODA NIEDOSTĘPNA";
  }
}

function showScreensaver() {
  document.body.classList.remove("dimmed");
  screensaver.classList.remove("hidden");
  screensaver.setAttribute("aria-hidden", "false");
  if (!latestWeather) loadWeather();
}

function resetIdle() {
  document.body.classList.remove("dimmed");
  screensaver.classList.add("hidden");
  screensaver.setAttribute("aria-hidden", "true");
  clearTimeout(inactivityTimer);
  clearTimeout(screensaverTimer);
  inactivityTimer = setTimeout(() => document.body.classList.add("dimmed"), (config.ui?.dimAfterSeconds ?? 90) * 1000);
  screensaverTimer = setTimeout(showScreensaver, (config.ui?.screensaverAfterSeconds ?? 300) * 1000);
}

async function boot() {
  config = await fetch("/api/config").then((response) => response.json());
  document.documentElement.style.setProperty("--accent", config.accent);
  title.textContent = config.title;
  render(currentPage);
  new EventSource("/api/events").addEventListener("message", (event) => updateState(JSON.parse(event.data)));
  updateClock();
  setInterval(updateClock, 10_000);
  loadWeather();
  setInterval(loadWeather, 15 * 60_000);
  for (const eventName of ["pointerdown", "touchstart", "keydown"]) document.addEventListener(eventName, resetIdle, { passive: true });
  resetIdle();
}

boot().catch(() => {
  showToast("Czekam na komputer…", true);
  setTimeout(() => location.reload(), 2000);
});
