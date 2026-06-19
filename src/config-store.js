import { access, copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { dataDir, dataPath, projectRoot, resourcePath } from "./runtime-paths.js";

const CURRENT_SCHEMA = 1;
const configPath = dataPath("config.json");
const backupDir = dataPath("backups");
let cached;
let cachedMtime = -1;

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

function migrate(config) {
  const next = structuredClone(config ?? {});
  next.schemaVersion = CURRENT_SCHEMA;
  next.port = Number(next.port) || 8765;
  next.accent = typeof next.accent === "string" ? next.accent : "#b7f34a";
  next.title = typeof next.title === "string" ? next.title : "ENDO DECK";
  next.ui = {
    dimAfterSeconds: 90,
    screensaverAfterSeconds: 300,
    showNowPlaying: true,
    showEqualizer: true,
    screensaverBrightness: { night: 6, twilight: 9, day: 13, offlineNight: 5, offlineDay: 10 },
    nightStandby: { enabled: true, start: "00:00", end: "07:00" },
    ...(next.ui ?? {})
  };
  next.ui.screensaverBrightness = {
    night: 6,
    twilight: 9,
    day: 13,
    offlineNight: 5,
    offlineDay: 10,
    ...(next.ui.screensaverBrightness ?? {})
  };
  next.ui.nightStandby = {
    enabled: true,
    start: "00:00",
    end: "07:00",
    ...(next.ui.nightStandby ?? {})
  };
  next.device = { serial: null, profile: "generic", apkVariant: "universal", modulesPending: false, ...(next.device ?? {}) };
  next.updates = { channel: "beta", automaticDesktop: true, automaticApk: true, ...(next.updates ?? {}) };
  next.runtime = {
    appsCacheTtlMs: 24 * 60 * 60_000,
    appsScanTimeoutMs: 45_000,
    adbPollMs: 4000,
    controlPollMs: 2200,
    statsPollMs: 4000,
    desktopUpdateDelayMs: 15_000,
    desktopUpdatePollMs: 60_000,
    phoneUpdateDelayMs: 60_000,
    phoneUpdatePollMs: 6 * 60 * 60_000,
    ...(next.runtime ?? {})
  };
  return next;
}

export function validateConfig(config) {
  if (!config || typeof config !== "object" || !config.pages || typeof config.pages !== "object") throw new Error("Nieprawidłowa konfiguracja");
  for (const [pageName, page] of Object.entries(config.pages)) {
    if (!pageName || !page || !Array.isArray(page.buttons)) throw new Error("Nieprawidłowa strona przycisków");
    for (const button of page.buttons) {
      if (!button.id || !button.label || !button.action?.type) throw new Error("Każdy przycisk musi mieć ID, nazwę i akcję");
    }
  }
}

async function rotateBackups() {
  await mkdir(backupDir, { recursive: true });
  for (let index = 4; index >= 1; index -= 1) {
    const source = join(backupDir, `config.${index}.json`);
    const target = join(backupDir, `config.${index + 1}.json`);
    if (await exists(source)) await rename(source, target).catch(() => {});
  }
  if (await exists(configPath)) await copyFile(configPath, join(backupDir, "config.1.json"));
}

async function atomicWrite(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export async function initializeConfigStore() {
  await mkdir(dataDir, { recursive: true });
  await mkdir(backupDir, { recursive: true });
  if (!(await exists(configPath))) {
    const legacy = join(projectRoot, "config.json");
    const source = await exists(legacy) ? legacy : resourcePath("resources", "default-config.json");
    const initial = migrate(JSON.parse(await readFile(source, "utf8")));
    validateConfig(initial);
    await atomicWrite(configPath, initial);
    await writeFile(dataPath("migration.json"), `${JSON.stringify({ source: basename(source), migratedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  }
  return loadConfig(true);
}

export async function loadConfig(force = false) {
  const info = await stat(configPath);
  if (!force && cached && info.mtimeMs === cachedMtime) return cached;
  const next = migrate(JSON.parse(await readFile(configPath, "utf8")));
  validateConfig(next);
  cached = next;
  cachedMtime = info.mtimeMs;
  return cached;
}

export async function saveConfig(nextConfig) {
  const current = await loadConfig();
  const next = migrate(nextConfig);
  next.port = current.port;
  validateConfig(next);
  await rotateBackups();
  await atomicWrite(configPath, next);
  cached = next;
  cachedMtime = (await stat(configPath)).mtimeMs;
  return cached;
}

export function getConfigPath() {
  return configPath;
}
