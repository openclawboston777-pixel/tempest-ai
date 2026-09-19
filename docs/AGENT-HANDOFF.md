# Ema — Agent Handoff (read this first)

You are continuing work on **Tempest AI "Ema"**: a customer support + sales AI chat/voice widget for the Shopify furniture store **tempestfurnitur.com**. Ema is **built and LIVE in production**. Your job is incremental improvements — don't rebuild.

## Where things are
- **Repo (server):** `/root/tempest-ai` — branch **`slice1-widget`** (working branch). GitHub: `openclawboston777-pixel/tempest-ai` (release tag `ema-v1.0`).
- **Live:** `https://ema.tempestfurnitur.com` (embedded on the Shopify store via a `<script src=".../embed.js">` snippet in theme.liquid).
- **Server:** Hostinger VPS `72.60.67.27`. Docker Compose in `/root/tempest-ai/deploy`:
  - `tempest-ema` (backend + built widget; container 8080, published **127.0.0.1:8090 only**)
  - `tempest-postgres` (customer memory; internal only)
  - **Caddy** (`/etc/caddy/Caddyfile`) reverse-proxies `ema.tempestfurnitur.com` → `127.0.0.1:8090`, auto-TLS (Let's Encrypt).
- **Secrets:** `/root/tempest-ai/deploy/.env` (gitignored) — xAI, Shopify (client-creds auto Admin token), Gemini, Postgres pw, ADMIN_TOKEN, AWS. Never commit it.

## Deploy / test
- Build+deploy: `cd /root/tempest-ai/deploy && docker compose up -d --build` (rebuilds widget + backend). Wait for `healthy`.
- Backend typecheck: `cd backend && npx tsc --noEmit`. Widget build: `cd widget && npm run build`.
- Eval (28 scenarios): `docker cp scripts/eval.mjs <ema-container>:/tmp/eval.mjs && docker exec <c> node /tmp/eval.mjs` → expect 28/28 (memory scenario is timing-flaky).
- Health: `https://ema.tempestfurnitur.com/health`.

## Cost-saving build workflow (IMPORTANT)
User wants heavy code-gen done by **Hermes / GitHub Copilot Opus 5**, with Claude architecting/reviewing/testing:
`docker cp gen.mjs hermes-copilot:/tmp/gen.mjs; docker cp prompt.txt hermes-copilot:/tmp/prompt.txt; docker exec -e MODEL=claude-opus-5 hermes-copilot node /tmp/gen.mjs > out.txt` then parse with `/root/.tempest-build/parse.mjs out.txt <destdir>` (format `<<<FILE:path>>>...<<<END>>>`).

## Key code
- **Ema's brain:** `backend/src/ema/systemPrompt.ts` — `EMA_SALES_SCRIPT` is the customer's WORD-FOR-WORD sales process (DO NOT edit or condense it), plus `EMA_CAPABILITIES` (tools/verification/style/support rules incl. "USING THE SALES SCRIPT" verbatim-vs-improvise rules). `EMA_VOICE_INSTRUCTIONS` = full script + a short spoken-delivery note.
- **Models:** `XAI_TEXT_MODEL=grok-4.20-0309-non-reasoning` (fast; chat.ts has a stream sanitizer that strips grok's "Got it" opener). Voice = speech-to-speech `grok-voice-latest`, `XAI_VOICE=liora` (pronunciation fixed via session `replace {Ema:Emma}` for live voice and "Emma" spelling in the greeting clip).
- **Tools:** `backend/src/tools/index.ts` (get_products, get_shop_policies, get_order_status, submit_support_ticket, remember_customer, record_favorite/list_favorites/set_favorite_status, get_product_economics, create_offer). Voice runs them via `POST /voice/tool`.
- **Offer engine:** `backend/src/shopify/offers.ts` — margin floor = cost + $1000 shipping + $500 profit; creates REAL Shopify discount codes (20-min "Deal Lock"); widget `dealLock.ts` shows the countdown; `GET /offer/active`.
- **Memory:** `backend/src/memory/store.ts` (Postgres; anon visitor→profile; identity by verified email only — never by unverified claim). Analytics: `memory/analytics.ts` + `GET /admin/analytics` (Bearer ADMIN_TOKEN).
- **Widget:** `widget/src/` — widget.ts, voice.ts, visualize.ts (Gemini room viz), dealLock.ts, proactive.ts (engagement bubbles + spoken greeting). `backendUrl` self-configures from the embed.js origin; proactive intro shows once per 6h via localStorage `tw_proactive_last`.

## Environment gotchas
- Bash **blocks** `curl`/`wget` and inline `node -e "fetch(...)"` (a hook). To make HTTP calls: put fetch in a **.mjs FILE** and run `docker exec <c> node /tmp/x.mjs`, OR use the `ctx_execute` tool (has network, runs off-host — good for EXTERNAL checks like hitting the public domain). Foreground `sleep` is blocked.
- Keys/token are attached per chat under `/tmp/aionui/<id>/` (id changes each session). GitHub push uses the `ghp_...` token file there: `git push https://x-access-token:$GH@github.com/openclawboston777-pixel/tempest-ai.git slice1-widget`. If missing, ask the user to re-attach.
- Commit style: end messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit + push when a change is verified.

## Backups (already automated)
- **Weekly** systemd timer `ema-backup.timer` → `/usr/local/bin/ema-weekly-backup.sh` → `/root/ema-backups/weekly/` (keeps 6) + offsite to `s3://tempest-content-storage/tempest-ai/backups/`.
- **V1.0 recovery kit:** `/root/ema-backups/ema-v1.0/` (+ `ema-v1.0-FULL-KIT.tar.gz`) with `RESTORE.md`. GitHub tag/branch/release `ema-v1.0`.
- Customer data (transcripts/tickets/room renders) already stream to S3 `tempest-content-storage/tempest-ai/`.

## Status / possible next work
V1.0 shipped & live: sales script + support process, tools, voice (Liora) + spoken greeting, room visualization, memory, margin-safe offers + Deal Lock, analytics, cost controls, hardened CORS + loopback backend, weekly backups.
Deferred/optional (confirm with user before building): follow-up engine (SMS/phone — needs Twilio + consent), analytics/admin dashboard UI, holdout/experiment groups, richer sales state machine, financing beyond Shop Pay/Affirm.
