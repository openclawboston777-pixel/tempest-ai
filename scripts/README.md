# Ema eval harness

`eval.mjs` runs a battery of realistic customer scenarios against a running backend
(`http://localhost:8080` by default) and scores grounding / no-hallucination / correct
behavior (order-verification gate, prompt-injection refusal, out-of-catalog honesty, etc.).

Run inside the backend container: `node /tmp/eval.mjs` (copy it in), or locally against
a running `npm run dev` backend. Baseline 2026-09-10: 13/13 pass, avg ~2.9s
(note: "tell me about <product>" can be slow — see reliability timeouts).
