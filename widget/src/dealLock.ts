interface ActiveOffer {
  kind: string;
  productTitle: string;
  discountAmount: number | null;
  finalPrice: number | null;
  code: string;
  checkoutUrl: string;
  expiresAt: string;
}

const MAX_WINDOW_MS = 60 * 60 * 1000;
const STYLE_FLAG = "data-tw-dl-styles";

export class DealLock {
  private pollTimer: number | null = null;
  private tickTimer: number | null = null;
  private started = false;
  private dismissed = false;
  private offer: ActiveOffer | null = null;
  private expiresAtMs = 0;

  private root: HTMLDivElement | null = null;
  private summaryEl: HTMLDivElement | null = null;
  private countdownEl: HTMLDivElement | null = null;
  private subEl: HTMLDivElement | null = null;
  private codeEl: HTMLDivElement | null = null;
  private ctaEl: HTMLButtonElement | null = null;

  constructor(
    private backendUrl: string,
    private sessionId: string,
    private mount: HTMLElement
  ) {}

  public start(): void {
    if (this.started) return;
    this.started = true;
    this.injectStyles();
    void this.poll();
    this.pollTimer = window.setInterval(() => {
      void this.poll();
    }, 15000);
    this.tickTimer = window.setInterval(() => {
      this.tick();
    }, 1000);
  }

  public stop(): void {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.tickTimer !== null) {
      window.clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.started = false;
    this.dismissed = false;
    this.offer = null;
    this.expiresAtMs = 0;
    this.removeBanner();
  }

  private async poll(): Promise<void> {
    let data: unknown;
    try {
      const url =
        this.backendUrl.replace(/\/+$/, "") +
        "/offer/active?sessionId=" +
        encodeURIComponent(this.sessionId);
      const res = await fetch(url, { method: "GET" });
      if (!res || !res.ok) return;
      data = await res.json();
    } catch (_e) {
      return;
    }

    const offer = this.extractOffer(data);
    if (!offer) {
      this.offer = null;
      this.expiresAtMs = 0;
      this.removeBanner();
      return;
    }

    const ms = Date.parse(offer.expiresAt);
    if (!isFinite(ms)) {
      this.offer = null;
      this.expiresAtMs = 0;
      this.removeBanner();
      return;
    }
    const remaining = ms - Date.now();
    if (remaining <= 0 || remaining > MAX_WINDOW_MS) {
      this.offer = null;
      this.expiresAtMs = 0;
      this.removeBanner();
      return;
    }

    this.offer = offer;
    this.expiresAtMs = ms;
    if (this.dismissed) return;
    this.ensureBanner();
    this.renderOffer();
    this.tick();
  }

  private extractOffer(data: unknown): ActiveOffer | null {
    if (!data || typeof data !== "object") return null;
    const obj = data as { offer?: unknown };
    const raw = obj.offer;
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    const expiresAt = typeof o["expiresAt"] === "string" ? (o["expiresAt"] as string) : "";
    if (!expiresAt) return null;
    return {
      kind: typeof o["kind"] === "string" ? (o["kind"] as string) : "",
      productTitle:
        typeof o["productTitle"] === "string" ? (o["productTitle"] as string) : "Your item",
      discountAmount: typeof o["discountAmount"] === "number" ? (o["discountAmount"] as number) : null,
      finalPrice: typeof o["finalPrice"] === "number" ? (o["finalPrice"] as number) : null,
      code: typeof o["code"] === "string" ? (o["code"] as string) : "",
      checkoutUrl: typeof o["checkoutUrl"] === "string" ? (o["checkoutUrl"] as string) : "",
      expiresAt
    };
  }

  private money(value: number): string {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
        minimumFractionDigits: 0
      }).format(value);
    } catch (_e) {
      return "$" + Math.round(value);
    }
  }

  private injectStyles(): void {
    if (this.mount.querySelector("style[" + STYLE_FLAG + "]")) return;
    const style = document.createElement("style");
    style.setAttribute(STYLE_FLAG, "1");
    style.textContent = [
      ".tw-dl-banner{position:relative;margin:8px;padding:12px 14px 12px;border:1px solid rgba(255,107,90,.35);",
      "border-left:4px solid #FF6B5A;border-radius:12px;background:#fff;",
      "box-shadow:0 2px 10px rgba(20,20,30,.08);font-family:inherit;color:#1f2330;box-sizing:border-box;}",
      ".tw-dl-title{font-size:12px;font-weight:700;letter-spacing:.02em;color:#FF5A46;text-transform:none;margin:0 20px 4px 0;}",
      ".tw-dl-summary{font-size:13px;line-height:1.35;color:#2b2f3a;margin-bottom:6px;word-break:break-word;}",
      ".tw-dl-countdown{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:28px;",
      "font-weight:700;line-height:1.1;color:#1f2330;letter-spacing:.04em;margin:2px 0 6px;}",
      ".tw-dl-sub{font-size:11px;line-height:1.4;color:#6b7280;margin-bottom:4px;}",
      ".tw-dl-code{font-size:11px;font-weight:700;color:#3b3f4a;letter-spacing:.04em;margin-bottom:9px;}",
      ".tw-dl-cta{display:block;width:100%;padding:10px 12px;border:0;border-radius:9px;background:#FF6B5A;",
      "color:#fff;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;}",
      ".tw-dl-cta:hover{background:#f25946;}",
      ".tw-dl-x{position:absolute;top:6px;right:8px;border:0;background:transparent;color:#9aa0ab;",
      "font-size:16px;line-height:1;cursor:pointer;padding:2px 5px;border-radius:6px;font-family:inherit;}",
      ".tw-dl-x:hover{background:#f3f4f6;color:#4b5563;}"
    ].join("");
    this.mount.appendChild(style);
  }

  private ensureBanner(): void {
    if (this.root) return;

    const root = document.createElement("div");
    root.className = "tw-dl-banner";

    const close = document.createElement("button");
    close.className = "tw-dl-x";
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Dismiss deal lock");
    close.addEventListener("click", () => {
      this.dismissed = true;
      this.removeBanner();
    });
    root.appendChild(close);

    const title = document.createElement("div");
    title.className = "tw-dl-title";
    title.textContent = "🔒 Your Tempest Deal Lock";
    root.appendChild(title);

    const summary = document.createElement("div");
    summary.className = "tw-dl-summary";
    root.appendChild(summary);

    const countdown = document.createElement("div");
    countdown.className = "tw-dl-countdown";
    countdown.textContent = "--:--";
    root.appendChild(countdown);

    const sub = document.createElement("div");
    sub.className = "tw-dl-sub";
    sub.textContent =
      "This locks in the custom deal we worked out. The furniture isn't going anywhere — this just holds your special price.";
    root.appendChild(sub);

    const code = document.createElement("div");
    code.className = "tw-dl-code";
    root.appendChild(code);

    const cta = document.createElement("button");
    cta.className = "tw-dl-cta";
    cta.type = "button";
    cta.textContent = "Check out now";
    cta.addEventListener("click", () => {
      const url = this.offer && this.offer.checkoutUrl ? this.offer.checkoutUrl : "";
      if (url) window.open(url, "_blank", "noopener");
    });
    root.appendChild(cta);

    this.root = root;
    this.summaryEl = summary;
    this.countdownEl = countdown;
    this.subEl = sub;
    this.codeEl = code;
    this.ctaEl = cta;

    if (this.mount.firstChild) {
      this.mount.insertBefore(root, this.mount.firstChild);
    } else {
      this.mount.appendChild(root);
    }
  }

  private renderOffer(): void {
    const offer = this.offer;
    if (!offer) return;

    if (this.summaryEl) {
      let text = offer.productTitle;
      if (typeof offer.finalPrice === "number") {
        text += " — " + this.money(offer.finalPrice);
      }
      if (typeof offer.discountAmount === "number" && offer.discountAmount > 0) {
        text += " (you save $" + Math.round(offer.discountAmount) + ")";
      }
      this.summaryEl.textContent = text;
    }

    if (this.codeEl) {
      this.codeEl.textContent = offer.code ? "Code: " + offer.code : "";
    }

    if (this.ctaEl) {
      this.ctaEl.style.display = offer.checkoutUrl ? "block" : "none";
    }

    if (this.subEl) {
      this.subEl.style.display = "block";
    }
  }

  private tick(): void {
    if (!this.offer || !this.root || !this.countdownEl) return;
    const remaining = this.expiresAtMs - Date.now();
    if (remaining <= 0) {
      this.offer = null;
      this.expiresAtMs = 0;
      this.removeBanner();
      return;
    }
    const total = Math.floor(remaining / 1000);
    const mm = Math.floor(total / 60);
    const ss = total % 60;
    const text = (mm < 10 ? "0" + mm : String(mm)) + ":" + (ss < 10 ? "0" + ss : String(ss));
    if (this.countdownEl.textContent !== text) {
      this.countdownEl.textContent = text;
    }
  }

  private removeBanner(): void {
    if (this.root && this.root.parentNode) {
      this.root.parentNode.removeChild(this.root);
    }
    this.root = null;
    this.summaryEl = null;
    this.countdownEl = null;
    this.subEl = null;
    this.codeEl = null;
    this.ctaEl = null;
  }
}
