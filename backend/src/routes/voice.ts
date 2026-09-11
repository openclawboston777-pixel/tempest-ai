import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { XaiVoiceProvider } from "../providers/xaiVoiceProvider.js";
import type { VoiceProvider } from "../providers/voiceProvider.js";
import { EMA_SYSTEM_PROMPT } from "../ema/systemPrompt.js";
import { toolDefs, executeTool } from "../tools/index.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

const toolBodySchema = z.object({
  query: z.string().optional().default(""),
});

export const voiceRoutes: FastifyPluginAsync = async (app) => {
  const provider: VoiceProvider = new XaiVoiceProvider();

  app.post("/voice-token", async (_request, reply) => {
    try {
      const token = await provider.mintEphemeralToken();
      return {
        ...token,
        voice: config.xaiVoice,
        instructions:
          EMA_SYSTEM_PROMPT +
          "\n\nYou are speaking out loud in a voice conversation. Keep replies short, natural, and conversational.",
        tools: toolDefs,
      };
    } catch (err) {
      logger.error({ err }, "voice token error");
      reply.code(502).send({ error: "voice_token_failed" });
    }
  });

  app.post("/tool/get-products", async (request, reply) => {
    const parsed = toolBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid_request" });
      return;
    }

    try {
      const { query } = parsed.data;
      const resultJson = await executeTool(
        "get_products",
        JSON.stringify({ query }),
      );
      const result = JSON.parse(resultJson);
      reply.type("application/json").send(result);
    } catch (err) {
      logger.error({ err }, "voice get-products tool error");
      reply.code(502).send({ error: "tool_execution_failed" });
    }
  });
};

export default voiceRoutes;
