import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL("../scripts/audio-control.ps1", import.meta.url));

async function run(args) {
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args], {
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    encoding: "buffer"
  });
  const text = Buffer.isBuffer(stdout) ? stdout.toString("utf8") : String(stdout);
  return JSON.parse(text.replace(/^\uFEFF/, "").trim() || "{}");
}

export function getAudioSnapshot() {
  return run(["-Action", "list"]);
}

export function getOutputDevices() {
  return run(["-Action", "devices"]);
}

export function setDefaultOutputDevice(deviceId) {
  return run(["-Action", "set-default", "-DeviceId", String(deviceId)]);
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

export async function toggleProcessMute(processName) {
  const result = await run(["-Action", "process-toggle", "-ProcessName", String(processName)]);
  if (!result.available) throw new Error(`${processName} nie ma teraz aktywnej sesji audio`);
  return result;
}
