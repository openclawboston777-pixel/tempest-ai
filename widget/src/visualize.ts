/**
 * "See it in your room" overlay panel for the furniture chat widget.
 * Vanilla DOM, no imports, Shadow-DOM friendly.
 */

interface CatalogProduct {
  title: string;
  image: string;
  price: string;
  currency: string;
  url: string;
  available: boolean;
}

interface CatalogResponse {
  ok: boolean;
  products?: CatalogProduct[];
  error?: string;
}

interface VisualizeResponse {
  ok: boolean;
  image?: string;
  productTitle?: string;
  productUrl?: string;
  remaining?: number;
  key?: string;
  error?: string;
}

function formatPrice(price: string, currency: string): string {
  const n = Number.parseFloat(price);
  if (!Number.isFinite(n)) return "";
  const rounded = Math.round(n);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(rounded);
  } catch {
    return `$${rounded.toLocaleString()}`;
  }
}

const STATUS_MESSAGES: string[] = [
  "Analyzing your room\u2026",
  "Measuring the space\u2026",
  "Placing your piece\u2026",
  "Matching the lighting\u2026",
  "Finishing the render\u2026",
];

export class VisualizePanel {
  private overlay: HTMLDivElement | null = null;
  private built = false;
  private busy = false;

  // form state
  private selectedTitle: string | null = null;
  private selectedCard: HTMLDivElement | null = null;
  private chosenFile: File | null = null;

  // element refs
  private searchInput: HTMLInputElement | null = null;
  private gridEl: HTMLDivElement | null = null;
  private gridStatusEl: HTMLDivElement | null = null;
  private fileInput: HTMLInputElement | null = null;
  private fileLabel: HTMLLabelElement | null = null;
  private previewWrap: HTMLDivElement | null = null;
  private previewImg: HTMLImageElement | null = null;
  private previewName: HTMLSpanElement | null = null;
  private noteInput: HTMLInputElement | null = null;
  private generateBtn: HTMLButtonElement | null = null;
  private errorEl: HTMLDivElement | null = null;
  private formEl: HTMLDivElement | null = null;
  private busyEl: HTMLDivElement | null = null;
  private busyText: HTMLDivElement | null = null;
  private resultEl: HTMLDivElement | null = null;
  private resultImg: HTMLImageElement | null = null;
  private resultMeta: HTMLDivElement | null = null;
  private addToChatBtn: HTMLButtonElement | null = null;

  private searchTimer: number | null = null;
  private statusTimer: number | null = null;
  private previewUrl: string | null = null;
  private catalogLoaded = false;
  private lastResultImage: string | null = null;
  private lastResultTitle: string = "";

  constructor(
    private backendUrl: string,
    private root: HTMLElement,
    private sessionId: string,
    private onAddToChat?: (dataUrl: string, productTitle: string) => void
  ) {}

  /* ------------------------------------------------------------------ */
  /* public API                                                          */
  /* ------------------------------------------------------------------ */

  public open(): void {
    this.injectStyles();
    if (!this.built) {
      this.build();
      this.built = true;
    }
    if (this.overlay) {
      this.overlay.style.display = "flex";
    }
    if (!this.catalogLoaded) {
      this.catalogLoaded = true;
      void this.loadCatalog("");
    }
  }

  public close(): void {
    if (this.overlay) {
      this.overlay.style.display = "none";
    }
    this.stopStatusRotation();
  }

  /* ------------------------------------------------------------------ */
  /* build UI                                                            */
  /* ------------------------------------------------------------------ */

  private build(): void {
    const overlay = document.createElement("div");
    overlay.className = "tw-viz-overlay";
    overlay.addEventListener("click", (ev: MouseEvent) => {
      if (ev.target === overlay && !this.busy) this.close();
    });

    const card = document.createElement("div");
    card.className = "tw-viz-card";

    /* header */
    const header = document.createElement("div");
    header.className = "tw-viz-header";

    const title = document.createElement("div");
    title.className = "tw-viz-title";
    title.textContent = "See it in your room";

    const closeBtn = document.createElement("button");
    closeBtn.className = "tw-viz-close";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "\u00d7";
    closeBtn.addEventListener("click", () => {
      if (!this.busy) this.close();
    });

    header.appendChild(title);
    header.appendChild(closeBtn);

    /* body */
    const body = document.createElement("div");
    body.className = "tw-viz-body";

    /* ---------- form ---------- */
    const form = document.createElement("div");
    form.className = "tw-viz-form";
    this.formEl = form;

    // step 1
    form.appendChild(this.makeStepLabel("1", "Pick a product"));

    const search = document.createElement("input");
    search.type = "search";
    search.className = "tw-viz-input";
    search.placeholder = "Search sofas, sectionals\u2026";
    search.addEventListener("input", () => this.onSearchInput());
    this.searchInput = search;
    form.appendChild(search);

    const gridStatus = document.createElement("div");
    gridStatus.className = "tw-viz-grid-status";
    gridStatus.textContent = "loading\u2026";
    this.gridStatusEl = gridStatus;
    form.appendChild(gridStatus);

    const grid = document.createElement("div");
    grid.className = "tw-viz-grid";
    this.gridEl = grid;
    form.appendChild(grid);

    // step 2
    form.appendChild(this.makeStepLabel("2", "Add a photo of your room"));

    const fileWrap = document.createElement("div");
    fileWrap.className = "tw-viz-filewrap";

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.setAttribute("capture", "environment");
    fileInput.className = "tw-viz-file";
    fileInput.id = "tw-viz-file-" + Math.random().toString(36).slice(2, 8);
    fileInput.addEventListener("change", () => this.onFileChosen());
    this.fileInput = fileInput;

    const label = document.createElement("label");
    label.className = "tw-viz-uploadbtn";
    label.htmlFor = fileInput.id;
    label.textContent = "Upload a photo of your room";
    this.fileLabel = label;

    fileWrap.appendChild(fileInput);
    fileWrap.appendChild(label);

    const preview = document.createElement("div");
    preview.className = "tw-viz-preview";
    preview.style.display = "none";
    const pimg = document.createElement("img");
    pimg.className = "tw-viz-preview-img";
    pimg.alt = "Room photo preview";
    const pname = document.createElement("span");
    pname.className = "tw-viz-preview-name";
    preview.appendChild(pimg);
    preview.appendChild(pname);
    this.previewWrap = preview;
    this.previewImg = pimg;
    this.previewName = pname;
    fileWrap.appendChild(preview);

    form.appendChild(fileWrap);

    // note
    const note = document.createElement("input");
    note.type = "text";
    note.className = "tw-viz-input";
    note.maxLength = 300;
    note.placeholder = "Where should it go? (optional, e.g. against the left wall)";
    this.noteInput = note;
    form.appendChild(note);

    // error
    const err = document.createElement("div");
    err.className = "tw-viz-error";
    err.style.display = "none";
    this.errorEl = err;
    form.appendChild(err);

    // generate
    const gen = document.createElement("button");
    gen.type = "button";
    gen.className = "tw-viz-btn tw-viz-btn-primary";
    gen.textContent = "Generate";
    gen.disabled = true;
    gen.addEventListener("click", () => {
      void this.generate();
    });
    this.generateBtn = gen;
    form.appendChild(gen);

    body.appendChild(form);

    /* ---------- busy ---------- */
    const busyBox = document.createElement("div");
    busyBox.className = "tw-viz-busy";
    busyBox.style.display = "none";
    const spinner = document.createElement("div");
    spinner.className = "tw-viz-spinner";
    const bt = document.createElement("div");
    bt.className = "tw-viz-busy-text";
    bt.textContent = STATUS_MESSAGES[0];
    busyBox.appendChild(spinner);
    busyBox.appendChild(bt);
    this.busyEl = busyBox;
    this.busyText = bt;
    body.appendChild(busyBox);

    /* ---------- result ---------- */
    const result = document.createElement("div");
    result.className = "tw-viz-result";
    result.style.display = "none";

    const rimg = document.createElement("img");
    rimg.className = "tw-viz-result-img";
    rimg.alt = "Your room visualization";
    result.appendChild(rimg);
    this.resultImg = rimg;

    const meta = document.createElement("div");
    meta.className = "tw-viz-meta";
    result.appendChild(meta);
    this.resultMeta = meta;

    const actions = document.createElement("div");
    actions.className = "tw-viz-actions";

    const dl = document.createElement("button");
    dl.type = "button";
    dl.className = "tw-viz-btn tw-viz-btn-primary";
    dl.textContent = "Download";
    dl.addEventListener("click", () => this.download());
    actions.appendChild(dl);

    const again = document.createElement("button");
    again.type = "button";
    again.className = "tw-viz-btn tw-viz-btn-ghost";
    again.textContent = "Try another";
    again.addEventListener("click", () => this.showForm());
    actions.appendChild(again);

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "tw-viz-btn tw-viz-btn-ghost";
    addBtn.textContent = "Add to chat";
    addBtn.style.display = this.onAddToChat ? "" : "none";
    addBtn.addEventListener("click", () => {
      if (this.onAddToChat && this.lastResultImage) {
        this.onAddToChat(this.lastResultImage, this.lastResultTitle);
      }
      this.close();
    });
    this.addToChatBtn = addBtn;
    actions.appendChild(addBtn);

    result.appendChild(actions);
    this.resultEl = result;
    body.appendChild(result);

    card.appendChild(header);
    card.appendChild(body);
    overlay.appendChild(card);

    this.overlay = overlay;
    this.root.appendChild(overlay);
  }

  private makeStepLabel(num: string, text: string): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.className = "tw-viz-step";
    const badge = document.createElement("span");
    badge.className = "tw-viz-step-num";
    badge.textContent = num;
    const t = document.createElement("span");
    t.textContent = text;
    wrap.appendChild(badge);
    wrap.appendChild(t);
    return wrap;
  }

  /* ------------------------------------------------------------------ */
  /* catalog                                                             */
  /* ------------------------------------------------------------------ */

  private onSearchInput(): void {
    if (this.searchTimer !== null) {
      window.clearTimeout(this.searchTimer);
    }
    this.searchTimer = window.setTimeout(() => {
      this.searchTimer = null;
      const q = this.searchInput ? this.searchInput.value.trim() : "";
      void this.loadCatalog(q);
    }, 350);
  }

  private async loadCatalog(q: string): Promise<void> {
    if (this.gridStatusEl) {
      this.gridStatusEl.style.display = "";
      this.gridStatusEl.textContent = "loading\u2026";
    }
    if (this.gridEl) this.gridEl.textContent = "";

    let products: CatalogProduct[] = [];
    try {
      const res = await fetch(
        this.backendUrl + "/catalog?q=" + encodeURIComponent(q),
        { method: "GET" }
      );
      const data = (await res.json()) as CatalogResponse;
      if (res.ok && data && data.ok && Array.isArray(data.products)) {
        products = data.products;
      } else {
        throw new Error("catalog_failed");
      }
    } catch (_e) {
      if (this.gridStatusEl) {
        this.gridStatusEl.textContent = "Couldn't load products. Try again.";
      }
      return;
    }

    this.renderProducts(products);
  }

  private renderProducts(products: CatalogProduct[]): void {
    const grid = this.gridEl;
    if (!grid) return;
    grid.textContent = "";
    this.selectedCard = null;

    if (!products.length) {
      if (this.gridStatusEl) {
        this.gridStatusEl.style.display = "";
        this.gridStatusEl.textContent = "No matches";
      }
      this.updateGenerateState();
      return;
    }
    if (this.gridStatusEl) this.gridStatusEl.style.display = "none";

    for (const p of products) {
      const cardEl = document.createElement("div");
      cardEl.className = "tw-viz-prod";
      cardEl.setAttribute("role", "button");
      cardEl.tabIndex = 0;

      const img = document.createElement("img");
      img.className = "tw-viz-prod-img";
      img.loading = "lazy";
      img.src = p.image || "";
      img.alt = p.title || "";
      cardEl.appendChild(img);

      const t = document.createElement("div");
      t.className = "tw-viz-prod-title";
      t.textContent = p.title || "";
      cardEl.appendChild(t);

      const price = document.createElement("div");
      price.className = "tw-viz-prod-price";
      price.textContent = formatPrice(p.price, p.currency);
      cardEl.appendChild(price);

      const select = (): void => {
        if (this.busy) return;
        if (this.selectedCard) {
          this.selectedCard.classList.remove("tw-viz-prod-sel");
        }
        cardEl.classList.add("tw-viz-prod-sel");
        this.selectedCard = cardEl;
        this.selectedTitle = p.title;
        this.updateGenerateState();
      };

      cardEl.addEventListener("click", select);
      cardEl.addEventListener("keydown", (ev: KeyboardEvent) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          select();
        }
      });

      if (this.selectedTitle && this.selectedTitle === p.title) {
        cardEl.classList.add("tw-viz-prod-sel");
        this.selectedCard = cardEl;
      }

      grid.appendChild(cardEl);
    }
    this.updateGenerateState();
  }

  /* ------------------------------------------------------------------ */
  /* file handling                                                       */
  /* ------------------------------------------------------------------ */

  private onFileChosen(): void {
    const input = this.fileInput;
    if (!input || !input.files || input.files.length === 0) {
      this.chosenFile = null;
      this.updateGenerateState();
      return;
    }
    const f = input.files[0];
    this.chosenFile = f;

    if (this.previewUrl) {
      URL.revokeObjectURL(this.previewUrl);
      this.previewUrl = null;
    }
    try {
      this.previewUrl = URL.createObjectURL(f);
    } catch (_e) {
      this.previewUrl = null;
    }
    if (this.previewImg && this.previewUrl) this.previewImg.src = this.previewUrl;
    if (this.previewName) this.previewName.textContent = f.name;
    if (this.previewWrap) this.previewWrap.style.display = "flex";
    if (this.fileLabel) this.fileLabel.textContent = "Replace photo";

    this.updateGenerateState();
  }

  private updateGenerateState(): void {
    if (!this.generateBtn) return;
    this.generateBtn.disabled =
      this.busy || !this.selectedTitle || !this.chosenFile;
  }

  /* ------------------------------------------------------------------ */
  /* downscale                                                           */
  /* ------------------------------------------------------------------ */

  private loadImageFromFile(file: File): Promise<HTMLImageElement> {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("image_decode_failed"));
      };
      img.src = url;
    });
  }

  private async prepareUpload(
    file: File
  ): Promise<{ blob: Blob; type: string }> {
    const fallbackOk =
      file.type === "image/jpeg" ||
      file.type === "image/png" ||
      file.type === "image/webp";

    try {
      const img = await this.loadImageFromFile(file);
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) throw new Error("bad_dims");

      const longest = Math.max(w, h);
      const scale = longest > 1600 ? 1600 / longest : 1;
      const tw = Math.max(1, Math.round(w * scale));
      const th = Math.max(1, Math.round(h * scale));

      const canvas = document.createElement("canvas");
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no_ctx");
      ctx.drawImage(img, 0, 0, tw, th);

      const blob = await new Promise<Blob | null>((resolve) => {
        try {
          canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9);
        } catch (_e) {
          resolve(null);
        }
      });
      if (!blob) throw new Error("toblob_failed");
      return { blob, type: "image/jpeg" };
    } catch (_e) {
      if (fallbackOk) {
        return { blob: file, type: file.type };
      }
      throw new Error("unsupported_media_type");
    }
  }

  /* ------------------------------------------------------------------ */
  /* generate                                                            */
  /* ------------------------------------------------------------------ */

  private async generate(): Promise<void> {
    if (this.busy) return;
    if (!this.selectedTitle || !this.chosenFile) return;

    this.setBusy(true);
    this.showError("");

    try {
      const prepared = await this.prepareUpload(this.chosenFile);

      const note = this.noteInput ? this.noteInput.value.trim() : "";
      let url =
        this.backendUrl +
        "/visualize?sessionId=" +
        encodeURIComponent(this.sessionId) +
        "&productQuery=" +
        encodeURIComponent(this.selectedTitle);
      if (note) url += "&note=" + encodeURIComponent(note.slice(0, 300));

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": prepared.type || "image/jpeg" },
        body: prepared.blob,
      });

      let data: VisualizeResponse | null = null;
      try {
        data = (await res.json()) as VisualizeResponse;
      } catch (_e) {
        data = null;
      }

      if (!res.ok || !data || !data.ok || !data.image) {
        const code = data && data.error ? data.error : "visualize_failed";
        throw new Error(code);
      }

      this.showResult(data);
    } catch (e) {
      const code = e instanceof Error ? e.message : "visualize_failed";
      this.showForm();
      this.showError(this.friendlyError(code));
    } finally {
      this.setBusy(false);
    }
  }

  private friendlyError(code: string): string {
    switch (code) {
      case "visualize_limit_reached":
        return "You've reached the visualization limit for this chat. ";
      case "product_not_found":
        return "I couldn't find that product's photo\u2014try another.";
      case "visualize_disabled":
        return "Room visualization isn't available right now.";
      case "unsupported_media_type":
        return "That image format isn't supported. Try a JPEG or PNG.";
      case "missing_image":
        return "Please choose a room photo first.";
      case "missing_product":
        return "Please pick a product first.";
      default:
        return "Something went wrong creating your render. Please try again.";
    }
  }

  private showError(msg: string): void {
    if (!this.errorEl) return;
    if (!msg) {
      this.errorEl.style.display = "none";
      this.errorEl.textContent = "";
      return;
    }
    this.errorEl.textContent = msg;
    this.errorEl.style.display = "block";
  }

  private setBusy(on: boolean): void {
    this.busy = on;
    if (this.formEl) this.formEl.style.display = on ? "none" : "";
    if (this.busyEl) this.busyEl.style.display = on ? "flex" : "none";
    if (on) {
      if (this.resultEl) this.resultEl.style.display = "none";
      this.startStatusRotation();
    } else {
      this.stopStatusRotation();
    }
    if (this.searchInput) this.searchInput.disabled = on;
    if (this.noteInput) this.noteInput.disabled = on;
    if (this.fileInput) this.fileInput.disabled = on;
    this.updateGenerateState();
  }

  private startStatusRotation(): void {
    this.stopStatusRotation();
    let i = 0;
    if (this.busyText) this.busyText.textContent = STATUS_MESSAGES[0];
    this.statusTimer = window.setInterval(() => {
      i = (i + 1) % STATUS_MESSAGES.length;
      if (this.busyText) this.busyText.textContent = STATUS_MESSAGES[i];
    }, 2800);
  }

  private stopStatusRotation(): void {
    if (this.statusTimer !== null) {
      window.clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
  }

  private showForm(): void {
    if (this.resultEl) this.resultEl.style.display = "none";
    if (this.busyEl) this.busyEl.style.display = "none";
    if (this.formEl) this.formEl.style.display = "";
  }

  private showResult(data: VisualizeResponse): void {
    this.lastResultImage = data.image || null;
    this.lastResultTitle = data.productTitle || this.selectedTitle || "";

    if (this.resultImg && data.image) this.resultImg.src = data.image;
    if (this.resultMeta) {
      this.resultMeta.textContent = "";
      const t = document.createElement("div");
      t.className = "tw-viz-meta-title";
      t.textContent = this.lastResultTitle;
      this.resultMeta.appendChild(t);
      if (typeof data.remaining === "number") {
        const r = document.createElement("div");
        r.className = "tw-viz-meta-rem";
        r.textContent = data.remaining + " visualizations left";
        this.resultMeta.appendChild(r);
      }
    }
    if (this.addToChatBtn) {
      this.addToChatBtn.style.display = this.onAddToChat ? "" : "none";
    }
    if (this.formEl) this.formEl.style.display = "none";
    if (this.busyEl) this.busyEl.style.display = "none";
    if (this.resultEl) this.resultEl.style.display = "block";
  }

  private download(): void {
    if (!this.lastResultImage) return;
    const a = document.createElement("a");
    a.href = this.lastResultImage;
    a.download = "tempest-room.jpg";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => {
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 0);
  }

  /* ------------------------------------------------------------------ */
  /* styles                                                              */
  /* ------------------------------------------------------------------ */

  private injectStyles(): void {
    if (this.root.querySelector("style[data-tw-viz-styles]")) return;
    const style = document.createElement("style");
    style.setAttribute("data-tw-viz-styles", "1");
    style.textContent = `
.tw-viz-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;padding:10px;box-sizing:border-box;overflow:auto;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
.tw-viz-card{background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.28);max-width:620px;margin:0 auto;display:flex;flex-direction:column;max-height:100%;overflow:hidden;}
.tw-viz-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #eee;flex:0 0 auto;}
.tw-viz-title{font-size:15px;font-weight:650;color:#1b1b1f;}
.tw-viz-close{border:0;background:transparent;font-size:22px;line-height:1;color:#777;cursor:pointer;padding:2px 6px;border-radius:8px;}
.tw-viz-close:hover{background:#f3f3f5;color:#222;}
.tw-viz-body{padding:14px 16px 18px;overflow:auto;flex:1 1 auto;}
.tw-viz-form{display:flex;flex-direction:column;gap:10px;}
.tw-viz-step{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:#333;margin-top:4px;}
.tw-viz-step-num{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#FF6B5A;color:#fff;font-size:11px;font-weight:700;}
.tw-viz-input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #ddd;border-radius:10px;font-size:13px;color:#222;outline:none;background:#fff;}
.tw-viz-input:focus{border-color:#FF6B5A;box-shadow:0 0 0 3px rgba(255,107,90,.15);}
.tw-viz-grid-status{font-size:12px;color:#888;padding:6px 2px;}
.tw-viz-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;}
.tw-viz-prod{border:1px solid #e8e8ec;border-radius:12px;padding:6px;cursor:pointer;background:#fff;outline:none;transition:border-color .15s,box-shadow .15s;}
.tw-viz-prod:hover{border-color:#ccc;}
.tw-viz-prod-sel{border-color:#FF6B5A;box-shadow:0 0 0 2px rgba(255,107,90,.35);}
.tw-viz-prod-img{width:100%;height:84px;object-fit:cover;border-radius:8px;display:block;background:#f4f4f6;}
.tw-viz-prod-title{font-size:12px;font-weight:600;color:#222;margin-top:6px;line-height:1.25;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}
.tw-viz-prod-price{font-size:12px;color:#666;margin-top:2px;}
.tw-viz-filewrap{display:flex;flex-direction:column;gap:8px;}
.tw-viz-file{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;}
.tw-viz-uploadbtn{display:block;text-align:center;padding:12px;border:1.5px dashed #cfcfd6;border-radius:12px;font-size:13px;color:#555;cursor:pointer;background:#fafafb;}
.tw-viz-uploadbtn:hover{border-color:#FF6B5A;color:#FF6B5A;}
.tw-viz-preview{display:flex;align-items:center;gap:8px;}
.tw-viz-preview-img{width:44px;height:44px;object-fit:cover;border-radius:8px;background:#eee;}
.tw-viz-preview-name{font-size:12px;color:#666;word-break:break-all;}
.tw-viz-error{font-size:12.5px;color:#b3261e;background:#fdecea;border:1px solid #f7c9c3;padding:8px 10px;border-radius:10px;}
.tw-viz-btn{border:0;border-radius:10px;padding:11px 14px;font-size:13.5px;font-weight:650;cursor:pointer;}
.tw-viz-btn-primary{background:#FF6B5A;color:#fff;}
.tw-viz-btn-primary:hover{background:#f2594a;}
.tw-viz-btn-primary:disabled{background:#e6e6ea;color:#9a9aa2;cursor:not-allowed;}
.tw-viz-btn-ghost{background:#fff;color:#333;border:1px solid #ddd;}
.tw-viz-btn-ghost:hover{background:#f6f6f8;}
.tw-viz-busy{display:none;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:40px 10px;}
.tw-viz-spinner{width:30px;height:30px;border-radius:50%;border:3px solid #f0e2e0;border-top-color:#FF6B5A;animation:tw-viz-spin .9s linear infinite;}
@keyframes tw-viz-spin{to{transform:rotate(360deg);}}
.tw-viz-busy-text{font-size:13px;color:#666;}
.tw-viz-result-img{width:100%;border-radius:12px;display:block;background:#f4f4f6;}
.tw-viz-meta{margin:10px 0;}
.tw-viz-meta-title{font-size:13px;font-weight:650;color:#222;}
.tw-viz-meta-rem{font-size:12px;color:#888;margin-top:2px;}
.tw-viz-actions{display:flex;flex-wrap:wrap;gap:8px;}
.tw-viz-actions .tw-viz-btn{flex:1 1 auto;min-width:110px;}
`;
    this.root.appendChild(style);
  }
}
