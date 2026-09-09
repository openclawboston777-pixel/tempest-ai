import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("getProducts", () => {
  it("maps Storefront GraphQL payload correctly", async () => {
    process.env.SHOPIFY_STORE_DOMAIN = "test-shop.myshopify.com";
    process.env.SHOPIFY_STOREFRONT_TOKEN = "test-token";

    const fakePayload = {
      data: {
        products: {
          edges: [
            {
              node: {
                id: "gid://shopify/Product/1",
                title: "Test Sofa",
                description: "A comfy test sofa",
                onlineStoreUrl: "https://test-shop.myshopify.com/products/test-sofa",
                handle: "test-sofa",
                priceRange: {
                  minVariantPrice: { amount: "499.00", currencyCode: "USD" },
                },
                variants: {
                  edges: [
                    {
                      node: {
                        title: "Default",
                        availableForSale: true,
                        price: { amount: "499.00", currencyCode: "USD" },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => fakePayload,
        text: async () => JSON.stringify(fakePayload),
      }))
    );

    const { getProducts } = await import("../src/tools/getProducts.js");
    const products = await getProducts("sofa");

    expect(products.length).toBe(1);
    const p = products[0];
    expect(p.id).toBe("gid://shopify/Product/1");
    expect(p.title).toBe("Test Sofa");
    expect(p.price).toBe("499.00");
    expect(p.currency).toBe("USD");
    expect(p.available).toBe(true);
    expect(p.variants[0].title).toBe("Default");
  });

  it("returns MOCK array when env unset", async () => {
    delete process.env.SHOPIFY_STORE_DOMAIN;
    delete process.env.SHOPIFY_STOREFRONT_TOKEN;

    const { getProducts } = await import("../src/tools/getProducts.js");
    const products = await getProducts("sofa");

    expect(Array.isArray(products)).toBe(true);
    expect(products.length).toBeGreaterThan(0);
    expect(products.every((p) => typeof p.title === "string")).toBe(true);
  });
});
