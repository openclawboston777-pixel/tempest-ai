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
import supportRoutes from "./routes/support.js";
import visualizeRoutes from "./routes/visualize.js";
import memoryRoutes from "./routes/memory.js";
import adminRoutes from "./routes/admin.js";
import offerRoutes from "./routes/offer.js";
import greetingRoutes from "./routes/greeting.js";
import { migrate } from "./db/pool.js";
import { purgeExpired as purgeMemory } from "./memory/store.js";

export async function buildApp() {
  const app = Fastify({
    logger: false,
    bodyLimit: 25 * 1024 * 1024,
    // Behind Caddy (loopback-bound 127.0.0.1:8090; inside Docker the proxied
    // connection arrives from the bridge gateway 172.16.x.1). Trust these private
    // hops so request.ip resolves to the real client from X-Forwarded-For.
    // WITHOUT this, @fastify/rate-limit keyed every visitor on the single proxy IP,
    // so the WHOLE store shared one 60/min bucket — a chatty voice call (or another
    // visitor's traffic) then 429s the next /chat and the widget shows "couldn't
    // chat right now". Safe because the port is loopback-bound: only Caddy can reach
    // it, so a client cannot inject a trusted X-Forwarded-For directly.
    trustProxy: "loopback,linklocal,uniquelocal",
  });

  // CORS: "*" allows all; otherwise a comma-separated allowlist of origins/hosts.
  // Entries may be full origins (https://x.com), bare hosts (x.com), or wildcard
  // suffixes (*.myshopify.com). Same-origin requests (no Origin header) always pass.
  const corsOption: import("@fastify/cors").FastifyCorsOptions["origin"] =
    config.corsOrigin.trim() === "*"
      ? "*"
      : (origin, cb) => {
          if (!origin) return cb(null, true); // same-origin / non-browser (no Origin header)
          let u: URL;
          try {
            u = new URL(origin);
          } catch {
            return cb(null, false); // unparseable (e.g. "null")
          }
          // Only allow secure origins on the standard HTTPS port — reject http://
          // and non-standard ports (e.g. :444) even if the hostname would match.
          if (u.protocol !== "https:") return cb(null, false);
          if (u.port && u.port !== "443") return cb(null, false);
          const host = u.hostname.toLowerCase();
          const allow = config.corsOrigin
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .some((entry) => {
              const e = entry.toLowerCase();
              if (e.startsWith("*.")) {
                // Wildcard: require a real dot-boundary subdomain match (never a
                // substring like "evilmyshopify.com" matching "*.myshopify.com").
                const base = e.slice(2);
                return host === base || host.endsWith("." + base);
              }
              let eh = e;
              try {
                eh = new URL(e).hostname.toLowerCase();
              } catch {
                /* bare host entry */
              }
              return host === eh;
            });
          return cb(null, allow);
        };
  await app.register(cors, { origin: corsOption });

  // Abuse guard only — generous so it never blocks a real visitor. Now keyed on
  // the real client IP (see trustProxy above), so one person's chatty voice call
  // no longer eats everyone else's quota. Actual voice COST is controlled by the
  // 90s-silence cutoff, the 15-min non-buying shut-off, the per-person daily voice
  // cap, and the global daily voice/image caps — not by this per-minute limit.
  await app.register(rateLimit, {
    max: 240,
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
  await app.register(supportRoutes);
  await app.register(visualizeRoutes);
  await app.register(memoryRoutes);
  await app.register(adminRoutes);
  await app.register(offerRoutes);
  await app.register(greetingRoutes);

  // Customer-memory schema (best-effort; no-op when DB disabled, never throws).
  await migrate();
  void purgeMemory();

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
