$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'magisk'
$dist = Join-Path $root 'dist'

Add-Type -AssemblyName System.IO.Compression.FileSystem
New-Item -ItemType Directory -Path $dist -Force | Out-Null

$modules = @{
    'endodeck-power-guard' = 'EndoDeck-Power-Guard-Magisk.zip'
    'endodeck-touch-wake' = 'EndoDeck-Touch-Wake-Magisk.zip'
}

foreach ($entry in $modules.GetEnumerator()) {
    $modulePath = Join-Path $source $entry.Key
    $zipPath = Join-Path $dist $entry.Value
    if (Test-Path $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
    [System.IO.Compression.ZipFile]::CreateFromDirectory($modulePath, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
    Write-Output $zipPath
}
