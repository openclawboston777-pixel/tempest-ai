import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { EMA_SYSTEM_PROMPT } from "../ema/systemPrompt.js";
import { XaiTextProvider } from "../providers/xaiTextProvider.js";
import type { ChatMessage, TextProvider } from "../providers/textProvider.js";
import { ensureVisitor, getProfileContext, saveMessages } from "../memory/store.js";
import { logger } from "../logger.js";

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

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

    const sessionId =
      parsed.data.sessionId && SESSION_ID_RE.test(parsed.data.sessionId)
        ? parsed.data.sessionId
        : undefined;

    // Load returning-customer memory (best-effort; never blocks/breaks chat).
    let memoryContext: string | null = null;
    if (sessionId) {
      try {
        await ensureVisitor(sessionId, String(request.headers["user-agent"] || ""));
        memoryContext = await getProfileContext(sessionId);
      } catch (err) {
        logger.warn({ err: String(err) }, "chat: memory load failed");
      }
    }

    const messages: ChatMessage[] = [
      { role: "system", content: EMA_SYSTEM_PROMPT },
      ...(memoryContext ? [{ role: "system" as const, content: memoryContext }] : []),
      ...parsed.data.messages,
    ];

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    let assistantText = "";
    try {
      for await (const delta of provider.streamChat(messages, { sessionId })) {
        assistantText += delta;
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

    // Persist this turn (last user message + assistant reply) for continuity.
    if (sessionId) {
      const lastUser = [...parsed.data.messages].reverse().find((m) => m.role === "user");
      const toSave: Array<{ role: string; content: string }> = [];
      if (lastUser?.content) toSave.push({ role: "user", content: lastUser.content });
      if (assistantText.trim()) toSave.push({ role: "assistant", content: assistantText });
      if (toSave.length) {
        void saveMessages(sessionId, toSave).catch((err) =>
          logger.warn({ err: String(err) }, "chat: saveMessages failed"),
        );
      }
    }
  });
};

export default chatRoutes;
