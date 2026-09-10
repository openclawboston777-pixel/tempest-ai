import { config } from "../config.js";
import { logger } from "../logger.js";
import { toolDefs, executeTool } from "../tools/index.js";
import type { TextProvider, ChatMessage } from "./textProvider.js";

export class XaiTextProvider implements TextProvider {
  async *streamChat(messages: ChatMessage[]): AsyncGenerator<string> {
    if (config.mockXai) {
      yield "Hi, I'm Ema (mock mode). ";
      yield "I can't reach the live model right now, but I'm here to help with our furniture collection.";
      return;
    }

    const convo: ChatMessage[] = [...messages];
    let finalContent = "";

    try {
      // ---- TOOL LOOP (non-streaming, reliable) ----
      for (let round = 0; round < 4; round++) {
        const res = await fetch(`${config.xaiBaseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.xaiApiKey}`,
          },
          body: JSON.stringify({
            model: config.xaiTextModel,
            messages: convo,
            tools: toolDefs,
            tool_choice: "auto",
            stream: false,
          }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          logger.error({ status: res.status, text }, "xAI tool-phase request failed");
          yield "Sorry, I'm having trouble reaching the assistant right now.";
          return;
        }

        const data = await res.json();
        const message = data?.choices?.[0]?.message;
        if (!message) break;

        const toolCalls = message.tool_calls;
        if (Array.isArray(toolCalls) && toolCalls.length > 0) {
          convo.push({
            role: "assistant",
            content: message.content ?? "",
            // @ts-expect-error tool_calls is OpenAI-compatible extra field
            tool_calls: toolCalls,
          });

          for (const tc of toolCalls) {
            let result: string;
            try {
              result = await executeTool(tc.function?.name, tc.function?.arguments);
            } catch (err) {
              logger.error({ err, tool: tc.function?.name }, "tool execution failed");
              result = JSON.stringify({ error: "tool_failed" });
            }
            convo.push({
              role: "tool",
              content: result,
              tool_call_id: tc.id,
              name: tc.function?.name,
            });
          }
          continue;
        }

        // No tool calls: the content IS the final answer.
        if (typeof message.content === "string") {
          finalContent = message.content;
        }
        break;
      }

      // ---- STREAM THE FINAL ANSWER IN SMALL CHUNKS ----
      if (!finalContent || !finalContent.trim()) {
        yield "I'm here to help with our furniture collection — could you tell me a bit more about what you're looking for?";
        return;
      }

      const size = 24;
      for (let i = 0; i < finalContent.length; i += size) {
        yield finalContent.slice(i, i + size);
      }
    } catch (err) {
      logger.error({ err }, "xAI chat error");
      yield "Sorry, I'm having trouble reaching the assistant right now.";
      return;
    }
  }
}
