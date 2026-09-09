import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../config.js";
import { XaiTextProvider } from "./xai.js";

function sseResponse(chunks: unknown[]): Response {
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let out = "";
  for await (const delta of stream) out += delta;
  return out;
}

describe("XaiTextProvider", () => {
  it("resolves get_products tool calls and streams the final answer", async () => {
    const config = loadConfig();
    config.xai.apiKey = "test-key";
    config.shopify.storeDomain = undefined;
    config.shopify.storefrontToken = undefined;
    config.shopify.storefrontPrivateToken = undefined;

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: "call_1", function: { name: "get_products", arguments: '{"query":' } },
                  ],
                },
              },
            ],
          },
          {
            choices: [
              { delta: { tool_calls: [{ index: 0, function: { arguments: '"sofa"}' } }] } },
            ],
          },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          { choices: [{ delta: { content: "We have " } }] },
          { choices: [{ delta: { content: "a coral sofa." } }] },
        ]),
      );

    const provider = new XaiTextProvider({ config, fetchImpl: fetchImpl as unknown as typeof fetch });
    const text = await collect(
      provider.streamChat({ messages: [{ role: "user", content: "Any sofas?" }] }),
    );

    expect(text).toBe("We have a coral sofa.");
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const secondBody = JSON.parse((fetchImpl.mock.calls[1][1] as RequestInit).body as string);
    const toolMessage = secondBody.messages.at(-1);
    expect(toolMessage.role).toBe("tool");
    expect(toolMessage.tool_call_id).toBe("call_1");
    expect(JSON.parse(toolMessage.content).source).toBe("mock");
    expect(secondBody.messages[0].role).toBe("system");
  });

  it("fails fast when the API key is missing", async () => {
    const config = loadConfig();
    config.xai.apiKey = undefined;
    const provider = new XaiTextProvider({ config });

    await expect(
      collect(provider.streamChat({ messages: [{ role: "user", content: "hi" }] })),
    ).rejects.toThrow(/XAI_API_KEY/);
  });
});
