import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
let cache = { at: 0, apps: [] };

function normalizeApp(app) {
  const name = String(app?.name ?? "").trim().replace(/\.lnk$/i, "");
  const command = String(app?.command ?? "").trim();
  if (!name || !command) return null;
  const args = String(app?.args ?? "").trim();
  return {
    id: `${name}|${command}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 96),
    name: name.slice(0, 80),
    command,
    args: args ? splitWindowsArgs(args) : [],
    source: String(app?.source ?? "start-menu")
  };
}

function splitWindowsArgs(value) {
  const matches = String(value).match(/"[^"]*"|\S+/g) ?? [];
  return matches.map((entry) => entry.replace(/^"|"$/g, ""));
}

export async function listInstalledApps({ force = false } = {}) {
  if (!force && Date.now() - cache.at < 5 * 60_000) return cache.apps;
  const script = `
    $ErrorActionPreference = 'SilentlyContinue'
    $roots = @(
      "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs",
      "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs"
    ) | Where-Object { $_ -and (Test-Path $_) }
    $shell = New-Object -ComObject WScript.Shell
    $items = foreach ($root in $roots) {
      Get-ChildItem -LiteralPath $root -Recurse -Filter *.lnk | ForEach-Object {
        $shortcut = $shell.CreateShortcut($_.FullName)
        if ($shortcut.TargetPath) {
          [pscustomobject]@{
            name = $_.BaseName
            command = $shortcut.TargetPath
            args = $shortcut.Arguments
            source = 'start-menu'
          }
        }
      }
    }
    $items | Sort-Object name -Unique | ConvertTo-Json -Depth 4
  `;
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 8000, maxBuffer: 2 * 1024 * 1024 });
    const raw = stdout.trim() ? JSON.parse(stdout) : [];
    const apps = (Array.isArray(raw) ? raw : [raw]).map(normalizeApp).filter(Boolean);
    cache = { at: Date.now(), apps };
    return apps;
  } catch {
    cache = { at: Date.now(), apps: [] };
    return [];
  }
}
