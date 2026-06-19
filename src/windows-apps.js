import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { dataPath, scriptPath } from "./runtime-paths.js";

const execFileAsync = promisify(execFile);
const listAppsScript = scriptPath("list-windows-apps.ps1");
const appsCachePath = dataPath("apps-cache.json");
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60_000;
const DEFAULT_SCAN_TIMEOUT_MS = 45_000;
let cache = { at: 0, apps: [] };

function splitWindowsArgs(value) {
  const matches = String(value).match(/"[^"]*"|\S+/g) ?? [];
  return matches.map((entry) => entry.replace(/^"|"$/g, ""));
}

function positiveNumber(value, fallback, minimum = 1000) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum ? number : fallback;
}

function normalizeApp(app) {
  const name = String(app?.name ?? "").trim().replace(/\.lnk$/i, "");
  const command = String(app?.command ?? "").trim();
  if (!name || !command) return null;
  const args = Array.isArray(app?.args)
    ? app.args.map((entry) => String(entry).trim()).filter(Boolean)
    : splitWindowsArgs(String(app?.args ?? "").trim());
  return {
    id: `${name}|${command}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 96),
    name: name.slice(0, 80),
    command,
    args,
    source: String(app?.source ?? "unknown")
  };
}

async function loadDiskCache() {
  try {
    const raw = JSON.parse(await readFile(appsCachePath, "utf8"));
    const apps = (Array.isArray(raw.apps) ? raw.apps : []).map(normalizeApp).filter(Boolean);
    const at = Number(raw.at) || 0;
    if (!apps.length || !at) return null;
    cache = { at, apps };
    return cache;
  } catch {
    return null;
  }
}

async function saveDiskCache(apps) {
  try {
    await mkdir(dirname(appsCachePath), { recursive: true });
    const payload = { schemaVersion: 1, at: Date.now(), apps };
    await writeFile(appsCachePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    cache = { at: payload.at, apps };
  } catch {
    cache = { at: Date.now(), apps };
  }
}

export async function listInstalledApps({ force = false, cacheTtlMs = DEFAULT_CACHE_TTL_MS, scanTimeoutMs = DEFAULT_SCAN_TIMEOUT_MS } = {}) {
  const ttl = positiveNumber(cacheTtlMs, DEFAULT_CACHE_TTL_MS, 60_000);
  const timeout = positiveNumber(scanTimeoutMs, DEFAULT_SCAN_TIMEOUT_MS, 5000);
  const now = Date.now();
  if (!force && cache.apps.length && now - cache.at < ttl) return cache.apps;
  const diskCache = await loadDiskCache();
  if (!force && diskCache?.apps.length && now - diskCache.at < ttl) return diskCache.apps;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", listAppsScript],
      { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 }
    );
    const raw = stdout.trim() ? JSON.parse(stdout) : [];
    const apps = (Array.isArray(raw) ? raw : [raw]).map(normalizeApp).filter(Boolean);
    await saveDiskCache(apps);
    return apps;
  } catch {
    return diskCache?.apps.length ? diskCache.apps : cache.apps;
  }
}
