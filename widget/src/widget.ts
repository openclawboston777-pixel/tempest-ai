import { VoiceSession } from "./voice.js";
import { Proactive } from "./proactive.js";
import { VisualizePanel } from "./visualize.js";
import { DealLock } from "./dealLock.js";
import { STYLES } from "./styles";

function makeWidgetSessionId(): string {
  // Persist an anonymous visitor id so a returning shopper (same browser) is
  // recognized across visits. The id is a capability that grants access to that
  // visitor's stored memory, so it MUST be cryptographically unguessable — and
  // we refuse to PERSIST a weak id (no secure RNG => ephemeral, memory disabled).
  const KEY = "tw_visitor_id";
  const c = (globalThis as any).crypto as Crypto | undefined;
  const secureId = (): string | null => {
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    if (c && typeof c.getRandomValues === "function") {
      const b = new Uint8Array(16);
      c.getRandomValues(b);
      return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    }
    return null; // no CSPRNG available
  };
  try {
    const existing = window.localStorage.getItem(KEY);
    if (existing && /^[A-Za-z0-9_-]{1,64}$/.test(existing)) return existing;
    const id = secureId();
    if (!id) {
      // No secure randomness: use a non-persisted ephemeral id so we never store
      // a guessable one. Cross-visit memory is disabled this session (acceptable).
      return "eph-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }
    window.localStorage.setItem(KEY, id);
    return id;
  } catch {
    return secureId() || "eph-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
}

interface TempestConfig {
  backendUrl?: string;
  assistantName?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  // "voice" = a spoken turn. Kept in this.messages (memory, backend recall,
  // continuity) but NEVER rendered as a text bubble. Absent = a typed chat turn.
  channel?: "voice";
}

declare global {
  interface Window {
    TempestConfig?: TempestConfig;
  }
}

// Where is this embed.js being served from? If the store forgets to set
// window.TempestConfig.backendUrl, we self-configure to the origin that served
// embed.js (e.g. https://ema.tempestfurnitur.com) — production-safe. localhost is
// only a last-resort dev fallback.
const SCRIPT_ORIGIN: string = (() => {
  try {
    const s = document.currentScript as HTMLScriptElement | null;
    if (s && s.src) return new URL(s.src).origin;
  } catch {
    /* ignore */
  }
  return "";
})();

const CFG: Required<TempestConfig> = {
  backendUrl: window.TempestConfig?.backendUrl || SCRIPT_ORIGIN || "http://localhost:8080",
  assistantName: window.TempestConfig?.assistantName || "Ema"
};

// Continuity across page navigations (same browser): Ema's script tells the
// customer to close the chat and keep browsing — "I'll still be here." The store
// reloads the widget on every navigation, so we persist the conversation, the
// open/closed state, and whether a voice call was live, and restore them on load.
const HISTORY_KEY = "tw_chat_history";
const OPEN_KEY = "tw_panel_open";
const VOICE_ACTIVE_KEY = "tw_voice_active";
const HISTORY_MAX = 50;
const OPEN_RESTORE_MS = 30 * 60 * 1000; // reopen if navigated within 30 min
const VOICE_RESUME_MS = 5 * 60 * 1000; // offer voice resume within 5 min

// Soft navigation is normally active only during a live voice call. This flag lets
// automated tests (and, if ever needed, config) force it on without a real call.
const softNavForce = { on: false };

// Master kill-switch for soft navigation in production. Enabled after automated
// tests proved soft-load renders pages identically to a full load on the live NOOM
// store (collection + product parity: text, product cards, images, no leftover
// lazy placeholders, no new errors) and that in-drawer links navigate + auto-close
// the menu. Soft-nav still only runs DURING a live voice call; normal browsing is
// untouched, and any failure falls back to a normal navigation.
const SOFTNAV_ENABLED = true;

/* ---- Icons ---- */
// Sparkle: one large 4-point star + one small 4-point star.
const SPARKLE = (size = 24) => `
<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="#FFFFFF" aria-hidden="true">
  <path d="M14 2c.3 2.9 1.6 4.2 4.5 4.5C15.6 6.8 14.3 8.1 14 11c-.3-2.9-1.6-4.2-4.5-4.5C12.4 6.2 13.7 4.9 14 2z"/>
  <path d="M7 12.5c.2 2 1.1 2.9 3.1 3.1-2 .2-2.9 1.1-3.1 3.1-.2-2-1.1-2.9-3.1-3.1 2-.2 2.9-1.1 3.1-3.1z"/>
</svg>`;

const CLOSE_ICON = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
  <path d="M6 6l12 12M18 6L6 18"/>
</svg>`;

const MORE_ICON = `
<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <circle cx="5" cy="12" r="2"/>
  <circle cx="12" cy="12" r="2"/>
  <circle cx="19" cy="12" r="2"/>
</svg>`;

const SEND_ICON = `
<svg viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 19V5M5 12l7-7 7 7"/>
</svg>`;

const MIC_ICON = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="9" y="2" width="6" height="12" rx="3"/>
  <path d="M5 11a7 7 0 0 0 14 0M12 18v4"/>
</svg>`;

const ROOM_ICON = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="4" width="18" height="14" rx="2"/>
  <circle cx="8.5" cy="9.5" r="1.5"/>
  <path d="M21 15l-5-5L5 18"/>
</svg>`;

class TempestWidget {
  private root: HTMLDivElement;
  private launcher!: HTMLDivElement;
  private bubble!: HTMLButtonElement;
  private panel!: HTMLDivElement;
  private messagesEl!: HTMLDivElement;
  private voice!: VoiceSession;
  private voiceBtn?: HTMLButtonElement;
  private visualize?: VisualizePanel;
  private dealLock?: DealLock;
  private sessionId = makeWidgetSessionId();
  private firstOpened = false;
  private proactive?: Proactive;
  private input!: HTMLInputElement;
  private sendBtn!: HTMLButtonElement;
  private messages: ChatMessage[] = [];
  private isOpen = false;
  private isStreaming = false;
  private voiceLive = false;
  private voicePill?: HTMLDivElement;
  private voicePillLabel?: HTMLSpanElement;
  private voicePillEnd?: HTMLButtonElement;
  private pillTimer?: number;
  private lastVoiceRole?: "user" | "ai";
  // Cross-page voice recall: how many voice turns we've already persisted to the
  // backend, plus a debounce handle. Lets us append each finalized spoken turn to
  // Postgres DURING the call so recall survives an abrupt navigation.
  private voicePersistedCount = 0;
  private voicePersistTimer?: number;
  // Set on load when a live voice call was ongoing on the previous page, so the
  // next tap RESUMES (no re-introduction) instead of starting a fresh greeting.
  private resumePending = false;

  constructor(shadow: ShadowRoot) {
    this.root = document.createElement("div");
    this.root.className = "tw-root";
    // Restore any prior conversation for this browser before building the panel so
    // the greeting/replay logic knows whether this is a returning session.
    this.messages = this.loadHistory();
    // Voice turns restored from a previous page were already persisted server-side
    // there, so start the counter past them — otherwise a resume would re-save them
    // as duplicates in backend memory.
    this.voicePersistedCount = this.messages.filter(
      (m) => m.channel === "voice" && m.content && m.content.trim(),
    ).length;
    this.buildLauncher();
    this.buildPanel();
    shadow.appendChild(this.root);
  }

  private buildLauncher() {
    this.launcher = document.createElement("div");
    this.launcher.className = "tw-launcher";

    const pulse = document.createElement("div");
    pulse.className = "tw-pulse";

    this.bubble = document.createElement("button");
    this.bubble.className = "tw-bubble";
    this.bubble.setAttribute("aria-label", `Chat with ${CFG.assistantName}`);
    this.bubble.innerHTML = SPARKLE(24);
    this.bubble.addEventListener("click", () => this.open());

    this.launcher.appendChild(pulse);
    this.launcher.appendChild(this.bubble);
    this.root.appendChild(this.launcher);
  }

  private buildPanel() {
    this.panel = document.createElement("div");
    this.panel.className = "tw-panel";
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-label", `${CFG.assistantName} assistant`);

    // Drag handle (mobile)
    const handle = document.createElement("div");
    handle.className = "tw-handle";

    // Header
    const header = document.createElement("div");
    header.className = "tw-header";
    header.innerHTML = `
      <div class="tw-avatar">${SPARKLE(16)}</div>
      <div class="tw-title">
        <span class="tw-name">${escapeHtml(CFG.assistantName)}</span>
        <span class="tw-status"><span class="tw-dot"></span>Online</span>
      </div>`;

    const moreBtn = document.createElement("button");
    moreBtn.className = "tw-hbtn";
    moreBtn.setAttribute("aria-label", "More options");
    moreBtn.innerHTML = MORE_ICON;
    // TODO: wire up more-options menu in a future slice (visual only for now).

    const closeBtn = document.createElement("button");
    closeBtn.className = "tw-hbtn";
    closeBtn.setAttribute("aria-label", "Close chat");
    closeBtn.innerHTML = CLOSE_ICON;
    closeBtn.addEventListener("click", () => this.close());

    header.appendChild(moreBtn);
    header.appendChild(closeBtn);

    // Messages
    this.messagesEl = document.createElement("div");
    this.messagesEl.className = "tw-messages";

    // Footer
    const footer = document.createElement("div");
    footer.className = "tw-footer";

    this.input = document.createElement("input");
    this.input.className = "tw-input";
    this.input.type = "text";
    this.input.placeholder = "Type a message...";
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });

    const roomBtn = document.createElement("button");
    roomBtn.className = "tw-voice";
    roomBtn.setAttribute("aria-label", "See it in your room");
    roomBtn.title = "See it in your room";
    roomBtn.innerHTML = ROOM_ICON;
    this.visualize = new VisualizePanel(
      CFG.backendUrl,
      this.root,
      this.sessionId,
      (dataUrl, productTitle) => this.addImageMessage(dataUrl, productTitle),
    );
    roomBtn.addEventListener("click", () => this.visualize?.open());

    const voiceBtn = document.createElement("button");
    voiceBtn.className = "tw-voice";
    voiceBtn.setAttribute("aria-label", "Voice");
    voiceBtn.innerHTML = MIC_ICON;
    this.voice = new VoiceSession(CFG.backendUrl, this.root, {
      onTranscript: (role, text, opts) =>
        this.onVoiceTranscript(role, text, opts?.replace === true),
      visitorId: this.sessionId,
      onStatus: (text) => this.onVoiceStatus(text),
      onActiveChange: (active) => this.onVoiceActiveChange(active),
      onCard: (card) => this.renderLinkCard(card),
    });
    this.voiceBtn = voiceBtn;
    voiceBtn.addEventListener("click", () => this.voice.toggle(voiceBtn));

    this.sendBtn = document.createElement("button");
    this.sendBtn.className = "tw-send";
    this.sendBtn.setAttribute("aria-label", "Send message");
    this.sendBtn.innerHTML = SEND_ICON;
    this.sendBtn.addEventListener("click", () => this.send());

    footer.appendChild(this.input);
    footer.appendChild(roomBtn);
    footer.appendChild(voiceBtn);
    footer.appendChild(this.sendBtn);

    // Pinned mount point for the Deal Lock countdown (between header and messages).
    const dealLockMount = document.createElement("div");
    dealLockMount.className = "tw-deallock-mount";

    this.panel.appendChild(handle);
    this.panel.appendChild(header);
    this.panel.appendChild(dealLockMount);
    this.panel.appendChild(this.messagesEl);
    this.panel.appendChild(footer);
    this.root.appendChild(this.panel);

    this.dealLock = new DealLock(CFG.backendUrl, this.sessionId, dealLockMount);
    this.dealLock.start();

    // Restore the prior conversation (Ema is "still here" across page loads) or
    // show the first-time greeting if this is a fresh visitor. Voice turns are
    // filtered from the RENDER only — this.messages itself stays complete so
    // memory, backend recall, and continuity still see the whole conversation.
    const visible = this.messages.filter((m) => m.channel !== "voice");
    if (visible.length > 0) {
      for (const m of visible) {
        this.addMessage(m.role === "assistant" ? "ai" : "user", m.content);
      }
    } else {
      this.addMessage("ai", `Hi! I'm ${CFG.assistantName}. How can I help you today?`);
    }
    this.proactive = new Proactive(this.launcher, this.root, (seed) => { this.open(); if (seed) this.addMessage("ai", seed); }, { voiceGreetingUrl: CFG.backendUrl + "/voice-greeting.mp3" });
    this.proactive.start();

    // Restore panel/voice state from a prior page and persist it on exit.
    this.installContinuity();
  }

  private open() {
    if (this.isOpen) return;
    this.proactive?.suppress();
    this.isOpen = true;
    this.persistOpenState(true);
    this.hideVoicePill();
    this.launcher.classList.add("tw-hidden");
    // ensure transition triggers
    requestAnimationFrame(() => this.panel.classList.add("tw-open"));
    setTimeout(() => this.input.focus(), 320);
    if (!this.firstOpened) {
      this.firstOpened = true;
      if ((CFG as any).proactiveVoice !== false) {
        this.addMessage("ai", "\u{1F399}\uFE0F Heads up: voice chats may be recorded to help improve our service.");
        void this.voice.startProactive(this.voiceBtn);
      }
    }
  }

  private close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.persistOpenState(false);
    this.panel.classList.remove("tw-open");
    setTimeout(() => this.launcher.classList.remove("tw-hidden"), 180);
    // The X only hides the chat window — it does NOT end the voice call, so the
    // customer can free up the screen and keep browsing while still talking to Ema
    // (her script: "close this chat and keep looking around, I'll still be here").
    // A persistent pill shows the call is still live (no silent background mic), and
    // the MIC button is how you actually end the voice conversation. Voice turns keep
    // persisting to history, so reopening shows the full conversation.
    if (this.voiceLive) {
      // Flush the conversation to the backend now — the customer often hits X to keep
      // browsing and then changes pages, so make sure recall is saved before they go.
      this.persistVoiceTurns(true);
      this.showVoicePill("\u{1F399}️ Ema is still listening — tap to reopen", { showEnd: true });
      // Fail-closed: never leave a hot mic with no visible disclosure. If the
      // live-mic indicator didn't actually render, end the call instead.
      if (!this.voicePillVisible()) {
        try { this.voice.stop(); } catch { /* ignore */ }
      }
    }
  }

  // Reconnect a voice call that was live on a previous page. Opens the panel and
  // starts the session in RESUME mode so Ema picks up where she left off (backend
  // re-injects the recent conversation + profile) instead of re-introducing herself.
  private resumeVoice(): void {
    this.resumePending = false;
    this.firstOpened = true; // never trigger the first-open proactive intro here
    this.open();
    this.hideVoicePill();
    void this.voice.startProactive(this.voiceBtn, { resume: true });
  }

  private addMessage(kind: "ai" | "user" | "error", text: string): HTMLDivElement {
    const el = document.createElement("div");
    el.className = `tw-msg ${kind}`;
    el.textContent = text;
    this.messagesEl.appendChild(el);
    this.scrollToBottom();
    return el;
  }

  private addImageMessage(dataUrl: string, caption: string): void {
    const el = document.createElement("div");
    el.className = "tw-msg ai tw-msg-image";
    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = caption ? `${caption} in your room` : "Your room visualization";
    img.style.cssText = "max-width:100%;border-radius:10px;display:block;";
    el.appendChild(img);
    if (caption) {
      const cap = document.createElement("div");
      cap.className = "tw-msg-caption";
      cap.textContent = caption;
      cap.style.cssText = "font-size:12px;opacity:0.75;margin-top:4px;";
      el.appendChild(cap);
    }
    this.messagesEl.appendChild(el);
    this.scrollToBottom();
  }

  // Renders a tappable link/code card in the chat when the voice agent calls
  // show_in_chat — so URLs and codes are shown visually and never read aloud.
  private renderLinkCard(card: { label?: string; url?: string; code?: string }): void {
    const label = (card.label || "").toString().trim();
    const url = (card.url || "").toString().trim();
    const code = (card.code || "").toString().trim();
    // Only render real http(s) links; ignore anything else to avoid junk cards.
    const safeUrl = /^https?:\/\//i.test(url) ? url : "";
    if (!safeUrl && !code) return;

    const el = document.createElement("div");
    el.className = "tw-msg ai tw-msg-card";

    if (label) {
      const lab = document.createElement("div");
      lab.className = "tw-card-label";
      lab.textContent = label;
      lab.style.cssText = "font-weight:600;margin-bottom:6px;";
      el.appendChild(lab);
    }

    if (safeUrl) {
      const a = document.createElement("a");
      a.href = safeUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "tw-card-link";
      // Show a friendly link, not a raw URL wall.
      a.textContent = label ? "Open link →" : safeUrl;
      a.style.cssText =
        "display:inline-block;color:#2563eb;text-decoration:underline;word-break:break-all;";
      el.appendChild(a);
    }

    if (code) {
      const codeEl = document.createElement("div");
      codeEl.className = "tw-card-code";
      codeEl.textContent = `Code: ${code}`;
      codeEl.style.cssText =
        "margin-top:6px;font-family:monospace;font-weight:700;letter-spacing:0.5px;";
      el.appendChild(codeEl);
    }

    this.messagesEl.appendChild(el);
    this.scrollToBottom();
  }

  private scrollToBottom() {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private async send() {
    const text = this.input.value.trim();
    if (!text || this.isStreaming) return;

    this.input.value = "";
    this.addMessage("user", text);
    this.messages.push({ role: "user", content: text });
    this.saveHistory();

    this.isStreaming = true;
    this.sendBtn.disabled = true;

    // typing indicator bubble
    const aiEl = document.createElement("div");
    aiEl.className = "tw-msg ai";
    aiEl.innerHTML = `<span class="tw-typing"><span></span><span></span><span></span></span>`;
    this.messagesEl.appendChild(aiEl);
    this.scrollToBottom();

    let acc = "";
    let started = false;

    try {
      const res = await fetch(`${CFG.backendUrl}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: this.messages, sessionId: this.sessionId })
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const flushDelta = (delta: string) => {
        if (!started) {
          aiEl.textContent = "";
          started = true;
        }
        acc += delta;
        aiEl.textContent = acc;
        this.scrollToBottom();
      };

      let done = false;
      while (!done) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") { done = true; break; }
          try {
            const delta = JSON.parse(payload);
            if (typeof delta === "string") flushDelta(delta);
          } catch {
            // ignore malformed chunk
          }
        }
      }

      if (!started) {
        // No content arrived
        aiEl.remove();
        this.addMessage("error", "Sorry, I couldn't reach the assistant.");
      } else {
        this.messages.push({ role: "assistant", content: acc });
        this.saveHistory();
      }
    } catch {
      aiEl.remove();
      this.addMessage("error", "Sorry, I couldn't reach the assistant.");
    } finally {
      this.isStreaming = false;
      this.sendBtn.disabled = false;
      this.input.focus();
    }
  }

  /* ---- Cross-page continuity ---- */

  private loadHistory(): ChatMessage[] {
    try {
      const raw = window.localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr
        .filter(
          (m: unknown): m is ChatMessage =>
            !!m &&
            ((m as ChatMessage).role === "user" || (m as ChatMessage).role === "assistant") &&
            typeof (m as ChatMessage).content === "string",
        )
        // Normalize the channel marker: only the exact string "voice" counts, so a
        // malformed stored value can never masquerade as (or corrupt) a voice turn.
        .map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.channel === "voice" ? { channel: "voice" as const } : {}),
        }))
        .slice(-HISTORY_MAX);
    } catch {
      return [];
    }
  }

  private saveHistory(): void {
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(this.messages.slice(-HISTORY_MAX)));
    } catch {
      /* ignore (quota/private mode) */
    }
  }

  private persistOpenState(open: boolean): void {
    try {
      if (open) window.localStorage.setItem(OPEN_KEY, String(Date.now()));
      else window.localStorage.removeItem(OPEN_KEY);
    } catch {
      /* ignore */
    }
  }

  private installContinuity(): void {
    // Restore the panel + voice affordance from the page the customer came from.
    try {
      const openTs = Number(window.localStorage.getItem(OPEN_KEY) || "0");
      const wasOpen = openTs > 0 && Date.now() - openTs < OPEN_RESTORE_MS;

      const voiceTs = Number(window.localStorage.getItem(VOICE_ACTIVE_KEY) || "0");
      const voiceWasLive = voiceTs > 0 && Date.now() - voiceTs < VOICE_RESUME_MS;
      window.localStorage.removeItem(VOICE_ACTIVE_KEY);

      // Any restored session (panel was open OR a call was live) must NOT trigger the
      // first-open proactive intro — otherwise Ema re-introduces herself ("Hi, I'm
      // Ema, what's your name?") mid-relationship, which is exactly the bug we're fixing.
      if (wasOpen || voiceWasLive) {
        this.firstOpened = true;
      }
      if (voiceWasLive) {
        // A live voice call was ongoing when they changed pages (a full navigation
        // tears down the WebSocket, so the call can't literally stay connected).
        // Offer a one-tap RESUME that reconnects WITH full memory and NO re-intro.
        // Browsers block auto-starting the mic without a gesture, so we can't silently
        // reconnect — but the resume is seamless the moment they tap.
        this.resumePending = true;
        if (wasOpen) this.open();
        this.showVoicePill(
          "\u{1F399}️ Tap to pick our voice chat back up — I've got everything we discussed",
          { showEnd: true },
        );
      } else if (wasOpen) {
        this.open();
      }
    } catch {
      /* ignore */
    }

    // Persist continuity state whenever the page is navigated away / hidden.
    try {
      const persist = (): void => {
        this.persistOpenState(this.isOpen);
        try {
          if (this.voiceLive) {
            window.localStorage.setItem(VOICE_ACTIVE_KEY, String(Date.now()));
            // Make sure the running conversation is saved server-side before we leave.
            this.persistVoiceTurns(true);
          }
        } catch {
          /* ignore */
        }
      };
      window.addEventListener("pagehide", persist);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") persist();
      });
    } catch {
      /* ignore */
    }

    this.installSoftNav();
  }

  /* ---- Soft navigation (keep a live voice call alive across page changes) ----
     A normal link click = a full page load, which destroys the JS context and with
     it the live voice WebSocket + mic. To keep Ema talking while the customer
     browses, we intercept same-origin link clicks DURING A LIVE CALL and swap the
     theme's <main id="MainContent"> in place (fetch + History API) instead of
     reloading. The widget host lives on <body>, OUTSIDE #MainContent, so it — and
     the running call — are never torn down. This is the Turbo/pjax "permanent
     element" technique. It is active ONLY during a live voice call (or when forced
     for tests); normal browsing is completely untouched. Any uncertainty or failure
     falls back to a normal navigation, so it can never break the store. */

  private softNavUsed = false;

  private softNavActive(): boolean {
    // Kill-switch: while SOFTNAV_ENABLED is false, soft-nav never runs for real
    // customers (production behaves exactly like a normal site + resume-on-tap).
    // Tests can still exercise it via window.__tempestSoftNav(true).
    return (SOFTNAV_ENABLED && this.voiceLive) || softNavForce.on;
  }

  private installSoftNav(): void {
    try {
      document.addEventListener("click", (e) => this.onDocClick(e), false);
      window.addEventListener("popstate", () => {
        if (!this.softNavUsed) return;
        this.softNavigate(new URL(window.location.href), false).catch(() => {
          window.location.reload();
        });
      });
    } catch {
      /* ignore */
    }
  }

  private onDocClick(e: MouseEvent): void {
    try {
      // Only ever change navigation behaviour while a call is actually live.
      if (!this.softNavActive()) return;
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const path = e.composedPath ? e.composedPath() : [];
      let a: HTMLAnchorElement | null = null;
      for (const n of path) {
        if (n instanceof HTMLAnchorElement) { a = n; break; }
      }
      if (!a) {
        const t = e.target as HTMLElement | null;
        a = t && t.closest ? (t.closest("a") as HTMLAnchorElement | null) : null;
      }
      if (!a) return;

      // Respect explicit opt-outs and special links.
      const target = a.getAttribute("target");
      if (target && target !== "_self") return;
      if (a.hasAttribute("download")) return;
      const rel = (a.getAttribute("rel") || "").toLowerCase();
      if (rel.includes("external") || rel.includes("nofollow")) return;
      if (a.getAttribute("data-no-instant") != null) return;

      const rawHref = a.getAttribute("href") || "";
      if (!rawHref || rawHref.startsWith("#") || /^(mailto:|tel:|javascript:)/i.test(rawHref)) return;

      let url: URL;
      try { url = new URL(a.href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin) return; // never touch off-site links

      // Same page (hash only) — let the browser handle it.
      if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return;

      // Never intercept checkout / cart-permalink / account flows — those must be
      // real navigations (discount permalinks redirect straight to checkout).
      if (/^\/(checkout|account)(\/|$)/.test(url.pathname)) return;
      if (/^\/cart\//.test(url.pathname)) return; // /cart/{variant}:1?discount=... permalinks
      // Non-page asset links.
      if (/\.(pdf|jpg|jpeg|png|gif|webp|svg|zip|mp4|mp3|csv|xlsx?|docx?)$/i.test(url.pathname)) return;

      // Looks like a normal in-store page navigation → soft-navigate instead.
      e.preventDefault();
      void this.softNavigate(url, true);
    } catch {
      /* let the browser navigate normally */
    }
  }

  private recreateScript(old: HTMLScriptElement): HTMLScriptElement {
    const s = document.createElement("script");
    for (const attr of Array.from(old.attributes)) s.setAttribute(attr.name, attr.value);
    s.text = old.text;
    return s;
  }

  private async softNavigate(url: URL, push: boolean): Promise<void> {
    let res: Response;
    try {
      res = await fetch(url.href, {
        headers: { "X-Requested-With": "fetch" },
        credentials: "same-origin",
        redirect: "follow",
      });
      const ctype = res.headers.get("content-type") || "";
      if (!res.ok || !/text\/html/i.test(ctype)) throw new Error("not html");
      const finalUrl = new URL(res.url || url.href);
      // A redirect off-origin (e.g. to checkout) → hand back to the browser.
      if (finalUrl.origin !== window.location.origin) throw new Error("off-origin redirect");

      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const nextMain = doc.getElementById("MainContent");
      const curMain = document.getElementById("MainContent");
      if (!nextMain || !curMain) throw new Error("no MainContent");

      // Pull in any stylesheets the new page needs that this page doesn't have.
      const haveCss = new Set(
        Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(
          (l) => (l as HTMLLinkElement).href,
        ),
      );
      doc.querySelectorAll('head link[rel="stylesheet"]').forEach((link) => {
        if (!haveCss.has((link as HTMLLinkElement).href)) {
          document.head.appendChild(link.cloneNode(true));
        }
      });

      const main = document.importNode(nextMain, true);
      // Scripts parsed by DOMParser never run — recreate the ones this page hasn't
      // already loaded so they execute (web-component themes like NOOM re-init on
      // insertion automatically; this covers any inline/new page scripts too).
      const haveJs = new Set(
        Array.from(document.querySelectorAll("script[src]")).map(
          (s) => (s as HTMLScriptElement).src,
        ),
      );
      // Track newly-inserted external scripts (esp. section ES modules like
      // section-faq.build.min.js) so we can wait for them to LOAD before firing the
      // section-init event — otherwise a module that registers its init listener
      // asynchronously misses the event and the page never wires up.
      const newScriptLoads: Promise<void>[] = [];
      main.querySelectorAll("script").forEach((old) => {
        const scriptEl = old as HTMLScriptElement;
        if (scriptEl.src && haveJs.has(scriptEl.src)) { scriptEl.remove(); return; }
        const fresh = this.recreateScript(scriptEl);
        if (fresh.src) {
          newScriptLoads.push(new Promise<void>((res) => {
            fresh.addEventListener("load", () => res(), { once: true });
            fresh.addEventListener("error", () => res(), { once: true });
          }));
        }
        scriptEl.replaceWith(fresh);
      });

      curMain.replaceWith(main);
      document.title = doc.title;
      this.syncCartCount(doc);

      // NOOM lazy-loads images via data-src/data-srcset watched by an observer that
      // only knows about the ORIGINAL page's nodes — the swapped-in images would never
      // load. Promote them now, and keep promoting any that section-hydration injects
      // over the next few seconds (galleries/sliders/related products).
      this.watchAndPromote(3000);

      // A link clicked inside the mobile menu/search drawer would otherwise leave the
      // drawer stuck open (no full reload to tear it down). Close any open overlay.
      this.closeOpenOverlays();

      if (push) {
        history.pushState(
          { tempestSoftNav: true },
          "",
          finalUrl.pathname + finalUrl.search + finalUrl.hash,
        );
      }
      this.softNavUsed = true;
      window.scrollTo(0, 0);

      // Re-hydrate the theme. NOOM (like all Shopify themes) wires section JS to the
      // "shopify:section:load" lifecycle event (that's how the theme editor re-inits a
      // section without a reload). Fire it per section so sliders, galleries, variant
      // pickers, FAQ modules, etc. initialise. Dispatch it ONCE, but only AFTER any new
      // section scripts have finished loading, so async-registered listeners (e.g. the
      // FAQ page's section module) actually receive it. Each dispatch is isolated so one
      // bad section can't abort the rest.
      const dispatchSectionLoad = () => {
        main.querySelectorAll('[id^="shopify-section-"]').forEach((sec) => {
          try {
            const sectionId = sec.id.replace(/^shopify-section-/, "");
            sec.dispatchEvent(
              new CustomEvent("shopify:section:load", {
                bubbles: true,
                detail: { sectionId, load: true },
              }),
            );
          } catch {
            /* one section failing must not stop the others */
          }
        });
      };
      if (newScriptLoads.length) {
        let fired = false;
        const fireOnce = () => { if (!fired) { fired = true; dispatchSectionLoad(); } };
        void Promise.all(newScriptLoads).then(fireOnce);
        window.setTimeout(fireOnce, 2500); // fallback if a script never loads
      } else {
        dispatchSectionLoad();
      }

      // Let the theme (and any app embeds) know the page changed.
      document.dispatchEvent(
        new CustomEvent("tempest:soft-navigate", { detail: { path: finalUrl.pathname } }),
      );
    } catch {
      // Anything unexpected → do a normal navigation so the store never breaks.
      window.location.href = url.href;
    }
  }

  // Force lazy-loaded images to load after a swap. NOOM defers images with
  // data-src / data-srcset (and <source data-srcset>) and loads them via an
  // observer that only tracks the original page's nodes; the swapped-in images
  // would stay blank. Promoting them to real src/srcset renders them immediately.
  private promoteLazyImages(root: ParentNode): void {
    try {
      root.querySelectorAll("img[data-src]").forEach((el) => {
        const v = el.getAttribute("data-src");
        if (v) { (el as HTMLImageElement).src = v; el.removeAttribute("data-src"); }
      });
      root.querySelectorAll("img[data-srcset], source[data-srcset]").forEach((el) => {
        const v = el.getAttribute("data-srcset");
        if (v) { (el as HTMLImageElement).setAttribute("srcset", v); el.removeAttribute("data-srcset"); }
      });
      // Any element that flags lazy state via class — mark as loaded so CSS reveals it.
      root.querySelectorAll(".lazyload, .lazy, .is-loading").forEach((el) => {
        el.classList.remove("lazyload", "lazy", "is-loading");
        el.classList.add("lazyloaded", "is-loaded");
      });
    } catch {
      /* ignore */
    }
  }

  // Reveal scroll-in animations. NOOM hides many elements with class `need-animate`
  // (opacity:0) and reveals them via an IntersectionObserver that only tracks the
  // ORIGINAL page's nodes — so after a swap, headings/text/blocks stay invisible
  // ("only a photo or two shows, all text vanished"). We reveal them directly. We
  // ONLY touch `need-animate` — never `visually-hidden`, inactive carousel slides,
  // hover images, or collapsed accordions, which are hidden BY DESIGN.
  private revealAnimated(root: ParentNode): void {
    try {
      root.querySelectorAll(".need-animate").forEach((el) => {
        const s = (el as HTMLElement).style;
        s.opacity = "1";
        s.transform = "none";
        s.visibility = "visible";
        el.classList.remove("need-animate");
      });
    } catch {
      /* ignore */
    }
  }

  // Repair accordions (e.g. the FAQ blocks on the financing page). NOOM wires them in
  // an ES-module bundle that ran once on the first page load and CANNOT be re-run, so
  // accordion buttons in soft-swapped content never get their click handler and won't
  // expand. We attach our own handler that fires ONLY when the theme didn't handle the
  // click (state didn't change) — so it repairs broken ones without double-toggling any
  // the theme does bind, and it can't break anything. Scoped to #MainContent so it never
  // touches the header/cart-drawer accordions the theme already handles.
  private repairAccordions(root: ParentNode): void {
    try {
      root.querySelectorAll("button.js-accordion-control").forEach((el) => {
        const btn = el as HTMLButtonElement;
        if (btn.getAttribute("data-tw-acc")) return; // already repaired
        btn.setAttribute("data-tw-acc", "1");
        btn.addEventListener("click", () => {
          const wasOpen = btn.getAttribute("aria-expanded") === "true";
          const cid = btn.getAttribute("aria-controls");
          const content = cid ? document.getElementById(cid) : null;
          window.setTimeout(() => {
            // If the theme's own handler already toggled it, do nothing.
            if ((btn.getAttribute("aria-expanded") === "true") !== wasOpen) return;
            const open = !wasOpen;
            btn.setAttribute("aria-expanded", String(open));
            const item = btn.closest(".accordion__item, .js-accordion-item") as HTMLElement | null;
            if (item) { item.classList.toggle("is-open", open); item.classList.toggle("is-active", open); }
            if (content) {
              const cs = content.style;
              if (open) {
                content.removeAttribute("hidden");
                cs.maxHeight = "none"; cs.height = "auto"; cs.overflow = "visible"; cs.visibility = "visible";
                if (getComputedStyle(content).display === "none") cs.display = "block";
              } else {
                cs.maxHeight = ""; cs.height = ""; cs.overflow = ""; cs.display = "";
              }
            }
          }, 60);
        });
      });
    } catch {
      /* ignore */
    }
  }

  // Section hydration (galleries, sliders, related products) can inject MORE lazy
  // images / animated blocks after the initial swap. Watch #MainContent for a short
  // window and normalise (promote lazy images + reveal need-animate) anything added,
  // so nothing stays blank or invisible. Self-disconnects.
  private watchAndPromote(ms: number): void {
    try {
      const root = document.getElementById("MainContent");
      if (!root || typeof MutationObserver === "undefined") return;
      const normalise = () => { this.promoteLazyImages(root); this.revealAnimated(root); this.repairAccordions(root); };
      normalise();
      const obs = new MutationObserver(normalise);
      obs.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-src", "data-srcset"],
      });
      window.setTimeout(() => {
        try { normalise(); obs.disconnect(); } catch { /* ignore */ }
      }, ms);
    } catch {
      /* ignore */
    }
  }

  // A link clicked inside NOOM's mobile menu/search/cart drawer would otherwise leave
  // the drawer's dark overlay AND its body scroll-lock in place after a soft nav (a
  // real full load would have torn them down). NOOM's exact mechanism (confirmed by
  // inspecting the live store): drawer + `.window-overlay` get `is-active`, the toggler
  // gets aria-expanded=true, and body gets inline `overflow:hidden` + class
  // `scroll-padding-0`. We (1) trigger the theme's OWN close by clicking the active
  // overlay so its internal state stays consistent, then (2) hard-reset those exact
  // artifacts as a fallback so the page is never left dimmed or unscrollable.
  private closeOpenOverlays(): void {
    try {
      // 1) Theme's own close — clicking the scrim is NOOM's documented close path.
      document
        .querySelectorAll(".window-overlay.is-active, .drawer__overlay.is-active, .js-drawer-overlay.is-active")
        .forEach((o) => { try { (o as HTMLElement).click(); } catch { /* ignore */ } });

      // 2) Hard-reset fallback — remove the exact open-state artifacts.
      document
        .querySelectorAll(".window-overlay.is-active, .drawer.is-active, .drawer--active, .drawer.is-open, [data-drawer].is-open")
        .forEach((d) => d.classList.remove("is-active", "drawer--active", "is-open"));
      document.querySelectorAll('[aria-expanded="true"]').forEach((el) =>
        el.setAttribute("aria-expanded", "false"),
      );

      // Release the body scroll-lock (inline overflow + NOOM's scroll-padding class,
      // plus common class/position-fixed lock patterns from other themes).
      const b = document.body, h = document.documentElement;
      if (b.style.overflow === "hidden") b.style.overflow = "";
      if (h.style.overflow === "hidden") h.style.overflow = "";
      if (b.style.position === "fixed") {
        const top = b.style.top;
        b.style.position = ""; b.style.top = "";
        const y = top ? -parseInt(top, 10) : NaN;
        if (!Number.isNaN(y)) window.scrollTo(0, y);
      }
      [
        "scroll-padding-0", "js-drawer-open", "drawer-open", "menu-open",
        "js-menu-open", "no-scroll", "overflow-hidden", "js-drawer-opened",
        "scroll-locked", "is-menu-open",
      ].forEach((c) => { b.classList.remove(c); h.classList.remove(c); });
    } catch {
      /* ignore */
    }
  }

  // Keep the header cart count in sync after a soft navigation (NOOM markup).
  private syncCartCount(doc: Document): void {
    try {
      const selectors = [
        ".js-header-cart-item-count",
        ".header__cart-count",
        "[data-cart-count]",
      ];
      for (const sel of selectors) {
        const next = doc.querySelector(sel);
        const cur = document.querySelector(sel);
        if (next && cur) {
          cur.innerHTML = next.innerHTML;
          const dc = next.getAttribute("data-cart-count");
          if (dc != null) cur.setAttribute("data-cart-count", dc);
        }
      }
    } catch {
      /* ignore */
    }
  }

  /* ---- Voice indicator (visible even when the panel is closed) ---- */

  private ensureVoicePill(): HTMLDivElement {
    if (this.voicePill) return this.voicePill;
    const pill = document.createElement("div");
    pill.className = "tw-voice-pill";
    pill.style.cssText = [
      "position:fixed",
      "right:20px",
      "bottom:88px",
      "z-index:2147483647",
      "max-width:300px",
      "padding:10px 12px",
      "border-radius:18px",
      "background:#111",
      "color:#fff",
      "font:500 13px/1.35 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif",
      "box-shadow:0 6px 24px rgba(0,0,0,.28)",
      "display:none",
      "align-items:center",
      "gap:8px",
    ].join(";");
    const label = document.createElement("span");
    label.style.cssText = "cursor:pointer;flex:1;";
    label.addEventListener("click", () => {
      // If a call was live on the previous page, tapping RESUMES it (with memory,
      // no re-intro); otherwise it just reopens the panel.
      if (this.resumePending) this.resumeVoice();
      else this.open();
    });
    // Explicit hang-up so a customer can end the live mic while browsing without
    // reopening the panel — an unambiguous end-call control on the recording pill.
    const endBtn = document.createElement("button");
    endBtn.textContent = "End call";
    endBtn.setAttribute("aria-label", "End voice call");
    endBtn.style.cssText =
      "border:0;border-radius:12px;background:#e5484d;color:#fff;font:600 12px system-ui;padding:5px 10px;cursor:pointer;display:none;flex:none;";
    endBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      try { this.voice.stop(); } catch { /* ignore */ }
      this.hideVoicePill();
    });
    pill.appendChild(label);
    pill.appendChild(endBtn);
    this.root.appendChild(pill);
    this.voicePill = pill;
    this.voicePillLabel = label;
    this.voicePillEnd = endBtn;
    return pill;
  }

  private showVoicePill(text: string, opts?: { autoHideMs?: number; showEnd?: boolean }): void {
    try {
      const pill = this.ensureVoicePill();
      if (this.voicePillLabel) this.voicePillLabel.textContent = text;
      if (this.voicePillEnd) this.voicePillEnd.style.display = opts?.showEnd ? "inline-block" : "none";
      pill.style.display = "flex";
      if (this.pillTimer) {
        clearTimeout(this.pillTimer);
        this.pillTimer = undefined;
      }
      if (opts?.autoHideMs) {
        this.pillTimer = window.setTimeout(() => this.hideVoicePill(), opts.autoHideMs);
      }
    } catch {
      /* ignore */
    }
  }

  // True only if the live-mic indicator actually rendered and is visible.
  private voicePillVisible(): boolean {
    try {
      return !!this.voicePill && this.voicePill.isConnected && this.voicePill.style.display !== "none";
    } catch {
      return false;
    }
  }

  private hideVoicePill(): void {
    try {
      if (this.pillTimer) {
        clearTimeout(this.pillTimer);
        this.pillTimer = undefined;
      }
      if (this.voicePill) this.voicePill.style.display = "none";
    } catch {
      /* ignore */
    }
  }

  // Voice turns are kept in the SAME conversation as text — pushed into
  // this.messages (so they persist across page loads and are sent to the backend
  // for memory/recall) — but tagged channel:"voice" and NEVER rendered as chat
  // bubbles. So Ema remembers the spoken conversation while it stays off the UI.
  private onVoiceTranscript(role: "user" | "ai", text: string, replace: boolean): void {
    const mrole: "user" | "assistant" = role === "user" ? "user" : "assistant";
    const last = this.messages[this.messages.length - 1];
    const canReplace =
      replace &&
      this.lastVoiceRole === role &&
      !!last &&
      last.channel === "voice" &&
      last.role === mrole;
    if (canReplace) {
      last!.content = text; // extend the same spoken turn (partial transcript merge)
    } else {
      this.messages.push({ role: mrole, content: text, channel: "voice" });
      this.lastVoiceRole = role;
    }
    this.saveHistory();
    // Persist finalized spoken turns to the backend as we go (debounced), so if the
    // customer navigates away mid-call the conversation is already recalled server-side.
    if (this.voicePersistTimer) clearTimeout(this.voicePersistTimer);
    this.voicePersistTimer = window.setTimeout(() => this.persistVoiceTurns(false), 1500);
    // Intentionally no addMessage()/DOM write — voice turns are never shown as text.
  }

  // Append newly-finalized voice turns to the backend memory (Postgres) so recall
  // survives page navigation. `force` also persists the still-current last turn
  // (used on close / navigation / session end). A turn is only "finalized" once a
  // newer turn has started, so normally we hold back the last (in-flight) one.
  private persistVoiceTurns(force: boolean): void {
    try {
      if (this.voicePersistTimer) {
        clearTimeout(this.voicePersistTimer);
        this.voicePersistTimer = undefined;
      }
      const voice = this.messages.filter(
        (m) => m.channel === "voice" && m.content && m.content.trim(),
      );
      const end = force ? voice.length : Math.max(0, voice.length - 1);
      if (end <= this.voicePersistedCount) return;
      const batch = voice.slice(this.voicePersistedCount, end).map((m) => ({
        role: m.role === "assistant" ? "ai" : "user",
        content: m.content,
      }));
      if (!batch.length) return;
      const sending = this.voicePersistedCount + batch.length;
      this.voicePersistedCount = sending; // optimistic; avoids double-send on rapid calls
      void fetch(`${CFG.backendUrl}/session/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId: this.sessionId, turns: batch }),
        keepalive: true,
      }).catch(() => {
        // On failure, roll the counter back so the next attempt retries these turns.
        this.voicePersistedCount = Math.max(0, sending - batch.length);
      });
    } catch {
      /* ignore */
    }
  }

  private onVoiceStatus(text: string): void {
    // While the panel is open the in-panel status line is visible; only mirror onto
    // the launcher pill when the panel is closed and a call is live.
    if (this.isOpen || !this.voiceLive || !text) return;
    this.showVoicePill("\u{1F399}️ " + text, { showEnd: true });
  }

  private onVoiceActiveChange(active: boolean): void {
    this.voiceLive = active;
    if (!active) {
      // Session ended (mic off, 90s cutoff, etc.) — persist whatever's left.
      this.persistVoiceTurns(true);
    }
    if (active) {
      if (!this.isOpen) this.showVoicePill("\u{1F399}️ Ema is listening — tap to open", { showEnd: true });
    } else if (!this.isOpen) {
      // Surface the end (incl. the 90s inactivity cutoff) so it never dies silently.
      this.showVoicePill("Voice ended — tap to talk again", { autoHideMs: 12000 });
    } else {
      this.hideVoicePill();
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}

function init() {
  if (document.getElementById("tempest-ema-host")) return;
  const host = document.createElement("div");
  host.id = "tempest-ema-host";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = STYLES;
  shadow.appendChild(style);
  new TempestWidget(shadow);
  // Test/config hook: force soft-navigation on without a live call.
  (window as unknown as { __tempestSoftNav?: (v: boolean) => void }).__tempestSoftNav =
    (v: boolean) => { softNavForce.on = !!v; };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
