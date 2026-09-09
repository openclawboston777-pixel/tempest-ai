import type { FastifyPluginAsync } from "fastify";
import { XaiVoiceProvider } from "../providers/xaiVoiceProvider.js";
import type { VoiceProvider } from "../providers/voiceProvider.js";
import { logger } from "../logger.js";

export const voiceRoutes: FastifyPluginAsync = async (app) => {
  const provider: VoiceProvider = new XaiVoiceProvider();

  app.post("/voice-token", async (_request, reply) => {
    try {
      const token = await provider.mintEphemeralToken();
      return token;
    } catch (err) {
      logger.error({ err }, "voice token error");
      reply.code(502).send({ error: "voice_token_failed" });
    }
  });
};

export default voiceRoutes;
