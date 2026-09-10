import { getProducts } from "./getProducts.js";
import { getShopPolicies } from "./getShopPolicies.js";
import { getOrderStatus } from "./getOrderStatus.js";
import { submitSupportTicket } from "./submitSupportTicket.js";
import { logger } from "../logger.js";

export const toolDefs = [
  {
    type: "function" as const,
    function: {
      name: "get_products",
      description:
        "Search the store catalog for products. Use this for ANY product fact: " +
        "names, prices, availability, variants, descriptions, or links. " +
        "Returns up to 5 matching products.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Free-text search query, e.g. 'grey 3-seat sofa' or 'oak dining table'.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_shop_policies",
      description:
        "Fetch the store's published policies (returns/refunds, shipping, privacy, " +
        "terms of service, subscriptions). Use for any policy question.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_order_status",
      description:
        "Look up an order's status and tracking. Requires BOTH the order number and " +
        "the email used on the order for verification.",
      parameters: {
        type: "object",
        properties: {
          orderNumber: { type: "string" },
          email: { type: "string" },
        },
        required: ["orderNumber", "email"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "submit_support_ticket",
      description:
        "File a support ticket so a human from the support team can follow up with the " +
        "customer. Use when you cannot resolve the issue yourself (damaged/defective item, " +
        "refund or return needing a human, order lookup unavailable, complaints), or when " +
        "the customer asks for a human. Requires the customer's email and a short " +
        "description of the issue.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: "string" },
          message: { type: "string" },
          orderNumber: { type: "string" },
        },
        required: ["email", "message"],
      },
    },
  },
];

export async function executeTool(name: string, argsJson: string): Promise<string> {
  try {
    switch (name) {
      case "get_products": {
        let query = "";
        try {
          const parsed = JSON.parse(argsJson || "{}") as { query?: unknown };
          query = typeof parsed.query === "string" ? parsed.query : "";
        } catch {
          query = "";
        }
        const products = await getProducts(query);
        return JSON.stringify({ products });
      }
      case "get_shop_policies": {
        return await getShopPolicies();
      }
      case "get_order_status": {
        let parsed: { orderNumber?: string; email?: string } = {};
        try {
          const raw = JSON.parse(argsJson || "{}") as {
            orderNumber?: unknown;
            email?: unknown;
          };
          parsed = {
            orderNumber:
              typeof raw.orderNumber === "string" ? raw.orderNumber : undefined,
            email: typeof raw.email === "string" ? raw.email : undefined,
          };
        } catch {
          parsed = {};
        }
        return await getOrderStatus(parsed);
      }
      case "submit_support_ticket": {
        let parsed: {
          name?: string;
          email?: string;
          message?: string;
          orderNumber?: string;
        } = {};
        try {
          const raw = JSON.parse(argsJson || "{}") as {
            name?: unknown;
            email?: unknown;
            message?: unknown;
            orderNumber?: unknown;
          };
          parsed = {
            name: typeof raw.name === "string" ? raw.name : undefined,
            email: typeof raw.email === "string" ? raw.email : undefined,
            message: typeof raw.message === "string" ? raw.message : undefined,
            orderNumber:
              typeof raw.orderNumber === "string" ? raw.orderNumber : undefined,
          };
        } catch {
          parsed = {};
        }
        return await submitSupportTicket(parsed);
      }
      default:
        logger.warn({ name }, "executeTool: unknown tool");
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    logger.error({ err, name }, "executeTool: failed");
    return JSON.stringify({ error: "Tool execution failed." });
  }
}
