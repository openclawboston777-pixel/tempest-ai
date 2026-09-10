/**
 * Proactive text-message bubbles (Phase 2)
 * Shows at most 2 gentle "text message" style bubbles above the launcher
 * when the visitor has been idle and has not opened the chat.
 *
 * Zero dependencies. Never throws.
 */

const IDLE_MS = 8000;        // delay before first bubble
const SECOND_MS = 5000;      // delay between bubble 1 and bubble 2
const VISIBLE_MS = 8000;     // how long each bubble stays visible
const COOLDOWN_MS = 90000;   // wait before attempting another sequence
const MAX_SEQUENCES = 2;     // per session
const MAX_VISIBLE = 2;       // HARD rule: never more than 2 bubbles at once

const DEFAULT_MESSAGES: string[] = [
  "Looking for something specific? I can help \u{1F44B}",
  "Happy to help you find the perfect piece \u2014 just ask.",
];

export interface ProactiveOptions {
  messages?: string[];
}

type TimerId = ReturnType<typeof setTimeout>;

function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    /* never throw */
  }
}

export class Proactive {
  private launcher: HTMLElement;
  private container: HTMLElement;
  private onOpen: (seed?: string) => void;

  private messages: string[];
  private wrap: HTMLElement | null = null;
  private timers: TimerId[] = [];
  private bubbles: HTMLElement[] = [];

  private suppressed = false;
  private started = false;
  private sequenceCount = 0;

  constructor(
    launcher: HTMLElement,
    container: HTMLElement,
    onOpen: (seed?: string) => void,
    opts?: ProactiveOptions
  ) {
    this.launcher = launcher;
    this.container = container;
    this.onOpen = typeof onOpen === "function" ? onOpen : () => undefined;
    this.messages = this.resolveMessages(opts);
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  public start(): void {
    safe(() => {
      if (this.started || this.suppressed) return;
      this.started = true;
      this.scheduleSequence(IDLE_MS);
    });
  }

  public stop(): void {
    safe(() => {
      this.clearTimers();
      this.hideAll(true);
    });
  }

  public suppress(): void {
    safe(() => {
      this.suppressed = true;
      this.clearTimers();
      this.hideAll(false);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                           */
  /* ------------------------------------------------------------------ */

  private resolveMessages(opts?: ProactiveOptions): string[] {
    let list: string[] = DEFAULT_MESSAGES.slice();
    try {
      const cfg = (window as unknown as { TempestConfig?: { proactiveMessages?: unknown } })
        .TempestConfig;
      const fromCfg = cfg && cfg.proactiveMessages;
      if (Array.isArray(fromCfg)) {
        const clean = fromCfg.filter(
          (m): m is string => typeof m === "string" && m.trim().length > 0
        );
        if (clean.length) list = clean;
      }
    } catch {
      /* ignore */
    }
    if (opts && Array.isArray(opts.messages)) {
      const clean = opts.messages.filter(
        (m): m is string => typeof m === "string" && m.trim().length > 0
      );
      if (clean.length) list = clean;
    }
    // Hard cap: only ever two per sequence.
    return list.slice(0, MAX_VISIBLE);
  }

  private isChatOpen(): boolean {
    try {
      // Launcher hides (tw-hidden) while the panel is open.
      if (this.launcher && this.launcher.classList.contains("tw-hidden")) return true;
      const panel = this.container.querySelector(".tw-panel");
      if (panel && panel.classList.contains("tw-open")) return true;
    } catch {
      /* ignore */
    }
    return false;
  }

  private canShow(): boolean {
    return !this.suppressed && !this.isChatOpen();
  }

  private addTimer(fn: () => void, ms: number): void {
    const id = setTimeout(() => {
      this.timers = this.timers.filter((t) => t !== id);
      safe(fn);
    }, ms);
    this.timers.push(id);
  }

  private clearTimers(): void {
    for (const t of this.timers) {
      try {
        clearTimeout(t);
      } catch {
        /* ignore */
      }
    }
    this.timers = [];
  }

  private ensureWrap(): HTMLElement | null {
    try {
      if (this.wrap && this.wrap.isConnected) return this.wrap;
      const el = document.createElement("div");
      el.className = "tw-proactive-wrap";
      this.container.appendChild(el);
      this.wrap = el;
      return el;
    } catch {
      return null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Sequencing                                                          */
  /* ------------------------------------------------------------------ */

  private scheduleSequence(delay: number): void {
    if (this.suppressed) return;
    if (this.sequenceCount >= MAX_SEQUENCES) return;

    this.addTimer(() => this.runSequence(), delay);
  }

  private runSequence(): void {
    if (!this.canShow()) {
      // Chat open right now — try again after cooldown (if budget remains).
      this.scheduleSequence(COOLDOWN_MS);
      return;
    }
    if (this.sequenceCount >= MAX_SEQUENCES) return;
    this.sequenceCount += 1;

    const first = this.messages[0];
    const second = this.messages[1];

    if (first) this.showBubble(first);

    if (second) {
      this.addTimer(() => {
        if (!this.canShow()) return;
        this.showBubble(second);
      }, SECOND_MS);
    }

    // End of sequence: hide everything, then cooldown before another attempt.
    const endAt = (second ? SECOND_MS : 0) + VISIBLE_MS;
    this.addTimer(() => {
      this.hideAll(true);
      this.scheduleSequence(COOLDOWN_MS);
    }, endAt);
  }

  private showBubble(text: string): void {
    if (!this.canShow()) return;
    const wrap = this.ensureWrap();
    if (!wrap) return;

    // HARD rule: max 2 visible at once — drop the oldest.
    while (this.bubbles.length >= MAX_VISIBLE) {
      const oldest = this.bubbles.shift();
      if (oldest) this.removeBubble(oldest, true);
    }

    const bubble = document.createElement("div");
    bubble.className = "tw-proactive-bubble tw-proactive-enter";
    bubble.setAttribute("role", "button");
    bubble.setAttribute("tabindex", "0");
    bubble.setAttribute("aria-label", text);

    const label = document.createElement("span");
    label.className = "tw-proactive-text";
    label.textContent = text;
    bubble.appendChild(label);

    const dismiss = document.createElement("span");
    dismiss.className = "tw-proactive-dismiss";
    dismiss.setAttribute("role", "button");
    dismiss.setAttribute("aria-label", "Dismiss");
    dismiss.textContent = "\u00D7";
    bubble.appendChild(dismiss);

    const openHandler = (e: Event): void => {
      safe(() => {
        e.preventDefault();
        e.stopPropagation();
        const seed = text;
        this.suppress();
        this.onOpen(seed);
      });
    };

    bubble.addEventListener("click", openHandler);
    bubble.addEventListener("keydown", (e: KeyboardEvent) => {
      safe(() => {
        if (e.key === "Enter" || e.key === " ") openHandler(e);
      });
    });

    dismiss.addEventListener("click", (e: Event) => {
      safe(() => {
        e.preventDefault();
        e.stopPropagation();
        this.removeBubble(bubble, true);
        this.suppress();
      });
    });

    wrap.appendChild(bubble);
    this.bubbles.push(bubble);

    // Entrance: next frame, drop the enter class to animate in.
    try {
      const raf =
        typeof requestAnimationFrame === "function"
          ? requestAnimationFrame
          : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16);
      raf(() => {
        raf(() => {
          safe(() => bubble.classList.remove("tw-proactive-enter"));
        });
      });
    } catch {
      bubble.classList.remove("tw-proactive-enter");
    }

    // Auto fade after visible window.
    this.addTimer(() => this.removeBubble(bubble, true), VISIBLE_MS);
  }

  private removeBubble(bubble: HTMLElement, animate: boolean): void {
    safe(() => {
      this.bubbles = this.bubbles.filter((b) => b !== bubble);
      if (!bubble.isConnected) return;

      if (!animate) {
        if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
        return;
      }

      bubble.classList.add("tw-proactive-hide");
      setTimeout(() => {
        safe(() => {
          if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
        });
      }, 260);
    });
  }

  private hideAll(animate: boolean): void {
    const list = this.bubbles.slice();
    this.bubbles = [];
    for (const b of list) this.removeBubble(b, animate);
  }
}

export default Proactive;
