import { getProducts } from "./getProducts.js";
import { getShopPolicies } from "./getShopPolicies.js";
import { getOrderStatus } from "./getOrderStatus.js";
import { submitSupportTicket } from "./submitSupportTicket.js";
import { rememberCustomer, recordProductInterest } from "../memory/store.js";
import type { ToolContext } from "../providers/textProvider.js";
import { logger } from "../logger.js";

export const toolDefs = [
  {
    type: "function" as const,
    function: {
      name: "get_products",
      description:
        "Search the store catalog for products and return full product details. " +
        "Use this for ANY product fact: names, prices, availability, variants, links, " +
        "and especially exact dimensions/measurements (assembled length × width × height in inches), " +
        "weight in lbs, main material, seat count, product features, and packaging/shipping notes — " +
        "these live inside the product description text. ALWAYS use this tool for any size, " +
        "measurement, material, weight, or \"will it fit\" question. Returns up to 5 matching products.",
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
        "Fetch store help & policy pages: shipping & delivery times, returns/refunds, warranty & guarantee, financing, FAQ, terms, privacy, contact/support, about/story. Pass a 'topic' keyword to get the most relevant page.",
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description:
              "Topic keyword, e.g. 'shipping', 'returns', 'warranty', 'financing', 'faq'.",
          },
        },
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
  {
    type: "function" as const,
    function: {
      name: "remember_customer",
      description:
        "Save what you learn about THIS customer so you can help them better now and on future " +
        "visits (their name, email, preferences like style/budget/room, and products they're " +
        "interested in). Call this once you learn a real detail worth remembering — especially " +
        "when the customer shares their email or name, or expresses a clear preference or a " +
        "product they like. Only pass information the customer actually provided; never invent it.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The customer's name, if they gave it." },
          email: {
            type: "string",
            description:
              "The customer's real email (used to recognize them across visits/devices). Only if they provided it.",
          },
          preferences: {
            type: "object",
            description:
              "Key/value preferences, e.g. { style: 'modern', budget: 'under 2000', room: 'living room' }.",
            additionalProperties: true,
          },
          interestedProducts: {
            type: "array",
            items: { type: "string" },
            description: "Titles of products the customer likes or is considering.",
          },
        },
      },
    },
  },
];

async function executeToolImpl(
  name: string,
  argsJson: string,
  ctx?: ToolContext,
): Promise<string> {
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
        let topic: string | undefined;
        try {
          const raw = JSON.parse(argsJson || "{}") as { topic?: unknown };
          topic = typeof raw.topic === "string" ? raw.topic : undefined;
        } catch {
          topic = undefined;
        }
        return await getShopPolicies(topic);
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
      case "remember_customer": {
        const sessionId = ctx?.sessionId;
        if (!sessionId) {
          return JSON.stringify({ ok: false, note: "no_session" });
        }
        let raw: {
          name?: unknown;
          email?: unknown;
          preferences?: unknown;
          interestedProducts?: unknown;
        } = {};
        try {
          raw = JSON.parse(argsJson || "{}");
        } catch {
          raw = {};
        }
        const name = typeof raw.name === "string" ? raw.name : undefined;
        const email = typeof raw.email === "string" ? raw.email : undefined;
        const prefs =
          raw.preferences && typeof raw.preferences === "object"
            ? (raw.preferences as Record<string, unknown>)
            : undefined;
        const result = await rememberCustomer(sessionId, { email, name, prefs });
        if (Array.isArray(raw.interestedProducts)) {
          for (const t of raw.interestedProducts) {
            if (typeof t === "string" && t.trim()) {
              await recordProductInterest(sessionId, {
                productTitle: t.trim(),
                source: "mentioned",
              });
            }
          }
        }
        return JSON.stringify({ ok: result.ok });
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


export async function executeTool(
  name: string,
  argsJson: string,
  ctx?: ToolContext,
): Promise<string> {
  const start = Date.now();
  const TIMEOUT_MS = 15000;
  try {
    const result = await Promise.race<string>([
      executeToolImpl(name, argsJson, ctx),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("tool_timeout")), TIMEOUT_MS)
      ),
    ]);
    logger.info({ tool: name, ms: Date.now() - start }, "tool executed");
    return result;
  } catch (err) {
    logger.error({ tool: name, ms: Date.now() - start, err: String(err) }, "tool failed or timed out");
    return JSON.stringify({ error: "tool_error" });
  }
}
