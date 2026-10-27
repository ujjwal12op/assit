# Deploy Interview Copilot online

This starter is configured as a private, password-protected Render web service. Provider API keys stay in the hosting provider's environment settings and are never bundled into browser JavaScript. The app uses a shared access password and short-lived, signed HTTP-only session cookies. Do not commit `.env`.

## Deploy with Render

1. Put the contents of this folder in a **private GitHub repository**. Confirm `.env` is excluded by `.gitignore`; never upload it.
2. In Render, choose **New → Blueprint** and connect that private repository. Render reads `render.yaml` and creates the web service.
3. When prompted for environment values, add the provider key you plan to use and choose a long, unique `APP_PASSWORD`. Render generates `SESSION_SECRET` for the service.
4. Wait for the first deploy to finish, then open the service URL. Sign in with the access password.

The Render free web service sleeps after 15 minutes without incoming traffic and may take about a minute to wake up. Its filesystem is ephemeral, which is suitable here because the app does not save uploaded documents or interview transcripts to the server. The in-memory login session resets when the service restarts, so you may need to sign in again.

## Environment variables

- `GEMINI_API_KEY`: secret from Google AI Studio; enter it only in Render's environment settings.
- `AI_PROVIDER`: set to `gemini` or `anthropic`. Defaults to `gemini` if unset.
- `ANTHROPIC_API_KEY`: Claude API key from the Anthropic Console; enter it only in Render's environment settings.
- `ANTHROPIC_MODEL`: optional Claude model ID; defaults to `claude-haiku-4-5-20251001` for interactive speed.
- `ANTHROPIC_FALLBACK_MODEL`: optional Claude model ID used as a fallback when set.
- `APP_PASSWORD`: private shared password for this personal testing deployment.
- `SESSION_SECRET`: long random signing secret; Render Blueprint generates this.
- `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`: model IDs, with starter defaults in `render.yaml`.
- `HOST` and `PORT`: Render supplies the port; the Blueprint binds the service to `0.0.0.0`.

To switch the deployed app to Claude, open the Render service's **Environment** page, set `AI_PROVIDER` to `anthropic`, add `ANTHROPIC_API_KEY` as a secret, and save/redeploy. To switch back, change `AI_PROVIDER` to `gemini`. Keep `GEMINI_API_KEY` only if you need the server's audio-transcription fallback on browsers that do not support native speech recognition; Claude is used for answers and PDF extraction.

For a local run, put `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY=...` in your untracked `.env` file. Do not paste API keys into source files or commit them.

For production with multiple users, replace the shared password with managed authentication, persistent session storage, per-user authorization, and durable usage quotas.

## Windows interviewer audio

The browser share companion has been replaced by a small Windows helper using WASAPI loopback capture. It records the selected Windows output directly (including headphone output), then uploads short speech WAV segments to the existing authenticated pairing queue. The phone continues to run its existing transcription and answer-generation path; its microphone remains available.

1. Deploy the current repository so the server accepts `audio/wav` on the existing audio-pair and transcription endpoints.
2. On the phone, sign in, open the Interview Room, and choose **Pair laptop helper**. Keep the six-character code visible.
3. Run `laptop-audio-helper/dist/Interview Copilot System Audio.exe` on Windows.
4. Enter the same app URL, shared app password, and phone pairing code in the helper. Select the Windows output currently playing the interviewer and choose **Connect and start capture**.
5. Confirm the helper playback meter moves. The phone should show the captured interviewer turn and generate its answer. Stop the helper when finished.

Build the helper from source with Python 3.12 on Windows: `cd laptop-audio-helper`, `python -m pip install -r requirements.txt`, then `build.ps1`. It creates the executable in `dist/`.

The helper keeps the password and audio in memory and does not save recordings or credentials. Pairing state and audio segments remain in server memory. Both devices must use the same running server instance. A server restart or expired pairing requires a new code and reconnect.
