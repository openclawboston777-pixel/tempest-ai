import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { EMA_SYSTEM_PROMPT } from "../ema/systemPrompt.js";
import { XaiTextProvider } from "../providers/xaiTextProvider.js";
import type { ChatMessage, TextProvider } from "../providers/textProvider.js";
import { logger } from "../logger.js";

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
});

const bodySchema = z.object({
  messages: z.array(messageSchema).min(1),
  sessionId: z.string().optional(),
});

export const chatRoutes: FastifyPluginAsync = async (app) => {
  const provider: TextProvider = new XaiTextProvider();

  app.post("/chat", async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      return;
    }

    const messages: ChatMessage[] = [
      { role: "system", content: EMA_SYSTEM_PROMPT },
      ...parsed.data.messages,
    ];

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    try {
      for await (const delta of provider.streamChat(messages)) {
        reply.raw.write(`data: ${JSON.stringify(delta)}\n\n`);
      }
    } catch (err) {
      logger.error({ err }, "chat stream error");
      reply.raw.write(
        `data: ${JSON.stringify("Sorry, an unexpected error occurred.")}\n\n`
      );
    } finally {
      reply.raw.write("data: [DONE]\n\n");
      reply.raw.end();
    }
  });
};

export default chatRoutes;
