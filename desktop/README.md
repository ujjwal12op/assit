# Interview Copilot Desktop for Windows

This desktop companion captures Windows playback audio through Electron's system loopback, including sound routed to wired, USB, and Bluetooth headphones. It reuses the existing `/companion` page and authenticated `/api/interviewer-audio-pair` relay. Audio still reaches the phone, which uses the existing transcription flow. No provider API key is stored in this app.

## Install

Download and run `dist/Interview Copilot Desktop Setup 1.0.0.exe`. Windows may show an unknown-publisher warning because the installer is not code-signed.

## Use

1. Open the desktop app and enter the Render address (default: `https://interview-copilot.onrender.com`).
2. Sign in using the existing app password.
3. On your phone, open the Interview Room and press **Connect laptop audio** to get a pairing code.
4. On the desktop app, open **Open laptop companion page**, enter that code, then press **Connect Interviewer Audio**.
5. Play the interviewer audio through the Windows output device. The status reports whether playback signal is reaching the companion.

Use **Stop Audio** to stop only the desktop capture. The phone microphone and its session controls are unchanged. Keep the phone and desktop connected to the same deployed app instance; a server restart expires the pairing code.

## Build from source

Requires Windows, Node.js 20.12 or later, and npm:

```powershell
cd desktop
npm install
npm run dist
```

The NSIS installer is written to `desktop/dist/`. For local development, run the web app in another terminal (`npm start` from the repository root), enter `http://localhost:3000` in the desktop launcher, and sign in if local access protection is enabled.
