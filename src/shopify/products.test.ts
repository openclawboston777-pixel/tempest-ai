import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../config.js";
import { getProducts, isShopifyConfigured } from "./products.js";

function configWithShopify() {
  const config = loadConfig();
  config.shopify.storeDomain = "151v9c-1d.myshopify.com";
  config.shopify.storefrontToken = "test-storefront-token";
  config.shopify.apiVersion = "2025-07";
  return config;
}

function configWithoutShopify() {
  const config = loadConfig();
  config.shopify.storeDomain = undefined;
  config.shopify.storefrontToken = undefined;
  config.shopify.storefrontPrivateToken = undefined;
  return config;
}

describe("get_products", () => {
  it("falls back to mock data when Shopify is not configured", async () => {
    const config = configWithoutShopify();
    expect(isShopifyConfigured(config)).toBe(false);

    const result = await getProducts(config, "sofa");
    expect(result.source).toBe("mock");
    expect(result.products.length).toBeGreaterThan(0);
    expect(result.products[0]).toMatchObject({
      title: expect.any(String),
      description: expect.any(String),
      price: expect.any(String),
      available: expect.any(Boolean),
      url: expect.any(String),
    });
    expect(Array.isArray(result.products[0].variants)).toBe(true);
  });

  it("maps Storefront API responses to the tool result shape", async () => {
    const config = configWithShopify();
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            products: {
              edges: [
                {
                  node: {
                    title: "Oak Dining Table",
                    description: "Solid oak, seats six.",
                    onlineStoreUrl: null,
                    handle: "oak-dining-table",
                    availableForSale: true,
                    priceRange: { minVariantPrice: { amount: "18995.00", currencyCode: "SEK" } },
                    variants: {
                      edges: [
                        {
                          node: {
                            title: "180 cm",
                            availableForSale: false,
                            price: { amount: "18995.00", currencyCode: "SEK" },
                          },
                        },
                      ],
                    },
                  },
                },
              ],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await getProducts(config, "dining table", { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.source).toBe("shopify");
    expect(result.products).toEqual([
      {
        title: "Oak Dining Table",
        description: "Solid oak, seats six.",
        price: "18995.00",
        currency: "SEK",
        available: true,
        url: "https://151v9c-1d.myshopify.com/products/oak-dining-table",
        variants: [{ title: "180 cm", price: "18995.00", currency: "SEK", available: false }],
      },
    ]);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://151v9c-1d.myshopify.com/api/2025-07/graphql.json");
    expect((init.headers as Record<string, string>)["X-Shopify-Storefront-Access-Token"]).toBe(
      "test-storefront-token",
    );
  });

  it("throws when the Storefront API returns GraphQL errors", async () => {
    const config = configWithShopify();
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ errors: [{ message: "Invalid API key" }] }), { status: 200 }),
    );

    await expect(
      getProducts(config, "sofa", { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/Invalid API key/);
  });
});
