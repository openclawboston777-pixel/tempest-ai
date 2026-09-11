import { z } from "zod";

const EnvSchema = z.object({
  XAI_API_KEY: z.string().optional(),
  XAI_BASE_URL: z.string().url().default("https://api.x.ai/v1"),
  XAI_TEXT_MODEL: z.string().default("grok-4.20-0309-non-reasoning"),
  XAI_VOICE_MODEL: z.string().default("grok-voice-latest"),
  XAI_VOICE: z.string().default("eve"),

  SHOPIFY_STORE_DOMAIN: z.string().optional(),
  SHOPIFY_STOREFRONT_TOKEN: z.string().optional(),
  SHOPIFY_API_VERSION: z.string().default("2025-07"),
  SHOPIFY_ADMIN_TOKEN: z.string().optional(),
  SHOPIFY_ADMIN_API_VERSION: z.string().default("2026-07"),
  SHOPIFY_CLIENT_ID: z.string().optional(),
  SHOPIFY_CLIENT_SECRET: z.string().optional(),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_IMAGE_MODEL: z.string().default("gemini-3.1-flash-image"),
  VISUALIZE_MAX_PER_SESSION: z.coerce.number().int().positive().default(6),
  VISUALIZE_MAX_UPLOAD_MB: z.coerce.number().positive().default(12),

  AWS_REGION: z.string().default("eu-north-1"),
  S3_BUCKET: z.string().optional(),
  S3_PREFIX: z.string().default("tempest-ai/conversations"),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),

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
const mockOrders = Boolean(
  !(env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET) &&
    !env.SHOPIFY_ADMIN_TOKEN,
);

export const config = {
  xaiApiKey: env.XAI_API_KEY,
  xaiBaseUrl: env.XAI_BASE_URL.replace(/\/+$/, ""),
  xaiTextModel: env.XAI_TEXT_MODEL,
  xaiVoiceModel: env.XAI_VOICE_MODEL,
  xaiVoice: env.XAI_VOICE,

  shopifyStoreDomain: env.SHOPIFY_STORE_DOMAIN,
  shopifyStorefrontToken: env.SHOPIFY_STOREFRONT_TOKEN,
  shopifyApiVersion: env.SHOPIFY_API_VERSION,
  shopifyAdminToken: env.SHOPIFY_ADMIN_TOKEN,
  shopifyAdminApiVersion: env.SHOPIFY_ADMIN_API_VERSION,
  shopifyClientId: env.SHOPIFY_CLIENT_ID,
  shopifyClientSecret: env.SHOPIFY_CLIENT_SECRET,

  geminiApiKey: env.GEMINI_API_KEY,
  geminiImageModel: env.GEMINI_IMAGE_MODEL,
  visualizeEnabled: Boolean(env.GEMINI_API_KEY),
  visualizeMaxPerSession: env.VISUALIZE_MAX_PER_SESSION,
  visualizeMaxUploadBytes: Math.round(env.VISUALIZE_MAX_UPLOAD_MB * 1024 * 1024),

  awsRegion: env.AWS_REGION,
  s3Bucket: env.S3_BUCKET,
  s3Prefix: env.S3_PREFIX.replace(/\/+$/, ""),
  awsAccessKeyId: env.AWS_ACCESS_KEY_ID,
  awsSecretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  storageEnabled: Boolean(env.S3_BUCKET && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY),

  port: env.PORT,
  corsOrigin: env.CORS_ORIGIN,

  mockXai,
  mockShopify,
  mockOrders,
} as const;

export type Config = typeof config;
