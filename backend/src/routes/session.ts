import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { putObject, dateKey, sanitizeId } from "../storage/s3.js";

const MAX_BODY_BYTES = 25 * 1024 * 1024;

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

  app.post("/session/log", async (req, reply) => {
    try {
      const parsed = LogBody.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return { ok: false, error: "invalid body" };
      }
      const { sessionId, transcript, meta } = parsed.data;
      const id = sanitizeId(sessionId);
      if (!id) {
        reply.code(400);
        return { ok: false, error: "invalid sessionId" };
      }
      const key = `${config.s3Prefix}/${dateKey()}/${id}.json`;
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
  });

  app.post("/session/audio", async (req, reply) => {
    try {
      const q = (req.query ?? {}) as Record<string, unknown>;
      const id = sanitizeId(String(q.sessionId ?? ""));
      if (!id) {
        reply.code(400);
        return { ok: false, error: "invalid sessionId" };
      }
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        reply.code(400);
        return { ok: false, error: "missing audio body" };
      }
      const contentType =
        (req.headers["content-type"] as string | undefined)?.split(";")[0] || "audio/webm";
      const key = `${config.s3Prefix}/${dateKey()}/${id}.webm`;
      await putObject(key, body, contentType);
      return { ok: config.storageEnabled, key };
    } catch (err) {
      logger.error({ err }, "session/audio failed");
      return { ok: false };
    }
  });
};

export default sessionRoutes;
