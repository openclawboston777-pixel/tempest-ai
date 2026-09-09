import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs";
import { config } from "./config.js";
import { logger } from "./logger.js";
import healthRoutes from "./routes/health.js";
import chatRoutes from "./routes/chat.js";
import voiceRoutes from "./routes/voice.js";

export async function buildApp() {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: config.corsOrigin });

  // Global rate limit; /voice-token is intended to be stricter (see note).
  await app.register(rateLimit, {
    max: 60,
    timeWindow: "1 minute",
  });

  // Serve the built widget (optional — only if the public dir exists).
  const publicDir = path.join(process.cwd(), "public");
  if (fs.existsSync(publicDir)) {
    await app.register(fastifyStatic, {
      root: publicDir,
      prefix: "/",
    });
  }

  // Convenience route: serve the widget IIFE bundle as /embed.js
  app.get("/embed.js", async (_req, reply) => {
    const widgetPath = path.join(publicDir, "tempest-widget.iife.js");
    if (!fs.existsSync(widgetPath)) {
      reply.code(404).send({ error: "widget bundle not found" });
      return reply;
    }
    reply.header("Content-Type", "application/javascript; charset=utf-8");
    return reply.send(fs.createReadStream(widgetPath));
  });

  await app.register(healthRoutes);
  await app.register(chatRoutes);
  await app.register(voiceRoutes);

  return app;
}

// Start listening only when run directly.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const app = await buildApp();
  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    logger.info(
      { port: config.port, mockXai: config.mockXai, mockShopify: config.mockShopify },
      "Tempest Ema backend listening"
    );
  } catch (err) {
    logger.error({ err }, "failed to start server");
    process.exit(1);
  }
}
