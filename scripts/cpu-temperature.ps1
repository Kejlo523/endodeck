function Read-Temp([double]$Value) {
  $n = [math]::Round($Value)
  if ($n -ge 10 -and $n -le 120) { return $n }
  return $null
}

$s = Get-CimInstance -Namespace root\LibreHardwareMonitor -ClassName Sensor -ErrorAction SilentlyContinue |
  Where-Object { $_.SensorType -eq 'Temperature' -and $_.Identifier -match '/cpu/' -and $_.Name -match 'Package|Core Average|Tctl|Tdie|CPU' } |
  Sort-Object Value -Descending | Select-Object -First 1
if ($s) {
  $t = Read-Temp $s.Value
  if ($t) { Write-Output $t; exit 0 }
}

$s = Get-CimInstance -Namespace root\OpenHardwareMonitor -ClassName Sensor -ErrorAction SilentlyContinue |
  Where-Object { $_.SensorType -eq 'Temperature' -and $_.Identifier -match '/cpu/' } |
  Sort-Object Value -Descending | Select-Object -First 1
if ($s) {
  $t = Read-Temp $s.Value
  if ($t) { Write-Output $t; exit 0 }
}

$temps = [System.Collections.Generic.List[int]]::new()
Get-CimInstance Win32_PerfFormattedData_Counters_ThermalZoneInformation -ErrorAction SilentlyContinue |
  Where-Object { $_.HighPrecisionTemperature -gt 0 } |
  ForEach-Object {
    $c = [math]::Round($_.HighPrecisionTemperature / 10 - 273.15)
    if ($c -ge 10 -and $c -le 120) { [void]$temps.Add($c) }
  }
if ($temps.Count -gt 0) {
  Write-Output ($temps | Measure-Object -Maximum).Maximum
  exit 0
}

Get-CimInstance -Namespace root\wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue |
  ForEach-Object {
    $c = [math]::Round($_.CurrentTemperature / 10 - 273.15)
    if ($c -ge 10 -and $c -le 120) { [void]$temps.Add($c) }
  }
if ($temps.Count -gt 0) {
  Write-Output ($temps | Measure-Object -Maximum).Maximum
}
