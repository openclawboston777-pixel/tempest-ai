import type { Config } from "../config.js";

export interface ProductVariant {
  title: string;
  price: string;
  currency: string;
  available: boolean;
}

export interface Product {
  title: string;
  description: string;
  price: string;
  currency: string;
  available: boolean;
  url: string;
  variants: ProductVariant[];
}

export interface GetProductsResult {
  query: string;
  source: "shopify" | "mock";
  products: Product[];
}

const PRODUCT_SEARCH_QUERY = `
  query ProductSearch($query: String!, $first: Int!) {
    products(first: $first, query: $query) {
      edges {
        node {
          title
          description
          onlineStoreUrl
          handle
          availableForSale
          priceRange {
            minVariantPrice {
              amount
              currencyCode
            }
          }
          variants(first: 20) {
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

interface StorefrontMoney {
  amount: string;
  currencyCode: string;
}

interface StorefrontProductNode {
  title: string;
  description: string | null;
  onlineStoreUrl: string | null;
  handle: string;
  availableForSale: boolean;
  priceRange: { minVariantPrice: StorefrontMoney };
  variants: { edges: Array<{ node: { title: string; availableForSale: boolean; price: StorefrontMoney } }> };
}

interface StorefrontResponse {
  data?: { products?: { edges: Array<{ node: StorefrontProductNode }> } };
  errors?: Array<{ message: string }>;
}

const MOCK_PRODUCTS: Product[] = [
  {
    title: "Tempest Coral Two-Seat Sofa",
    description: "A compact two-seater in coral bouclé with a solid oak base.",
    price: "12995.00",
    currency: "SEK",
    available: true,
    url: "https://tempestfurnitur.com/products/coral-two-seat-sofa",
    variants: [
      { title: "Coral", price: "12995.00", currency: "SEK", available: true },
      { title: "Sand", price: "12995.00", currency: "SEK", available: false },
    ],
  },
  {
    title: "Tempest Oak Dining Table",
    description: "Solid oak dining table for six, hand-finished with natural oil.",
    price: "18995.00",
    currency: "SEK",
    available: true,
    url: "https://tempestfurnitur.com/products/oak-dining-table",
    variants: [{ title: "180 cm", price: "18995.00", currency: "SEK", available: true }],
  },
];

export function isShopifyConfigured(config: Config): boolean {
  return Boolean(
    config.shopify.storeDomain &&
      (config.shopify.storefrontToken || config.shopify.storefrontPrivateToken),
  );
}

function storefrontEndpoint(config: Config): string {
  return `https://${config.shopify.storeDomain}/api/${config.shopify.apiVersion}/graphql.json`;
}

function storefrontHeaders(config: Config): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.shopify.storefrontToken) {
    // Public Storefront API token.
    headers["X-Shopify-Storefront-Access-Token"] = config.shopify.storefrontToken;
  }
  if (config.shopify.storefrontPrivateToken) {
    // Private (server-to-server) Storefront API token.
    headers["Shopify-Storefront-Private-Token"] = config.shopify.storefrontPrivateToken;
  }
  return headers;
}

function toProduct(node: StorefrontProductNode, storeDomain: string): Product {
  const minPrice = node.priceRange.minVariantPrice;
  return {
    title: node.title,
    description: node.description ?? "",
    price: minPrice.amount,
    currency: minPrice.currencyCode,
    available: node.availableForSale,
    url: node.onlineStoreUrl ?? `https://${storeDomain}/products/${node.handle}`,
    variants: node.variants.edges.map(({ node: variant }) => ({
      title: variant.title,
      price: variant.price.amount,
      currency: variant.price.currencyCode,
      available: variant.availableForSale,
    })),
  };
}

function mockProducts(query: string): Product[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return MOCK_PRODUCTS;
  const matches = MOCK_PRODUCTS.filter(
    (product) =>
      product.title.toLowerCase().includes(needle) ||
      product.description.toLowerCase().includes(needle),
  );
  return matches.length > 0 ? matches : MOCK_PRODUCTS;
}

/**
 * Looks up live catalog data through the Shopify Storefront API.
 * Falls back to a small mock catalog when Shopify env vars are unset,
 * so the service is usable in local development and tests.
 */
export async function getProducts(
  config: Config,
  query: string,
  options: { first?: number; fetchImpl?: typeof fetch } = {},
): Promise<GetProductsResult> {
  const first = options.first ?? 5;

  if (!isShopifyConfigured(config)) {
    return { query, source: "mock", products: mockProducts(query) };
  }

  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(storefrontEndpoint(config), {
    method: "POST",
    headers: storefrontHeaders(config),
    body: JSON.stringify({
      query: PRODUCT_SEARCH_QUERY,
      variables: { query, first },
    }),
  });

  if (!response.ok) {
    throw new Error(`Shopify Storefront API request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as StorefrontResponse;
  if (payload.errors && payload.errors.length > 0) {
    throw new Error(`Shopify Storefront API error: ${payload.errors.map((e) => e.message).join("; ")}`);
  }

  const edges = payload.data?.products?.edges ?? [];
  const storeDomain = config.shopify.storeDomain as string;
  return {
    query,
    source: "shopify",
    products: edges.map(({ node }) => toProduct(node, storeDomain)),
  };
}
