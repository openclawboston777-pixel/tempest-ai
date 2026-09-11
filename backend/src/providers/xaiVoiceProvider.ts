import { config } from "../config.js";
import { logger } from "../logger.js";
import type { VoiceProvider, EphemeralToken } from "./voiceProvider.js";

const REALTIME_URL = "https://api.x.ai/v1/realtime";
const STUB_URL = "wss://api.x.ai/v1/realtime";

export class XaiVoiceProvider implements VoiceProvider {
  async mintEphemeralToken(): Promise<EphemeralToken> {
    if (config.mockXai) {
      return {
        token: "stub-ephemeral",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        url: STUB_URL,
        model: config.xaiVoiceModel,
        stub: true,
      };
    }

    try {
      const res = await fetch(`${config.xaiBaseUrl}/realtime/client_secrets`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.xaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: config.xaiVoiceModel }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        logger.error({ status: res.status, text }, "xAI voice token failed");
        return {
          token: "stub-ephemeral",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          url: STUB_URL,
          model: config.xaiVoiceModel,
          stub: true,
        };
      }

      const data: { value: string; expires_at: number } = await res.json();

      return {
        token: data.value,
        expiresAt: new Date(data.expires_at * 1000).toISOString(),
        url: REALTIME_URL,
        model: config.xaiVoiceModel,
      };
    } catch (err) {
      logger.error({ err }, "xAI voice token error");
      return {
        token: "stub-ephemeral",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        url: STUB_URL,
        model: config.xaiVoiceModel,
        stub: true,
      };
    }
  }
}
