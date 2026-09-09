# TEMPEST AI (Ema) — Slice 1 Backend

Backend powering the storefront AI assistant **Ema**: text chat via xAI Grok with a
`get_products` tool (Shopify Storefront API) and a voice-token endpoint.

Ema is a warm, concise, consultative sales + support assistant for a furniture store.
She always calls `get_products` for product facts and never invents price, inventory,
or promotions.

## Requirements

- Node 20+
- npm

## Setup

```bash
cp .env.example .env   # fill in secrets (optional — omitted secrets => MOCK mode)
npm install
```

## Run

```bash
npm run dev     # watch mode (tsx)
npm run build   # compile to dist/
npm start       # run compiled server
```

Server listens on `PORT` (default `8080`).

## Test

```bash
npm test
npm run typecheck
```

## MOCK mode

If xAI env is missing the text/voice providers run in MOCK mode (canned replies / stub
token). If Shopify env is missing `getProducts` returns a clearly-labeled MOCK array.
The server always boots.

## Endpoints

- `GET  /health` -> `{ status: "ok" }`
- `POST /chat` -> body `{ messages: {role,content}[], sessionId? }` — streams SSE text deltas.
- `POST /voice-token` -> `{ token, expiresAt, url }` (ephemeral; never exposes the API key).

## Environment variables

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `XAI_API_KEY` | optional | — | Missing => xAI MOCK mode |
| `XAI_BASE_URL` | optional | `https://api.x.ai/v1` | |
| `XAI_TEXT_MODEL` | optional | `grok-4` | |
| `SHOPIFY_STORE_DOMAIN` | optional | — | e.g. `151v9c-1d.myshopify.com` |
| `SHOPIFY_STOREFRONT_TOKEN` | optional | — | Missing (with domain) => Shopify MOCK mode |
| `SHOPIFY_API_VERSION` | optional | `2025-07` | |
| `PORT` | optional | `8080` | |
| `CORS_ORIGIN` | optional | `*` | |

Secrets are read from env only and are never logged (redacted via pino) or exposed to Grok.
