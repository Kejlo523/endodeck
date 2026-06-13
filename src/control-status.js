import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getAudioStatus } from "./audio.js";

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
  const [processes, audio] = await Promise.all([
    runningProcesses().catch(() => new Set()),
    getAudioStatus().catch(() => ({ muted: false, microphoneMuted: false }))
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
    }
  }
  return controls;
}
