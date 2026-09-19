# Tempest AI (Ema) — Project Status

_Last updated: 2026-08-23 (overnight autonomous session)_

## Where things stand

**✅ Slice 1 backend — DONE, live-verified, merged to `main`.**
- Fastify + TypeScript backend at `backend/`: `GET /health`, `POST /chat` (SSE stream), `POST /voice-token`.
- xAI Grok text provider with tool-calling; `get_products` → Shopify Storefront GraphQL (private-token header); MOCK mode when secrets absent.
- `TextProvider`/`VoiceProvider` seams, zod-validated config, pino logging (secrets redacted), rate limiting, CORS.
- **Verified:** `tsc` clean, `vitest` 3/3 pass, `vite`/`tsc` build OK, and a **live end-to-end run** produced a real grounded answer:
  > "Yes, we sell sofas — try the Artemitize dark gray velvet sectional for $5235 (in stock)."
  (Grok called `get_products`, hit the real store, answered with correct price + stock.)

**🔵 Slice 1 widget — built, pending your visual review (PR open).**
- Vanilla TS + Vite, Shadow-DOM encapsulated, ~13KB (4.35KB gz). Coral bubble (breathing + halo), emerge-to-panel chat, SSE streaming to the backend, "Talk to me" placeholder.
- Builds clean. **Aesthetics need your eye** — run locally (below) and tell me what to tune.

## How this is being built (cost model)
- **Code generation → Claude Opus on your GitHub Copilot subscription** via the `copilot-api` proxy (the "Hermes" stack). Generated code is written straight to files, so it costs neither the chat budget nor context.
- **Architecture, review, verification, fixes, git/PRs → Claude Code** (the overseer). Objective gates: typecheck + tests + real runtime, not vibes.
- **GitHub is the bridge** (the coding environment is isolated from the live VPS; files sync via this repo).
- Note: "Herdr" and the "Hermes plugins/LSP/RTK/LCM" from the original plan do not exist on the system; the real, working money-saver is the Copilot-Opus proxy above.

## Verified facts
- Repo: `openclawboston777-pixel/tempest-ai`
- Shopify store handle: `151v9c-1d.myshopify.com` (custom domain tempestfurnitur.com); Storefront API v `2025-07`; use the **private** Storefront token via `Shopify-Storefront-Private-Token`.
- xAI text model: use a valid id like **`grok-4.6`** (`grok-4` is NOT valid). 12 models available.
- AWS: IAM user `Claude007`, account `829860303439`, region `eu-north-1`. (App Runner is NOT in eu-north-1 — deploy will use eu-west-1 or Fargate/Lightsail.)

## Secrets (never in repo)
Runtime env only: `XAI_API_KEY`, `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_STOREFRONT_TOKEN`, (later) AWS + Admin API. See `backend/.env.example`.

## Run locally
```bash
# backend
cd backend && npm install && cp .env.example .env   # fill XAI + Shopify values
npm run dev      # http://localhost:8080/health
# widget (separate terminal)
cd widget && npm install && npm run dev              # opens the dev harness
```

## Roadmap (your priority order)
1. Slice 1 widget visual review + polish ← next
2. Deploy backend (AWS eu-west-1 or your VPS) + install widget on the store
3. Sales + support intelligence (proactive engine, orders/support via Admin API, memory, escalation)
4. Voice behavior tuning (turn-taking/floor control) — second-to-last
5. Phone calls + SMS follow-up — last
