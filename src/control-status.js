import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getAudioSnapshot } from "./audio.js";
import { getTuyaStates } from "./tuya.js";

const execFileAsync = promisify(execFile);

function configuredProcesses(config) {
  const names = new Set();
  for (const page of Object.values(config.pages ?? {})) {
    for (const button of page.buttons ?? []) {
      if (button.status?.type === "process" && button.status.process) names.add(String(button.status.process).toLowerCase());
    }
  }
  return names;
}

function configuredTuyaDevices(config) {
  const aliases = new Set();
  for (const page of Object.values(config.pages ?? {})) {
    for (const button of page.buttons ?? []) {
      if (button.status?.type === "tuya" && button.status.device) aliases.add(String(button.status.device));
    }
  }
  return [...aliases];
}

async function runningProcesses() {
  const { stdout } = await execFileAsync("tasklist.exe", ["/FO", "CSV", "/NH"], { windowsHide: true, timeout: 5000 });
  const result = new Set();
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^"([^"]+)"/);
    if (match) result.add(match[1].replace(/\.exe$/i, "").toLowerCase());
  }
  return result;
}

export async function getControlStates(config) {
  const [processes, audio, tuya] = await Promise.all([
    runningProcesses().catch(() => new Set()),
    getAudioSnapshot().catch(() => ({ muted: false, microphoneMuted: false, sessions: [] })),
    getTuyaStates(configuredTuyaDevices(config)).catch(() => ({}))
  ]);
  const wanted = configuredProcesses(config);
  const processState = Object.fromEntries([...wanted].map((name) => [name, processes.has(name)]));
  const controls = {};

  for (const page of Object.values(config.pages ?? {})) {
    for (const button of page.buttons ?? []) {
      const status = button.status;
      if (!status) continue;
      if (status.type === "process") controls[button.id] = { active: Boolean(processState[String(status.process).toLowerCase()]), source: "process" };
      if (status.type === "microphoneMute") controls[button.id] = { active: Boolean(audio.microphoneMuted), source: "windows-audio" };
      if (status.type === "masterMute") controls[button.id] = { active: Boolean(audio.muted), source: "windows-audio" };
      if (status.type === "processAudioMute") {
        const processName = String(status.process).toLowerCase();
        const sessions = (audio.sessions ?? []).filter((session) => String(session.process).toLowerCase() === processName);
        controls[button.id] = { active: sessions.length > 0 && sessions.every((session) => session.muted), available: sessions.length > 0, source: "windows-audio" };
      }
      if (status.type === "tuya") controls[button.id] = tuya[String(status.device)] ?? { active: false, available: false, source: "tuya" };
    }
  }
  return controls;
}
