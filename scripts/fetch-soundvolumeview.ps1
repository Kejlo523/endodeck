$ErrorActionPreference = 'Stop'
$dest = Join-Path $PSScriptRoot 'SoundVolumeView.exe'
if (Test-Path $dest) { exit 0 }
$zip = Join-Path $env:TEMP 'soundvolumeview-x64.zip'
$folder = Join-Path $env:TEMP 'soundvolumeview-x64'
Invoke-WebRequest -Uri 'https://www.nirsoft.net/utils/soundvolumeview-x64.zip' -OutFile $zip -UseBasicParsing
Expand-Archive -Path $zip -DestinationPath $folder -Force
Copy-Item (Join-Path $folder 'SoundVolumeView.exe') $dest -Force
