import type { FastifyPluginAsync } from "fastify";
import { config } from "../config.js";
import { logger } from "../logger.js";

// Serves a short spoken greeting in Ema's (Liora) voice, generated once via xAI
// TTS and cached in memory. The widget plays this alongside the proactive text
// bubbles. Tied to config.xaiVoice so it always matches her live voice.
let cache: Buffer | null = null;
let inflight: Promise<Buffer | null> | null = null;

async function generate(): Promise<Buffer | null> {
  if (!config.xaiApiKey) return null;
  try {
    const res = await fetch(`${config.xaiBaseUrl}/tts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.xaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: config.voiceGreetingText,
        voice_id: config.xaiVoice,
        language: "en",
      }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "voice-greeting TTS failed");
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    logger.error({ err: String(err) }, "voice-greeting generate error");
    return null;
  }
}

const greetingRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/voice-greeting.mp3",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (_req, reply) => {
      if (!cache) {
        if (!inflight) inflight = generate();
        cache = await inflight;
        inflight = null;
      }
      if (!cache) {
        reply.code(503).send({ error: "greeting_unavailable" });
        return;
      }
      reply
        .header("Content-Type", "audio/mpeg")
        .header("Cache-Control", "public, max-age=86400")
        .send(cache);
    },
  );
};

export default greetingRoutes;
