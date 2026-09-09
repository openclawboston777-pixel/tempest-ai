import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";

import { loadConfig, type Config } from "./config.js";
import { XaiTextProvider, XaiVoiceProvider } from "./providers/xai.js";
import type { TextProvider, VoiceProvider } from "./providers/types.js";

const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(40),
});

export interface BuildServerOptions {
  config?: Config;
  textProvider?: TextProvider;
  voiceProvider?: VoiceProvider;
}

export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();

  const app = Fastify({
    logger: {
      level: config.logLevel,
      // Structured logs must never carry credentials.
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          'req.headers["x-shopify-storefront-access-token"]',
          'req.headers["shopify-storefront-private-token"]',
          "res.headers['set-cookie']",
        ],
        censor: "[redacted]",
      },
    },
  });

  const textProvider =
    options.textProvider ?? new XaiTextProvider({ config, logger: app.log });
  const voiceProvider = options.voiceProvider ?? new XaiVoiceProvider({ config });

  await app.register(rateLimit, {
    global: false,
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.timeWindowMs,
  });

  const rateLimited = {
    config: {
      rateLimit: { max: config.rateLimit.max, timeWindow: config.rateLimit.timeWindowMs },
    },
  };

  app.get("/health", async () => ({ status: "ok" }));

  app.post("/chat", rateLimited, async (request, reply) => {
    const parsed = chatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body" });
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });

    try {
      for await (const delta of textProvider.streamChat({ messages: parsed.data.messages })) {
        reply.raw.write(delta);
      }
    } catch (error) {
      request.log.error({ err: (error as Error).message }, "chat stream failed");
      reply.raw.write("\n\nSorry — I couldn't reach my assistant service just now.");
    } finally {
      reply.raw.end();
    }

    return reply;
  });

  app.post("/voice-token", rateLimited, async (request, reply) => {
    try {
      const token = await voiceProvider.createEphemeralToken();
      return token;
    } catch (error) {
      request.log.error({ err: (error as Error).message }, "voice token minting failed");
      return reply.code(502).send({ error: "Could not mint a voice token" });
    }
  });

  return app;
}
