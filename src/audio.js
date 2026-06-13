import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL("../scripts/audio-control.ps1", import.meta.url));

async function run(args) {
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args], {
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 1024 * 1024
  });
  return JSON.parse(stdout.trim() || "{}");
}

export function getAudioSnapshot() {
  return run(["-Action", "list"]);
}

export function setMasterVolume(volume) {
  return run(["-Action", "master", "-Volume", String(volume)]);
}

export function setSessionVolume(sessionId, volume) {
  return run(["-Action", "session", "-SessionId", String(sessionId), "-Volume", String(volume)]);
}

export function getAudioStatus() {
  return run(["-Action", "status"]);
}

export function toggleMicrophoneMute() {
  return run(["-Action", "microphone-toggle"]);
}
