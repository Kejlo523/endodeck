$ErrorActionPreference = 'Stop'

# Wymuś UTF-8 na wyjściu, by polskie znaki w tytułach (ąćęłńóśźż) nie były psute
# przez domyślną stronę kodową konsoli na polskim Windowsie.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

# Odczyt aktualnie odtwarzanego utworu z Windows System Media Transport Controls (SMTC).
# Działa dla Spotify, przeglądarek (YouTube), Tidal, Apple Music itd. - dowolnej aplikacji,
# która zgłasza media do Windows. Wymaga Windows PowerShell 5.1 (powershell.exe).

# Awaitowanie WinRT IAsyncOperation w czystym PowerShellu wymaga refleksji nad metodą
# AsTask z assembly System.Runtime.WindowsRuntime - bez tego typ nie jest widoczny.
Add-Type -AssemblyName System.Runtime.WindowsRuntime

[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime] | Out-Null

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(2500) | Out-Null
    return $netTask.Result
}

function Get-NowPlaying {
    $manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    if (-not $manager) { return $null }

    $sessions = $manager.GetSessions()
    if (-not $sessions -or $sessions.Count -eq 0) { return $null }

    # Wybór: najpierw sesja faktycznie odtwarzająca, w przeciwnym razie bieżąca/pierwsza.
    $chosen = $null
    foreach ($session in $sessions) {
        $info = $session.GetPlaybackInfo()
        if ($info -and $info.PlaybackStatus -eq [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing) {
            $chosen = $session
            break
        }
    }
    if (-not $chosen) { $chosen = $manager.GetCurrentSession() }
    if (-not $chosen) { $chosen = $sessions[0] }
    if (-not $chosen) { return $null }

    $props = Await ($chosen.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    if (-not $props) { return $null }

    $playback = $chosen.GetPlaybackInfo()
    $status = if ($playback) { $playback.PlaybackStatus.ToString() } else { 'Unknown' }

    $appId = ''
    try { $appId = $chosen.SourceAppUserModelId } catch {}

    return [ordered]@{
        title   = [string]$props.Title
        artist  = [string]$props.Artist
        album   = [string]$props.AlbumTitle
        status  = $status
        source  = $appId
        playing = ($status -eq 'Playing')
    }
}

try {
    $result = Get-NowPlaying
    $json = if ($result -and $result.title) { $result | ConvertTo-Json -Compress } else { '{}' }
} catch {
    $json = '{}'
}

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::Out.WriteLine($json)
