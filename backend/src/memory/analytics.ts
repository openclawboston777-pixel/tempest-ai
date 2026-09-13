import { query } from "../db/pool.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

const VISITOR_RE = /^[A-Za-z0-9_-]{1,64}$/;

export async function logEvent(
  visitorId: string | undefined,
  type: string,
  data?: Record<string, unknown>
): Promise<void> {
  try {
    if (!config.dbEnabled) return;
    if (!type || typeof type !== "string" || type.trim() === "") return;

    let vid: string | null = null;
    if (typeof visitorId === "string" && visitorId.length > 0) {
      vid = VISITOR_RE.test(visitorId) ? visitorId : null;
    }

    const safeType = type.slice(0, 64);
    const payload = data && typeof data === "object" ? data : {};

    await query(
      `INSERT INTO events (visitor_id, profile_id, type, data)
       VALUES ($1, (SELECT profile_id FROM visitors WHERE id = $1), $2, $3::jsonb)`,
      [vid, safeType, JSON.stringify(payload)]
    );
  } catch (err) {
    logger.warn({ err, type }, "logEvent failed");
  }
}

export interface AnalyticsSummary {
  generatedAt: string;
  days: number;
  totals: Record<string, number>;
  uniqueVisitors: number;
  conversations: number;
  topSearches: Array<{ query: string; count: number }>;
  topVisualizedProducts: Array<{ title: string; count: number }>;
  funnel: {
    visitors: number;
    searched: number;
    visualized: number;
    orderLookups: number;
    supportTickets: number;
  };
}

function emptySummary(days: number): AnalyticsSummary {
  return {
    generatedAt: new Date().toISOString(),
    days,
    totals: {},
    uniqueVisitors: 0,
    conversations: 0,
    topSearches: [],
    topVisualizedProducts: [],
    funnel: {
      visitors: 0,
      searched: 0,
      visualized: 0,
      orderLookups: 0,
      supportTickets: 0
    }
  };
}

export async function getAnalyticsSummary(days = 7): Promise<AnalyticsSummary> {
  const d = Math.min(Math.max(Math.floor(days) || 7, 1), 365);
  const p = [String(d)];
  const summary = emptySummary(d);

  if (!config.dbEnabled) return summary;

  try {
    const totalsRes = await query<{ type: string; c: number }>(
      `SELECT type, count(*)::int AS c
         FROM events
        WHERE created_at > now() - ($1 || ' days')::interval
        GROUP BY type`,
      p
    );
    if (totalsRes && Array.isArray(totalsRes.rows)) {
      for (const row of totalsRes.rows) {
        if (row && row.type) summary.totals[row.type] = Number(row.c) || 0;
      }
    }

    const uniqRes = await query<{ c: number }>(
      `SELECT count(DISTINCT visitor_id)::int AS c
         FROM events
        WHERE created_at > now() - ($1 || ' days')::interval
          AND visitor_id IS NOT NULL`,
      p
    );
    summary.uniqueVisitors = Number(uniqRes?.rows?.[0]?.c) || 0;

    const convRes = await query<{ c: number }>(
      `SELECT count(DISTINCT visitor_id)::int AS c
         FROM messages
        WHERE created_at > now() - ($1 || ' days')::interval`,
      p
    );
    summary.conversations = Number(convRes?.rows?.[0]?.c) || 0;

    const searchRes = await query<{ q: string; c: number }>(
      `SELECT lower(data->>'query') AS q, count(*)::int AS c
         FROM events
        WHERE type = 'product_search'
          AND created_at > now() - ($1 || ' days')::interval
          AND coalesce(data->>'query', '') <> ''
        GROUP BY 1
        ORDER BY c DESC
        LIMIT 10`,
      p
    );
    summary.topSearches = (searchRes?.rows ?? []).map((r) => ({
      query: String(r.q ?? ""),
      count: Number(r.c) || 0
    }));

    const visRes = await query<{ t: string; c: number }>(
      `SELECT product_title AS t, count(*)::int AS c
         FROM product_interests
        WHERE source = 'visualized'
          AND created_at > now() - ($1 || ' days')::interval
        GROUP BY 1
        ORDER BY c DESC
        LIMIT 10`,
      p
    );
    summary.topVisualizedProducts = (visRes?.rows ?? []).map((r) => ({
      title: String(r.t ?? ""),
      count: Number(r.c) || 0
    }));

    const visitorsRes = await query<{ c: number }>(
      `SELECT count(DISTINCT id)::int AS c
         FROM visitors
        WHERE last_seen > now() - ($1 || ' days')::interval`,
      p
    );
    summary.funnel.visitors = Number(visitorsRes?.rows?.[0]?.c) || 0;

    const searchedRes = await query<{ c: number }>(
      `SELECT count(DISTINCT visitor_id)::int AS c
         FROM events
        WHERE type = 'product_search'
          AND created_at > now() - ($1 || ' days')::interval`,
      p
    );
    summary.funnel.searched = Number(searchedRes?.rows?.[0]?.c) || 0;

    const visualizedRes = await query<{ c: number }>(
      `SELECT count(DISTINCT visitor_id)::int AS c
         FROM events
        WHERE type = 'visualization'
          AND created_at > now() - ($1 || ' days')::interval`,
      p
    );
    summary.funnel.visualized = Number(visualizedRes?.rows?.[0]?.c) || 0;

    const orderRes = await query<{ c: number }>(
      `SELECT count(*)::int AS c
         FROM events
        WHERE type = 'order_lookup'
          AND created_at > now() - ($1 || ' days')::interval`,
      p
    );
    summary.funnel.orderLookups = Number(orderRes?.rows?.[0]?.c) || 0;

    const ticketRes = await query<{ c: number }>(
      `SELECT count(*)::int AS c
         FROM events
        WHERE type = 'support_ticket'
          AND created_at > now() - ($1 || ' days')::interval`,
      p
    );
    summary.funnel.supportTickets = Number(ticketRes?.rows?.[0]?.c) || 0;

    summary.generatedAt = new Date().toISOString();
    return summary;
  } catch (err) {
    logger.error({ err, days: d }, "getAnalyticsSummary failed");
    return summary;
  }
}
