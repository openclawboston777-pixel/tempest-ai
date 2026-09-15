import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { EMA_SYSTEM_PROMPT } from "../ema/systemPrompt.js";
import { XaiTextProvider } from "../providers/xaiTextProvider.js";
import type { ChatMessage, TextProvider } from "../providers/textProvider.js";
import { ensureVisitor, getProfileContext, saveMessages } from "../memory/store.js";
import { logEvent } from "../memory/analytics.js";
import { logger } from "../logger.js";

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// grok-4.20 (fast model) reliably opens replies with "Got it, <name>." no matter
// how the prompt bans it. Strip that filler opener deterministically so Ema sounds
// natural without paying a slower model's latency. Only removes a SHORT leading
// filler clause ending at the first sentence break, and only if real content follows
// — so it never eats a genuine first sentence.
function stripFillerOpener(text: string): string {
  const m = text.match(
    /^\s*(got\s?it|gotcha|got\s?you|understood)\b(?:[^.!?\n]{0,24}?[.!?]+|\s*[—:,-]+)\s*/i,
  );
  if (m && text.length - m[0].length > 8) {
    const rest = text.slice(m[0].length);
    return rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  return text;
}

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
        void logEvent(sessionId, "user_message", {
          returning: Boolean(memoryContext),
        });
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
    const send = (s: string): void => {
      reply.raw.write(`data: ${JSON.stringify(s)}\n\n`);
    };
    try {
      // Buffer just the opening (until the first sentence break) so we can strip a
      // filler opener before it's shown; then stream the rest live. Negligible delay.
      let head = "";
      let openerDone = false;
      for await (const delta of provider.streamChat(messages, { sessionId })) {
        if (!openerDone) {
          head += delta;
          // Buffer ~48 chars so the opener + start of the real sentence are both
          // present before we strip; enough to decide, small enough to be instant.
          if (head.length >= 48) {
            const cleaned = stripFillerOpener(head);
            assistantText += cleaned;
            send(cleaned);
            openerDone = true;
            head = "";
          }
          continue;
        }
        assistantText += delta;
        send(delta);
      }
      if (!openerDone && head) {
        const cleaned = stripFillerOpener(head);
        assistantText += cleaned;
        send(cleaned);
      }
    } catch (err) {
      logger.error({ err }, "chat stream error");
      send("Sorry, an unexpected error occurred.");
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
