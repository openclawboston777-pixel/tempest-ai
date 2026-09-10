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
import sessionRoutes from "./routes/session.js";

export async function buildApp() {
  const app = Fastify({ logger: false, bodyLimit: 25 * 1024 * 1024 });

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
    reply.header("Cache-Control", "no-store");
    return reply.send(fs.createReadStream(widgetPath));
  });

  // Demo storefront preview that loads the Ema widget same-origin.
  app.get("/demo", async (_req, reply) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Tempest Furniture — Preview</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background: #f7f6f3; color: #1f2933; }
    header { padding: 32px 24px; background: #fff; border-bottom: 1px solid #e5e7eb; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    .intro { margin: 0; color: #52606d; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 20px; padding: 32px 24px; max-width: 960px; margin: 0 auto; }
    .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; }
    .card h2 { margin: 0 0 8px; font-size: 18px; }
    .card p { margin: 0 0 12px; color: #52606d; font-size: 14px; }
    .price { font-weight: 600; color: #1f2933; }
  </style>
</head>
<body>
  <header>
    <h1>Tempest Furniture — Preview</h1>
    <p class="intro">Handcrafted pieces for the modern home. Ask Ema for help finding the perfect fit.</p>
  </header>
  <main class="grid">
    <div class="card">
      <h2>Aria Lounge Chair</h2>
      <p>Solid oak frame with a soft wool blend seat. A cozy reading companion.</p>
      <span class="price">$429</span>
    </div>
    <div class="card">
      <h2>Nova Dining Table</h2>
      <p>Seats six comfortably. Natural walnut top with tapered steel legs.</p>
      <span class="price">$1,180</span>
    </div>
    <div class="card">
      <h2>Haven Bookshelf</h2>
      <p>Five open shelves in warm ash. Perfect for books, plants, and treasures.</p>
      <span class="price">$599</span>
    </div>
  </main>
  <script>window.TempestConfig={backendUrl:location.origin, assistantName:"Ema"};</script>
  <script src="/embed.js" defer></script>
</body>
</html>`;
    reply.header("Content-Type", "text/html; charset=utf-8");
    reply.header("Cache-Control", "no-store");
    return reply.send(html);
  });

  await app.register(healthRoutes);
  await app.register(chatRoutes);
  await app.register(voiceRoutes);
  await app.register(sessionRoutes);

  return app;
}

// Start listening only when run directly.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const app = await buildApp();
  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    logger.info(
      {
        port: config.port,
        mockXai: config.mockXai,
        mockShopify: config.mockShopify,
        storageEnabled: config.storageEnabled,
      },
      "Tempest Ema backend listening"
    );
  } catch (err) {
    logger.error({ err }, "failed to start server");
    process.exit(1);
  }
}
