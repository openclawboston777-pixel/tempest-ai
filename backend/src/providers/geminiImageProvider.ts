import { config } from "../config.js";
import { logger } from "../logger.js";

const ALLOWED_ROOM_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface VisualizeInput {
  roomImage: Buffer;
  roomMime: string;
  productImageUrl: string;
  productTitle: string;
  note?: string;
}

export type VisualizeOutput =
  | { ok: true; image: Buffer; mime: string }
  | { ok: false; error: string };

function isAllowedProductHost(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    return h === "cdn.shopify.com" || h.endsWith(".shopify.com");
  } catch {
    return false;
  }
}

function buildPrompt(input: VisualizeInput): string {
  const lines: string[] = [];
  lines.push(
    "You are a photorealistic interior visualizer. Place the product shown in the SECOND image into the real room shown in the FIRST image."
  );
  lines.push(`The product is: ${input.productTitle}.`);
  lines.push(
    "Keep the product's EXACT design, color, materials, textures, and proportions accurate. Do not redesign, restyle, or invent details."
  );
  lines.push(
    "Match the room's lighting, white balance, perspective, camera angle, scale relative to the room, and the floor plane. Cast realistic shadows and correct contact shadows where the product meets surfaces."
  );
  if (input.note && input.note.trim().length > 0) {
    lines.push(`Placement guidance from the customer: ${input.note.trim()}`);
  }
  lines.push(
    "Return only the edited room photograph. Do not add text, watermarks, or labels."
  );
  return lines.join("\n");
}

export async function visualizeRoom(input: VisualizeInput): Promise<VisualizeOutput> {
  try {
    const apiKey = config.geminiApiKey;
    if (!apiKey) return { ok: false, error: "visualize_disabled" };
    if (!ALLOWED_ROOM_TYPES.has(input.roomMime)) {
      return { ok: false, error: "unsupported_media_type" };
    }
    if (!isAllowedProductHost(input.productImageUrl)) {
      return { ok: false, error: "product_image_unavailable" };
    }

    let productB64: string;
    let productMime: string;

    const prodController = new AbortController();
    const prodTimer = setTimeout(() => prodController.abort(), 15_000);
    try {
      const res = await fetch(input.productImageUrl, { signal: prodController.signal });
      if (!res.ok) return { ok: false, error: "product_image_unavailable" };
      productMime = (res.headers.get("content-type") || "image/jpeg").split(";")[0]!.trim();
      productB64 = Buffer.from(await res.arrayBuffer()).toString("base64");
    } finally {
      clearTimeout(prodTimer);
    }

    const roomB64 = input.roomImage.toString("base64");

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiImageModel}:generateContent?key=${apiKey}`;
    const payload = {
      contents: [
        {
          parts: [
            { text: buildPrompt(input) },
            { inline_data: { mime_type: input.roomMime, data: roomB64 } },
            { inline_data: { mime_type: productMime, data: productB64 } },
          ],
        },
      ],
      generationConfig: { responseModalities: ["IMAGE"] },
    };

    const genController = new AbortController();
    const genTimer = setTimeout(() => genController.abort(), 45_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: genController.signal,
      });

      if (!res.ok) {
        let detail = "";
        try {
          detail = (await res.text()).slice(0, 200);
        } catch {
          detail = "";
        }
        logger.warn({ status: res.status, detail }, "gemini image http error");
        return { ok: false, error: "generation_failed" };
      }

      const json: any = await res.json();
      const parts: any[] = json?.candidates?.[0]?.content?.parts ?? [];
      const part = parts.find((p) => p && (p.inlineData || p.inline_data));
      if (part) {
        const d = part.inlineData || part.inline_data;
        if (d && typeof d.data === "string" && d.data.length > 0) {
          return {
            ok: true,
            image: Buffer.from(d.data, "base64"),
            mime: d.mimeType || d.mime_type || "image/jpeg",
          };
        }
      }
      logger.warn(
        { finishReason: json?.candidates?.[0]?.finishReason },
        "gemini returned no image"
      );
      return { ok: false, error: "generation_failed" };
    } finally {
      clearTimeout(genTimer);
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: "timeout" };
    }
    logger.error({ err: String(err) }, "visualizeRoom failed");
    return { ok: false, error: "generation_failed" };
  }
}
