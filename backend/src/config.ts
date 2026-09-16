import { z } from "zod";

const EnvSchema = z.object({
  XAI_API_KEY: z.string().optional(),
  XAI_BASE_URL: z.string().url().default("https://api.x.ai/v1"),
  XAI_TEXT_MODEL: z.string().default("grok-4.20-0309-non-reasoning"),
  XAI_VOICE_MODEL: z.string().default("grok-voice-latest"),
  XAI_VOICE: z.string().default("liora"),
  // Short spoken greeting (Ema's voice) played alongside the proactive text bubbles.
  VOICE_GREETING_TEXT: z
    .string()
    .default(
      "Hey, I'm Ema, Tempest's AI assistant. If you'd like to talk, just tap the icon and allow your microphone. Otherwise, I'm right here whenever you need me.",
    ),

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
  VISUALIZE_MAX_PER_DAY: z.coerce.number().int().positive().default(300),
  VISUALIZE_MAX_UPLOAD_MB: z.coerce.number().positive().default(12),
  VOICE_TOKENS_MAX_PER_DAY: z.coerce.number().int().positive().default(500),

  AWS_REGION: z.string().default("eu-north-1"),
  S3_BUCKET: z.string().optional(),
  S3_PREFIX: z.string().default("tempest-ai/conversations"),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),

  DATABASE_URL: z.string().optional(),
  MEMORY_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
  ADMIN_TOKEN: z.string().optional(),

  // Offer engine (hard money rules from the sales prompt)
  OFFER_SHIPPING_ALLOWANCE: z.coerce.number().nonnegative().default(1000),
  OFFER_MIN_GROSS_PROFIT: z.coerce.number().nonnegative().default(500),
  OFFER_DEAL_LOCK_MINUTES: z.coerce.number().int().positive().default(20),
  OFFER_COMEBACK_CREDIT_DAYS: z.coerce.number().int().positive().default(30),
  OFFER_CODE_PREFIX: z.string().default("EMA"),
  // Financing is presented at CHECKOUT (Shop Pay installments, Affirm) — Ema
  // describes it, she does NOT create a code for it. Comma-separated provider ids.
  FINANCING_PROVIDERS: z.string().default("shop_pay,affirm"),

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
  voiceGreetingText: env.VOICE_GREETING_TEXT,

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
  visualizeMaxPerDay: env.VISUALIZE_MAX_PER_DAY,
  visualizeMaxUploadBytes: Math.round(env.VISUALIZE_MAX_UPLOAD_MB * 1024 * 1024),
  voiceTokensMaxPerDay: env.VOICE_TOKENS_MAX_PER_DAY,

  awsRegion: env.AWS_REGION,
  s3Bucket: env.S3_BUCKET,
  s3Prefix: env.S3_PREFIX.replace(/\/+$/, ""),
  awsAccessKeyId: env.AWS_ACCESS_KEY_ID,
  awsSecretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  storageEnabled: Boolean(env.S3_BUCKET && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY),

  databaseUrl: env.DATABASE_URL,
  dbEnabled: Boolean(env.DATABASE_URL),
  memoryRetentionDays: env.MEMORY_RETENTION_DAYS,
  adminToken: env.ADMIN_TOKEN,

  offerShippingAllowance: env.OFFER_SHIPPING_ALLOWANCE,
  offerMinGrossProfit: env.OFFER_MIN_GROSS_PROFIT,
  offerDealLockMinutes: env.OFFER_DEAL_LOCK_MINUTES,
  offerComebackCreditDays: env.OFFER_COMEBACK_CREDIT_DAYS,
  offerCodePrefix: env.OFFER_CODE_PREFIX,
  financingProviders: env.FINANCING_PROVIDERS.split(",").map((s) => s.trim()).filter(Boolean),
  financingEnabled: env.FINANCING_PROVIDERS.trim().length > 0,

  port: env.PORT,
  corsOrigin: env.CORS_ORIGIN,

  mockXai,
  mockShopify,
  mockOrders,
} as const;

export type Config = typeof config;
