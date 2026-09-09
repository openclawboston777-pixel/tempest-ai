import { z } from "zod";

const EnvSchema = z.object({
  XAI_API_KEY: z.string().optional(),
  XAI_BASE_URL: z.string().url().default("https://api.x.ai/v1"),
  XAI_TEXT_MODEL: z.string().default("grok-4"),

  SHOPIFY_STORE_DOMAIN: z.string().optional(),
  SHOPIFY_STOREFRONT_TOKEN: z.string().optional(),
  SHOPIFY_API_VERSION: z.string().default("2025-07"),

  PORT: z.coerce.number().int().positive().default(8080),
  CORS_ORIGIN: z.string().default("*"),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // Do not print values — only which keys failed.
  const issues = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
  throw new Error(`Invalid environment configuration for: ${issues}`);
}

const env = parsed.data;

const mockXai = !env.XAI_API_KEY;
const mockShopify = !env.SHOPIFY_STORE_DOMAIN || !env.SHOPIFY_STOREFRONT_TOKEN;

export const config = {
  xaiApiKey: env.XAI_API_KEY,
  xaiBaseUrl: env.XAI_BASE_URL.replace(/\/+$/, ""),
  xaiTextModel: env.XAI_TEXT_MODEL,

  shopifyStoreDomain: env.SHOPIFY_STORE_DOMAIN,
  shopifyStorefrontToken: env.SHOPIFY_STOREFRONT_TOKEN,
  shopifyApiVersion: env.SHOPIFY_API_VERSION,

  port: env.PORT,
  corsOrigin: env.CORS_ORIGIN,

  mockXai,
  mockShopify,
} as const;

export type Config = typeof config;
