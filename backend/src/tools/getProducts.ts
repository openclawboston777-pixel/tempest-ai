import { config } from "../config.js";
import { logger } from "../logger.js";

export interface ProductVariant {
  title: string;
  price: string;
  available: boolean;
}

export interface Product {
  id: string;
  title: string;
  description?: string;
  price: string;
  currency: string;
  available: boolean;
  url: string;
  variants?: ProductVariant[];
}

const PRODUCTS_QUERY = `
  query Products($q: String!) {
    products(first: 10, query: $q) {
      edges {
        node {
          id
          title
          description
          onlineStoreUrl
          availableForSale
          priceRange {
            minVariantPrice {
              amount
              currencyCode
            }
          }
          variants(first: 10) {
            edges {
              node {
                title
                availableForSale
                price {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    }
  }
`;

const CHEAPEST_PRODUCTS_QUERY = `
  query CheapestProducts {
    products(first: 60, sortKey: PRICE) {
      edges {
        node {
          id
          title
          onlineStoreUrl
          availableForSale
          priceRange {
            minVariantPrice {
              amount
              currencyCode
            }
          }
          variants(first: 10) {
            edges {
              node {
                availableForSale
              }
            }
          }
        }
      }
    }
  }
`;

const EXPENSIVE_PRODUCTS_QUERY = `
  query ExpensiveProducts {
    products(first: 60, sortKey: PRICE, reverse: true) {
      edges {
        node {
          id
          title
          onlineStoreUrl
          availableForSale
          priceRange {
            minVariantPrice {
              amount
              currencyCode
            }
          }
          variants(first: 10) {
            edges {
              node {
                availableForSale
              }
            }
          }
        }
      }
    }
  }
`;

interface GqlMoney {
  amount: string;
  currencyCode: string;
}

interface GqlProductNode {
  id: string;
  title: string;
  description?: string;
  onlineStoreUrl: string | null;
  availableForSale?: boolean;
  priceRange: { minVariantPrice: GqlMoney };
  variants: {
    edges: Array<{
      node: { title?: string; availableForSale: boolean; price?: GqlMoney };
    }>;
  };
}

interface GqlResponse {
  data?: {
    products?: { edges?: Array<{ node: GqlProductNode }> };
  };
  errors?: unknown;
}

function mockProducts(query: string): Product[] {
  return [
    {
      id: "mock/1",
      title: "[MOCK] Aurora 3-Seat Sofa",
      description:
        "MOCK DATA — a plush 3-seat sofa with deep cushions. Not from live Shopify.",
      price: "1299.00",
      currency: "USD",
      available: true,
      url: "https://example.com/products/aurora-sofa",
      variants: [
        { title: "Slate Grey", price: "1299.00", available: true },
        { title: "Sand Beige", price: "1299.00", available: false },
      ],
    },
    {
      id: "mock/2",
      title: "[MOCK] Nordic 2-Seat Loveseat",
      description: `MOCK DATA — compact loveseat (query: "${query}"). Not from live Shopify.`,
      price: "899.00",
      currency: "USD",
      available: true,
      url: "https://example.com/products/nordic-loveseat",
      variants: [{ title: "Forest Green", price: "899.00", available: true }],
    },
  ];
}

function parsePrice(amount: string | undefined): number {
  const n = Number.parseFloat(amount ?? "");
  return Number.isFinite(n) ? n : 0;
}

function mapNodeFull(node: GqlProductNode): Product {
  const min = node.priceRange?.minVariantPrice;
  const variants = (node.variants?.edges ?? []).map((e) => ({
    title: e.node.title ?? "",
    price: e.node.price?.amount ?? "0.00",
    available: Boolean(e.node.availableForSale),
  }));
  const available =
    typeof node.availableForSale === "boolean"
      ? node.availableForSale
      : variants.some((v) => v.available);
  return {
    id: node.id,
    title: node.title,
    description: node.description ?? "",
    price: min?.amount ?? "0.00",
    currency: min?.currencyCode ?? "USD",
    available,
    url: node.onlineStoreUrl ?? "",
    variants,
  };
}

function mapNodeCompact(node: GqlProductNode): Product {
  const min = node.priceRange?.minVariantPrice;
  const variantsAvailable = (node.variants?.edges ?? []).some((e) =>
    Boolean(e.node.availableForSale),
  );
  const available =
    typeof node.availableForSale === "boolean"
      ? node.availableForSale
      : variantsAvailable;
  return {
    id: node.id,
    title: node.title,
    price: min?.amount ?? "0.00",
    currency: min?.currencyCode ?? "USD",
    available,
    url: node.onlineStoreUrl ?? "",
  };
}

function buildSearchQuery(rawQuery: string): string {
  const term = rawQuery.trim().toLowerCase();
  const singular = term.endsWith("s") ? term.slice(0, -1) : term;

  const parts: string[] = [];
  parts.push(term);
  if (singular !== term) {
    parts.push(singular);
  }
  parts.push(`title:*${singular}*`);
  parts.push(`product_type:*${singular}*`);
  parts.push(`tag:*${singular}*`);

  return parts.join(" OR ");
}

function endpointUrl(): string {
  return `https://${config.shopifyStoreDomain}/api/${config.shopifyApiVersion}/graphql.json`;
}

async function runQuery(
  body: Record<string, unknown>,
): Promise<GqlProductNode[] | null> {
  const res = await fetch(endpointUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Shopify-Storefront-Private-Token": config.shopifyStorefrontToken as string,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    logger.error(
      { status: res.status },
      "getProducts: Shopify Storefront request failed",
    );
    return null;
  }

  const json = (await res.json()) as GqlResponse;
  if (json.errors) {
    logger.error({ errors: json.errors }, "getProducts: Shopify GraphQL errors");
    return null;
  }

  return (json.data?.products?.edges ?? []).map((e) => e.node);
}

async function getBroadProducts(): Promise<Product[]> {
  const [cheapest, expensive] = await Promise.all([
    runQuery({ query: CHEAPEST_PRODUCTS_QUERY }),
    runQuery({ query: EXPENSIVE_PRODUCTS_QUERY }),
  ]);

  if (cheapest === null && expensive === null) {
    return [];
  }

  const byId = new Map<string, Product>();
  for (const node of [...(cheapest ?? []), ...(expensive ?? [])]) {
    if (!byId.has(node.id)) {
      byId.set(node.id, mapNodeCompact(node));
    }
  }

  const merged = Array.from(byId.values());
  merged.sort((a, b) => parsePrice(a.price) - parsePrice(b.price));

  if (merged.length === 0) {
    logger.info({ broad: true }, "getProducts: no products matched");
  }
  return merged;
}

export async function getProducts(query: string): Promise<Product[]> {
  if (config.mockShopify) {
    logger.info({ query }, "getProducts: MOCK mode (Shopify env not configured)");
    return mockProducts(query);
  }

  const isBroad = query.trim().length === 0;

  try {
    if (isBroad) {
      return await getBroadProducts();
    }

    const nodes = await runQuery({
      query: PRODUCTS_QUERY,
      variables: { q: buildSearchQuery(query) },
    });

    if (nodes === null) {
      return [];
    }

    if (nodes.length === 0) {
      logger.info({ query, broad: false }, "getProducts: no products matched");
      return [];
    }

    return nodes.map((node) => mapNodeFull(node));
  } catch (err) {
    logger.error({ err }, "getProducts: unexpected error");
    return [];
  }
}
