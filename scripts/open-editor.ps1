$root = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'start-endodeck.ps1')
Start-Sleep -Milliseconds 500
Start-Process 'http://127.0.0.1:8765/editor.html'
