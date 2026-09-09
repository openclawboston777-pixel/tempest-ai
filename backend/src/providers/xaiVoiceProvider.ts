import { config } from "../config.js";
import { logger } from "../logger.js";
import type { VoiceProvider, EphemeralToken } from "./voiceProvider.js";

const REALTIME_URL = "wss://api.x.ai/v1/realtime";

export class XaiVoiceProvider implements VoiceProvider {
  async mintEphemeralToken(): Promise<EphemeralToken> {
    if (config.mockXai) {
      // TODO: replace with real xAI ephemeral-token minting when available.
      return {
        token: "stub-ephemeral",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        url: REALTIME_URL,
      };
    }

    try {
      const res = await fetch(`${config.xaiBaseUrl}/realtime/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.xaiApiKey}`,
        },
        body: JSON.stringify({ model: config.xaiTextModel }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        logger.error({ status: res.status, text }, "xAI voice session failed");
        // TODO: confirm documented ephemeral-token endpoint; fall back to stub.
        return {
          token: "stub-ephemeral",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          url: REALTIME_URL,
        };
      }

      const data: any = await res.json();
      const token =
        data?.client_secret?.value ?? data?.token ?? "stub-ephemeral";
      const expiresAt =
        data?.client_secret?.expires_at ??
        data?.expiresAt ??
        new Date(Date.now() + 60_000).toISOString();

      return { token, expiresAt, url: REALTIME_URL };
    } catch (err) {
      logger.error({ err }, "xAI voice token error");
      // TODO: replace with real endpoint; graceful stub fallback.
      return {
        token: "stub-ephemeral",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        url: REALTIME_URL,
      };
    }
  }
}
