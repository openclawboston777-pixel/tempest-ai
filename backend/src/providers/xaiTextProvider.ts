import { config } from "../config.js";
import { logger } from "../logger.js";
import { toolDefs, executeTool } from "../tools/index.js";
import type { TextProvider, ChatMessage } from "./textProvider.js";

interface ToolCallAcc {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface DeltaToolCall {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface StreamDelta {
  content?: string | null;
  tool_calls?: DeltaToolCall[];
}

export class XaiTextProvider implements TextProvider {
  async *streamChat(
    messages: ChatMessage[],
    ctx?: { sessionId?: string },
  ): AsyncGenerator<string> {
    if (config.mockXai) {
      yield "Hi, I'm Ema (mock mode). ";
      yield "I can't reach the live model right now, but I'm here to help with our furniture collection.";
      return;
    }

    const convo: ChatMessage[] = [...messages];

    try {
      for (let round = 0; round < 4; round++) {
        const toolCalls: ToolCallAcc[] = [];
        let streamedContent = "";

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
            stream: true,
          }),
        });

        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          logger.error({ status: res.status, text }, "xAI stream request failed");
          yield "Sorry, I'm having trouble right now.";
          return;
        }

        const reader = (res.body as ReadableStream<Uint8Array>).getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let done = false;

        while (!done) {
          const { value, done: streamDone } = await reader.read();
          if (streamDone) break;
          if (!value) continue;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            if (payload === "[DONE]") {
              done = true;
              break;
            }

            let json: any;
            try {
              json = JSON.parse(payload);
            } catch {
              continue;
            }

            const choice = json?.choices?.[0];
            const d: StreamDelta | undefined = choice?.delta;
            if (!d) continue;

            if (typeof d.content === "string" && d.content.length > 0) {
              streamedContent += d.content;
              yield d.content;
            }

            if (Array.isArray(d.tool_calls)) {
              for (const tc of d.tool_calls) {
                const idx = typeof tc.index === "number" ? tc.index : 0;
                if (!toolCalls[idx]) {
                  toolCalls[idx] = {
                    id: "",
                    type: "function",
                    function: { name: "", arguments: "" },
                  };
                }
                const acc = toolCalls[idx];
                if (tc.id) acc.id = tc.id;
                if (tc.function?.name) acc.function.name += tc.function.name;
                if (tc.function?.arguments) acc.function.arguments += tc.function.arguments;
              }
            }
          }
        }

        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }

        const calls = toolCalls.filter((c): c is ToolCallAcc => Boolean(c));
        if (calls.length > 0) {
          convo.push({
            role: "assistant",
            content: streamedContent || "",
            // @ts-expect-error tool_calls is an OpenAI-compatible extra field
            tool_calls: calls,
          });

          for (const tc of calls) {
            let out: string;
            try {
              out = await executeTool(tc.function.name, tc.function.arguments, ctx);
            } catch (err) {
              logger.error({ err, tool: tc.function.name }, "tool execution failed");
              out = JSON.stringify({ error: "tool_failed" });
            }
            convo.push({
              role: "tool",
              content: out,
              tool_call_id: tc.id,
              name: tc.function.name,
            });
          }
          continue;
        }

        break;
      }
    } catch (err) {
      logger.error({ err }, "xAI streaming chat error");
      yield "Sorry, I'm having trouble right now.";
      return;
    }
  }
}
