import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { putObject, dateKey, sanitizeId } from "../storage/s3.js";
import { ensureVisitor, saveMessages, addVoiceSeconds } from "../memory/store.js";

const MAX_BODY_BYTES = 25 * 1024 * 1024;

// Client-supplied session ids are untrusted: strictly validate shape.
const SESSION_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

// Persistent visitor ids may also contain underscores.
const VISITOR_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

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
  visitorId: z.string().optional(),
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

        // Voice TURNS are persisted INCREMENTALLY via /session/turn during the call
        // (so cross-page recall survives an abrupt navigation — the customer hitting
        // X then opening another page). We deliberately do NOT re-save the transcript
        // to Postgres here, which would duplicate those turns. This endpoint only
        // archives the full transcript to object storage and records voice time.
        const visitorId = parsed.data.visitorId;
        if (visitorId && VISITOR_ID_RE.test(visitorId)) {
          try {
            await ensureVisitor(visitorId);
          } catch (err) {
            logger.warn({ err: String(err) }, "session/log: ensureVisitor failed");
          }

          // Voice-time accounting for the per-person daily cap (best-effort).
          try {
            let durationSec = 0;
            const md = meta && typeof (meta as Record<string, unknown>).durationMs === "number"
              ? (meta as Record<string, number>).durationMs
              : 0;
            if (md > 0) {
              durationSec = md / 1000;
            } else {
              const ts = transcript
                .map((t) => (typeof t.ts === "number" ? t.ts : 0))
                .filter((n) => n > 0);
              if (ts.length >= 2) durationSec = (Math.max(...ts) - Math.min(...ts)) / 1000;
            }
            if (durationSec > 0) await addVoiceSeconds(visitorId, durationSec);
          } catch (err) {
            logger.warn({ err: String(err) }, "session/log: voice usage record failed");
          }
        }

        return { ok: config.storageEnabled, key: config.storageEnabled ? key : null };
      } catch (err) {
        logger.error({ err }, "session/log failed");
        return { ok: false };
      }
    }
  );

  // Incremental voice-turn persistence. Called by the widget as each spoken turn
  // finalizes (and on X / navigation) so the backend has the running conversation
  // in Postgres BEFORE the customer leaves the page. This is what lets Ema resume
  // and still know the customer after they hit X and open another page — instead of
  // only saving at session end (which an abrupt navigation can drop).
  const TurnBody = z.object({
    visitorId: z.string(),
    turns: z
      .array(z.object({ role: z.string(), content: z.string() }))
      .min(1)
      .max(50),
  });
  app.post(
    "/session/turn",
    { config: { rateLimit: { max: 180, timeWindow: "1 minute" } } },
    async (req, reply) => {
      try {
        const parsed = TurnBody.safeParse(req.body);
        if (!parsed.success) {
          reply.code(400);
          return { ok: false, error: "invalid body" };
        }
        const { visitorId, turns } = parsed.data;
        if (!VISITOR_ID_RE.test(visitorId)) {
          reply.code(400);
          return { ok: false, error: "invalid_visitor_id" };
        }
        const toSave = turns
          .filter((t) => t && typeof t.content === "string" && t.content.trim())
          .map((t) => ({
            role: t.role === "ai" ? "assistant" : "user",
            content: t.content.slice(0, 4000),
          }));
        if (!toSave.length) return { ok: true, saved: 0 };
        await ensureVisitor(visitorId);
        await saveMessages(visitorId, toSave);
        return { ok: true, saved: toSave.length };
      } catch (err) {
        logger.error({ err }, "session/turn failed");
        reply.code(500);
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
