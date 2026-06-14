$ErrorActionPreference = 'Stop'
$dest = Join-Path $PSScriptRoot 'nircmd.exe'
if (Test-Path $dest) { exit 0 }
$zip = Join-Path $env:TEMP 'nircmd-x64.zip'
$folder = Join-Path $env:TEMP 'nircmd-x64'
Invoke-WebRequest -Uri 'https://www.nirsoft.net/utils/nircmd-x64.zip' -OutFile $zip -UseBasicParsing
Expand-Archive -Path $zip -DestinationPath $folder -Force
Copy-Item (Join-Path $folder 'nircmd.exe') $dest -Force
