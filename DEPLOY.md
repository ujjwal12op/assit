# Deploy Interview Copilot online

This starter is configured as a private, password-protected Render web service. The Gemini key stays in the hosting provider's environment settings and is never bundled into browser JavaScript. The app uses a shared access password and short-lived, signed HTTP-only session cookies. Do not commit `.env`.

## Deploy with Render

1. Put the contents of this folder in a **private GitHub repository**. Confirm `.env` is excluded by `.gitignore`; never upload it.
2. In Render, choose **New → Blueprint** and connect that private repository. Render reads `render.yaml` and creates the web service.
3. When prompted for environment values, enter `GEMINI_API_KEY` and choose a long, unique `APP_PASSWORD`. Render generates `SESSION_SECRET` for the service.
4. Wait for the first deploy to finish, then open the service URL. Sign in with the access password.

The Render free web service sleeps after 15 minutes without incoming traffic and may take about a minute to wake up. Its filesystem is ephemeral, which is suitable here because the app does not save uploaded documents or interview transcripts to the server. The in-memory login session resets when the service restarts, so you may need to sign in again.

## Environment variables

- `GEMINI_API_KEY`: secret from Google AI Studio; enter it only in Render's environment settings.
- `APP_PASSWORD`: private shared password for this personal testing deployment.
- `SESSION_SECRET`: long random signing secret; Render Blueprint generates this.
- `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`: model IDs, with starter defaults in `render.yaml`.
- `HOST` and `PORT`: Render supplies the port; the Blueprint binds the service to `0.0.0.0`.

For production with multiple users, replace the shared password with managed authentication, persistent session storage, per-user authorization, and durable usage quotas.
