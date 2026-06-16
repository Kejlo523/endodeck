import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { toggleMicrophoneMute, toggleProcessMute } from "./audio.js";
import { toggleLocalDevice } from "./local-devices.js";
import { scriptPath } from "./runtime-paths.js";

const execFileAsync = promisify(execFile);
const sendKeysScript = scriptPath("send-keys.ps1");

function resolveLaunch(action) {
  const alias = String(action.command || "").toLowerCase();
  if (/^https?:\/\//i.test(String(action.command || ""))) return { command: "explorer.exe", args: [action.command, ...(action.args ?? [])] };
  const local = process.env.LOCALAPPDATA || "";
  const roaming = process.env.APPDATA || "";
  const aliases = {
    discord: [
      { command: `${local}\\Discord\\Update.exe`, args: ["--processStart", "Discord.exe"] },
      { command: `${local}\\DiscordCanary\\Update.exe`, args: ["--processStart", "DiscordCanary.exe"] }
    ],
    spotify: [
      { command: `${roaming}\\Spotify\\Spotify.exe`, args: [] },
      { command: `${local}\\Microsoft\\WindowsApps\\Spotify.exe`, args: [] }
    ],
    vscode: [
      { command: `${local}\\Programs\\Microsoft VS Code\\Code.exe`, args: [] },
      { command: "code.cmd", args: [] }
    ]
  };
  const candidates = aliases[alias];
  if (!candidates) return { command: action.command, args: action.args ?? [] };
  const match = candidates.find((candidate) => !candidate.command.includes("\\") || existsSync(candidate.command));
  if (!match) throw new Error(`Nie znaleziono aplikacji: ${action.command}`);
  return { command: match.command, args: [...match.args, ...(action.args ?? [])] };
}

async function runKeyScript(codes, { holdMs = 50, extended = false } = {}) {
  const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", sendKeysScript, "-Keys", codes.join(","), "-HoldMs", String(holdMs)];
  if (extended) args.push("-Extended");
  await execFileAsync("powershell.exe", args, { windowsHide: true, timeout: 6000 });
}

const virtualKeys = {
  playPause: 0xB3,
  next: 0xB0,
  previous: 0xB1,
  volumeMute: 0xAD,
  volumeDown: 0xAE,
  volumeUp: 0xAF
};

const hotkeyCodes = {
  CTRL: 0x11,
  SHIFT: 0x10,
  ALT: 0x12,
  WIN: 0x5B,
  ENTER: 0x0D,
  ESC: 0x1B,
  SPACE: 0x20,
  TAB: 0x09,
  BACKSPACE: 0x08,
  DELETE: 0x2E,
  INSERT: 0x2D,
  HOME: 0x24,
  END: 0x23,
  PAGEUP: 0x21,
  PAGEDOWN: 0x22,
  UP: 0x26,
  DOWN: 0x28,
  LEFT: 0x25,
  RIGHT: 0x27
};

function keyCode(key) {
  const normalized = String(key).toUpperCase();
  if (hotkeyCodes[normalized]) return hotkeyCodes[normalized];
  if (/^[A-Z0-9]$/.test(normalized)) return normalized.charCodeAt(0);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(normalized)) return 0x6F + Number(normalized.slice(1));
  throw new Error(`Nieobsługiwany klawisz: ${key}`);
}

async function pressVirtualKeys(keys) {
  const codes = keys.map(keyCode);
  if (!codes.length) throw new Error("Skrót musi zawierać co najmniej jeden klawisz");
  await runKeyScript(codes, { holdMs: 45 });
}

// Globalny skrót systemowy: wysyła klawisze z ustawioną flagą rozszerzoną tam,
// gdzie to potrzebne, aby aplikacje z globalnymi hotkeyami (np. Discord)
// przechwyciły go niezależnie od fokusu i nawet gdy są zminimalizowane.
async function pressGlobalHotkey(keys) {
  const codes = keys.map(keyCode);
  if (!codes.length) throw new Error("Skrót globalny musi zawierać co najmniej jeden klawisz");
  await runKeyScript(codes, { holdMs: 60, extended: true });
}

async function pressProcessHotkey(processName, keys) {
  const codes = keys.map(keyCode);
  const down = codes.map((code) => `[DeckTarget]::keybd_event(${code},0,0,[UIntPtr]::Zero)`).join(";");
  const up = [...codes].reverse().map((code) => `[DeckTarget]::keybd_event(${code},0,2,[UIntPtr]::Zero)`).join(";");
  const safeName = String(processName).replace(/'/g, "''");
  const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class DeckTarget { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int cmd); [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr extra); }';$previous=[DeckTarget]::GetForegroundWindow();$target=Get-Process -Name '${safeName}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1;if(-not $target){throw 'Aplikacja ${safeName} nie jest uruchomiona'};[DeckTarget]::ShowWindowAsync($target.MainWindowHandle,9)|Out-Null;[DeckTarget]::SetForegroundWindow($target.MainWindowHandle)|Out-Null;Start-Sleep -Milliseconds 90;${down};Start-Sleep -Milliseconds 50;${up};Start-Sleep -Milliseconds 80;if($previous -ne [IntPtr]::Zero){[DeckTarget]::SetForegroundWindow($previous)|Out-Null}`;
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 6000 });
}

async function pressBackgroundProcessHotkey(processName, keys) {
  const codes = keys.map(keyCode);
  const modifierSet = new Set([0x10, 0x11, 0x12, 0x5B, 0x5C]);
  const modifiers = codes.filter((code) => modifierSet.has(code));
  const targetKeys = codes.filter((code) => !modifierSet.has(code));
  if (!targetKeys.length) throw new Error("Skrót aplikacji musi zawierać zwykły klawisz");
  const safeName = String(processName).replace(/'/g, "''");
  const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class DeckBackground { [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd,uint msg,IntPtr wParam,IntPtr lParam); [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code,uint mapType); [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra); public static IntPtr KeyData(int code,bool released){ long value=1|((long)MapVirtualKey((uint)code,0)<<16); if(released)value|=(1L<<30)|(1L<<31); return new IntPtr(value); } }';$target=Get-Process -Name '${safeName}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1;if(-not $target){throw 'Aplikacja ${safeName} nie jest uruchomiona'};$modifiers=@(${modifiers.join(",")});$targetKeys=@(${targetKeys.join(",")});try{foreach($code in $modifiers){[DeckBackground]::keybd_event($code,0,0,[UIntPtr]::Zero)};Start-Sleep -Milliseconds 35;foreach($code in $targetKeys){if(-not [DeckBackground]::PostMessage($target.MainWindowHandle,0x0100,[IntPtr]$code,[DeckBackground]::KeyData($code,$false))){throw 'Nie udało się wysłać skrótu do ${safeName}'}};Start-Sleep -Milliseconds 70;[array]::Reverse($targetKeys);foreach($code in $targetKeys){[DeckBackground]::PostMessage($target.MainWindowHandle,0x0101,[IntPtr]$code,[DeckBackground]::KeyData($code,$true))|Out-Null}}finally{[array]::Reverse($modifiers);foreach($code in $modifiers){[DeckBackground]::keybd_event($code,0,2,[UIntPtr]::Zero)}}`;
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 5000 });
}

async function pressMediaKey(name) {
  const code = virtualKeys[name];
  if (!code) throw new Error(`Nieobsługiwany klawisz multimedialny: ${name}`);
  const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class DeckMedia { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr extra); }';[DeckMedia]::keybd_event(${code},0,0,[UIntPtr]::Zero);Start-Sleep -Milliseconds 40;[DeckMedia]::keybd_event(${code},0,2,[UIntPtr]::Zero)`;
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 5000 });
}

export async function executeAction(action, context) {
  switch (action.type) {
    case "page":
      return { page: action.page };
    case "media":
      await pressMediaKey(action.key);
      return {};
    case "hotkey":
      await pressVirtualKeys(action.keys ?? []);
      return {};
    case "globalHotkey":
      await pressGlobalHotkey(action.keys ?? []);
      return {};
    case "processHotkey":
      await pressProcessHotkey(action.process, action.keys ?? []);
      return {};
    case "backgroundProcessHotkey":
      await pressBackgroundProcessHotkey(action.process, action.keys ?? []);
      return {};
    case "microphoneMute":
      return toggleMicrophoneMute();
    case "processAudioMute":
      return toggleProcessMute(action.process);
    case "localDeviceToggle":
      return toggleLocalDevice(action.device);
    case "launch": {
      const launch = resolveLaunch(action);
      const child = spawn(launch.command, launch.args, { detached: true, stdio: "ignore", windowsHide: false });
      child.unref();
      return {};
    }
    case "command": {
      await execFileAsync(action.command, action.args ?? [], { windowsHide: true, timeout: action.timeout ?? 15000 });
      return {};
    }
    case "sequence":
      for (const nestedAction of action.actions ?? []) {
        await executeAction(nestedAction, context);
        await new Promise((resolve) => setTimeout(resolve, action.delay ?? 180));
      }
      return {};
    case "audioSource":
      return {};
    default:
      throw new Error(`Nieznany typ akcji: ${action.type}`);
  }
}
