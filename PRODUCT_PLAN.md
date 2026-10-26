# Interview Copilot — Product and MVP Plan

## Product requirements

Candidates need fast, glanceable interview prompts grounded in their actual experience. The product supports preparation, practice, mock interviews, and live assistance only when interview rules permit AI assistance.

### MVP scope
- Responsive dashboard and interview workspace.
- Role, company, mode, and answer-style configuration.
- Editable candidate profile context saved in this browser only.
- Optional resume PDF/text extraction and job-description context for tailored answers; extracted document context stays in memory in the open tab.
- Manual question entry and browser speech recognition where supported.
- Server-side Gemini request with question-driven answer style, concise output, no fabricated candidate claims, and a missing-evidence flag.
- Loading, API error, unsupported microphone, and no-key states.
- Visible microphone indicator; no audio or transcript persistence on the server.

### Deferred scope
Accounts, multi-device sync, resume upload/extraction, managed streaming transcription, mock interviewer evaluation, durable session history, billing, admin analytics, production deployment, and compliance claims. Do not use live assistance where prohibited by interview rules.

### Acceptance criteria
1. Candidate can set role/context, submit a question, and receive a short answer grounded only in supplied profile context.
2. Missing evidence is called out instead of invented.
3. API secrets stay on the server and are read from environment variables.
4. Text entry works if speech recognition is unavailable or denied.
5. Microphone status is visible and stopping recognition ends the capture session.
6. No audio/transcript persistence is implemented.

## Recommended architecture and stack

Commercial product: Next.js + TypeScript and an accessible component system; PostgreSQL; managed authentication; private object storage; provider-neutral LLM and streaming speech adapters; Stripe billing; managed deployment. Start as a modular monolith. Keep provider calls behind server-side interfaces.

Starter slice: Node.js 20+ built-in HTTP server and vanilla HTML/CSS/JS, no build tool or dependencies. The Gemini API key stays server-side. Browser SpeechRecognition is optional and browser-dependent. This is a local single-user starter, not secure multi-user SaaS. Upgrade to Next.js alongside authentication and durable data.

Request flow: Browser (text or speech) → POST /api/answer → validation and size limits → LLM provider → structured answer JSON → browser. Profile context stays in browser storage and is sent only when the user requests an answer. No database or file storage.

## Database schema (target)

PostgreSQL with UUID primary keys, UTC timestamps, per-user row-level authorization, and soft delete only where retention requires it.

- users(id, auth_subject UNIQUE, email, created_at, deleted_at)
- candidate_profiles(user_id PK/FK, summary, skills JSONB, experience JSONB, projects JSONB, education JSONB, updated_at)
- interview_sessions(id, user_id FK, mode, role, company, status, started_at, ended_at, consent_version)
- interview_turns(id, session_id FK, question_text, answer_text, answer_style, latency_ms, created_at); retention opt-in and deletion controls required
- usage_events(id, user_id FK, session_id NULL, provider, model, input_tokens, output_tokens, transcription_seconds, cost_estimate, created_at)
- subscriptions(id, user_id FK, provider_customer_id, provider_subscription_id, status, plan_key, period_end, updated_at)
- quota_periods(user_id FK, period_start, period_end, answer_count, transcription_seconds, PRIMARY KEY(user_id, period_start))

Resume files belong in private object storage with short-lived signed access, not database blobs. Do not store raw audio by default.

## Screen-by-screen UI plan

1. Dashboard: start practice/mock/preparation/permitted-live session; recent sessions and quota summary after history exists.
2. Profile setup: summary, skills, experience, projects, education; resume upload and review in a later phase.
3. Interview setup: mode, role, company, answer style, consent reminder and profile selection.
4. Interview workspace: question transcript/input, microphone state, suggested answer, evidence/missing-context note, regenerate/copy controls, latency label.
5. Session recap: questions, user response, feedback, action items; opt-in persistence and deletion.
6. Settings/privacy: profile export/delete, retention, microphone permissions, consent, subscription and usage.
7. Admin (later): aggregate usage, failure/latency/cost trends, abuse controls; avoid access to candidate content.

## API endpoints (target)

Implemented: GET /api/health, POST /api/answer.

Planned: GET/PUT /api/profile, POST /api/profile/resume (signed upload), POST /api/profile/resume/parse, POST /api/sessions, GET /api/sessions, GET/DELETE /api/sessions/:id, POST /api/sessions/:id/turns, POST /api/sessions/:id/feedback, POST /api/sessions/:id/questions, POST /api/transcription/token (short-lived provider token), GET /api/usage, POST /api/billing/checkout, POST /api/billing/portal, POST /api/webhooks/billing.

Before launch, all user-scoped endpoints need authentication, authorization, schema validation, rate limits, and safe errors. Webhooks need signature validation and idempotency.

## Phased roadmap

1. Requirements and architecture — this document and MVP boundaries.
2. UI and application structure — responsive workspace and accessible states (starter included).
3. Authentication and profiles — managed auth, PostgreSQL, ownership checks, profile CRUD.
4. Resume ingestion — private upload, malware/type/size checks, extraction, user review, prompt-injection isolation.
5. Answering and mock interviews — provider adapters, structured outputs, evidence references, evaluation rubric.
6. Streaming transcription — short-lived provider tokens, partial/final states, end-of-question detection, consent and latency telemetry.
7. Session history — opt-in retention, export, deletion, retention jobs.
8. Billing and quotas — Stripe, metering, hard limits, idempotent webhooks.
9. Security, quality, deployment — threat model, rate limits, accessibility, evaluation, observability, deletion procedures.

## Effort and operating-cost estimate

Planning estimate for one experienced full-stack engineer: 6–10 weeks for a usable MVP with managed auth, profile, grounded answers, basic practice/mock flow, and limited transcription; another 4–8 weeks for hardened billing, retention, evaluation, and production readiness. Team size, provider approvals, and compliance scope change this.

Illustrative monthly model for 100 active users: 60 speech minutes and 40 answer calls each (2k input + 350 output tokens/call), 10 MB profile storage each. Speech: $30–$120 assuming $0.005–$0.02/min; model: roughly $2–$30 assuming blended $0.25–$3 per million input and $1–$15 per million output tokens; small-scale infrastructure: $50–$250; storage negligible. Approximate total: $82–$400/month ($0.82–$4/user). These are planning assumptions, not vendor quotes. Replace with selected vendor pricing and measured usage before setting plans. Cap free quotas.

## Risks and mitigations

- Fabricated experience: constrain prompts to profile evidence, flag unsupported claims, require review, evaluate adversarial cases.
- Recording consent/interview rules: explicit controls and visible status; remind users to follow employer/interviewer policies; live mode only when permitted.
- Resume privacy and prompt injection: private storage, minimum retention, treat document text as untrusted, never follow embedded instructions.
- Latency/cost: measure capture/finalization/model/render stages, stream where safe, cache prep content, enforce budgets and quotas.
- Browser speech variation: manual input always available; capability detection; add streaming service only with short-lived tokens.
- Security: no browser API secrets, managed auth, ownership checks, upload validation, rate limiting and deletion workflows before launch.
- Answer quality: concise typed outputs, evidence/missing-context checks, regression evaluation set, user control.

## Run instructions

Copy `.env.example` to `.env`, set `GEMINI_API_KEY` and optionally `GEMINI_MODEL` (default `gemini-3.5-flash-lite`). `GEMINI_FALLBACK_MODEL` defaults to `gemini-3.1-flash-lite` for timeouts and temporary 503 capacity errors. Create a key in Google AI Studio. Never commit `.env`. Run `npm start`, then open http://localhost:3000. Without a key, answer generation reports that it is unavailable; it does not fabricate an AI response. Resume and job-description PDFs are sent to Gemini for extraction; TXT and MD are read locally. Context is sent to Gemini with answer requests and is not persisted by the app.
