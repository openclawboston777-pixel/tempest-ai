import { pino } from "pino";

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "XAI_API_KEY",
      "SHOPIFY_STOREFRONT_TOKEN",
      "*.XAI_API_KEY",
      "*.SHOPIFY_STOREFRONT_TOKEN",
      "config.xaiApiKey",
      "config.shopifyStorefrontToken",
      "headers.authorization",
      "req.headers.authorization",
      'headers["shopify-storefront-private-token"]',
    ],
    censor: "[REDACTED]",
  },
  transport: isDev
    ? {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:standard" },
      }
    : undefined,
});
