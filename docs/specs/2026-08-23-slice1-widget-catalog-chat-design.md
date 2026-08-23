# Tempest AI — Slice 1 Design: "Ema answers questions about your products"

**Date:** 2026-08-23
**Status:** Draft — awaiting owner review
**Author:** Claude (architect/overseer)

---

## 1. Purpose of this slice

Ship the smallest version of Ema that is genuinely useful and demoable: a premium
chat widget on `tempestfurnitur.com` that answers shopper questions using the store's
**real product catalog**, powered by Grok. Text first; a "Talk to me" voice button as a
fast-follow using Grok's default realtime voice.

This is the foundation every later phase (sales intelligence, support/orders, proactive
engagement, follow-up) bolts onto. It handles **no customer PII and no order data** —
that keeps it fast to build, safe, and free of Shopify protected-data gates.

## 2. In scope / out of scope

**In scope**
- Coral idle bubble → opens into the white chat panel (per the design spec).
- Text chat with Ema (Grok), streaming responses.
- Ema can look up **live product info** (names, descriptions, variants, price, stock)
  via the Shopify **Storefront API**.
- Basic in-session conversation continuity (survives navigation within the tab).
- A minimal secure backend that holds secrets and brokers all AI/Shopify calls.
- Fast-follow: "Talk to me" voice via Grok realtime using ephemeral tokens.

**Explicitly OUT of scope for slice 1** (later phases)
- Order/customer/support lookup, identity verification.
- Durable customer memory database (Postgres), cross-session memory.
- Proactive message engine, sales-state tracking, offers.
- Follow-up (abandoned cart, SMS, email, outbound calls).
- Admin panel, analytics/holdout groups, evaluation/learning loop.
- Voice turn-taking / floor-control tuning (owner deprioritized: second-to-last).

## 3. Architecture

```
Shopper's browser (tempestfurnitur.com)
  └─ Ema widget  (Shopify Theme App Extension / app embed)
        │  text: HTTPS (streaming)          voice: ephemeral token, then direct WSS
        ▼                                          │
  Tempest backend (AWS)  ───────────────────────────┘
        ├─ POST /chat        → Grok text (with get_products tool) → stream back
        ├─ GET  /voice-token → mint short-lived xAI ephemeral token
        └─ product lookups   → Shopify Storefront API (public, read-only)
        │
        ▼ (secrets only, server-side)
  AWS Secrets Manager: xAI API key, Shopify tokens, app client secret
```

**Key rule (from spec):** Grok never receives raw credentials. The browser never
receives long-lived keys. All privileged calls go through the backend.

## 4. Components

### 4.1 Widget (frontend)
- Delivered as a **Shopify Theme App Extension (app embed)** — no theme-file writes
  needed; merchant toggles it on in the theme editor. Requires only `read_themes`.
- Lightweight TypeScript, built small (target premium/fast feel per design spec).
- Implements Phase 1 (idle bubble + breathing/halo), Phase 3 (open chat panel,
  emerge-from-bubble animation). Phase 2 (proactive messages) deferred.
- Renders assistant name from config ("Ema"), coral `#C94F3D`, per design spec tokens.

### 4.2 Backend (AWS)
- **Node.js + TypeScript** service (Fastify or Express).
- Endpoints: `/chat` (streaming), `/voice-token`, `/health`.
- Implements one Grok tool: `get_products(query)` → Storefront API → structured result.
- Recommended host: **AWS App Runner** for MVP (managed HTTPS, autoscaling, simple).
  Revisit ECS Fargate / Lambda if profiling warrants.
- Provider abstraction seam: a thin `TextProvider` / `VoiceProvider` interface so xAI
  can be swapped later (per addendum), even though slice 1 only implements Grok.

### 4.3 Shopify integration
- **Storefront API** (public token, `unauthenticated_read_*` scopes) for all product
  reads in slice 1 — nothing sensitive touches the browser.
- App installed on the store via OAuth/Shopify CLI (`shopify app config link`).
- App URL / redirect point to the backend once deployed.

### 4.4 Grok integration
- Text: Grok chat with a system prompt establishing Ema's persona (sales-lean,
  concise, never invents price/inventory — must call `get_products`).
- Voice (fast-follow): OpenAI-Realtime-compatible endpoint `wss://api.x.ai/v1/realtime`,
  browser connects with a backend-minted **ephemeral token**; Grok defaults for voice.

## 5. Security posture (slice 1)
- Secrets only in AWS Secrets Manager; never in browser, logs, or committed files.
- Storefront API for public product data; Admin token unused in this slice.
- Ephemeral tokens for browser voice (key stays server-side).
- Rate limiting on `/chat` and `/voice-token` to protect spend.
- Treat all shopper input as untrusted (prompt-injection safe): authorization lives in
  backend code, not the prompt.

## 6. Shopify app scope decision (recorded)

New app **"Grok Voice Support & Sales"** created with the full forward-looking scope set
(one-time, covers entire roadmap). Slice 1 uses only the Storefront product reads +
`read_themes`. Full granted set:

```
read_products,read_inventory,read_locations,read_files,read_metaobjects,read_metaobject_definitions,read_discounts,write_discounts,read_price_rules,read_markets,read_legal_policies,read_online_store_pages,read_content,read_themes,write_app_proxy,read_orders,read_all_orders,read_draft_orders,read_order_edits,read_fulfillments,read_returns,read_merchant_managed_fulfillment_orders,read_assigned_fulfillment_orders,read_third_party_fulfillment_orders,read_customers,write_customers,read_checkouts,read_payment_terms,read_shopify_payments_disputes,read_customer_events,write_pixels,read_analytics,read_marketing_events,write_marketing_events,unauthenticated_read_product_listings,unauthenticated_read_product_inventory,unauthenticated_read_product_tags,unauthenticated_read_selling_plans,unauthenticated_read_content,unauthenticated_read_metaobjects,unauthenticated_read_checkouts,customer_read_orders,customer_read_customers
```

Deliberately excluded: `read_customer_payment_methods`, theme-write scopes, commerce
writes (`write_products/inventory/orders`), `read_customer_merge`,
`read_customer_data_erasure`. Protected-data scopes are present but only exercised in
later phases (require Shopify data-protection agreement on the live store).

Webhooks (later phases): **Amazon EventBridge** (AWS-native), not Google Pub/Sub.

## 7. Acceptance criteria (how we know slice 1 is done)
1. Widget appears on `tempestfurnitur.com` as a coral bubble, opens to the chat panel
   with the specified look and emerge animation.
2. A shopper can type a product question and get an accurate, streamed answer that
   reflects **real current catalog data** (verified against the store).
3. Ema never fabricates price/stock — if the tool fails, she says she can't verify.
4. "Talk to me" starts a working Grok voice conversation (defaults) using an ephemeral
   token; mic permission prompt behaves on desktop Chrome + iPhone Safari.
5. No secret is ever present in browser, repo, or logs.
6. Backend deployed on AWS with HTTPS; rate limits active.

## 8. Dependencies / open items (owner or setup)
- **AWS access** — confirm how the backend is deployed and how I authenticate to the
  AWS account (deliberate, least-privilege; not assumed).
- **xAI API key** — created and stored in Secrets Manager.
- **Shopify app install** on the store + Storefront API token generation.
- Build labor: bulk implementation delegated to Copilot-Opus (GitHub subscription);
  Claude architects/reviews.

## 9. Proposed tech stack
- Frontend widget: TypeScript + Vite build, packaged as a Shopify theme app extension.
- Backend: Node.js + TypeScript (Fastify), AWS App Runner, AWS Secrets Manager.
- AI: xAI Grok (text + realtime voice), behind `TextProvider`/`VoiceProvider` seams.
- Commerce: Shopify Storefront API (slice 1); Admin/Customer Account APIs (later).
```
