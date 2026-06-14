import { execFile } from "node:child_process";
import { cpus, freemem, totalmem } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const cpuTemperatureScript = fileURLToPath(new URL("../scripts/cpu-temperature.ps1", import.meta.url));
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
    return { temperature, usage, memoryUsed, memoryTotal };
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
