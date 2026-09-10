import { VoiceSession } from "./voice.js";
import { Proactive } from "./proactive.js";
import { STYLES } from "./styles";

interface TempestConfig {
  backendUrl?: string;
  assistantName?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

declare global {
  interface Window {
    TempestConfig?: TempestConfig;
  }
}

const CFG: Required<TempestConfig> = {
  backendUrl: window.TempestConfig?.backendUrl || "http://localhost:8080",
  assistantName: window.TempestConfig?.assistantName || "Ema"
};

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

class TempestWidget {
  private root: HTMLDivElement;
  private launcher!: HTMLDivElement;
  private bubble!: HTMLButtonElement;
  private panel!: HTMLDivElement;
  private messagesEl!: HTMLDivElement;
  private voice!: VoiceSession;
  private voiceBtn?: HTMLButtonElement;
  private firstOpened = false;
  private proactive?: Proactive;
  private input!: HTMLInputElement;
  private sendBtn!: HTMLButtonElement;
  private messages: ChatMessage[] = [];
  private isOpen = false;
  private isStreaming = false;

  constructor(shadow: ShadowRoot) {
    this.root = document.createElement("div");
    this.root.className = "tw-root";
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

    const voiceBtn = document.createElement("button");
    voiceBtn.className = "tw-voice";
    voiceBtn.setAttribute("aria-label", "Voice");
    voiceBtn.innerHTML = MIC_ICON;
    this.voice = new VoiceSession(CFG.backendUrl, this.root, {
      onTranscript: (role, text) => this.addMessage(role === "user" ? "user" : "ai", text),
    });
    this.voiceBtn = voiceBtn;
    voiceBtn.addEventListener("click", () => this.voice.toggle(voiceBtn));

    this.sendBtn = document.createElement("button");
    this.sendBtn.className = "tw-send";
    this.sendBtn.setAttribute("aria-label", "Send message");
    this.sendBtn.innerHTML = SEND_ICON;
    this.sendBtn.addEventListener("click", () => this.send());

    footer.appendChild(this.input);
    footer.appendChild(voiceBtn);
    footer.appendChild(this.sendBtn);

    this.panel.appendChild(handle);
    this.panel.appendChild(header);
    this.panel.appendChild(this.messagesEl);
    this.panel.appendChild(footer);
    this.root.appendChild(this.panel);

    // Greeting
    this.addMessage("ai", `Hi! I'm ${CFG.assistantName}. How can I help you today?`);
    this.proactive = new Proactive(this.launcher, this.root, (seed) => { this.open(); if (seed) this.addMessage("ai", seed); });
    this.proactive.start();
  }

  private open() {
    if (this.isOpen) return;
    this.proactive?.suppress();
    this.isOpen = true;
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
    this.panel.classList.remove("tw-open");
    setTimeout(() => this.launcher.classList.remove("tw-hidden"), 180);
  }

  private addMessage(kind: "ai" | "user" | "error", text: string): HTMLDivElement {
    const el = document.createElement("div");
    el.className = `tw-msg ${kind}`;
    el.textContent = text;
    this.messagesEl.appendChild(el);
    this.scrollToBottom();
    return el;
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
        body: JSON.stringify({ messages: this.messages })
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
