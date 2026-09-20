import { getProducts } from "./getProducts.js";
import { getShopPolicies } from "./getShopPolicies.js";
import { getOrderStatus } from "./getOrderStatus.js";
import { submitSupportTicket } from "./submitSupportTicket.js";
import { rememberCustomer, recordProductInterest } from "../memory/store.js";
import { recordFavorite, listFavorites, setFavoriteStatus } from "../memory/favorites.js";
import { getProductEconomics, createOffer } from "../shopify/offers.js";
import { logEvent } from "../memory/analytics.js";
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
          phone: {
            type: "string",
            description: "The customer's phone number for follow-up, only if they provided it.",
          },
          preferences: {
            type: "object",
            description:
              "Key/value preferences and sales criteria you have gathered, e.g. { style:'modern', budget:'under 3000', room:'living room', seats:'5', dealbreakers:'must fit through 32in door', timeline:'this month', sale_stage:'qualifying' }.",
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
  {
    type: "function" as const,
    function: {
      name: "record_favorite",
      description:
        "Record a couch the customer saved / said they like, so you can narrow their favorites later. " +
        "Call this whenever the customer names a couch they're drawn to. Only real products they mentioned.",
      parameters: {
        type: "object",
        properties: {
          productTitle: { type: "string" },
          note: { type: "string", description: "Why they like it, in their words (optional)." },
        },
        required: ["productTitle"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_favorites",
      description:
        "List the couches this customer has saved (with status: saved/finalist/eliminated/chosen). " +
        "Use during the narrowing phase to review their favorites.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_favorite_status",
      description:
        "Update a saved favorite's status as you narrow the list: 'finalist' (passed qualification), " +
        "'eliminated' (crossed off with the customer's agreement), or 'chosen' (their final pick).",
      parameters: {
        type: "object",
        properties: {
          productTitle: { type: "string" },
          status: { type: "string", enum: ["saved", "finalist", "eliminated", "chosen"] },
        },
        required: ["productTitle", "status"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_product_economics",
      description:
        "Before proposing ANY discount, call this to get the authorized discount limit for a product. " +
        "Returns the selling price and the maximum discount you are allowed to give while protecting " +
        "Tempest's required margin. NEVER offer a discount without checking this first, and NEVER exceed " +
        "the returned maxDiscount. If canOffer is false, you may not discount that product.",
      parameters: {
        type: "object",
        properties: {
          product: { type: "string", description: "Product title/name to price." },
        },
        required: ["product"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_offer",
      description:
        "Create a REAL, authorized offer (discount code) for the customer. The backend enforces Tempest's " +
        "margin rules and only creates the code if the offer is allowed — you cannot invent or exceed a " +
        "discount. Use kind: 'final_lock' or 'personal_win' or 'room_builder' for an immediate dollars-off " +
        "discount (activates a 20-minute Deal Lock), 'comeback_credit' for a future-purchase credit, or " +
        "'flex_pay' for financing. Returns a discount code, final price, a checkout link, and expiry. " +
        "Give the customer the code/link exactly as returned; never state a price or discount the tool didn't return.",
      parameters: {
        type: "object",
        properties: {
          product: { type: "string", description: "Product title/name." },
          kind: {
            type: "string",
            enum: ["final_lock", "personal_win", "room_builder", "comeback_credit", "flex_pay"],
          },
          amount: {
            type: "number",
            description: "Dollar amount of the discount (or credit). Must be within the authorized limit.",
          },
          note: { type: "string", description: "Optional context for the offer." },
        },
        required: ["product", "kind"],
      },
    },
  },
];

// VOICE-ONLY tool. The realtime agent must NEVER read a URL or a code out loud;
// instead it calls show_in_chat and the widget renders a tappable link/code card
// in the chat window. Added only to voiceToolDefs (text chat renders links inline,
// so the text model doesn't need it). The widget intercepts this call locally and
// does not round-trip to the backend; the executeTool case below is a harmless
// fallback so a stray backend call still returns ok instead of "unknown_tool".
const showInChatTool = {
  type: "function" as const,
  function: {
    name: "show_in_chat",
    description:
      "VOICE ONLY. Put a clickable link (or a code) visually into the chat window for the customer to see and tap — because you must NEVER read a URL or a discount code out loud. Use it to share a product page link, or a policy/returns/warranty page link (pass the exact `url` from get_shop_policies — never make a URL up). After calling it, just tell the customer you've dropped it in the chat. Note: discount codes and checkout links from create_offer ALREADY appear automatically in the on-screen Deal Lock card, so you do not need this for those.",
    parameters: {
      type: "object",
      properties: {
        label: {
          type: "string",
          description:
            "Short human label for what the link/code is, e.g. 'Returns & refunds policy' or 'The Hazeli (dark grey)'.",
        },
        url: {
          type: "string",
          description:
            "The exact URL to show, taken verbatim from a tool result (get_products url or get_shop_policies url). Never invent or guess a URL.",
        },
        code: {
          type: "string",
          description:
            "Optional. A code to display, only if it came from a tool result this turn.",
        },
      },
      required: ["label"],
      additionalProperties: false,
    },
  },
};

// The voice agent gets every text tool PLUS show_in_chat.
export const voiceToolDefs = [...toolDefs, showInChatTool];

async function executeToolImpl(
  name: string,
  argsJson: string,
  ctx?: ToolContext,
): Promise<string> {
  try {
    switch (name) {
      case "show_in_chat": {
        // Widget renders this locally; backend fallback just acknowledges.
        return JSON.stringify({ ok: true });
      }
      case "get_products": {
        let query = "";
        try {
          const parsed = JSON.parse(argsJson || "{}") as { query?: unknown };
          query = typeof parsed.query === "string" ? parsed.query : "";
        } catch {
          query = "";
        }
        const products = await getProducts(query);
        void logEvent(ctx?.sessionId, "product_search", {
          query,
          resultCount: products.length,
        });
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
        const orderResult = await getOrderStatus(parsed);
        void logEvent(ctx?.sessionId, "order_lookup", {
          ok: !/error|unavailable|verification_failed/.test(orderResult),
        });
        return orderResult;
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
        const ticketResult = await submitSupportTicket(parsed);
        void logEvent(ctx?.sessionId, "support_ticket", {
          ok: /ticketId|"ok":true/.test(ticketResult),
        });
        return ticketResult;
      }
      case "remember_customer": {
        const sessionId = ctx?.sessionId;
        if (!sessionId) {
          return JSON.stringify({ ok: false, note: "no_session" });
        }
        let raw: {
          name?: unknown;
          email?: unknown;
          phone?: unknown;
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
        const phone = typeof raw.phone === "string" ? raw.phone : undefined;
        const prefs =
          raw.preferences && typeof raw.preferences === "object"
            ? (raw.preferences as Record<string, unknown>)
            : undefined;
        const result = await rememberCustomer(sessionId, { email, name, phone, prefs });
        void logEvent(sessionId, "profile_updated", {
          hasName: !!name,
          hasEmail: !!email,
          hasPhone: !!phone,
          prefKeys: prefs ? Object.keys(prefs).length : 0,
        });
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
      case "record_favorite": {
        const sessionId = ctx?.sessionId;
        if (!sessionId) return JSON.stringify({ ok: false, note: "no_session" });
        let raw: { productTitle?: unknown; note?: unknown } = {};
        try { raw = JSON.parse(argsJson || "{}"); } catch { raw = {}; }
        const productTitle = typeof raw.productTitle === "string" ? raw.productTitle.trim() : "";
        if (!productTitle) return JSON.stringify({ ok: false, error: "missing_product" });
        const note = typeof raw.note === "string" ? raw.note : undefined;
        await recordFavorite(sessionId, { productTitle, note });
        // Also log as an interest so it surfaces in returning-customer context.
        await recordProductInterest(sessionId, { productTitle, source: "favorite" });
        void logEvent(sessionId, "favorite_saved", { productTitle });
        return JSON.stringify({ ok: true });
      }
      case "list_favorites": {
        const sessionId = ctx?.sessionId;
        if (!sessionId) return JSON.stringify({ favorites: [] });
        const favorites = await listFavorites(sessionId);
        return JSON.stringify({ favorites });
      }
      case "set_favorite_status": {
        const sessionId = ctx?.sessionId;
        if (!sessionId) return JSON.stringify({ ok: false, note: "no_session" });
        let raw: { productTitle?: unknown; status?: unknown } = {};
        try { raw = JSON.parse(argsJson || "{}"); } catch { raw = {}; }
        const productTitle = typeof raw.productTitle === "string" ? raw.productTitle.trim() : "";
        const status = typeof raw.status === "string" ? raw.status : "";
        if (!productTitle || !status) return JSON.stringify({ ok: false, error: "missing_args" });
        await setFavoriteStatus(sessionId, productTitle, status);
        return JSON.stringify({ ok: true });
      }
      case "get_product_economics": {
        let raw: { product?: unknown } = {};
        try { raw = JSON.parse(argsJson || "{}"); } catch { raw = {}; }
        const product = typeof raw.product === "string" ? raw.product : "";
        const econ = await getProductEconomics(product);
        // Never expose internal cost to the model output; only what it needs to offer safely.
        return JSON.stringify({
          ok: econ.ok,
          productTitle: econ.productTitle,
          sellingPrice: econ.sellingPrice,
          currency: econ.currency,
          maxDiscount: econ.maxDiscount ?? 0,
          canOffer: econ.canOffer ?? false,
          reason: econ.reason,
        });
      }
      case "create_offer": {
        const sessionId = ctx?.sessionId;
        let raw: { product?: unknown; kind?: unknown; amount?: unknown; note?: unknown } = {};
        try { raw = JSON.parse(argsJson || "{}"); } catch { raw = {}; }
        const product = typeof raw.product === "string" ? raw.product : "";
        const kind = typeof raw.kind === "string" ? raw.kind : "";
        const amount = typeof raw.amount === "number" ? raw.amount : Number(raw.amount) || 0;
        const note = typeof raw.note === "string" ? raw.note : undefined;
        if (!product || !kind) return JSON.stringify({ ok: false, error: "missing_args" });
        const offer = await createOffer({ visitorId: sessionId, productQuery: product, kind, amount, note });
        void logEvent(sessionId, "offer_created", { kind, ok: offer.ok, error: offer.error });
        return JSON.stringify(offer);
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
