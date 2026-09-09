import type { Config } from "../config.js";
import { getProducts } from "../shopify/products.js";
import { systemPrompt } from "./prompt.js";
import type {
  ChatMessage,
  EphemeralVoiceToken,
  StreamChatOptions,
  TextProvider,
  VoiceProvider,
} from "./types.js";

export interface MinimalLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

const NOOP_LOGGER: MinimalLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function bearer(apiKey: string): string {
  return "Bearer " + apiKey;
}

const MAX_TOOL_ROUNDS = 3;

const GET_PRODUCTS_TOOL = {
  type: "function",
  function: {
    name: "get_products",
    description:
      "Look up live products in the Tempest Furnitur catalog. Always use this before talking about price, stock or variants.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Free-text search, e.g. 'oak dining table' or 'coral sofa'.",
        },
      },
      required: ["query"],
    },
  },
} as const;

interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

export interface XaiOptions {
  config: Config;
  logger?: MinimalLogger;
  fetchImpl?: typeof fetch;
}

function requireApiKey(config: Config): string {
  if (!config.xai.apiKey) {
    throw new Error("XAI_API_KEY is not configured");
  }
  return config.xai.apiKey;
}

/** Parses an OpenAI-compatible SSE body into JSON chunks. */
async function* parseSseChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, any>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "" || data === "[DONE]") continue;
      try {
        yield JSON.parse(data) as Record<string, any>;
      } catch {
        // Ignore malformed keep-alive fragments.
      }
    }
  }
}

export class XaiTextProvider implements TextProvider {
  readonly name = "xai";

  private readonly config: Config;
  private readonly logger: MinimalLogger;
  private readonly fetchImpl: typeof fetch;

  constructor({ config, logger = NOOP_LOGGER, fetchImpl = fetch }: XaiOptions) {
    this.config = config;
    this.logger = logger;
    this.fetchImpl = fetchImpl;
  }

  async *streamChat({ messages, signal }: StreamChatOptions): AsyncIterable<string> {
    const apiKey = requireApiKey(this.config);
    const conversation: ChatMessage[] = [
      { role: "system", content: systemPrompt(this.config) },
      ...messages,
    ];

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      const response = await this.fetchImpl(`${this.config.xai.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: bearer(apiKey),
        },
        signal,
        body: JSON.stringify({
          model: this.config.xai.model,
          stream: true,
          messages: conversation,
          tools: [GET_PRODUCTS_TOOL],
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`xAI chat completion failed with status ${response.status}`);
      }

      const toolCalls = new Map<number, ToolCallAccumulator>();
      let assistantText = "";

      for await (const chunk of parseSseChunks(response.body)) {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (typeof delta.content === "string" && delta.content.length > 0) {
          assistantText += delta.content;
          yield delta.content;
        }

        for (const call of delta.tool_calls ?? []) {
          const index: number = call.index ?? 0;
          const existing = toolCalls.get(index) ?? { id: "", name: "", arguments: "" };
          if (call.id) existing.id = call.id;
          if (call.function?.name) existing.name = call.function.name;
          if (call.function?.arguments) existing.arguments += call.function.arguments;
          toolCalls.set(index, existing);
        }
      }

      if (toolCalls.size === 0) return;

      const calls = [...toolCalls.values()];
      conversation.push({
        role: "assistant",
        content: assistantText,
        // The API echoes tool calls back to us on the next turn.
        ...({
          tool_calls: calls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.arguments || "{}" },
          })),
        } as object),
      });

      for (const call of calls) {
        conversation.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.name,
          content: await this.runTool(call),
        });
      }
    }

    this.logger.warn({ rounds: MAX_TOOL_ROUNDS }, "tool call limit reached");
  }

  private async runTool(call: ToolCallAccumulator): Promise<string> {
    if (call.name !== "get_products") {
      return JSON.stringify({ error: `Unknown tool: ${call.name}` });
    }
    try {
      const args = JSON.parse(call.arguments || "{}") as { query?: unknown };
      const query = typeof args.query === "string" ? args.query : "";
      const result = await getProducts(this.config, query);
      this.logger.info(
        { tool: "get_products", source: result.source, results: result.products.length },
        "tool call",
      );
      return JSON.stringify(result);
    } catch (error) {
      this.logger.error(
        { tool: "get_products", err: (error as Error).message },
        "tool call failed",
      );
      return JSON.stringify({ error: "Product lookup failed; do not guess price or stock." });
    }
  }
}

export class XaiVoiceProvider implements VoiceProvider {
  readonly name = "xai";

  private readonly config: Config;
  private readonly fetchImpl: typeof fetch;

  constructor({ config, fetchImpl = fetch }: XaiOptions) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async createEphemeralToken(options: { signal?: AbortSignal } = {}): Promise<EphemeralVoiceToken> {
    const apiKey = requireApiKey(this.config);
    const response = await this.fetchImpl(`${this.config.xai.baseUrl}/realtime/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: bearer(apiKey),
      },
      signal: options.signal,
      body: JSON.stringify({ model: this.config.xai.voiceModel }),
    });

    if (!response.ok) {
      throw new Error(`xAI ephemeral token request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      client_secret?: { value?: string; expires_at?: number | string };
      expires_at?: number | string;
    };
    const token = payload.client_secret?.value;
    if (!token) {
      throw new Error("xAI ephemeral token response did not contain a client secret");
    }

    const rawExpiry = payload.client_secret?.expires_at ?? payload.expires_at;
    return {
      token,
      model: this.config.xai.voiceModel,
      url: `${this.config.xai.baseUrl.replace(/^http/, "ws")}/realtime`,
      expiresAt:
        typeof rawExpiry === "number"
          ? new Date(rawExpiry * 1000).toISOString()
          : (rawExpiry ?? undefined),
    };
  }
}
