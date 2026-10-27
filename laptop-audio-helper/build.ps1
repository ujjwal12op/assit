$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    python -m pip install -r requirements.txt
    python -m PyInstaller --noconfirm --clean --onefile --windowed --name 'Interview Copilot System Audio' --collect-data soundcard system_audio_helper.py
    Write-Host 'Built: laptop-audio-helper\dist\Interview Copilot System Audio.exe'
}
finally {
    Pop-Location
}
