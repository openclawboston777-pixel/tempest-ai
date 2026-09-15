import { config } from "../config.js";
import { logger } from "../logger.js";
import { getAdminToken } from "./adminToken.js";
import { getProducts } from "../tools/getProducts.js";
import { query } from "../db/pool.js";

const ADMIN_ENDPOINT = () =>
  `https://${config.shopifyStoreDomain}/admin/api/${config.shopifyAdminApiVersion}/graphql.json`;

let codeCounter = 0;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function numericId(gid: string | undefined | null): string | undefined {
  if (!gid) return undefined;
  const parts = String(gid).split("/");
  return parts[parts.length - 1] || undefined;
}

async function adminQuery(queryStr: string): Promise<any | null> {
  try {
    const token = await getAdminToken();
    if (!token) return null;
    const res = await fetch(ADMIN_ENDPOINT(), {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query: queryStr })
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "admin query http error");
      return null;
    }
    const json: any = await res.json();
    return json ?? null;
  } catch (err) {
    logger.error({ err }, "admin query failed");
    return null;
  }
}

function makeCode(): string {
  codeCounter = (codeCounter + 1) % 100000;
  const raw = (
    Date.now().toString(36) +
    codeCounter.toString(36) +
    Math.random().toString(36).slice(2)
  )
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const tail = raw.slice(-6).padStart(6, "X");
  return `${config.offerCodePrefix}-${tail}`;
}

export interface Economics {
  ok: boolean;
  error?: string;
  productTitle?: string;
  productId?: string;
  variantId?: string;
  variantNumericId?: string;
  sellingPrice?: number;
  cost?: number | null;
  currency?: string;
  floorPrice?: number;
  maxDiscount?: number;
  canOffer?: boolean;
  reason?: string;
}

export async function getProductEconomics(productQuery: string): Promise<Economics> {
  const products = await getProducts(productQuery);
  const product = products.find((p) => p.image) || products[0];
  if (!product) return { ok: false, error: "product_not_found" };

  const sellingPrice = parseFloat(product.price) || 0;
  const productId = product.id;

  const gql = `{ product(id:"${productId}"){ variants(first:1){edges{node{ id price inventoryItem{ unitCost{ amount } } }}} } }`;
  const data = await adminQuery(gql);

  if (!data) {
    return {
      ok: true,
      productTitle: product.title,
      productId,
      sellingPrice,
      cost: null,
      currency: product.currency,
      canOffer: false,
      reason: "cost_unavailable",
      maxDiscount: 0
    };
  }

  const node = data?.data?.product?.variants?.edges?.[0]?.node;
  const variantId: string | undefined = node?.id;
  const variantNumericId = numericId(variantId);
  const rawCost = node?.inventoryItem?.unitCost?.amount;
  const cost: number | null = rawCost != null ? parseFloat(String(rawCost)) : null;

  const floorPrice = round2(
    (cost ?? 0) + config.offerShippingAllowance + config.offerMinGrossProfit
  );
  const maxDiscount = cost == null ? 0 : Math.max(0, round2(sellingPrice - floorPrice));
  const canOffer = cost != null && maxDiscount > 0;

  return {
    ok: true,
    productTitle: product.title,
    productId,
    variantId,
    variantNumericId,
    sellingPrice,
    cost,
    currency: product.currency || "USD",
    floorPrice,
    maxDiscount,
    canOffer,
    reason: cost == null ? "cost_unavailable" : maxDiscount <= 0 ? "no_margin" : undefined
  };
}

export interface OfferResult {
  ok: boolean;
  error?: string;
  maxDiscount?: number;
  kind?: string;
  code?: string;
  discountAmount?: number;
  finalPrice?: number;
  currency?: string;
  checkoutUrl?: string;
  expiresAt?: string;
  dealLockMinutes?: number;
  note?: string;
}

export async function createOffer(input: {
  visitorId?: string;
  productQuery: string;
  kind: string;
  amount: number;
  note?: string;
}): Promise<OfferResult> {
  try {
    const kind = String(input.kind || "").toLowerCase();
    const amount = Math.max(0, round2(Number(input.amount) || 0));

    if (kind === "flex_pay") {
      if (!config.financingEnabled) return { ok: false, error: "financing_not_configured" };
      return { ok: false, error: "financing_manual" };
    }

    const econ = await getProductEconomics(input.productQuery);
    if (!econ.ok) return { ok: false, error: econ.error || "product_not_found" };
    if (econ.cost == null) return { ok: false, error: "cost_unavailable" };

    const isCredit = kind === "comeback_credit";

    if (!isCredit) {
      if (amount <= 0) return { ok: false, error: "invalid_amount" };
      if (amount > (econ.maxDiscount || 0)) {
        return { ok: false, error: "exceeds_limit", maxDiscount: econ.maxDiscount };
      }
      const provisionalFinal = round2((econ.sellingPrice || 0) - amount);
      if (provisionalFinal < (econ.floorPrice || 0)) {
        return { ok: false, error: "exceeds_limit", maxDiscount: econ.maxDiscount };
      }
    }

    const code = makeCode();
    const now = new Date();
    const startsAt = now.toISOString();
    const endsAt = isCredit
      ? new Date(now.getTime() + config.offerComebackCreditDays * 86400000).toISOString()
      : new Date(now.getTime() + config.offerDealLockMinutes * 60000).toISOString();

    const title = `Ema ${kind} for ${econ.productTitle}`;
    const minimumClause = isCredit
      ? `, minimumRequirement:{ subtotal:{ greaterThanOrEqualToSubtotal:"${String(
          round2(econ.floorPrice || 0)
        )}" } }`
      : "";

    const mutation = `mutation { discountCodeBasicCreate(basicCodeDiscount: {
    title: ${JSON.stringify(title)},
    code: ${JSON.stringify(code)},
    startsAt: "${startsAt}",
    endsAt: "${endsAt}",
    customerSelection:{ all:true },
    customerGets:{ value:{ discountAmount:{ amount:"${String(amount)}", appliesOnEachItem:false } }, items:{ all:true } },
    appliesOncePerCustomer:true${minimumClause}
  }) { codeDiscountNode{ id } userErrors{ field message } } }`;

    const result = await adminQuery(mutation);
    const userErrors = result?.data?.discountCodeBasicCreate?.userErrors ?? [];
    if (!result || (Array.isArray(userErrors) && userErrors.length > 0)) {
      logger.warn({ userErrors }, "discount create failed");
      return { ok: false, error: "discount_create_failed" };
    }

    const checkoutUrl = econ.variantNumericId
      ? `https://${config.shopifyStoreDomain}/cart/${econ.variantNumericId}:1?discount=${code}`
      : `https://${config.shopifyStoreDomain}/discount/${code}`;

    const finalPrice = isCredit
      ? econ.sellingPrice || 0
      : round2((econ.sellingPrice || 0) - amount);

    if (config.dbEnabled && input.visitorId) {
      try {
        await query(
          `INSERT INTO offers (visitor_id,kind,product_title,product_id,selling_price,cost,discount_amount,final_price,code,checkout_url,status,expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11)`,
          [
            input.visitorId,
            kind,
            econ.productTitle ?? null,
            econ.productId ?? null,
            econ.sellingPrice ?? null,
            econ.cost ?? null,
            amount,
            finalPrice,
            code,
            checkoutUrl,
            endsAt
          ]
        );
      } catch (err) {
        logger.warn({ err }, "offer persist failed");
      }
    }

    return {
      ok: true,
      kind,
      code,
      discountAmount: amount,
      finalPrice,
      currency: econ.currency,
      checkoutUrl,
      expiresAt: endsAt,
      dealLockMinutes: isCredit ? undefined : config.offerDealLockMinutes,
      note: isCredit
        ? `Credit valid ${config.offerComebackCreditDays} days on a future order`
        : undefined
    };
  } catch (err) {
    logger.error({ err }, "createOffer failed");
    return { ok: false, error: "offer_failed" };
  }
}

export async function getActiveOffer(visitorId: string): Promise<any | null> {
  if (!config.dbEnabled || !visitorId) return null;
  try {
    const res = await query(
      `SELECT kind,product_title,discount_amount,final_price,code,checkout_url,expires_at
       FROM offers
       WHERE visitor_id=$1 AND status='active' AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [visitorId]
    );
    return res?.rows?.[0] || null;
  } catch (err) {
    logger.warn({ err }, "getActiveOffer failed");
    return null;
  }
}
