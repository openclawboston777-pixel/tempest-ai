import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { logger } from "../logger.js";
import { putObject, dateKey, sanitizeId } from "../storage/s3.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const supportSchema = z.object({
  name: z.string().max(120).optional(),
  email: z.string().regex(EMAIL_RE),
  message: z.string().min(1).max(5000),
  orderNumber: z.string().max(32).optional(),
  sessionId: z.string().max(64).optional(),
});

const supportRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/support",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const parsed = supportSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ ok: false, error: "invalid_request" });
      }

      const { name, email, message, orderNumber, sessionId } = parsed.data;
      const ticketId = randomUUID();

      try {
        const key = `tempest-ai/support/${dateKey()}/${sanitizeId(ticketId)}.json`;
        await putObject(
          key,
          JSON.stringify(
            {
              ticketId,
              createdAt: new Date().toISOString(),
              name,
              email,
              message,
              orderNumber,
              sessionId,
            },
            null,
            2
          ),
          "application/json"
        );

        // TODO send email to store owner when SMTP/email provider is configured.
        logger.info({ ticketId, email }, "support ticket received");

        return reply.send({ ok: true, ticketId });
      } catch (err) {
        logger.error({ err, ticketId }, "failed to handle support ticket");
        return reply.code(500).send({ ok: false, error: "support_failed" });
      }
    }
  );
};

export default supportRoutes;
