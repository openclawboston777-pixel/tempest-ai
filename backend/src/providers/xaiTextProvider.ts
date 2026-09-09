import { config } from "../config.js";
import { logger } from "../logger.js";
import { toolDefs, executeTool } from "../tools/index.js";
import type { TextProvider, ChatMessage } from "./textProvider.js";

interface ToolCallAccumulator {
  id: string;
  name: string;
  args: string;
}

async function* parseSSE(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<any> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        yield JSON.parse(data);
      } catch {
        // ignore malformed partial JSON
      }
    }
  }
}

export class XaiTextProvider implements TextProvider {
  async *streamChat(messages: ChatMessage[]): AsyncGenerator<string> {
    if (config.mockXai) {
      yield "Hi, I'm Ema (mock mode). ";
      yield "I can't reach the live model right now, but I'm here to help with our furniture collection.";
      return;
    }

    // Work on a mutable copy so we can append tool results.
    const convo: ChatMessage[] = [...messages];

    // Allow a few tool-call rounds to avoid infinite loops.
    for (let round = 0; round < 5; round++) {
      const toolCalls: Record<number, ToolCallAccumulator> = {};
      let sawToolCall = false;

      try {
        const res = await fetch(`${config.xaiBaseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.xaiApiKey}`,
          },
          body: JSON.stringify({
            model: config.xaiTextModel,
            stream: true,
            messages: convo,
            tools: toolDefs,
          }),
        });

        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          logger.error({ status: res.status, text }, "xAI chat request failed");
          yield "Sorry, I'm having trouble reaching the assistant right now. Please try again in a moment.";
          return;
        }

        for await (const chunk of parseSSE(res.body)) {
          const choice = chunk?.choices?.[0];
          if (!choice) continue;
          const delta = choice.delta ?? {};

          if (delta.content) {
            yield delta.content as string;
          }

          if (Array.isArray(delta.tool_calls)) {
            sawToolCall = true;
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const acc =
                toolCalls[idx] ?? (toolCalls[idx] = { id: "", name: "", args: "" });
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.name = tc.function.name;
              if (tc.function?.arguments) acc.args += tc.function.arguments;
            }
          }
        }
      } catch (err) {
        logger.error({ err }, "xAI chat stream error");
        yield "Sorry, something went wrong while generating a response.";
        return;
      }

      if (!sawToolCall) {
        return; // completed normally
      }

      // Append assistant tool_calls message + tool results, then continue.
      const calls = Object.values(toolCalls);
      convo.push({
        role: "assistant",
        content: "",
        // @ts-expect-error tool_calls is OpenAI-compatible extra field
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: c.args },
        })),
      });

      for (const c of calls) {
        let result: string;
        try {
          result = await executeTool(c.name, c.args);
        } catch (err) {
          logger.error({ err, tool: c.name }, "tool execution failed");
          result = JSON.stringify({ error: "tool_failed" });
        }
        convo.push({
          role: "tool",
          content: result,
          tool_call_id: c.id,
          name: c.name,
        });
      }
    }

    logger.warn("xAI chat exceeded max tool-call rounds");
  }
}
