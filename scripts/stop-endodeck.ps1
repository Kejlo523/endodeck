$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root '.endodeck.pid'
if (Test-Path $pidFile) {
    $deckPid = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($deckPid) { Stop-Process -Id $deckPid -Force -ErrorAction SilentlyContinue }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

$listener = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
}

$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
if (Test-Path $adb) {
    & $adb reverse --remove tcp:8765 2>$null
    & $adb shell am force-stop pl.endozero.endodeck 2>$null
    & $adb shell settings put global stay_on_while_plugged_in 0 2>$null
}
