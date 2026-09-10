import { config } from "../config.js";
import { logger } from "../logger.js";

const POLICIES_QUERY = `
  query ShopPolicies {
    shop {
      refundPolicy { title body url }
      shippingPolicy { title body url }
      privacyPolicy { title body url }
      termsOfService { title body url }
      subscriptionPolicy { title body url }
    }
  }
`;

interface GqlPolicy {
  title?: string;
  body?: string;
  url?: string;
}

interface GqlResponse {
  data?: {
    shop?: Record<string, GqlPolicy | null>;
  };
  errors?: unknown;
}

const POLICY_TYPES = [
  "refundPolicy",
  "shippingPolicy",
  "privacyPolicy",
  "termsOfService",
  "subscriptionPolicy",
] as const;

export async function getShopPolicies(): Promise<string> {
  if (config.mockShopify) {
    logger.info("getShopPolicies: MOCK mode (Shopify env not configured)");
    return JSON.stringify({ policies: [], note: "mock" });
  }

  try {
    const res = await fetch(
      `https://${config.shopifyStoreDomain}/api/${config.shopifyApiVersion}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Shopify-Storefront-Private-Token":
            config.shopifyStorefrontToken as string,
        },
        body: JSON.stringify({ query: POLICIES_QUERY }),
      },
    );

    if (!res.ok) {
      logger.error(
        { status: res.status },
        "getShopPolicies: Shopify Storefront request failed",
      );
      return JSON.stringify({ policies: [], error: "lookup_failed" });
    }

    const json = (await res.json()) as GqlResponse;
    if (json.errors) {
      logger.error({ errors: json.errors }, "getShopPolicies: GraphQL errors");
      return JSON.stringify({ policies: [], error: "lookup_failed" });
    }

    const shop = json.data?.shop ?? {};
    const policies = POLICY_TYPES.flatMap((type) => {
      const p = shop[type];
      const body = (p?.body ?? "").trim();
      if (!body) return [];
      return [
        {
          type,
          title: p?.title ?? "",
          body: body.slice(0, 1500),
          url: p?.url ?? "",
        },
      ];
    });

    if (policies.length === 0) {
      return JSON.stringify({ policies: [], note: "no published policies" });
    }

    return JSON.stringify({ policies });
  } catch (err) {
    logger.error({ err }, "getShopPolicies: unexpected error");
    return JSON.stringify({ policies: [], error: "lookup_failed" });
  }
}
