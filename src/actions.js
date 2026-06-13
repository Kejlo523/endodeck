import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { toggleMicrophoneMute } from "./audio.js";

const execFileAsync = promisify(execFile);

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
  const down = codes.map((code) => `[DeckKeys]::keybd_event(${code},0,0,[UIntPtr]::Zero)`).join(";");
  const up = [...codes].reverse().map((code) => `[DeckKeys]::keybd_event(${code},0,2,[UIntPtr]::Zero)`).join(";");
  const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class DeckKeys { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr extra); }';${down};Start-Sleep -Milliseconds 45;${up}`;
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 5000 });
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
  const codeList = codes.join(",");
  const safeName = String(processName).replace(/'/g, "''");
  const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class DeckBackground { [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd,uint msg,IntPtr wParam,IntPtr lParam); [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code,uint mapType); public static IntPtr KeyData(int code,bool released){ long value=1|((long)MapVirtualKey((uint)code,0)<<16); if(released)value|=(1L<<30)|(1L<<31); return new IntPtr(value); } }';$target=Get-Process -Name '${safeName}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1;if(-not $target){throw 'Aplikacja ${safeName} nie jest uruchomiona'};$codes=@(${codeList});foreach($code in $codes){if(-not [DeckBackground]::PostMessage($target.MainWindowHandle,0x0100,[IntPtr]$code,[DeckBackground]::KeyData($code,$false))){throw 'Nie udało się wysłać skrótu do ${safeName}'}};Start-Sleep -Milliseconds 55;[array]::Reverse($codes);foreach($code in $codes){[DeckBackground]::PostMessage($target.MainWindowHandle,0x0101,[IntPtr]$code,[DeckBackground]::KeyData($code,$true))|Out-Null}`;
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
    case "processHotkey":
      await pressProcessHotkey(action.process, action.keys ?? []);
      return {};
    case "backgroundProcessHotkey":
      await pressBackgroundProcessHotkey(action.process, action.keys ?? []);
      return {};
    case "microphoneMute":
      return toggleMicrophoneMute();
    case "launch": {
      const child = spawn(action.command, action.args ?? [], { detached: true, stdio: "ignore", windowsHide: false });
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
    default:
      throw new Error(`Nieznany typ akcji: ${action.type}`);
  }
}
