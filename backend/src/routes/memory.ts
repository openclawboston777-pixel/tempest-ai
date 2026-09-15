import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { forget } from "../memory/store.js";
import { logger } from "../logger.js";

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const bodySchema = z.object({
  sessionId: z.string(),
});

const memoryRoutes: FastifyPluginAsync = async (app) => {
  // Self-service data deletion: a visitor can erase the data tied to THEIR
  // browser session. Email-based deletion is intentionally NOT exposed here
  // (it would let anyone erase another person's data); that stays admin-only.
  app.post(
    "/forget",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = bodySchema.safeParse(request.body);
      if (!parsed.success || !SESSION_ID_RE.test(parsed.data.sessionId)) {
        reply.code(400);
        return { ok: false, error: "invalid_session_id" };
      }
      try {
        const result = await forget({ visitorId: parsed.data.sessionId });
        return { ok: result.ok };
      } catch (err) {
        logger.error({ err: String(err) }, "forget failed");
        reply.code(500);
        return { ok: false };
      }
    },
  );
};

export default memoryRoutes;
