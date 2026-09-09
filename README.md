# Tempest AI — Ema backend

Backend skeleton for **Ema**, the Tempest Furnitur shopping assistant
(slice 1, see [`docs/specs/2026-08-23-slice1-widget-catalog-chat-design.md`](docs/specs/2026-08-23-slice1-widget-catalog-chat-design.md)).

Node.js + TypeScript + Fastify. The service is the only place credentials live:
the browser never sees the xAI API key or the Shopify tokens.

## Quick start

```bash
npm install
cp .env.example .env   # fill in the real values (.env is git-ignored)
npm run dev            # http://localhost:3000
```

Without any credentials the server still boots: `get_products` then serves a small
**mock catalog**, so the widget and tests can run offline.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Run the server with hot reload (`tsx watch`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run the Vitest suite |

## Endpoints

### `GET /health`

```json
{ "status": "ok" }
```

### `POST /chat`

Streams Ema's answer as plain text (`text/plain`, chunked).

```bash
curl -N -X POST http://localhost:3000/chat \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"Do you have an oak dining table?"}]}'
```

Body: `{ "messages": [{ "role": "user" | "assistant", "content": string }] }`.
The system prompt is added server-side: Ema is concise and sales-leaning, **must**
call `get_products` before discussing products, and never invents price or stock.

### `POST /voice-token`

Mints a **short-lived xAI ephemeral token** for the browser's realtime voice
session. `XAI_API_KEY` is never returned.

```json
{ "token": "...", "model": "grok-4-realtime", "url": "wss://api.x.ai/v1/realtime", "expiresAt": "..." }
```

`/chat` and `/voice-token` are rate limited per IP
(`RATE_LIMIT_MAX` requests per `RATE_LIMIT_WINDOW_MS`).

## Tool: `get_products(query)`

Queries the Shopify **Storefront API** (`https://{SHOPIFY_STORE_DOMAIN}/api/{SHOPIFY_API_VERSION}/graphql.json`)
and returns, per product: `title`, `description`, `price`, `currency`, `available`,
`url` and `variants`. A public token is sent as `X-Shopify-Storefront-Access-Token`;
if `SHOPIFY_STOREFRONT_PRIVATE_TOKEN` is set it is also sent as
`Shopify-Storefront-Private-Token`. When neither token (or the domain) is configured,
the mock catalog is returned instead.

## Layout

```
src/
  config.ts             env-driven configuration
  server.ts             Fastify app: /health, /chat, /voice-token
  index.ts              process entrypoint
  providers/
    types.ts            TextProvider / VoiceProvider seams
    prompt.ts           Ema's system prompt
    xai.ts              Grok text streaming (+ tool loop) and ephemeral voice tokens
  shopify/
    products.ts         get_products via the Storefront API (mock fallback)
```

`TextProvider` / `VoiceProvider` keep the routes vendor-agnostic so xAI can be
swapped later; slice 1 only ships the Grok implementations.

## Security

- All secrets come from the environment; nothing is committed. `.env` is git-ignored.
- Logs are structured (pino) and redact `authorization`, cookies and Storefront token
  headers.
- Shopper input is treated as untrusted; authorization decisions live in code, not
  in the prompt.
