import "dotenv/config";

const DEFAULT_XAI_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_XAI_MODEL = "grok-4";
const DEFAULT_SHOPIFY_API_VERSION = "2025-07";

function optional(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function withDefault(name: string, fallback: string): string {
  return optional(name) ?? fallback;
}

function intWithDefault(name: string, fallback: number): number {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${name}: expected a positive integer`);
  }
  return parsed;
}

export interface Config {
  port: number;
  host: string;
  logLevel: string;
  assistantName: string;
  xai: {
    baseUrl: string;
    model: string;
    apiKey?: string;
    voiceModel: string;
  };
  shopify: {
    storeDomain?: string;
    storefrontToken?: string;
    storefrontPrivateToken?: string;
    apiVersion: string;
  };
  rateLimit: {
    max: number;
    timeWindowMs: number;
  };
}

/**
 * Reads configuration from the environment. Secrets stay optional so the
 * service can boot (and serve mock catalog data) without credentials.
 */
export function loadConfig(): Config {
  return {
    port: intWithDefault("PORT", 3000),
    host: withDefault("HOST", "0.0.0.0"),
    logLevel: withDefault("LOG_LEVEL", "info"),
    assistantName: withDefault("EMA_ASSISTANT_NAME", "Ema"),
    xai: {
      baseUrl: withDefault("XAI_BASE_URL", DEFAULT_XAI_BASE_URL).replace(/\/+$/, ""),
      model: withDefault("XAI_MODEL", DEFAULT_XAI_MODEL),
      apiKey: optional("XAI_API_KEY"),
      voiceModel: withDefault("XAI_VOICE_MODEL", "grok-4-realtime"),
    },
    shopify: {
      storeDomain: optional("SHOPIFY_STORE_DOMAIN"),
      storefrontToken: optional("SHOPIFY_STOREFRONT_TOKEN"),
      storefrontPrivateToken: optional("SHOPIFY_STOREFRONT_PRIVATE_TOKEN"),
      apiVersion: withDefault("SHOPIFY_API_VERSION", DEFAULT_SHOPIFY_API_VERSION),
    },
    rateLimit: {
      max: intWithDefault("RATE_LIMIT_MAX", 20),
      timeWindowMs: intWithDefault("RATE_LIMIT_WINDOW_MS", 60_000),
    },
  };
}
