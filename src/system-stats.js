import { execFile } from "node:child_process";
import { cpus, freemem, totalmem } from "node:os";
import { readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const projectsRoot = dirname(projectRoot);
let previousCpu = cpuTimes();
let projectCache = { at: 0, value: [] };
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
  const script = "$s=Get-CimInstance -Namespace root\\LibreHardwareMonitor -ClassName Sensor -ErrorAction SilentlyContinue|Where-Object{$_.SensorType -eq 'Temperature' -and $_.Identifier -match '/cpu/' -and $_.Name -match 'Package|Core Average'}|Sort-Object Value -Descending|Select-Object -First 1;if($s){[math]::Round($s.Value)}";
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 2500 });
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

async function projectStats() {
  if (Date.now() - projectCache.at < 30_000) return projectCache.value;
  const entries = await readdir(projectsRoot, { withFileTypes: true }).catch(() => []);
  const repositories = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(projectsRoot, entry.name);
    if (!(await stat(join(path, ".git")).catch(() => null))) continue;
    try {
      const [{ stdout: branch }, { stdout: statusText }] = await Promise.all([
        execFileAsync("git.exe", ["-C", path, "branch", "--show-current"], { windowsHide: true, timeout: 2500 }),
        execFileAsync("git.exe", ["-C", path, "status", "--porcelain"], { windowsHide: true, timeout: 3500 })
      ]);
      const dirty = statusText.split(/\r?\n/).filter(Boolean).length;
      repositories.push({ name: entry.name, branch: branch.trim() || "detached", dirty, clean: dirty === 0 });
    } catch { }
  }
  projectCache = { at: Date.now(), value: repositories.slice(0, 3) };
  return projectCache.value;
}

export async function getSystemStats() {
  const memoryTotal = totalmem();
  const memoryUsed = memoryTotal - freemem();
  const [cpuTemp, gpu, network, projects] = await Promise.all([
    cpuTemperature(),
    gpuStats(),
    networkStats(),
    projectStats()
  ]);
  return {
    cpu: { usage: cpuUsage(), temperature: cpuTemp },
    gpu,
    memory: { used: memoryUsed, total: memoryTotal, usage: Math.round(memoryUsed / memoryTotal * 100) },
    network,
    projects,
    updatedAt: Date.now()
  };
}
