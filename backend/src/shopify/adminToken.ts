import { config } from "../config.js";
import { logger } from "../logger.js";

let cached: { token: string; expiresAt: number } | null = null;
let inflight: Promise<string | null> | null = null;

async function refresh(): Promise<string | null> {
  try {
    const res = await fetch(
      `https://${config.shopifyStoreDomain}/admin/oauth/access_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: config.shopifyClientId as string,
          client_secret: config.shopifyClientSecret as string,
        }),
      },
    );

    if (res.ok) {
      const json = (await res.json()) as {
        access_token?: string;
        expires_in?: number | string;
      };
      if (json?.access_token) {
        cached = {
          token: json.access_token,
          expiresAt: Date.now() + (Number(json.expires_in) || 86400) * 1000,
        };
        logger.info("admin token refreshed");
        return cached.token;
      }
    }

    const text = await res.text().catch(() => "");
    logger.warn(
      { status: res.status, bodyStart: text.slice(0, 200) },
      "admin token request failed",
    );
    cached = null;
    return null;
  } catch (err) {
    logger.error({ err }, "admin token refresh error");
    cached = null;
    return null;
  }
}

export async function getAdminToken(): Promise<string | null> {
  try {
    if (config.shopifyClientId && config.shopifyClientSecret) {
      if (cached && cached.expiresAt - Date.now() > 60000) {
        return cached.token;
      }
      if (!inflight) {
        inflight = (async () => {
          try {
            return await refresh();
          } finally {
            inflight = null;
          }
        })();
      }
      return await inflight;
    }

    if (config.shopifyAdminToken) {
      return config.shopifyAdminToken;
    }

    return null;
  } catch (err) {
    logger.error({ err }, "getAdminToken: unexpected error");
    return null;
  }
}

export function invalidateAdminToken(): void {
  cached = null;
}
