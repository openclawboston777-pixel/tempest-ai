import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { putObject, dateKey, sanitizeId } from "../storage/s3.js";

const MAX_BODY_BYTES = 25 * 1024 * 1024;

// Client-supplied session ids are untrusted: strictly validate shape.
const SESSION_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

// Only these content types may be stored for audio uploads.
const ALLOWED_AUDIO_TYPES: Record<string, string> = {
  "audio/webm": "audio/webm",
  "audio/mp4": "audio/mp4",
  "audio/ogg": "audio/ogg",
  // Generic binary uploads are normalized to webm (never trust raw header).
  "application/octet-stream": "audio/webm",
};

const RATE_LIMIT = { max: 20, timeWindow: "1 minute" } as const;

const LogBody = z.object({
  sessionId: z.string().min(1),
  transcript: z.array(
    z.object({
      role: z.string(),
      text: z.string(),
      ts: z.number().optional(),
    })
  ),
  meta: z.record(z.any()).optional(),
});

const binaryParser = (
  _req: unknown,
  payload: NodeJS.ReadableStream,
  done: (err: Error | null, body?: Buffer) => void
) => {
  const chunks: Buffer[] = [];
  let size = 0;
  let aborted = false;
  payload.on("data", (chunk: Buffer) => {
    if (aborted) return;
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      aborted = true;
      const err = new Error("payload too large") as Error & { statusCode?: number };
      err.statusCode = 413;
      done(err);
      return;
    }
    chunks.push(Buffer.from(chunk));
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
};

const sessionRoutes: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser("application/octet-stream", binaryParser as any);
  app.addContentTypeParser("audio/webm", binaryParser as any);
  app.addContentTypeParser("audio/mp4", binaryParser as any);
  app.addContentTypeParser("audio/ogg", binaryParser as any);

  app.post(
    "/session/log",
    { config: { rateLimit: { max: RATE_LIMIT.max, timeWindow: RATE_LIMIT.timeWindow } } },
    async (req, reply) => {
      try {
        const parsed = LogBody.safeParse(req.body);
        if (!parsed.success) {
          reply.code(400);
          return { ok: false, error: "invalid body" };
        }
        const { sessionId, transcript, meta } = parsed.data;
        if (!SESSION_ID_RE.test(sessionId)) {
          reply.code(400);
          return { ok: false, error: "invalid_session_id" };
        }
        const id = sanitizeId(sessionId);
        if (!id) {
          reply.code(400);
          return { ok: false, error: "invalid_session_id" };
        }
        // Non-overwritable key: random suffix prevents one caller clobbering another's object.
        // TODO harden further with a per-session HMAC upload token issued at /voice-token.
        const rand = randomUUID().slice(0, 8);
        const key = `${config.s3Prefix}/${dateKey()}/${id}-${rand}.json`;
        await putObject(
          key,
          JSON.stringify(
            { sessionId, savedAt: new Date().toISOString(), meta, transcript },
            null,
            2
          ),
          "application/json"
        );
        return { ok: config.storageEnabled, key: config.storageEnabled ? key : null };
      } catch (err) {
        logger.error({ err }, "session/log failed");
        return { ok: false };
      }
    }
  );

  app.post(
    "/session/audio",
    { config: { rateLimit: { max: RATE_LIMIT.max, timeWindow: RATE_LIMIT.timeWindow } } },
    async (req, reply) => {
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

        const rawType =
          (req.headers["content-type"] as string | undefined)?.split(";")[0]?.trim().toLowerCase() ||
          "";
        const contentType = ALLOWED_AUDIO_TYPES[rawType];
        if (!contentType) {
          reply.code(415);
          return { ok: false, error: "unsupported_media_type" };
        }

        const body = req.body;
        if (!Buffer.isBuffer(body) || body.length === 0) {
          reply.code(400);
          return { ok: false, error: "missing audio body" };
        }

        // Non-overwritable key: random suffix prevents one caller clobbering another's object.
        // TODO harden further with a per-session HMAC upload token issued at /voice-token.
        const rand = randomUUID().slice(0, 8);
        const key = `${config.s3Prefix}/${dateKey()}/${id}-${rand}.webm`;
        await putObject(key, body, contentType);
        return { ok: config.storageEnabled, key };
      } catch (err) {
        logger.error({ err }, "session/audio failed");
        return { ok: false };
      }
    }
  );
};

export default sessionRoutes;
