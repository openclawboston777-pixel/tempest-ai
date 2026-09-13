# Morning brief — overnight session (2026-09-11)

Built via **Copilot Opus 5** (bulk gen) + Claude (architecture/review/test). All verified server-side,
committed, and live at `https://srv1861529.hstgr.cloud:9443/demo`. Branch `slice1-widget`.

## ✅ Shipped this session (all live & verified)

1. **Live order lookup** — Shopify Admin auth via **client-credentials grant**, fully auto-managed
   (fetch/cache/refresh at 24h, 401-retry). No manual token, ever. Verified real order #1001; wrong-email
   lookups blocked (no data leak).

2. **Product Knowledge System** — Ema now reads *structured Shopify fields* (price, availability, and
   **live in-stock counts** — "74 in stock" / "sold out") as authoritative, cross-referenced with the
   **full descriptions** (exact dimensions L×W×H, weight, materials, features, packaging) which the
   storefront hides. Colors-as-separate-products handled. Supplier junk (`#placeholder#`) stripped.

3. **Store policies from Pages** — shipping/delivery times, returns (60-day), warranty (5-Year),
   financing, FAQ, terms, privacy, support — answered from your Shopify **Pages** (your policy fields
   were empty), fetched by topic, cached 10 min, customer-facing pages only.

4. **Room Visualization ("See it in your room")** — Gemini **gemini-3.1-flash-image**. Customer picks a
   product (thumbnail grid), uploads a room photo, and gets a photorealistic composite to download/share
   or drop into chat. Client-side image downscaling; per-session cap (6), rate limits, SSRF guard
   (Shopify CDN only), photos-only. **Verified in a real browser end-to-end** (~12s/render, accurate).

5. **Customer Memory + Identity Resolution** — self-hosted **PostgreSQL** (internal-only). Ema remembers
   name, email, preferences, and products of interest — across a visit *and future visits* (persistent
   anonymous visitor id in localStorage; merges to a known profile by verified email). Returning-customer
   context is injected so Ema personalizes. Self-service **/forget** deletion; 365-day retention purge.
   **All DB usage degrades gracefully — it can never break the live chat.**

6. **Accuracy + Security guardrails** — no fabricated stock/dates/policies; refuses prompt-injection
   (won't leak the system prompt or invent discounts); treats all product/page/customer text as untrusted.

7. **Expanded eval suite** — now **28 scenarios** across knowledge, measurements, inventory, pricing,
   policies, order verification, support, security/injection, accuracy, sales, memory, endpoints
   (per-category scoring; fails the build on any regression). Currently **28/28**. This suite caught (and
   we fixed) a real memory privacy bug where the model could fabricate a cross-linkable identity.

8. **Security hardening** (from an automated review) — fixed an **identity-takeover** risk (a visitor could
   claim another's email and inherit their profile) — visitors now only ever write to their *own* profile;
   an unverified email is stored as a contact attribute only, never used to look up anyone else's data.
   Also replaced a weak visitor-id RNG fallback with `crypto.getRandomValues` (never persists a guessable id).

9. **Analytics + event tracking** — every key action is now recorded (searches, order lookups, support
   tickets, visualizations, profile updates, messages). New **`GET /admin/analytics`** endpoint (Bearer
   `ADMIN_TOKEN`) returns totals, unique visitors, conversations, top searches, top visualized products,
   and a funnel — the foundation for holdout groups + the continuous-improvement loop + the future dashboard.

10. **Cost controls** — global **daily caps** on the paid external calls (Gemini image gen: 300/day; xAI
    voice tokens: 500/day) on top of per-session caps, so a bug or abuse can't run up a big bill. Today's
    usage is visible in the analytics endpoint.

## 🔓 Needs YOU (quick)
1. **Gemini key hardening** (for room viz): enable **billing** on the Google Cloud project for real
   volume (free tier has low daily caps), restrict the key to the **Generative Language API**, and set a
   **budget cap**. Room viz works now; this just protects cost/quota. (Cheaper model available if needed:
   `gemini-3.1-flash-lite-image`.)
2. **Publish/refine** any policy Pages you want Ema to quote exactly (she already reads shipping, returns,
   warranty, financing, FAQ, terms, support).

## Analytics access
- `GET https://srv1861529.hstgr.cloud:9443/admin/analytics?days=7` with header
  `Authorization: Bearer <ADMIN_TOKEN>`. The token is in `deploy/.env` (server-side) — ask me and I'll
  show it securely, or read it on the host at `deploy/.env`. Endpoint returns 404 if no token is configured.

## Where data lives
- Voice transcripts + audio, support tickets, and now **room renders** (original + generated + product +
  meta): `s3://tempest-content-storage/tempest-ai/…`
- Customer profiles / conversations / product interests: **Postgres** (`tempest-postgres`, internal-only).

## Suggested next (your call)
- **Sales state machine** + **offer/discount engine** (you said you'll provide the script + selling rules
  — ready when you are; backend will enforce real, non-fabricated offers/urgency).
- **Analytics + holdout groups** (now possible on the DB): engagement, products discussed, viz usage,
  stage reached, conversions, AI-assisted revenue.
- **Follow-up engine** (SMS/phone) — deferred per your note; needs a Twilio-type account + consent rules.
- **Admin dashboard** — later, once there's data to show.
