$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root '.endodeck.pid'
$logFile = Join-Path $root 'endodeck.log'
$svvFetch = Join-Path $PSScriptRoot 'fetch-soundvolumeview.ps1'
if ((Test-Path $svvFetch) -and -not (Test-Path (Join-Path $PSScriptRoot 'SoundVolumeView.exe'))) {
    & $svvFetch
}

if (Test-Path $pidFile) {
    $oldPid = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($oldPid -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
        exit 0
    }
}

$process = Start-Process -FilePath 'node.exe' -ArgumentList 'src/server.js' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $logFile -RedirectStandardError (Join-Path $root 'endodeck-error.log') -PassThru
$process.Id | Set-Content $pidFile
