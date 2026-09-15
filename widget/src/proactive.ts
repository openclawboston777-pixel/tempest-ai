/**
 * Proactive text-message bubbles (Phase 2)
 * Shows gentle "text message" style bubbles above the launcher when the visitor
 * is idle and hasn't opened the chat. A single escalating timeline: two openers
 * (~6s), then witty follow-ups at +30s, +4min, +5min. Stops the moment the
 * visitor opens or dismisses the chat.
 *
 * Zero dependencies. Never throws.
 */

const VISIBLE_MS = 8000;     // how long each bubble stays visible
const MAX_VISIBLE = 2;       // HARD rule: never more than 2 bubbles at once

// Absolute offsets from page load for each message in the timeline (ms).
// Openers first (fire ~6s in), then three follow-ups spaced out for a shopper
// who hasn't responded: +30s after the openers, then +4min, then +5min.
const SCHEDULE_MS: number[] = [
  6000,     // opener 1
  10000,    // opener 2
  40000,    // follow-up 1  (~30s after openers)
  280000,   // follow-up 2  (~4 min later)
  580000,   // follow-up 3  (~5 min later)
];

const DEFAULT_OPENERS: string[] = [
  "Looking for something specific? I can help \u{1F44B}",
  "Happy to help you find the perfect piece \u2014 just ask.",
];

// Witty, low-pressure nudges for a shopper who's gone quiet.
const DEFAULT_FOLLOWUPS: string[] = [
  "Still browsing? I promise I'm more helpful than the average sales guy \u2014 and I don't work on commission \u{1F60F}",
  "No rush! Fun trick though: I can drop any of these couches into a photo of your actual room \u{1F6CB}\u{FE0F}\u{1F4F8}",
  "Okay, I'll stop hovering \u{1F605} \u2014 but I'm right here if you want a hand finding the one.",
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
      // Schedule the full escalating timeline up front. Each fires only if the
      // chat is still unopened and not dismissed; opening/dismissing clears them.
      this.messages.forEach((text, i) => {
        const at = SCHEDULE_MS[i];
        if (typeof at !== "number" || !text) return;
        this.addTimer(() => {
          if (this.canShow()) this.showBubble(text);
        }, at);
      });
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
    // Full timeline = openers + witty follow-ups. Either can be overridden via
    // window.TempestConfig (proactiveMessages / proactiveFollowups) or opts.messages.
    let openers: string[] = DEFAULT_OPENERS.slice();
    let followups: string[] = DEFAULT_FOLLOWUPS.slice();
    const clean = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((m): m is string => typeof m === "string" && m.trim().length > 0) : [];
    try {
      const cfg = (window as unknown as {
        TempestConfig?: { proactiveMessages?: unknown; proactiveFollowups?: unknown };
      }).TempestConfig;
      if (cfg) {
        const o = clean(cfg.proactiveMessages);
        if (o.length) openers = o;
        const f = clean(cfg.proactiveFollowups);
        if (f.length) followups = f;
      }
    } catch {
      /* ignore */
    }
    if (opts && Array.isArray(opts.messages)) {
      const o = clean(opts.messages);
      if (o.length) openers = o;
    }
    // Combine and cap to the number of scheduled slots.
    return openers.concat(followups).slice(0, SCHEDULE_MS.length);
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
  /* Bubbles                                                             */
  /* ------------------------------------------------------------------ */

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
