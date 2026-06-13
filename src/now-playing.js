import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL("../scripts/now-playing.ps1", import.meta.url));

const EMPTY = { title: "", artist: "", album: "", status: "Stopped", source: "", playing: false };

let cache = { ...EMPTY };
let cacheTime = 0;
let inFlight = null;

function normalize(raw) {
  if (!raw || typeof raw !== "object" || !raw.title) return { ...EMPTY };
  return {
    title: String(raw.title ?? "").trim(),
    artist: String(raw.artist ?? "").trim(),
    album: String(raw.album ?? "").trim(),
    status: String(raw.status ?? "Stopped"),
    source: String(raw.source ?? ""),
    playing: Boolean(raw.playing)
  };
}

async function query() {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
    { windowsHide: true, timeout: 6000, maxBuffer: 256 * 1024, encoding: "buffer" }
  );
  const text = Buffer.isBuffer(stdout) ? stdout.toString("utf8") : String(stdout);
  return normalize(JSON.parse(text.replace(/^\uFEFF/, "").trim() || "{}"));
}

// Lekki cache: SMTC odpytujemy najwyżej raz na ~1,5 s, by nie mnożyć procesów
// PowerShell, gdy front i pętla statusu pytają niemal jednocześnie.
export async function getNowPlaying() {
  const now = Date.now();
  if (now - cacheTime < 1500) return cache;
  if (inFlight) return inFlight;
  inFlight = query()
    .then((value) => {
      cache = value;
      cacheTime = Date.now();
      return value;
    })
    .catch(() => cache)
    .finally(() => { inFlight = null; });
  return inFlight;
}
