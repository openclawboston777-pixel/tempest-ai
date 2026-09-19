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

  constructor(shadow: ShadowRoot) {
    this.root = document.createElement("div");
    this.root.className = "tw-root";
    // Restore any prior conversation for this browser before building the panel so
    // the greeting/replay logic knows whether this is a returning session.
    this.messages = this.loadHistory();
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
      this.showVoicePill("\u{1F399}️ Ema is still listening — tap to reopen", { showEnd: true });
      // Fail-closed: never leave a hot mic with no visible disclosure. If the
      // live-mic indicator didn't actually render, end the call instead.
      if (!this.voicePillVisible()) {
        try { this.voice.stop(); } catch { /* ignore */ }
      }
    }
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

      if (wasOpen) {
        // Restoring an existing session — skip the first-open proactive voice auto-start.
        this.firstOpened = true;
        this.open();
        if (voiceWasLive) {
          this.addMessage(
            "ai",
            "I'm still here — tap the mic whenever you want to pick our voice chat back up. I've got everything we talked about.",
          );
        }
      } else if (voiceWasLive) {
        // Browsers block auto-starting mic/audio without a gesture, so we invite a
        // one-tap resume instead of silently (and expensively) reconnecting.
        this.showVoicePill("\u{1F399}️ Tap to resume our voice chat");
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
    label.addEventListener("click", () => this.open());
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
    // Intentionally no addMessage()/DOM write — voice turns are never shown as text.
  }

  private onVoiceStatus(text: string): void {
    // While the panel is open the in-panel status line is visible; only mirror onto
    // the launcher pill when the panel is closed and a call is live.
    if (this.isOpen || !this.voiceLive || !text) return;
    this.showVoicePill("\u{1F399}️ " + text, { showEnd: true });
  }

  private onVoiceActiveChange(active: boolean): void {
    this.voiceLive = active;
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
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
