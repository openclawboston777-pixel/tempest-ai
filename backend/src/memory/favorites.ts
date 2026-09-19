import { query } from "../db/pool.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

const VISITOR_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ALLOWED_STATUS = new Set(["saved", "finalist", "eliminated", "chosen"]);

function valid(visitorId: string): boolean {
  return !!visitorId && VISITOR_RE.test(visitorId);
}

export async function recordFavorite(
  visitorId: string,
  item: { productTitle: string; productId?: string; note?: string }
): Promise<void> {
  if (!config.dbEnabled || !valid(visitorId)) return;
  const title = (item?.productTitle || "").trim();
  if (!title) return;
  try {
    const existing = await query(
      `SELECT id FROM favorites
       WHERE visitor_id=$1 AND lower(product_title)=lower($2) AND status='saved'
       LIMIT 1`,
      [visitorId, title]
    );
    const row = existing?.rows?.[0];
    if (row) {
      await query(`UPDATE favorites SET note=COALESCE($2, note) WHERE id=$1`, [
        row.id,
        item.note ?? null
      ]);
      return;
    }
    await query(
      `INSERT INTO favorites (visitor_id, profile_id, product_title, product_id, note, status)
       VALUES ($1, (SELECT profile_id FROM visitors WHERE id=$1), $2, $3, $4, 'saved')`,
      [visitorId, title, item.productId ?? null, item.note ?? null]
    );
  } catch (err) {
    logger.warn({ err }, "recordFavorite failed");
  }
}

export async function listFavorites(
  visitorId: string
): Promise<Array<{ productTitle: string; productId: string | null; note: string | null; status: string }>> {
  if (!config.dbEnabled || !valid(visitorId)) return [];
  try {
    const res = await query(
      `SELECT product_title, product_id, note, status
       FROM favorites WHERE visitor_id=$1 ORDER BY created_at`,
      [visitorId]
    );
    if (!res) return [];
    return res.rows.map((r: any) => ({
      productTitle: r.product_title,
      productId: r.product_id ?? null,
      note: r.note ?? null,
      status: r.status
    }));
  } catch (err) {
    logger.warn({ err }, "listFavorites failed");
    return [];
  }
}

export async function setFavoriteStatus(
  visitorId: string,
  productTitle: string,
  status: string
): Promise<void> {
  if (!config.dbEnabled || !valid(visitorId)) return;
  const title = (productTitle || "").trim();
  if (!title) return;
  const s = String(status || "").toLowerCase();
  if (!ALLOWED_STATUS.has(s)) return;
  try {
    await query(
      `UPDATE favorites SET status=$3 WHERE visitor_id=$1 AND lower(product_title)=lower($2)`,
      [visitorId, title, s]
    );
  } catch (err) {
    logger.warn({ err }, "setFavoriteStatus failed");
  }
}
