# Interview Copilot Windows system-audio helper

This small Windows utility captures a selected playback device using WASAPI loopback. It uses the existing signed-in app session and six-character phone code, then uploads short 16 kHz mono WAV speech segments over HTTPS to the current `/api/interviewer-audio-pair` queue. The phone still transcribes each segment and generates the answer through its existing pipeline. No API key is included or required in this helper.

## Get the executable

Run `build.ps1` on Windows with Python 3.12. The resulting file is `dist/Interview Copilot System Audio.exe`. The executable is not code-signed, so Windows may show an unknown-publisher notice.

## Use it

1. Deploy the current repository version so its existing audio routes accept WAV.
2. Sign in on the phone, open Interview Room, and click **Pair laptop helper**.
3. Launch the helper. Enter the same app URL and shared app password, then paste the phone's six-character code.
4. Select the Windows playback output carrying the interviewer (including the connected headphone output).
5. Click **Connect and start capture**. Confirm the playback RMS meter changes when the interviewer audio plays. Stop when the session is over.

The helper only opens a loopback capture after you click Connect. Audio is segmented in memory after short pauses, with a 0.5-second pre-roll to preserve utterance beginnings. Segments are uploaded with retry; a full queue or repeated upload failure is shown as an error instead of silently continuing to drop audio. No local recordings or credentials are written to disk.

## Build and verify

```powershell
python -m pip install -r requirements.txt
python -m unittest -v
.
build.ps1
```
