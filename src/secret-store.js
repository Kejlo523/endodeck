import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dataDir, dataPath } from "./runtime-paths.js";

const storePath = dataPath("secrets.json");
const keyPath = dataPath("secret.key");
let cache;

async function electronSafeStorage() {
  try {
    const electron = await import("electron");
    if (electron.safeStorage?.isEncryptionAvailable()) return electron.safeStorage;
  } catch {}
  return null;
}

async function fallbackKey() {
  try { return Buffer.from((await readFile(keyPath, "utf8")).trim(), "base64"); }
  catch {
    const key = randomBytes(32);
    await writeFile(keyPath, key.toString("base64"), { encoding: "utf8", mode: 0o600 });
    return key;
  }
}

async function protect(value) {
  const safeStorage = await electronSafeStorage();
  if (safeStorage) return { mode: "dpapi", value: safeStorage.encryptString(value).toString("base64") };
  const key = await fallbackKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { mode: "aes-gcm", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64") };
}

async function unprotect(entry) {
  if (!entry) return "";
  if (entry.mode === "dpapi") {
    const safeStorage = await electronSafeStorage();
    if (!safeStorage) throw new Error("Magazyn DPAPI jest niedostępny poza aplikacją EndoDeck");
    return safeStorage.decryptString(Buffer.from(entry.value, "base64"));
  }
  const payload = Buffer.from(entry.value, "base64");
  const key = await fallbackKey();
  const decipher = createDecipheriv("aes-256-gcm", key, payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(12, 28));
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8");
}

async function loadStore() {
  if (cache) return cache;
  await mkdir(dataDir, { recursive: true });
  try { cache = JSON.parse(await readFile(storePath, "utf8")); }
  catch { cache = {}; }
  return cache;
}

export async function getSecret(name) {
  return unprotect((await loadStore())[name]);
}

export async function hasSecret(name) {
  return Boolean((await loadStore())[name]);
}

export async function setSecret(name, value) {
  const store = await loadStore();
  if (!value) delete store[name];
  else store[name] = await protect(String(value));
  await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}
