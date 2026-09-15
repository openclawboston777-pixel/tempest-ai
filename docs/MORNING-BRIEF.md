# Update — Liora voice, grok-4.20 + tic fix, production domain/CORS (2026-09-15)

- **Voice = Liora** (calm, grounded, luminous) — set live. Voice runs on the separate speech-to-speech model; test by tapping the mic.
- **Text model = grok-4.20** (fast ~2s) with a server-side **opener sanitizer** that removes grok's stubborn "Got it, <name>" opener — verified 0 occurrences across 30 replies; openers now varied/human. Offer engine + eval intact. (No latency tool needed — 4.20 is already fast; the tic was a style issue, now fixed deterministically.)
- **Production domain (customer-facing, professional):** configured Caddy for **https://ema.tempestfurnitur.com** (standard 443, auto-HTTPS) -> the Ema backend. **ACTION NEEDED (you):** add ONE DNS record where tempestfurnitur.com DNS is managed:  A  ema  ->  72.60.67.27  (or CNAME ema -> srv1861529.hstgr.cloud). TLS auto-provisions within ~1 min after that.
- **CORS locked** from "*" to an allowlist: tempestfurnitur.com, *.tempestfurnitur.com, *.myshopify.com, *.hstgr.cloud. Verified allow/deny; demo unaffected.
- **Shopify embed (use after DNS is live):**
  <script>window.TempestConfig={backendUrl:"https://ema.tempestfurnitur.com"};</script>
  <script src="https://ema.tempestfurnitur.com/embed.js" defer></script>
  (Until DNS is set you can test with backendUrl "https://srv1861529.hstgr.cloud:9443".)

---

# Morning brief — Offer engine hardening + Deal Lock + conversational review (2026-09-15 pm)

## Done
- **Financing = real checkout options** (Shop Pay installments / Affirm), described truthfully by Ema — not a fake discount. (Confirm Affirm is actually enabled in your Shopify payment settings; Shop Pay installments works with Shopify Payments.)
- **Offer engine thoroughly tested & hardened.** Fixed a real bug where Ema *fabricated* codes (e.g. "ARTEM-4900") — she now must call the tool; every code is a real, margin-checked Shopify code. Verified across boundaries: over-limit → **no code**; she meets the customer's target with the **smallest** discount (no giving away extra margin); final price never dips below the floor. Deal-lock codes self-expire in 20 min.
- **Deal Lock countdown** live in the widget — a real ticking timer that survives refresh (server-driven), with the price, code, and a Checkout button. Browser-verified.
- **90-second voice inactivity cutoff** (ends the paid voice session automatically).

## Conversational review (you asked "what makes her sound less human?")
Fixed: bullet-point/bold spam, repeated recaps, tool-narration ("let me pull that up"), stacked questions. She's now accurate, honest, follows the phase order, collects contact info, and negotiates with real margin-safe offers.
**One residual tic:** `grok-4.20-non-reasoning` (picked for speed) stubbornly opens ~7/10 replies with "Got it, Marcus" despite explicit bans. **Recommendation:** run the *sales conversation* on a stronger model (e.g. grok-4.6 / a reasoning model) — it will follow the nuanced style + phase logic far better and kill the tic. Fast simple Q&A can stay on the current model. Want me to switch it?

---

# Morning brief — Ema Sales Brain + Offer Engine (2026-09-15)

Your word-for-word sales prompt is now Ema's brain, and she's equipped with the backend abilities to
execute it. Live at `https://srv1861529.hstgr.cloud:9443/demo`, branch `slice1-widget`.

## ✅ Built this session
- **Your sales prompt embedded VERBATIM** (Phase 1 → Loops, offer structure, all rules) as Ema's guide,
  plus a capabilities layer that maps it to her real tools. Verified she opens exactly with
  *"Hey, I'm Ema. What's your name?"* and runs the process.
- **Offer engine with your hard money rules, enforced in the backend (not the LLM):** before any
  discount Ema calls `get_product_economics` (uses real product cost + your $1,000 shipping allowance +
  $500 min profit to compute the max allowed discount); `create_offer` then creates a **real Shopify
  discount code** with a **genuine 20-minute Deal Lock** and a one-click cart checkout link. **Grok
  physically cannot invent or exceed a discount** — verified: an over-limit request is rejected with no
  code; a within-limit $300 offer created a live ACTIVE code (Artemitize → $4,935, expires in 20 min).
- **Favorites** (save / list / mark finalist-eliminated-chosen) and **phone + criteria capture** so the
  narrowing and contact phases work and persist across visits.
- **Offer types** wired: final_lock / personal_win / room_builder (immediate $ off), comeback_credit
  (future credit), flex_pay (financing).

## 🔎 My review of your prompt (kept word-for-word; these are notes, not changes)
- **Financing ("The Flex Pay")** has no payment provider connected yet, so Ema can't truthfully *execute*
  it — right now she'll describe/deflect rather than promise financing. To make it real we need a provider
  (Shop Pay Installments / Affirm / Klarna). Tell me which and I'll wire it.
- **Deal Lock countdown**: the backend timer is genuine (the code literally expires in 20 min). The
  *visual* persistent countdown in the chat UI is the remaining piece — I'll build it next.
- **Voice speed ramp (1.2x→1.5x during looping)**: that's a live-voice TTS setting; I've instructed it,
  but true dynamic rate control depends on the voice provider — may need tuning.
- **"Worst case we just ship you a new one"** (Loop 2): Ema will verify this against your real
  return/warranty page before saying it — make sure that page states it, or soften the line.
- **90-second inactivity cutoff** and the **favorites "save" button** are UI pieces still to add (Ema
  currently records favorites when the customer names them).

## Needs you
1. **Financing provider** decision (for Flex Pay) — or I keep it disabled and Ema won't promise it.
2. Confirm you're OK that `create_offer` creates **real live discount codes** on the store (it does now,
   margin-protected; test codes self-expire in 20 min).
3. Gemini key hardening (billing + API restriction + budget cap) still pending from before.

---

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
