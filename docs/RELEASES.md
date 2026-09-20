# Tempest AI (Ema + storefront widget) — Releases

## ema-v1.2 — "Functional enough to start running traffic through the website"

**Status: Functional enough to start running traffic through the website.**

This is a stable, deployable restore point covering both Ema (backend) and the
storefront widget. To restore this exact version: `git checkout ema-v1.2`.

Highlights since v1.1:
- **Persistent voice across page navigation** — the live Grok voice call now survives
  the customer browsing the site (client-side "soft navigation" that swaps the NOOM
  theme's `#MainContent` in place instead of a full reload, so the widget + WebSocket +
  mic stay alive). Handles lazy images (`data-src`), reveal animations (`need-animate`),
  the mobile drawer overlay + body scroll-lock, and accordion re-init, with a safe
  full-reload fallback for anything it can't handle.
- **Per-turn voice memory + one-tap resume** — spoken turns persist server-side as they
  happen; on a fresh page the customer is recognized and Ema resumes without
  re-introducing herself.
- **URLs & discount codes shown in the chat**, never read aloud on voice (`show_in_chat`
  + the Deal Lock card).
- **Constant voice** — no pitch/speed change during the close/loop.
- **Live (uncached) pricing** on the offer/economics path (margin-safe).
- **Looping** reworked to the approved sequence (assume smokescreens; rebuild certainty;
  a better real offer each round; lock the Deal Lock immediately on "yes").
- **Proactive selling hardened** — Ema always evaluates her current phase and ends turns
  with a phase-advancing question; passive hand-offs ("I'll be here when you need me",
  "let me know if you need anything", etc.) are banned in multiple rule locations.
- **Never speaks the script's stage directions** ("They Respond", section headers,
  parentheticals).
- The customer-approved sales **script and phase-pass criteria are unchanged** — all
  behavior changes are in the rules layer only.

Known minor issue (accepted for now): on the footer **/pages/faq** page, the NOOM
theme-framework interactivity doesn't fully re-initialize after an in-place soft-nav
during a live call. Low impact — the customer is talking to Ema and can get answers
directly. Left as-is by decision.
