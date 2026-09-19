# Ema voice E2E tests

Automated **real-voice** conversations with Ema, used to verify the voice + memory
continuity fixes (and to catch regressions).

## What it does
- Launches Chromium (inside the `hermes-playwright` container) and loads the Ema
  `/demo` page over the internal Docker network (`http://tempest-ema:8080`).
- Overrides `navigator.mediaDevices.getUserMedia` with a synthetic mic driven by
  Web Audio, so we can "speak" arbitrary audio to the widget.
- Generates the customer's speech with **Gemini TTS** (24 kHz PCM — the exact format
  the widget's mic pipeline uses) and plays it into the synthetic mic.
- Reads Ema's spoken replies from the rendered chat transcript (voice turns now
  render there) and asserts behavior.

## Scenarios
1. **S1** — voice round-trip + in-session recall (Grok transcribes the customer; Ema
   recalls the stated product mid-conversation).
2. **S2** — **X-close → reopen**: the exact production bug. Asserts the mic stops on
   close (no silent hot-mic), a visible "Voice ended" indicator appears, and after
   reopening + resuming voice Ema still knows the customer's name/product/budget.
3. **S3** — **full page reload**: after navigating away and back, the conversation is
   restored and voice recall still works.

## Run
```bash
bash scripts/voice-e2e/run.sh
```
Prereqs: the tempest stack is up, `hermes-playwright` is running, and
`deploy/.env` has `GEMINI_API_KEY`. Note: each run makes **real Grok voice calls**
(counts against the daily voice cap) and writes test conversations to Postgres —
clean up test rows afterward if needed.

## Notes / gotchas (learned building this)
- The internal origin is `http://`, so the runner flags it secure with
  `--unsafely-treat-insecure-origin-as-secure` (voice needs a secure context).
- The widget's `stop()` calls `track.stop()` on the mic stream, so the shim hands
  out a **fresh** `MediaStreamDestination` per `getUserMedia` call — otherwise voice
  is dead after the first stop/restart.
- Turn-end is detected from transcript stability, not the status line (the status
  stays "Ema is speaking…" until the next user utterance).
