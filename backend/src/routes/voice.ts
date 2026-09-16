import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { XaiVoiceProvider } from "../providers/xaiVoiceProvider.js";
import type { VoiceProvider } from "../providers/voiceProvider.js";
import { EMA_VOICE_INSTRUCTIONS } from "../ema/systemPrompt.js";
import { toolDefs, executeTool } from "../tools/index.js";
import { config } from "../config.js";
import { allow } from "../costGuard.js";
import { logger } from "../logger.js";

const toolBodySchema = z.object({
  query: z.string().optional().default(""),
});

export const voiceRoutes: FastifyPluginAsync = async (app) => {
  const provider: VoiceProvider = new XaiVoiceProvider();

  app.post("/voice-token", async (_request, reply) => {
    try {
      // Global daily cap on realtime-voice sessions (xAI minutes = cost).
      if (!allow("voice_token", config.voiceTokensMaxPerDay)) {
        reply.code(429).send({ error: "voice_daily_limit" });
        return;
      }
      const token = await provider.mintEphemeralToken();
      return {
        ...token,
        voice: config.xaiVoice,
        instructions: EMA_VOICE_INSTRUCTIONS,
        // Spoken-form fixes applied before TTS (transcript keeps the original).
        // "Ema" -> "Emma" so it's pronounced "EH-mah", not "EE-ma".
        replace: { Ema: "Emma" },
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

  // Generic tool bridge for the realtime voice agent: runs ANY of Ema's tools
  // (get_products, get_shop_policies, get_order_status, submit_support_ticket,
  // remember_customer, favorites, get_product_economics, create_offer) so voice
  // is as capable as text. Returns the raw JSON-string output for the model.
  const KNOWN_TOOLS = new Set(toolDefs.map((t) => t.function.name));
  const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  const voiceToolSchema = z.object({
    name: z.string(),
    arguments: z.union([z.string(), z.record(z.any())]).optional(),
    sessionId: z.string().optional(),
  });

  app.post(
    "/voice/tool",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = voiceToolSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        reply.code(400).send({ error: "invalid_request" });
        return;
      }
      const { name } = parsed.data;
      if (!KNOWN_TOOLS.has(name)) {
        reply.code(400).send({ error: "unknown_tool" });
        return;
      }
      const argsJson =
        typeof parsed.data.arguments === "string"
          ? parsed.data.arguments
          : JSON.stringify(parsed.data.arguments ?? {});
      const sessionId =
        parsed.data.sessionId && SESSION_ID_RE.test(parsed.data.sessionId)
          ? parsed.data.sessionId
          : undefined;
      try {
        const output = await executeTool(name, argsJson, { sessionId });
        reply.type("application/json").send({ output });
      } catch (err) {
        logger.error({ err, name }, "voice tool bridge error");
        reply.type("application/json").send({
          output: JSON.stringify({ error: "tool_error" }),
        });
      }
    },
  );
};

export default voiceRoutes;
