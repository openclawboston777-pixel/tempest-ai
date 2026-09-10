import { config } from "../config.js";
import { logger } from "../logger.js";

const ORDER_QUERY = `
  query OrderByName($q: String!) {
    orders(first: 1, query: $q) {
      edges {
        node {
          name
          email
          displayFinancialStatus
          displayFulfillmentStatus
          fulfillments {
            trackingInfo {
              number
              url
              company
            }
          }
          lineItems(first: 10) {
            edges {
              node {
                title
                quantity
              }
            }
          }
        }
      }
    }
  }
`;

interface GqlOrderNode {
  name?: string;
  email?: string | null;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  fulfillments?: Array<{
    trackingInfo?: Array<{
      number?: string | null;
      url?: string | null;
      company?: string | null;
    }>;
  }>;
  lineItems?: {
    edges?: Array<{ node: { title?: string; quantity?: number } }>;
  };
}

interface GqlResponse {
  data?: { orders?: { edges?: Array<{ node: GqlOrderNode }> } };
  errors?: unknown;
}

export async function getOrderStatus(args: {
  orderNumber?: string;
  email?: string;
}): Promise<string> {
  const orderNumber = (args?.orderNumber ?? "").trim();
  const email = (args?.email ?? "").trim();

  if (!orderNumber || !email) {
    return JSON.stringify({ error: "need_order_number_and_email" });
  }

  if (config.mockOrders) {
    logger.info("getOrderStatus: order lookup unavailable (no admin token)");
    return JSON.stringify({
      error: "order_lookup_unavailable",
      message: "Order lookup isn't enabled yet.",
    });
  }

  try {
    const num = orderNumber.replace(/^#/, "");
    const res = await fetch(
      `https://${config.shopifyStoreDomain}/admin/api/${config.shopifyAdminApiVersion}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": config.shopifyAdminToken as string,
        },
        body: JSON.stringify({
          query: ORDER_QUERY,
          variables: { q: `name:#${num}` },
        }),
      },
    );

    if (!res.ok) {
      logger.error(
        { status: res.status },
        "getOrderStatus: Shopify Admin request failed",
      );
      return JSON.stringify({ error: "lookup_failed" });
    }

    const json = (await res.json()) as GqlResponse;
    if (json.errors) {
      logger.error({ errors: json.errors }, "getOrderStatus: GraphQL errors");
      return JSON.stringify({ error: "lookup_failed" });
    }

    const node = json.data?.orders?.edges?.[0]?.node;
    const orderEmail = (node?.email ?? "").trim().toLowerCase();

    if (!node || !orderEmail || orderEmail !== email.toLowerCase()) {
      return JSON.stringify({ error: "not_found_or_verification_failed" });
    }

    const items = (node.lineItems?.edges ?? []).map((e) => ({
      title: e.node.title ?? "",
      quantity: e.node.quantity ?? 0,
    }));

    const tracking = (node.fulfillments ?? []).flatMap((f) =>
      (f.trackingInfo ?? []).map((t) => ({
        number: t.number ?? "",
        url: t.url ?? "",
        company: t.company ?? "",
      })),
    );

    return JSON.stringify({
      order: {
        name: node.name ?? "",
        financialStatus: node.displayFinancialStatus ?? "",
        fulfillmentStatus: node.displayFulfillmentStatus ?? "",
        items,
        tracking,
      },
    });
  } catch (err) {
    logger.error({ err }, "getOrderStatus: unexpected error");
    return JSON.stringify({ error: "lookup_failed" });
  }
}
