import { execFile } from "node:child_process";
import { cpus, freemem, totalmem } from "node:os";
import { promisify } from "node:util";
import { scriptPath } from "./runtime-paths.js";

const execFileAsync = promisify(execFile);
const cpuTemperatureScript = scriptPath("cpu-temperature.ps1");
let previousCpu = cpuTimes();
let cpuTemperatureCache = { at: 0, value: null };

function cpuTimes() {
  return cpus().reduce((result, cpu) => {
    const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
    result.idle += cpu.times.idle;
    result.total += total;
    return result;
  }, { idle: 0, total: 0 });
}

function cpuUsage() {
  const current = cpuTimes();
  const idle = current.idle - previousCpu.idle;
  const total = current.total - previousCpu.total;
  previousCpu = current;
  return total > 0 ? Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100))) : 0;
}

async function cpuTemperature() {
  if (Date.now() - cpuTemperatureCache.at < 60_000) return cpuTemperatureCache.value;
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", cpuTemperatureScript], { windowsHide: true, timeout: 3500 });
    const value = Number(stdout.trim());
    cpuTemperatureCache = { at: Date.now(), value: Number.isFinite(value) && value > 0 ? value : null };
  } catch { cpuTemperatureCache = { at: Date.now(), value: null }; }
  return cpuTemperatureCache.value;
}

async function gpuStats() {
  try {
    const { stdout } = await execFileAsync("nvidia-smi.exe", ["--query-gpu=temperature.gpu,utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"], { windowsHide: true, timeout: 3000 });
    const [temperature, usage, memoryUsed, memoryTotal] = stdout.trim().split(",").map((value) => Number(value.trim()));
    return { name: "NVIDIA GPU", provider: "nvidia-smi", temperature, usage, memoryUsed, memoryTotal };
  } catch {}

  const script = `
    $gpu = Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -and $_.Name -notmatch 'Microsoft Basic|Remote' } |
      Select-Object -First 1
    if (-not $gpu) { return }
    $samples = (Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction SilentlyContinue).CounterSamples |
      Where-Object { $_.Path -match 'engtype_(3d|compute|graphics)' }
    $usage = [Math]::Min(100, [Math]::Round((($samples | Measure-Object CookedValue -Sum).Sum)))
    [pscustomobject]@{
      name = $gpu.Name
      usage = $usage
      memoryTotal = [int64]$gpu.AdapterRAM
      provider = 'windows-performance'
    } | ConvertTo-Json -Compress
  `;
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 4500 });
    const parsed = stdout.trim() ? JSON.parse(stdout) : null;
    if (!parsed?.name || !Number.isFinite(Number(parsed.usage))) return null;
    return {
      name: parsed.name,
      provider: parsed.provider,
      temperature: null,
      usage: Math.max(0, Math.min(100, Number(parsed.usage))),
      memoryUsed: null,
      memoryTotal: Number(parsed.memoryTotal) || null
    };
  } catch { return null; }
}

async function networkStats() {
  const script = "$n=Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface -ErrorAction SilentlyContinue|Where-Object{$_.Name -notmatch 'Loopback|isatap|Teredo'};$rx=($n|Measure-Object BytesReceivedPersec -Sum).Sum;$tx=($n|Measure-Object BytesSentPersec -Sum).Sum;Write-Output \"$rx|$tx\"";
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 3500 });
    const [received, sent] = stdout.trim().split("|").map(Number);
    return { received: received || 0, sent: sent || 0 };
  } catch { return { received: 0, sent: 0 }; }
}

export async function getSystemStats() {
  const memoryTotal = totalmem();
  const memoryUsed = memoryTotal - freemem();
  const [cpuTemp, gpu, network] = await Promise.all([
    cpuTemperature(),
    gpuStats(),
    networkStats()
  ]);
  return {
    cpu: { usage: cpuUsage(), temperature: cpuTemp },
    gpu,
    memory: { used: memoryUsed, total: memoryTotal, usage: Math.round(memoryUsed / memoryTotal * 100) },
    network,
    updatedAt: Date.now()
  };
}
