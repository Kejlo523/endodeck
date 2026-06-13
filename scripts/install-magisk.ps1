$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
$packages = @(
    'EndoDeck-Power-Guard-Magisk.zip',
    'EndoDeck-Touch-Wake-Magisk.zip'
)

& (Join-Path $PSScriptRoot 'build-magisk.ps1') | Out-Null

foreach ($package in $packages) {
    $local = Join-Path (Join-Path $root 'dist') $package
    $remote = "/data/local/tmp/$package"
    & $adb push $local $remote | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to push $package" }
    & $adb shell su -c "magisk --install-module $remote"
    if ($LASTEXITCODE -ne 0) { throw "Magisk failed to install $package" }
}

Write-Output 'Modules installed. Reboot the phone to activate them.'
