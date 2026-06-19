$ErrorActionPreference = 'SilentlyContinue'

$results = New-Object System.Collections.Generic.List[object]
$seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)

function Should-SkipExe([System.IO.FileInfo]$File) {
    $name = $File.BaseName
    $path = $File.FullName
    if ($name -match '^(uninst|unins|setup|crashpad|elevated|helper|Update|updater)$') { return $true }
    if ($path -match '\\(Update|Installer|uninstall|node_modules|\.git|WinSxS|Microsoft\.NET)\\') { return $true }
    return $false
}

function Resolve-ExePath([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    $candidate = ($Value -split ',')[0].Trim().Trim('"')
    if ($candidate -like '*.exe' -and (Test-Path -LiteralPath $candidate)) { return $candidate }
    return $null
}

function Add-App([string]$Name, [string]$Command, [string]$Args, [string]$Source) {
    if ([string]::IsNullOrWhiteSpace($Name) -or [string]::IsNullOrWhiteSpace($Command)) { return }
    $key = $Command.ToLowerInvariant()
    if ($seen.Contains($key)) { return }
    if ($Command -notlike '*.exe' -and $Command -ne 'explorer.exe') { return }
    if ($Command -like '*.exe' -and -not (Test-Path -LiteralPath $Command)) { return }
    [void]$seen.Add($key)
    $cleanName = ($Name.Trim() -replace '\.lnk$', '')
    if ($cleanName.Length -gt 80) { $cleanName = $cleanName.Substring(0, 80) }
    [void]$results.Add([pscustomobject]@{
        name = $cleanName
        command = $Command
        args = if ($Args) { $Args } else { '' }
        source = $Source
    })
}

function Add-ExeFile([System.IO.FileInfo]$File, [string]$Source, [string]$DisplayName = '') {
    if (-not $File -or -not $File.Exists) { return }
    if (Should-SkipExe $File) { return }
    $name = if ($DisplayName) { $DisplayName } else { $File.BaseName }
    Add-App $name $File.FullName '' $Source
}

$shell = New-Object -ComObject WScript.Shell
$shortcutRoots = @(
    "$env:APPDATA\Microsoft\Windows\Start Menu",
    "$env:ProgramData\Microsoft\Windows\Start Menu",
    [Environment]::GetFolderPath('Desktop'),
    [Environment]::GetFolderPath('CommonDesktopDirectory')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

foreach ($root in $shortcutRoots) {
    Get-ChildItem -LiteralPath $root -Recurse -Filter '*.lnk' -File -ErrorAction SilentlyContinue | ForEach-Object {
        $shortcut = $shell.CreateShortcut($_.FullName)
        if ($shortcut.TargetPath) {
            Add-App $_.BaseName $shortcut.TargetPath $shortcut.Arguments 'shortcut'
        }
    }
}

$userPrograms = Join-Path $env:LOCALAPPDATA 'Programs'
if (Test-Path -LiteralPath $userPrograms) {
    Get-ChildItem -LiteralPath $userPrograms -Recurse -Filter '*.exe' -File -ErrorAction SilentlyContinue | ForEach-Object {
        Add-ExeFile $_ 'user-programs'
    }
}

$registryRoots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)

foreach ($pattern in $registryRoots) {
    Get-ItemProperty $pattern -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName } |
        ForEach-Object {
            $command = Resolve-ExePath $_.DisplayIcon
            if (-not $command -and $_.InstallLocation -and (Test-Path -LiteralPath $_.InstallLocation)) {
                $exe = Get-ChildItem -LiteralPath $_.InstallLocation -Filter '*.exe' -File -ErrorAction SilentlyContinue |
                    Where-Object { -not (Should-SkipExe $_) } |
                    Sort-Object Length -Descending |
                    Select-Object -First 1
                if ($exe) { $command = $exe.FullName }
            }
            if ($command) { Add-App $_.DisplayName $command '' 'registry' }
        }
}

foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if (-not $root -or -not (Test-Path -LiteralPath $root)) { continue }
    Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        Get-ChildItem -LiteralPath $_.FullName -Filter '*.exe' -File -ErrorAction SilentlyContinue | ForEach-Object {
            Add-ExeFile $_ 'program-files'
        }
        Get-ChildItem -LiteralPath $_.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            Get-ChildItem -LiteralPath $_.FullName -Filter '*.exe' -File -ErrorAction SilentlyContinue | ForEach-Object {
                Add-ExeFile $_ 'program-files'
            }
        }
    }
}

Get-StartApps -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.AppID) {
    Add-App $_.Name 'explorer.exe' "shell:AppsFolder\$($_.AppID)" 'uwp'
  }
}

$results |
    Sort-Object name |
    ConvertTo-Json -Depth 4 -Compress
