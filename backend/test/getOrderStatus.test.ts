process.env.SHOPIFY_ADMIN_TOKEN = "shpat_testtoken";
process.env.SHOPIFY_STORE_DOMAIN = "test-store.myshopify.com";
process.env.SHOPIFY_ADMIN_API_VERSION = "2026-07";
process.env.SHOPIFY_STOREFRONT_TOKEN = "x";
process.env.XAI_API_KEY = "x";

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

vi.mock("../src/shopify/adminToken.js", () => ({
  getAdminToken: vi.fn(async () => "shpat_testtoken"),
  invalidateAdminToken: vi.fn(),
}));

type OrderStatusFn = (args: {
  orderNumber?: string;
  email?: string;
}) => Promise<string>;

let getOrderStatus: OrderStatusFn;

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function adminResponse(edges: unknown[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: { orders: { edges } } }),
  };
}

function orderEdge(overrides: Record<string, unknown> = {}) {
  return {
    node: {
      name: "#1001",
      email: "jane@doe.com",
      displayFinancialStatus: "PAID",
      displayFulfillmentStatus: "FULFILLED",
      fulfillments: [
        {
          trackingInfo: [
            { number: "TRK1", url: "http://t", company: "UPS" },
          ],
        },
      ],
      lineItems: {
        edges: [{ node: { title: "Artemitize", quantity: 1 } }],
      },
      ...overrides,
    },
  };
}

beforeAll(async () => {
  ({ getOrderStatus } = await import("../src/tools/getOrderStatus.js"));
});

beforeEach(() => {
  fetchMock.mockReset();
});

describe("getOrderStatus", () => {
  it("returns need_order_number_and_email when email is missing", async () => {
    const out = JSON.parse(await getOrderStatus({ orderNumber: "1001" }));
    expect(out).toEqual({ error: "need_order_number_and_email" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns need_order_number_and_email when orderNumber is missing", async () => {
    const out = JSON.parse(await getOrderStatus({ email: "jane@doe.com" }));
    expect(out).toEqual({ error: "need_order_number_and_email" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid order number without calling fetch", async () => {
    const out = JSON.parse(
      await getOrderStatus({
        orderNumber: 'abc"; DROP',
        email: "jane@doe.com",
      }),
    );
    expect(out).toEqual({ error: "invalid_order_number" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not leak order details when the email does not match", async () => {
    fetchMock.mockResolvedValueOnce(
      adminResponse([orderEdge({ email: "someone@else.com" })]),
    );

    const raw = await getOrderStatus({
      orderNumber: "1001",
      email: "jane@doe.com",
    });
    const out = JSON.parse(raw);

    expect(out).toEqual({ error: "not_found_or_verification_failed" });
    expect(out.order).toBeUndefined();
    expect(raw).not.toContain("#1001");
    expect(raw).not.toContain("TRK1");
    expect(raw).not.toContain("Artemitize");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns not_found_or_verification_failed when no order exists", async () => {
    fetchMock.mockResolvedValueOnce(adminResponse([]));

    const out = JSON.parse(
      await getOrderStatus({ orderNumber: "1001", email: "jane@doe.com" }),
    );
    expect(out).toEqual({ error: "not_found_or_verification_failed" });
  });

  it("returns the order on a verified match (case-insensitive email)", async () => {
    fetchMock.mockResolvedValueOnce(adminResponse([orderEdge()]));

    const out = JSON.parse(
      await getOrderStatus({ orderNumber: "1001", email: "JANE@doe.com" }),
    );

    expect(out.error).toBeUndefined();
    expect(out.order).toBeDefined();
    expect(out.order.name).toBe("#1001");
    expect(out.order.financialStatus).toBe("PAID");
    expect(out.order.fulfillmentStatus).toBe("FULFILLED");
    expect(out.order.items).toEqual([{ title: "Artemitize", quantity: 1 }]);
    expect(out.order.tracking).toEqual([
      { number: "TRK1", url: "http://t", company: "UPS" },
    ]);

    // sanity check on the request
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("test-store.myshopify.com");
    expect(String(url)).toContain("2026-07");
    expect(init.headers["X-Shopify-Access-Token"]).toBe("shpat_testtoken");
  });

  it("returns lookup_failed when fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    const out = JSON.parse(
      await getOrderStatus({ orderNumber: "1001", email: "jane@doe.com" }),
    );
    expect(out).toEqual({ error: "lookup_failed" });
  });

  it("returns lookup_failed on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const out = JSON.parse(
      await getOrderStatus({ orderNumber: "1001", email: "jane@doe.com" }),
    );
    expect(out).toEqual({ error: "lookup_failed" });
  });

  it("returns lookup_failed when GraphQL returns errors", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ errors: [{ message: "boom" }] }),
    });

    const out = JSON.parse(
      await getOrderStatus({ orderNumber: "1001", email: "jane@doe.com" }),
    );
    expect(out).toEqual({ error: "lookup_failed" });
  });
});
