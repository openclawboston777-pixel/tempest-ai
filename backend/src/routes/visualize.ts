import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { putObject, dateKey, sanitizeId } from "../storage/s3.js";
import { getProducts } from "../tools/getProducts.js";
import { visualizeRoom } from "../providers/geminiImageProvider.js";

const SESSION_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

const ALLOWED: Record<string, string> = {
  "image/jpeg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
};

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const sessionCounts = new Map<string, number>();

type ParserDone = (err: Error | null, body?: Buffer) => void;

function binaryParser(
  _req: FastifyRequest,
  payload: NodeJS.ReadableStream,
  done: ParserDone
): void {
  const limit = config.visualizeMaxUploadBytes;
  const chunks: Buffer[] = [];
  let size = 0;
  let aborted = false;

  payload.on("data", (chunk: Buffer | string) => {
    if (aborted) return;
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > limit) {
      aborted = true;
      const err = new Error("payload_too_large") as Error & { statusCode?: number };
      err.statusCode = 413;
      done(err);
      return;
    }
    chunks.push(buf);
  });

  payload.on("end", () => {
    if (aborted) return;
    done(null, Buffer.concat(chunks));
  });

  payload.on("error", (err: Error) => {
    if (aborted) return;
    aborted = true;
    done(err);
  });
}

const visualizeRoutes: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser("image/jpeg", binaryParser as any);
  app.addContentTypeParser("image/png", binaryParser as any);
  app.addContentTypeParser("image/webp", binaryParser as any);

  // Lightweight product picker for the "See it in your room" flow: returns
  // titles + images so the widget can show selectable thumbnails.
  app.get(
    "/catalog",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const q = (req.query ?? {}) as Record<string, unknown>;
        const query = String(q.q ?? "").trim().slice(0, 100);
        const products = await getProducts(query);
        const items = products
          .filter((p) => p.image)
          .slice(0, 12)
          .map((p) => ({
            title: p.title,
            image: p.image,
            price: p.price,
            currency: p.currency,
            url: p.url,
            available: p.available,
          }));
        return { ok: true, products: items };
      } catch (err) {
        logger.error({ err: String(err) }, "catalog route failed");
        reply.code(500);
        return { ok: false, products: [] };
      }
    }
  );

  app.post(
    "/visualize",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const q = (req.query ?? {}) as Record<string, unknown>;

        const rawId = String(q.sessionId ?? "");
        if (!SESSION_ID_RE.test(rawId)) {
          reply.code(400);
          return { ok: false, error: "invalid_session_id" };
        }
        const id = sanitizeId(rawId);
        if (!id) {
          reply.code(400);
          return { ok: false, error: "invalid_session_id" };
        }

        const productQuery = String(q.productQuery ?? q.product ?? "").trim();
        if (productQuery.length < 1 || productQuery.length > 100) {
          reply.code(400);
          return { ok: false, error: "missing_product" };
        }

        const note = typeof q.note === "string" ? q.note.slice(0, 300) : undefined;

        if (!config.visualizeEnabled) {
          reply.code(503);
          return { ok: false, error: "visualize_disabled" };
        }

        const rawType = String(req.headers["content-type"] || "")
          .split(";")[0]!
          .trim()
          .toLowerCase();
        const contentType = ALLOWED[rawType];
        if (!contentType) {
          reply.code(415);
          return { ok: false, error: "unsupported_media_type" };
        }

        const body = req.body as unknown;
        if (!Buffer.isBuffer(body) || body.length === 0) {
          reply.code(400);
          return { ok: false, error: "missing_image" };
        }

        const used = sessionCounts.get(id) ?? 0;
        if (used >= config.visualizeMaxPerSession) {
          reply.code(429);
          return { ok: false, error: "visualize_limit_reached" };
        }

        const products = await getProducts(productQuery);
        const product = products.find((p) => p.image);
        if (!product) {
          reply.code(404);
          return { ok: false, error: "product_not_found" };
        }

        const result = await visualizeRoom({
          roomImage: body,
          roomMime: contentType,
          productImageUrl: product.image!,
          productTitle: product.title,
          note,
        });

        if (!result.ok) {
          const code =
            result.error === "product_not_found"
              ? 404
              : result.error === "unsupported_media_type"
                ? 415
                : 503;
          reply.code(code);
          return { ok: false, error: result.error };
        }

        sessionCounts.set(id, used + 1);

        const rand = randomUUID().slice(0, 8);
        const base = `${config.s3Prefix}/visualize/${dateKey()}/${id}-${rand}`;
        const renderExt = EXT[result.mime] || "jpg";
        const renderKey = `${base}-render.${renderExt}`;

        try {
          await putObject(`${base}-room.${EXT[contentType]}`, body, contentType);
          await putObject(renderKey, result.image, result.mime);
          await putObject(
            `${base}-meta.json`,
            JSON.stringify({
              sessionId: id,
              productTitle: product.title,
              productId: product.id,
              productUrl: product.url,
              productImageUrl: product.image,
              note,
              at: new Date().toISOString(),
            }),
            "application/json"
          );
        } catch (err) {
          logger.warn({ err: String(err) }, "visualize storage failed");
        }

        return {
          ok: true,
          image: `data:${result.mime};base64,${result.image.toString("base64")}`,
          productTitle: product.title,
          productUrl: product.url,
          remaining: Math.max(0, config.visualizeMaxPerSession - (used + 1)),
          key: renderKey,
        };
      } catch (err) {
        logger.error({ err: String(err) }, "visualize route failed");
        reply.code(500);
        return { ok: false, error: "visualize_failed" };
      }
    }
  );
};

export default visualizeRoutes;
