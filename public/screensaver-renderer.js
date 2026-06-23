import { ensureScreensaverConfig, normalizeDisplayConfig, normalizeScreensaver } from "./screensaver-presets.js";

const weatherLabels = {
  0: ["SŁONECZNIE", "☀"],
  1: ["PRAWIE BEZCHMURNIE", "◒"],
  2: ["CZĘŚCIOWE ZACHMURZENIE", "◑"],
  3: ["POCHMURNO", "☁"],
  45: ["MGŁA", "≋"],
  48: ["SZADŹ", "≋"],
  51: ["MŻAWKA", "⋰"],
  53: ["MŻAWKA", "⋰"],
  55: ["MŻAWKA", "⋰"],
  61: ["DESZCZ", "↯"],
  63: ["DESZCZ", "↯"],
  65: ["ULEWA", "↯"],
  71: ["ŚNIEG", "✦"],
  73: ["ŚNIEG", "✦"],
  75: ["ŚNIEŻYCA", "✦"],
  80: ["PRZELOTNY DESZCZ", "↯"],
  81: ["PRZELOTNY DESZCZ", "↯"],
  82: ["ULEWA", "↯"],
  95: ["BURZA", "ϟ"],
  96: ["BURZA Z GRADEM", "ϟ"],
  99: ["BURZA Z GRADEM", "ϟ"]
};

const dayFormatter = new Intl.DateTimeFormat("pl-PL", { weekday: "short" });
const dateFormatter = new Intl.DateTimeFormat("pl-PL", { weekday: "long", day: "numeric", month: "long" });
const clockFormatter = new Intl.DateTimeFormat("pl-PL", { hour: "2-digit", minute: "2-digit" });

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function clamp(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min;
}

function weatherInfo(code) {
  return weatherLabels[code] ?? ["ZMIENNA POGODA", "·"];
}

function shortTime(value) {
  return String(value ?? "").split("T")[1]?.slice(0, 5) ?? "--:--";
}

function formatDay(value) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "--";
  return dayFormatter.format(date);
}

function formatDate(now) {
  return dateFormatter.format(now);
}

function formatClock(now) {
  return {
    main: clockFormatter.format(now),
    seconds: String(now.getSeconds()).padStart(2, "0")
  };
}

function analogAngles(now) {
  const seconds = now.getSeconds();
  const minutes = now.getMinutes() + seconds / 60;
  const hours = (now.getHours() % 12) + minutes / 60;
  return {
    hour: hours * 30,
    minute: minutes * 6,
    second: seconds * 6
  };
}

function continuousSecondAngle(node, angle) {
  const previous = Number(node.dataset.secondAngle);
  if (!Number.isFinite(previous)) return angle;
  let next = angle;
  while (next < previous - 180) next += 360;
  while (next > previous + 180) next -= 360;
  return next;
}

const LIGHT_HAND_PERIODS = { hour: 43200, minute: 3600, second: 60 };

function setupLightAnalog(container, now) {
  const seconds = now.getSeconds() + now.getMilliseconds() / 1000;
  const minutes = now.getMinutes() + seconds / 60;
  const hours = (now.getHours() % 12) + minutes / 60;
  const angles = { hour: hours * 30, minute: minutes * 6, second: seconds * 6 };
  for (const type of ["hour", "minute", "second"]) {
    const hand = container.querySelector(`.analog-hand.${type}`);
    if (!hand) continue;
    hand.style.animationDelay = `${-(angles[type] / 360) * LIGHT_HAND_PERIODS[type]}s`;
  }
  container.dataset.lightAnalog = "1";
}

function dataRateParts(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return { value: (value / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1), unit: "MB/s" };
  if (value >= 1024) return { value: String(Math.round(value / 1024)), unit: "KB/s" };
  return { value: String(Math.round(value)), unit: "B/s" };
}

function gibibytes(bytes) {
  return `${(Number(bytes || 0) / 1024 ** 3).toFixed(1)} GB`;
}

function demoWeather() {
  const today = new Date();
  const daily = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    const iso = date.toISOString().slice(0, 10);
    return {
      date: iso,
      code: [0, 2, 3, 61, 1, 80, 2][index],
      max: [24, 23, 21, 19, 25, 22, 24][index],
      min: [13, 14, 12, 10, 14, 12, 13][index],
      rain: [4, 12, 22, 63, 5, 31, 15][index],
      sunrise: `${iso}T04:${String(28 + index).padStart(2, "0")}`,
      sunset: `${iso}T20:${String(42 - index).padStart(2, "0")}`
    };
  });
  return {
    city: "Warszawa",
    utcOffsetSeconds: 7200,
    current: { code: 2, temperature: 24, apparent: 25, wind: 9 },
    daily
  };
}

export function demoScreensaverContext(accent = "#b7f34a") {
  return {
    now: new Date(),
    accent,
    offline: false,
    state: {
      adb: true,
      battery: { percent: 64, currentMa: -82 },
      systemStats: {
        cpu: { usage: 32, temperature: 49 },
        gpu: { usage: 18, temperature: 43, name: "GPU" },
        memory: { usage: 58, used: 9.3 * 1024 ** 3 },
        network: { received: 3.2 * 1024 ** 2, sent: 420 * 1024 }
      },
      nowPlaying: { playing: true, title: "Midnight Compiler", artist: "EndoDeck Studio" }
    },
    weather: demoWeather()
  };
}

export function getDisplayConfig(config) {
  return normalizeDisplayConfig(config?.ui ?? {});
}

export function activeScreensaver(config) {
  ensureScreensaverConfig(config);
  return normalizeScreensaver(
    config.ui.screensavers.find((profile) => profile.id === config.ui.screensaverProfile) ?? config.ui.screensavers[0],
    config.accent
  );
}

function cityTime(weather, now = new Date()) {
  const shifted = new Date(now.getTime() + Number(weather?.utcOffsetSeconds ?? 0) * 1000);
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

export function calculateScreensaverBrightness(config, weather, offline = false, now = new Date(), profile = null) {
  const { date, minute } = cityTime(weather, now);
  const today = weather?.daily?.find((day) => day.date === date) ?? weather?.daily?.[0];
  const sunrise = eventMinute(today?.sunrise);
  const sunset = eventMinute(today?.sunset);
  const displayBrightness = getDisplayConfig(config).screensaverBrightness;
  const brightness = { ...displayBrightness, ...(profile?.brightness ?? {}) };
  const levels = offline
    ? { night: brightnessPercent(brightness.offlineNight, 5), day: brightnessPercent(brightness.offlineDay, 10), twilight: brightnessPercent(brightness.twilight, 9) }
    : { night: brightnessPercent(brightness.night, 6), day: brightnessPercent(brightness.day, 13), twilight: brightnessPercent(brightness.twilight, 9) };
  const level = sunrise === null || sunset === null
    ? levels.night
    : Math.abs(minute - sunrise) <= 45 || Math.abs(minute - sunset) <= 45
      ? levels.twilight
      : minute > sunrise && minute < sunset ? levels.day : levels.night;
  const oledMultiplier = profile?.protection?.lowBrightnessOled === true ? .82 : 1;
  return clamp(level * oledMultiplier, .01, 1);
}

function applyRootTheme(root, profile, context, options) {
  const theme = profile.theme ?? {};
  const lightweight = options.lightweight === true || context.lightweight === true;
  root.classList.add("screen-renderer");
  root.classList.toggle("screen-renderer-preview", options.preview === true);
  root.classList.toggle("screen-renderer-editing", options.editing === true);
  root.classList.toggle("screen-renderer-light", lightweight);
  root.classList.toggle("screen-renderer-optimized", options.optimizeAnimations === true || context.optimizeAnimations === true);
  applyMotionState(root, context.config ?? {}, context, options);
  root.dataset.preset = profile.preset;
  root.dataset.screensaverId = profile.id;
  root.style.setProperty("--saver-accent", theme.accent || context.accent || "#b7f34a");
  root.style.setProperty("--saver-ink", theme.ink || "#f4f6ef");
  root.style.setProperty("--saver-muted", theme.muted || "#7b8278");
  root.style.setProperty("--saver-surface", theme.surface || "#0d100d");
  root.style.setProperty("--saver-shift-x", "0px");
  root.style.setProperty("--saver-shift-y", "0px");
  root.style.setProperty("--saver-rotation", "0deg");
  root.style.color = "var(--saver-ink)";
  const background = profile.background ?? {};
  if (lightweight) {
    root.style.background = theme.surface || (background.type === "image" ? "#060806" : background.value) || "#060806";
  } else if (background.type === "image" && background.value) {
    root.style.background = `${background.overlay || "linear-gradient(rgba(0,0,0,.28),rgba(0,0,0,.28))"}, url("${background.value}") center / cover no-repeat`;
  } else {
    root.style.background = background.value || "#060806";
  }
}

function applyMotionState(root, config, context = {}, options = {}) {
  const motion = getDisplayConfig(config).motion ?? {};
  const requestedMotionState = context.motionState ?? options.motionState;
  const motionState = requestedMotionState
    ? requestedMotionState === "eco" ? "eco" : "full"
    : motion.mode === "eco" ? "eco" : "full";
  const motionKey = `${motionState}:${motion.hideAnalogSecondInEco !== false}:${motion.freezeEqualizerInEco !== false}`;
  if (root.dataset.motionKey === motionKey) return;
  root.classList.toggle("screen-renderer-motion-eco", motionState === "eco");
  root.classList.toggle("screen-renderer-motion-full", motionState !== "eco");
  root.classList.toggle("screen-renderer-motion-hide-second", motionState === "eco" && motion.hideAnalogSecondInEco !== false);
  root.classList.toggle("screen-renderer-motion-freeze-eq", motionState === "eco" && motion.freezeEqualizerInEco !== false);
  root.dataset.motionState = motionState;
  root.dataset.motionKey = motionKey;
}

export function updateScreensaverProtection(root, profile, options = {}) {
  const protection = profile?.protection ?? {};
  if (!root || options.editing === true || options.disabled === true || options.lightweight === true || !protection.pixelShift) {
    root?.style.setProperty("--saver-shift-x", "0px");
    root?.style.setProperty("--saver-shift-y", "0px");
    root?.style.setProperty("--saver-rotation", "0deg");
    return;
  }
  const interval = clamp(Number(protection.staticElementLimitMinutes || 12) * 60_000, 60_000, 120 * 60_000);
  const phase = Math.floor(Date.now() / interval);
  const positions = [[-5, -3], [4, -4], [-3, 4], [5, 3], [0, -5], [-4, 2], [3, 5], [0, 0]];
  const [x, y] = positions[phase % positions.length];
  const subtleRotation = protection.subtleRotation ? ((phase % 5) - 2) * .08 : 0;
  const compositionRotation = protection.compositionRotation ? ((phase % 7) - 3) * .14 : 0;
  root.style.setProperty("--saver-shift-x", `${x}px`);
  root.style.setProperty("--saver-shift-y", `${y}px`);
  root.style.setProperty("--saver-rotation", `${subtleRotation + compositionRotation}deg`);
}

function applyElementStyle(node, entry) {
  node.className = `screen-element screen-element-${entry.type}`;
  node.dataset.elementId = entry.id;
  node.dataset.elementType = entry.type;
  node.style.left = `${entry.x}%`;
  node.style.top = `${entry.y}%`;
  node.style.width = `${entry.w}%`;
  node.style.height = `${entry.h}%`;
  node.style.zIndex = String(entry.zIndex ?? 10);
  node.style.display = entry.visible === false ? "none" : "";
  const style = entry.style ?? {};
  if (style.color) {
    node.style.color = style.color;
    node.style.setProperty("--element-color", style.color);
    node.style.setProperty("--element-accent", style.color);
  }
  if (style.background) node.style.background = style.background;
  if (style.border) node.style.border = style.border;
  if (style.radius) node.style.borderRadius = `${style.radius}px`;
  if (style.opacity !== undefined) node.style.opacity = String(style.opacity);
  const align = ["left", "center", "right"].includes(style.align) ? style.align : "center";
  const justify = align === "left" ? "start" : align === "right" ? "end" : "center";
  const flexJustify = align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";
  node.classList.add(`align-${align}`);
  node.dataset.align = align;
  node.style.textAlign = align;
  node.style.setProperty("--element-align", align);
  node.style.setProperty("--element-justify", justify);
  node.style.setProperty("--element-flex-justify", flexJustify);
  node.style.setProperty("--element-object-position", `${align} center`);
  if (style.size) {
    const size = Number(style.size);
    if (Number.isFinite(size) && size > 0) {
      node.style.setProperty("--element-size-num", String(size));
    }
  }
  if (style.letterSpacing !== undefined) node.style.setProperty("--element-letter", `${style.letterSpacing}em`);
  if (style.weight) node.style.fontWeight = String(style.weight);
  if (style.font === "mono") node.classList.add("screen-element-mono");
  if (entry.locked) node.classList.add("is-locked");
  if (entry.visible === false) node.classList.add("is-hidden-element");
}

function ringSvg(percent) {
  const value = clamp(percent, 0, 100);
  return `<span class="saver-ring" style="--ring-value:${value}"><svg viewBox="0 0 42 42" aria-hidden="true"><circle class="ring-track" cx="21" cy="21" r="16"></circle><circle class="ring-value" cx="21" cy="21" r="16"></circle></svg><strong>${Number.isFinite(Number(percent)) ? Math.round(value) : "--"}%</strong></span>`;
}

function metricElement(label, value, detail) {
  return `<div class="saver-metric">${ringSvg(value)}<span><small>${label}</small><b>${escapeHtml(detail || "—")}</b></span></div>`;
}

function renderMetric(type, context) {
  const stats = context.state?.systemStats ?? {};
  if (type === "cpu") return metricElement("CPU", stats.cpu?.usage, stats.cpu?.temperature ? `${stats.cpu.temperature}°C` : "—");
  if (type === "gpu") return stats.gpu ? metricElement("GPU", stats.gpu?.usage, stats.gpu?.temperature ? `${stats.gpu.temperature}°C` : (stats.gpu?.name ? "OK" : "—")) : "";
  if (type === "ram") return metricElement("RAM", stats.memory?.usage, gibibytes(stats.memory?.used));
  const down = dataRateParts(stats.network?.received);
  const up = dataRateParts(stats.network?.sent);
  return `<div class="saver-network"><div>${ringSvg(Math.min(100, ((Number(stats.network?.received) || 0) / (100 * 1024 * 1024)) * 100))}<span><small>↓</small><b>${down.value} ${down.unit}</b></span></div><div>${ringSvg(Math.min(100, ((Number(stats.network?.sent) || 0) / (100 * 1024 * 1024)) * 100))}<span><small>↑</small><b>${up.value} ${up.unit}</b></span></div></div>`;
}

function pcTelemetryAvailable(context) {
  const state = context.state ?? {};
  return context.offline !== true && state.adb === true;
}

function setText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}

function ringPercent(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp(numeric, 0, 100) : 0;
}

function ringLabel(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.round(clamp(numeric, 0, 100))}%` : "--%";
}

function updateRing(node, value) {
  if (!node) return;
  node.style.setProperty("--ring-value", String(ringPercent(value)));
  setText(node.querySelector("strong"), ringLabel(value));
}

function updateMetricNode(node, type, state) {
  const stats = state?.systemStats ?? {};
  if (type === "gpu" && !stats.gpu) {
    node.replaceChildren();
    return;
  }

  if (type === "network") {
    const network = stats.network ?? {};
    const down = dataRateParts(network.received);
    const up = dataRateParts(network.sent);
    const rings = node.querySelectorAll(".saver-ring");
    const labels = node.querySelectorAll(".saver-network b");
    if (rings.length < 2 || labels.length < 2) {
      node.innerHTML = renderMetric(type, { state });
      return;
    }
    updateRing(rings[0], Math.min(100, ((Number(network.received) || 0) / (100 * 1024 * 1024)) * 100));
    updateRing(rings[1], Math.min(100, ((Number(network.sent) || 0) / (100 * 1024 * 1024)) * 100));
    setText(labels[0], `${down.value} ${down.unit}`);
    setText(labels[1], `${up.value} ${up.unit}`);
    return;
  }

  const metric = node.querySelector(".saver-metric");
  if (!metric) {
    node.innerHTML = renderMetric(type, { state });
    return;
  }

  const values = {
    cpu: ["CPU", stats.cpu?.usage, stats.cpu?.temperature ? `${stats.cpu.temperature}°C` : "—"],
    gpu: ["GPU", stats.gpu?.usage, stats.gpu?.temperature ? `${stats.gpu.temperature}°C` : (stats.gpu?.name ? "OK" : "—")],
    ram: ["RAM", stats.memory?.usage, gibibytes(stats.memory?.used)]
  }[type];
  if (!values) return;
  updateRing(metric.querySelector(".saver-ring"), values[1]);
  setText(metric.querySelector("small"), values[0]);
  setText(metric.querySelector("b"), values[2]);
}

function renderForecast(weather) {
  return (weather?.daily ?? []).slice(0, 7).map((day) => {
    const [, symbol] = weatherInfo(day.code);
    return `<div class="screen-forecast-day"><b>${escapeHtml(formatDay(day.date))}</b><span>${escapeHtml(symbol)}</span><strong>${escapeHtml(day.max)}°</strong><small>${escapeHtml(day.min)}° · ${escapeHtml(day.rain)}%</small><small class="screen-sun-mini"><span>↑ ${escapeHtml(shortTime(day.sunrise))}</span><span>↓ ${escapeHtml(shortTime(day.sunset))}</span></small></div>`;
  }).join("");
}

function renderSunTimes(weather) {
  return (weather?.daily ?? []).slice(0, 7).map((day) => `<span><b>${escapeHtml(formatDay(day.date))}</b><i>↑ ${escapeHtml(shortTime(day.sunrise))}</i><i>↓ ${escapeHtml(shortTime(day.sunset))}</i></span>`).join("");
}

function eqBars(count = 4) {
  return "<i></i>".repeat(count);
}

function elementHtml(entry, context, config, profile) {
  const now = context.now ?? new Date();
  const weather = context.weather ?? demoWeather();
  const state = context.state ?? {};
  const clock = formatClock(now);
  const [weatherLabel, weatherSymbol] = weatherInfo(weather.current?.code);
  const battery = state.battery;
  const nowPlaying = state.nowPlaying;
  const display = getDisplayConfig(config);
  const widgets = profile.enabledWidgets ?? {};
  switch (entry.type) {
    case "clock":
      return `<time class="screen-clock"><span>${escapeHtml(clock.main)}</span>${entry.style?.seconds === false ? "" : `<small>${escapeHtml(clock.seconds)}</small>`}</time>`;
    case "analogClock": {
      const angles = analogAngles(now);
      return `<div class="screen-analog-clock" style="--hour-angle:${angles.hour}deg;--minute-angle:${angles.minute}deg;--second-angle:${angles.second}deg"><span class="analog-mark mark-12">12</span><span class="analog-mark mark-3">3</span><span class="analog-mark mark-6">6</span><span class="analog-mark mark-9">9</span><i class="analog-hand hour"></i><i class="analog-hand minute"></i><i class="analog-hand second"></i><b></b></div>`;
    }
    case "date":
      return `<span class="screen-date">${escapeHtml(formatDate(now))}</span>`;
    case "weatherNow":
      if (widgets.weather === false) return "";
      return `<div class="screen-weather-now"><span>${escapeHtml(weatherSymbol)}</span><strong>${escapeHtml(weather.current?.temperature ?? "--")}°</strong><div><b>${escapeHtml(weather.city ?? "Pogoda")}</b><small>${escapeHtml(weatherLabel)} · ODCZUWALNA ${escapeHtml(weather.current?.apparent ?? "--")}° · WIATR ${escapeHtml(weather.current?.wind ?? "--")} KM/H</small></div></div>`;
    case "forecast":
      if (widgets.weather === false) return "";
      return `<div class="screen-forecast">${renderForecast(weather)}</div>`;
    case "sunTimes":
      if (widgets.weather === false) return "";
      return `<div class="screen-sun-times">${renderSunTimes(weather)}</div>`;
    case "pcStatus":
      return `<span class="screen-chip ${state.adb ? "is-online" : ""}"><i></i>${state.adb ? "PC ONLINE" : "PC OFFLINE"}</span>`;
    case "power":
      if (!pcTelemetryAvailable(context)) return "";
      return `<span class="screen-chip screen-power">${battery ? `${battery.currentMa >= 0 ? "+" : ""}${battery.currentMa} mA` : "-- mA"}</span>`;
    case "battery":
      if (!pcTelemetryAvailable(context)) return "";
      return `<span class="screen-chip screen-battery">${battery ? `${battery.percent}%` : "--%"}</span>`;
    case "cpu":
    case "gpu":
    case "ram":
    case "network":
      if (widgets.telemetry === false || !pcTelemetryAvailable(context)) return "";
      return renderMetric(entry.type, context);
    case "nowPlaying":
      if (widgets.nowPlaying === false || display.showNowPlaying === false || !nowPlaying?.playing || !nowPlaying?.title) return "";
      return `<div class="screen-now-playing"><span class="eq saver-eq screen-now-eq ${nowPlaying?.playing ? "playing" : ""}" aria-hidden="true">${eqBars()}</span><span class="screen-now-copy"><b>TERAZ GRA</b><strong>${escapeHtml(nowPlaying?.title || "Nic nie gra")}</strong><span>${escapeHtml(nowPlaying?.artist || "Odtwarzacz jest w gotowości")}</span></span></div>`;
    case "visualizer":
      if (widgets.visualizer === false || display.visualizer?.enabled === false || display.showEqualizer === false || !nowPlaying?.playing || !nowPlaying?.title) return "";
      return `<span class="eq saver-eq screen-visualizer ${nowPlaying?.playing ? "playing" : ""}" aria-hidden="true">${eqBars()}</span>`;
    case "image":
      return entry.data?.src ? `<img class="screen-image" src="${escapeHtml(entry.data.src)}" alt="${escapeHtml(entry.label)}">` : `<div class="screen-image-placeholder">OBRAZ</div>`;
    case "shape":
      return entry.data?.text ? `<span class="screen-shape-label">${escapeHtml(entry.data.text)}</span>` : "";
    case "text":
    default:
      return `<span class="screen-text">${escapeHtml(entry.data?.text || entry.label || "Tekst")}</span>`;
  }
}

function renderElement(entry, context, config, profile) {
  const node = document.createElement("div");
  applyElementStyle(node, entry);
  if (entry.type === "shape") {
    node.classList.add(`shape-${entry.style?.shape || "rect"}`);
    if (entry.style?.fill) node.style.background = entry.style.fill;
  }
  node.innerHTML = elementHtml(entry, context, config, profile);
  return node;
}

function nodes(root, selector) {
  return Array.from(root.querySelectorAll(selector));
}

function cacheDynamicNodes(root) {
  root.__endoDynamicCache = {
    clocks: nodes(root, ".screen-element-clock .screen-clock"),
    dates: nodes(root, ".screen-element-date .screen-date"),
    analogs: nodes(root, ".screen-analog-clock"),
    pcChips: nodes(root, ".screen-element-pcStatus .screen-chip"),
    telemetryElements: nodes(root, ".screen-element-power, .screen-element-battery, .screen-element-cpu, .screen-element-gpu, .screen-element-ram, .screen-element-network"),
    powers: nodes(root, ".screen-element-power .screen-power"),
    batteries: nodes(root, ".screen-element-battery .screen-battery"),
    eqs: nodes(root, ".screen-now-eq, .screen-visualizer"),
    mediaElements: nodes(root, ".screen-element-nowPlaying, .screen-element-visualizer"),
    nowTitles: nodes(root, ".screen-now-copy strong"),
    nowArtists: nodes(root, ".screen-now-copy span"),
    metrics: {
      cpu: nodes(root, ".screen-element-cpu"),
      gpu: nodes(root, ".screen-element-gpu"),
      ram: nodes(root, ".screen-element-ram"),
      network: nodes(root, ".screen-element-network")
    }
  };
  return root.__endoDynamicCache;
}

export function renderScreensaver(root, profile, context = {}, options = {}) {
  if (!root) return;
  const config = context.config ?? {};
  const activeProfile = normalizeScreensaver(profile, config.accent ?? context.accent);
  const fullContext = {
    ...demoScreensaverContext(config.accent ?? activeProfile.theme?.accent),
    ...context,
    state: { ...demoScreensaverContext().state, ...(context.state ?? {}) },
    weather: context.weather ?? demoWeather(),
    now: context.now ?? new Date(),
    optimizeAnimations: options.optimizeAnimations === true || context.optimizeAnimations === true,
    motionState: options.motionState ?? context.motionState ?? "full",
    lightweight: options.lightweight === true || context.lightweight === true
  };
  applyRootTheme(root, activeProfile, fullContext, options);
  const stage = document.createElement("div");
  stage.className = "screen-stage";
  stage.replaceChildren(...activeProfile.elements
    .slice()
    .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    .map((entry) => renderElement(entry, fullContext, config, activeProfile)));
  root.replaceChildren(stage);
  cacheDynamicNodes(root);
  updateScreensaverProtection(root, activeProfile, { ...options, lightweight: fullContext.lightweight });
}

export function updateScreensaverDynamic(root, context = {}) {
  if (!root) return;
  if (context.config) applyMotionState(root, context.config, context);
  const cache = root.__endoDynamicCache ?? cacheDynamicNodes(root);
  const now = context.now ?? new Date();
  const clock = formatClock(now);
  for (const node of cache.clocks) {
    const main = node.querySelector("span");
    const seconds = node.querySelector("small");
    if (main && main.textContent !== clock.main) main.textContent = clock.main;
    if (seconds && seconds.textContent !== clock.seconds) seconds.textContent = clock.seconds;
  }
  const date = formatDate(now);
  for (const node of cache.dates) {
    if (node.textContent !== date) node.textContent = date;
  }
  if (context.lightweight === true) {
    for (const node of cache.analogs) {
      if (node.dataset.lightAnalog !== "1") setupLightAnalog(node, now);
    }
  } else {
    const angles = analogAngles(now);
    for (const node of cache.analogs) {
      const optimize = context.optimizeAnimations === true;
      const lastSync = Number(node.dataset.lastAnalogSync || 0);
      const needsSync = !optimize || !lastSync || now.getTime() - lastSync > 15_000;
      if (needsSync) {
        node.dataset.lastAnalogSync = String(now.getTime());
        node.style.setProperty("--hour-angle", `${angles.hour}deg`);
        node.style.setProperty("--minute-angle", `${angles.minute}deg`);
      }
      const secondAngle = continuousSecondAngle(node, angles.second);
      node.dataset.secondAngle = String(secondAngle);
      node.style.setProperty("--second-angle", `${secondAngle}deg`);
    }
  }

  if (!Object.prototype.hasOwnProperty.call(context, "state")) return;
  const state = context.state ?? {};
  const battery = state.battery;
  const nowPlaying = state.nowPlaying ?? {};
  const playing = Boolean(nowPlaying.playing && nowPlaying.title);
  const telemetryVisible = pcTelemetryAvailable(context);

  for (const node of cache.pcChips) {
    node.classList.toggle("is-online", Boolean(state.adb));
    node.innerHTML = `<i></i>${state.adb ? "PC ONLINE" : "PC OFFLINE"}`;
  }
  for (const node of cache.telemetryElements) {
    node.classList.toggle("screen-telemetry-hidden", !telemetryVisible);
  }
  if (telemetryVisible) {
    for (const node of cache.powers) {
      setText(node, battery ? `${battery.currentMa >= 0 ? "+" : ""}${battery.currentMa} mA` : "-- mA");
    }
    for (const node of cache.batteries) {
      setText(node, battery ? `${battery.percent}%` : "--%");
    }
  }
  for (const node of cache.eqs) {
    node.classList.toggle("playing", playing);
  }
  for (const node of cache.mediaElements) {
    node.classList.toggle("screen-media-hidden", !playing);
  }
  for (const node of cache.nowTitles) {
    setText(node, nowPlaying.title || "Nic nie gra");
  }
  for (const node of cache.nowArtists) {
    setText(node, nowPlaying.artist || "Odtwarzacz jest w gotowości");
  }
  if (telemetryVisible) {
    for (const type of ["cpu", "gpu", "ram", "network"]) {
      for (const node of cache.metrics[type]) updateMetricNode(node, type, state);
    }
  }
}
