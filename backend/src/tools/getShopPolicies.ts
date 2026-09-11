import { config } from "../config.js";
import { logger } from "../logger.js";
import { getAdminToken } from "../shopify/adminToken.js";

interface PageEntry {
  title: string;
  handle: string;
  body: string;
}

interface PagesResponse {
  data?: {
    pages?: {
      edges?: Array<{
        node: { title?: string; handle?: string; body?: string };
      }>;
    };
  };
  errors?: unknown;
}

let cache: { at: number; pages: PageEntry[] } | null = null;
const TTL = 600000;

function cleanText(raw: string): string {
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

  return text.replace(/\s+/g, " ").trim();
}

function isExcluded(handle: string, body: string): boolean {
  const h = handle.toLowerCase();
  if (/^ws-/i.test(h)) return true;
  if (
    /(wholesale|dealer|b2b|signin|sign-in|onboarding|registration|proxy|quick-order|account-login|account-create)/i.test(
      h,
    )
  ) {
    return true;
  }
  if (h === "login") return true;
  if (
    body.includes("Wholesale Gorilla") ||
    body.includes("Do not delete") ||
    body.includes("Do not modify")
  ) {
    return true;
  }
  return false;
}

export async function getShopPolicies(topic?: string): Promise<string> {
  if (config.mockShopify) {
    return JSON.stringify({ pages: [], note: "mock" });
  }

  try {
    let pages: PageEntry[];

    if (cache && Date.now() - cache.at < TTL) {
      pages = cache.pages;
    } else {
      const token = await getAdminToken();
      if (!token) {
        return JSON.stringify({ pages: [], error: "unavailable" });
      }

      const res = await fetch(
        `https://${config.shopifyStoreDomain}/admin/api/${config.shopifyAdminApiVersion}/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": token,
          },
          body: JSON.stringify({
            query: `{ pages(first:100){edges{node{title handle body}}} }`,
          }),
        },
      );

      if (!res.ok) {
        logger.error(
          { status: res.status },
          "getShopPolicies: Admin API request failed",
        );
        return JSON.stringify({ pages: [], error: "lookup_failed" });
      }

      const json = (await res.json()) as PagesResponse;
      if (json.errors) {
        logger.error(
          { errors: json.errors },
          "getShopPolicies: Admin GraphQL errors",
        );
        return JSON.stringify({ pages: [], error: "lookup_failed" });
      }

      const nodes = json.data?.pages?.edges ?? [];
      pages = nodes
        .map((e) => ({
          title: e.node.title ?? "",
          handle: e.node.handle ?? "",
          body: cleanText(e.node.body ?? ""),
        }))
        .filter((p) => !isExcluded(p.handle, p.body));

      cache = { at: Date.now(), pages };
    }

    if (typeof topic === "string" && topic.trim().length > 0) {
      const words = topic
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3);

      const scored = pages.map((p) => {
        const body = p.body.toLowerCase();
        const meta = (p.title + " " + p.handle).toLowerCase();
        let score = 0;
        for (const w of words) {
          if (body.includes(w)) score += 1;
          if (meta.includes(w)) score += 5;
        }
        return { page: p, score };
      });

      scored.sort((a, b) => b.score - a.score);
      const top = scored.filter((s) => s.score > 0).slice(0, 2);

      if (top.length > 0) {
        return JSON.stringify({
          pages: top.map((s) => ({
            title: s.page.title,
            handle: s.page.handle,
            body: s.page.body.slice(0, 2500),
          })),
        });
      }
    }

    return JSON.stringify({
      available_topics: pages.map((p) => p.title),
      note: "Ask the customer which topic, then call again with a topic keyword (e.g. shipping, returns, warranty, financing, faq).",
    });
  } catch (err) {
    logger.error({ err }, "getShopPolicies: unexpected error");
    return JSON.stringify({ pages: [], error: "lookup_failed" });
  }
}
