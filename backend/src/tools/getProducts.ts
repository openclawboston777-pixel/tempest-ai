import { config } from "../config.js";
import { logger } from "../logger.js";

export interface ProductVariant {
  title: string;
  price: string;
  available: boolean;
  quantityAvailable?: number | null;
}

export interface Product {
  id: string;
  title: string;
  description?: string;
  price: string;
  currency: string;
  available: boolean;
  quantityAvailable?: number | null;
  url: string;
  image?: string;
  variants?: ProductVariant[];
}

const PRODUCTS_QUERY = `
  query Products($q: String!) {
    products(first: 20, query: $q) {
      edges {
        node {
          id
          title
          description
          onlineStoreUrl
          availableForSale
          totalInventory
          featuredImage {
            url
          }
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
                quantityAvailable
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

// Browse query: fetch ALL published products in one page (Storefront max is 250;
// the store has ~121 active). Previously this was a cheapest-60 + priciest-60 hack
// that silently dropped mid-priced products once the catalog grew past 120.
const ALL_PRODUCTS_QUERY = `
  query AllProducts {
    products(first: 250, sortKey: PRICE) {
      edges {
        node {
          id
          title
          onlineStoreUrl
          availableForSale
          totalInventory
          featuredImage {
            url
          }
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
  totalInventory?: number | null;
  featuredImage?: { url?: string } | null;
  priceRange: { minVariantPrice: GqlMoney };
  variants: {
    edges: Array<{
      node: {
        title?: string;
        availableForSale: boolean;
        quantityAvailable?: number | null;
        price?: GqlMoney;
      };
    }>;
  };
}

interface GqlResponse {
  data?: {
    products?: { edges?: Array<{ node: GqlProductNode }> };
  };
  errors?: unknown;
}

export function cleanDescription(raw: string): string {
  let text = typeof raw === "string" ? raw : "";
  if (!text) return "";

  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ");

  text = text.replace(/<[^>]*>/g, " ");

  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  text = text.replace(
    /\b[A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)*\s*#[A-Za-z0-9_]+#/g,
    " ",
  );
  text = text.replace(/#[A-Za-z0-9_]+#/g, " ");

  text = text.replace(/\.[-\w]+\s*\{[^}]*\}/g, " ");

  text = text.replace(/\s+/g, " ").trim();

  return text.slice(0, 2000);
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
    quantityAvailable: e.node.quantityAvailable ?? null,
  }));
  const available =
    typeof node.availableForSale === "boolean"
      ? node.availableForSale
      : variants.some((v) => v.available);
  return {
    id: node.id,
    title: node.title,
    description: cleanDescription(node.description ?? ""),
    price: min?.amount ?? "0.00",
    currency: min?.currencyCode ?? "USD",
    available,
    quantityAvailable: node.totalInventory ?? null,
    url: node.onlineStoreUrl ?? "",
    image: node.featuredImage?.url ?? "",
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
    quantityAvailable: node.totalInventory ?? null,
    url: node.onlineStoreUrl ?? "",
    image: node.featuredImage?.url ?? "",
  };
}

const SEARCH_STOPWORDS = new Set([
  "the", "a", "an", "for", "and", "or", "with", "that", "this", "some", "any",
  "of", "to", "in", "on", "my", "our", "your", "me", "we", "is", "are", "it",
  "something", "need", "want", "looking", "really", "kind", "like", "new",
  "would", "could", "get", "one", "please", "you", "have", "has",
]);

// Build an OR query across the meaningful CONTENT words of the request, not the
// whole phrase. A descriptive query like "deep sectional for napping pet friendly"
// used to become title:*deep sectional for napping pet friendly* → zero matches;
// now it ORs each content token (deep, sectional, napping, pet, friendly) across
// title/product_type/tag, so the category word ("sectional") still surfaces results.
function buildSearchQuery(rawQuery: string): string {
  const term = rawQuery.trim().toLowerCase();
  const tokens = Array.from(
    new Set(
      term
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
        .filter((w) => w.length >= 3 && !SEARCH_STOPWORDS.has(w)),
    ),
  ).slice(0, 6);

  // Full-text OR over the content tokens. Bare tokens use Shopify's full-text
  // matching (good recall, incl. matches in title/type/tags/vendor), which is what
  // made single-word queries like "sectional" return ~20. A bare MULTI-word phrase
  // would be treated as an implicit AND and match nothing, so we OR the tokens.
  if (tokens.length === 0) return term;
  return tokens.join(" OR ");
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
  const nodes = await runQuery({ query: ALL_PRODUCTS_QUERY });
  if (nodes === null) {
    return [];
  }

  const byId = new Map<string, Product>();
  for (const node of nodes) {
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

// Short in-memory cache so repeated lookups within/around a conversation don't
// re-hit Shopify each time — cuts latency on Ema's "let me look that up" turns.
// TTL is short so stock/price stay effectively live.
const PRODUCT_CACHE_TTL_MS = 60_000;
const productCache = new Map<string, { t: number; data: Product[] }>();

export async function getProducts(query: string): Promise<Product[]> {
  if (config.mockShopify) {
    logger.info({ query }, "getProducts: MOCK mode (Shopify env not configured)");
    return mockProducts(query);
  }

  const isBroad = query.trim().length === 0;
  const cacheKey = isBroad ? "__broad__" : buildSearchQuery(query);

  const now = Date.now();
  const hit = productCache.get(cacheKey);
  if (hit && now - hit.t < PRODUCT_CACHE_TTL_MS) return hit.data;

  try {
    let result: Product[];
    if (isBroad) {
      result = await getBroadProducts();
    } else {
      const nodes = await runQuery({
        query: PRODUCTS_QUERY,
        variables: { q: cacheKey },
      });
      if (nodes === null) return [];
      if (nodes.length === 0) {
        // No keyword match: fall back to the full catalog so Ema always has real
        // products to offer instead of telling the customer "nothing fits".
        logger.info({ query }, "getProducts: search empty — falling back to broad catalog");
        result = await getBroadProducts();
      } else {
        result = nodes.map((node) => mapNodeFull(node));
      }
    }
    if (result.length > 0) productCache.set(cacheKey, { t: now, data: result });
    return result;
  } catch (err) {
    logger.error({ err }, "getProducts: unexpected error");
    return [];
  }
}
