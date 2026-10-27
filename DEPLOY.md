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

## Laptop interviewer audio

1. Sign in to the app on your phone and open the Interview Room.
2. Select **Connect laptop audio** and keep the displayed six-character pairing code visible.
3. On the Windows laptop, open the same app host at **/companion** and sign in with the same shared app password.
4. Enter the phone's code and select **Connect Interviewer Audio**. In the browser sharing prompt, choose a tab or system-audio source that contains the interviewer and enable audio sharing.
5. The laptop companion uploads short speech segments over the app's HTTPS connection. The phone relays them through the existing **/api/transcribe-turn** transcription route. Stop either audio channel independently.

Use a current desktop Chrome browser on Windows for the laptop capture page. The companion preselects the **Chrome Tab** picker and excludes **Entire Screen**. Select the tab that is actually playing the interviewer and enable **Share tab audio**. A tab share stays attached to that one selected tab; stop and reconnect to switch tabs. It also requests system audio when a Window is selected in Chrome versions that support the **windowAudio** capture hint. If the selected source has no audio track or no audio signal, the companion reports that. The existing server transcription configuration (including **GEMINI_API_KEY** when using its Gemini fallback) must be available.

Audio segments and pairing state are held in server memory only; recordings are not written to disk. Both devices must reach the same running server instance. A server restart or expired pairing requires creating a new code and reconnecting.

### Windows desktop companion

For direct Windows playback capture (including headphone output), build and install the desktop companion in `desktop/`. It opens the same hosted app, so sign in with the existing app password, then open **Open laptop companion page** and enter the phone's pairing code. Windows loopback audio replaces the Chrome share picker; the phone continues to receive audio through the existing relay and transcription route. See `desktop/README.md` for build steps.
