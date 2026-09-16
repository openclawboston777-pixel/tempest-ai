// Voice test suite: drives real Grok voice conversations against the live Ema
// widget by injecting Gemini-TTS audio as the microphone, then checks the exact
// bugs the user hit (memory loss on X-close/reopen and on reload). Runs in
// hermes-playwright. Prints a compact PASS/FAIL report per scenario.
import pw from "/tmp/vt/node_modules/playwright-core/index.js";
const { chromium } = pw;

const KEY = process.env.GEMINI_API_KEY;
const ORIGIN = process.env.EMA_ORIGIN || "http://tempest-ema:8080";
const URL = ORIGIN + "/demo";
const CHROME = "/ms-playwright/chromium-1237/chrome-linux64/chrome";
const SR = `document.getElementById('tempest-ema-host')?.shadowRoot`;

async function tts(text, voice = "Puck") {
  const model = "gemini-2.5-flash-preview-tts";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`;
  const body = { contents: [{ parts: [{ text: "Read aloud naturally, conversational, only these words: " + text }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } };
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.status === 200) { const j = await r.json(); const b = j?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data; if (b) return b; }
    await new Promise(s => setTimeout(s, 1200));
  }
  throw new Error("TTS failed for: " + text.slice(0, 40));
}

const INIT = `
window.__vt = { ready:false, err:null };
try {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC({ sampleRate: 24000 });
  if (!navigator.mediaDevices) { try { Object.defineProperty(navigator,'mediaDevices',{value:{},configurable:true}); } catch(e){} }
  // Hand out a FRESH destination each getUserMedia call. The widget's stop()
  // calls track.stop() on the returned stream (killing it forever), so reusing one
  // stream would make voice dead on restart. playPCM always targets the current one.
  const fake = async () => { const d = ctx.createMediaStreamDestination(); window.__vt.curDest = d; return d.stream; };
  try { navigator.mediaDevices.getUserMedia = fake; } catch(e){ Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:fake,configurable:true}); }
  window.__vt.playPCM = async (b64) => {
    await ctx.resume();
    let dest = window.__vt.curDest; if (!dest) { dest = ctx.createMediaStreamDestination(); window.__vt.curDest = dest; }
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    const dv = new DataView(bytes.buffer); const n = Math.floor(bytes.byteLength/2);
    const buf = ctx.createBuffer(1, n, 24000); const ch = buf.getChannelData(0);
    for (let i=0;i<n;i++) ch[i] = dv.getInt16(i*2,true)/32768;
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(dest); src.start();
    return buf.duration;
  };
  window.__vt.ready = true;
} catch(e){ window.__vt.err = String(e); }
`;

const msgs = (p) => p.evaluate(`(() => { const s=${SR}; if(!s) return []; return [...s.querySelectorAll('.tw-msg')].map(e=>({k:e.className.includes('user')?'user':(e.className.includes('error')?'error':'ai'),t:e.textContent.trim()})); })()`);
const status = (p) => p.evaluate(`(${SR}?.querySelector('.tw-voice-status')?.textContent)||''`);
const pill = (p) => p.evaluate(`(${SR}?.querySelector('.tw-voice-pill')?.textContent)||''`);
const clickSel = (p, sel) => p.evaluate(`${SR}?.querySelector(${JSON.stringify(sel)})?.click()`);
const sleep = (ms) => new Promise(s => setTimeout(s, ms));

const isActive = (s) => s === "Listening…" || s === "Ema is speaking…" || s === "Thinking…";
async function waitListening(p, secs = 25) {
  for (let i = 0; i < secs * 2; i++) { await sleep(500); if (isActive(await status(p))) return true; }
  return false;
}

// Wait until Ema stops talking: her last AI bubble text is unchanged for ~2s.
// (Status is unreliable for turn-end — it stays "Ema is speaking…" until the next
// user utterance — so we detect quiet purely from the rendered transcript.)
async function waitQuiet(p, maxSecs = 30) {
  let last = null, stable = 0;
  for (let i = 0; i < maxSecs * 2; i++) {
    await sleep(500);
    const ais = (await msgs(p)).filter(x => x.k === "ai");
    const cur = ais.length ? ais[ais.length - 1].t : "";
    if (cur === last) { stable++; if (stable >= 4) return true; } else { last = cur; stable = 0; }
  }
  return true;
}

// Ensure a voice session is live. Never toggles a session that's already on.
async function ensureVoiceOn(p) {
  if (await waitListening(p, 6)) return true;
  for (let a = 0; a < 3; a++) {
    await clickSel(p, 'button.tw-voice[aria-label="Voice"]');
    if (await waitListening(p, 6)) return true;
  }
  return false;
}

// Speak one customer line, then capture Ema's finalized reply (new AI bubble whose
// text stays stable ~2s). Waits for the utterance to fully play + a VAD gap first.
async function say(p, text) {
  await waitQuiet(p, 20); // don't talk over her
  const beforeAi = (await msgs(p)).filter(m => m.k === "ai").length;
  const b64 = await tts(text);
  const dur = await p.evaluate(async (d) => await window.__vt.playPCM(d), b64);
  await sleep(dur * 1000 + 1000);
  let last = "", stable = 0, resp = "";
  for (let i = 0; i < 50; i++) {
    await sleep(700);
    const ais = (await msgs(p)).filter(x => x.k === "ai");
    if (ais.length > beforeAi) {
      const cur = ais[ais.length - 1].t;
      if (cur && cur === last) { stable++; if (stable >= 3) { resp = cur; break; } } else { last = cur; stable = 0; }
    }
  }
  const us = (await msgs(p)).filter(m => m.k === "user");
  return { heard: us.length ? us[us.length - 1].t : "", response: resp };
}

async function openAndStartVoice(p, firstOpen) {
  await clickSel(p, ".tw-bubble");
  await sleep(700);
  if (!firstOpen) await clickSel(p, 'button.tw-voice[aria-label="Voice"]');
  const on = await ensureVoiceOn(p);
  if (on) await waitQuiet(p, 25); // let any greeting turn finish
  return on;
}

const results = [];
function record(name, pass, detail) { results.push({ name, pass, detail }); console.log(`\n[${pass ? "PASS" : "FAIL"}] ${name}\n   ${detail}`); }

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--unsafely-treat-insecure-origin-as-secure=" + ORIGIN] });

  // ---------- Scenario 1: basic round-trip + in-session recall ----------
  try {
    const c = await browser.newContext({ permissions: ["microphone"] });
    const p = await c.newPage(); await p.addInitScript(INIT);
    await p.goto(URL, { waitUntil: "domcontentloaded" }); await sleep(1200);
    await openAndStartVoice(p, true);
    const r1 = await say(p, "Hi, I'm Diana. I'm shopping for a forest green velvet sofa.");
    const heardOk = /diana/i.test(r1.heard) && /green/i.test(r1.heard) && /velvet/i.test(r1.heard);
    const r = await say(p, "Remind me — what color and material sofa did I say I wanted?");
    const recallOk = /green/i.test(r.response) && /velvet/i.test(r.response);
    record("S1 voice round-trip + in-session recall", heardOk && !!r.response && recallOk,
      `heardCorrectly=${heardOk} | recall=${JSON.stringify(r.response.slice(0,150))}`);
    await c.close();
  } catch (e) { record("S1 voice round-trip + in-session recall", false, "ERR " + String(e).slice(0, 160)); }

  // ---------- Scenario 2: X-close then reopen -> must still remember ----------
  try {
    const c = await browser.newContext({ permissions: ["microphone"] });
    const p = await c.newPage(); await p.addInitScript(INIT);
    await p.goto(URL, { waitUntil: "domcontentloaded" }); await sleep(1200);
    await openAndStartVoice(p, true); await sleep(1500);
    await say(p, "Hey, my name is Marcus and I'm after a grey sectional for a small apartment.");
    await say(p, "My budget is about three thousand dollars.");
    // X out to browse
    await clickSel(p, 'button.tw-hbtn[aria-label="Close chat"]'); await sleep(2000);
    const stAfterClose = await status(p); const pillAfterClose = await pill(p);
    const voiceStopped = stAfterClose === "";
    // reopen + restart voice
    await openAndStartVoice(p, false); await sleep(1500);
    const r = await say(p, "Okay I'm back. Remind me — what's my name, and what was I shopping for?");
    const remembered = /marcus/i.test(r.response) && /(grey|gray|sectional)/i.test(r.response);
    record("S2 X-close -> reopen keeps voice memory", remembered && voiceStopped,
      `voiceStoppedOnClose=${voiceStopped} pill=${JSON.stringify(pillAfterClose.slice(0,40))} | reply=${JSON.stringify(r.response.slice(0,170))}`);
    await c.close();
  } catch (e) { record("S2 X-close -> reopen keeps voice memory", false, "ERR " + String(e).slice(0, 160)); }

  // ---------- Scenario 3: full page reload -> must still remember ----------
  try {
    const c = await browser.newContext({ permissions: ["microphone"] });
    const p = await c.newPage(); await p.addInitScript(INIT);
    await p.goto(URL, { waitUntil: "domcontentloaded" }); await sleep(1200);
    await openAndStartVoice(p, true); await sleep(1500);
    await say(p, "Hi, I'm Priya and I'm looking for a cream boucle armchair for a nursery.");
    await sleep(1500); // let close/flush + persistence settle
    // navigate away and back (browsing) then reload the widget page
    await p.goto(URL, { waitUntil: "domcontentloaded" }); await sleep(1800);
    const restored = (await msgs(p)).some(m => /priya|boucle|armchair|nursery/i.test(m.t));
    await openAndStartVoice(p, false); await sleep(1500);
    const r = await say(p, "Hey again — do you remember my name and what I was looking for?");
    const remembered = /priya/i.test(r.response) && /(boucle|armchair|cream|nursery)/i.test(r.response);
    record("S3 reload keeps voice memory", remembered, `restoredInDOM=${restored} | reply=${JSON.stringify(r.response.slice(0,170))}`);
    await c.close();
  } catch (e) { record("S3 reload keeps voice memory", false, "ERR " + String(e).slice(0, 160)); }

  await browser.close();
  const passed = results.filter(r => r.pass).length;
  console.log(`\n==== VOICE SUITE: ${passed}/${results.length} passed ====`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.log("SUITE ERROR:", String(e && e.stack || e)); process.exit(2); });
