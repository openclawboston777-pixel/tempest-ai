import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { getAnalyticsSummary } from "../memory/analytics.js";

function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  const adminToken = config.adminToken;
  if (!adminToken) {
    reply.code(404).send({ error: "not_found" });
    return false;
  }

  const auth = String(req.headers["authorization"] || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (token.length !== adminToken.length) {
    reply.code(401).send({ error: "unauthorized" });
    return false;
  }

  let diff = 0;
  for (let i = 0; i < token.length; i++) {
    diff |= token.charCodeAt(i) ^ adminToken.charCodeAt(i);
  }
  if (diff !== 0) {
    reply.code(401).send({ error: "unauthorized" });
    return false;
  }

  return true;
}

const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/admin/analytics",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      try {
        const q = (req.query ?? {}) as Record<string, unknown>;
        const days = Number(q.days) || 7;
        const summary = await getAnalyticsSummary(days);
        return summary;
      } catch (err) {
        logger.error({ err }, "admin analytics failed");
        return reply.code(500).send({ error: "analytics_failed" });
      }
    }
  );
};

export default adminRoutes;
