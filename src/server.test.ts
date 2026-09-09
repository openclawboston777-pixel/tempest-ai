import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";
import type { TextProvider, VoiceProvider } from "./providers/types.js";

const stubTextProvider: TextProvider = {
  name: "stub",
  async *streamChat() {
    yield "Hello ";
    yield "from Ema.";
  },
};

const stubVoiceProvider: VoiceProvider = {
  name: "stub",
  async createEphemeralToken() {
    return { token: "ephemeral", model: "grok-4-realtime", url: "wss://api.x.ai/v1/realtime" };
  },
};

async function buildTestServer() {
  const config = loadConfig();
  config.logLevel = "silent";
  return buildServer({
    config,
    textProvider: stubTextProvider,
    voiceProvider: stubVoiceProvider,
  });
}

let app: Awaited<ReturnType<typeof buildTestServer>> | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("server routes", () => {
  it("GET /health returns status ok", async () => {
    app = await buildTestServer();

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("POST /chat streams the provider output", async () => {
    app = await buildTestServer();

    const response = await app.inject({
      method: "POST",
      url: "/chat",
      payload: { messages: [{ role: "user", content: "Do you have oak tables?" }] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("Hello from Ema.");
  });

  it("POST /chat rejects invalid payloads", async () => {
    app = await buildTestServer();

    const response = await app.inject({ method: "POST", url: "/chat", payload: { messages: [] } });

    expect(response.statusCode).toBe(400);
  });

  it("POST /voice-token returns an ephemeral token without the API key", async () => {
    app = await buildTestServer();

    const response = await app.inject({ method: "POST", url: "/voice-token" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ token: "ephemeral", model: "grok-4-realtime" });
  });
});
