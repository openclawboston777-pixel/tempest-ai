import { query } from "../db/pool.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

const VISITOR_RE = /^[A-Za-z0-9_-]{1,64}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function ensureVisitor(visitorId: string, userAgent?: string): Promise<void> {
  if (!config.dbEnabled) return;
  try {
    if (!visitorId || !VISITOR_RE.test(visitorId)) return;
    await query(
      `INSERT INTO visitors (id, user_agent) VALUES ($1,$2)
       ON CONFLICT (id) DO UPDATE SET last_seen=now(),
       user_agent=COALESCE(EXCLUDED.user_agent, visitors.user_agent)`,
      [visitorId, userAgent ?? null]
    );
  } catch (err) {
    logger.error({ err: String(err) }, "ensureVisitor failed");
  }
}

export async function saveMessages(
  visitorId: string,
  msgs: Array<{ role: string; content: string }>
): Promise<void> {
  if (!config.dbEnabled) return;
  try {
    if (!visitorId || !VISITOR_RE.test(visitorId) || !Array.isArray(msgs)) return;
    for (const m of msgs) {
      try {
        if (!m || typeof m.content !== "string" || m.content.trim() === "") continue;
        const content = m.content.slice(0, 8000);
        await query(
          `INSERT INTO messages (visitor_id, profile_id, role, content)
           VALUES ($1, (SELECT profile_id FROM visitors WHERE id=$1), $2, $3)`,
          [visitorId, String(m.role ?? "user"), content]
        );
      } catch (err) {
        logger.warn({ err: String(err) }, "saveMessages item failed");
      }
    }
  } catch (err) {
    logger.error({ err: String(err) }, "saveMessages failed");
  }
}

export async function getRecentMessages(
  visitorId: string,
  limit = 20
): Promise<Array<{ role: string; content: string; created_at: string }>> {
  if (!config.dbEnabled) return [];
  try {
    if (!visitorId || !VISITOR_RE.test(visitorId)) return [];
    const res = await query<{ role: string; content: string; created_at: string }>(
      `SELECT role, content, created_at FROM messages WHERE visitor_id=$1
       ORDER BY created_at DESC LIMIT $2`,
      [visitorId, limit]
    );
    if (!res) return [];
    return res.rows.slice().reverse();
  } catch (err) {
    logger.error({ err: String(err) }, "getRecentMessages failed");
    return [];
  }
}

export async function recordProductInterest(
  visitorId: string,
  item: { productTitle: string; productId?: string; source?: string }
): Promise<void> {
  if (!config.dbEnabled) return;
  try {
    if (!visitorId || !VISITOR_RE.test(visitorId)) return;
    if (!item || !item.productTitle) return;
    await query(
      `INSERT INTO product_interests (visitor_id, profile_id, product_title, product_id, source)
       VALUES ($1, (SELECT profile_id FROM visitors WHERE id=$1), $2, $3, $4)`,
      [visitorId, item.productTitle.slice(0, 500), item.productId ?? null, item.source ?? null]
    );
  } catch (err) {
    logger.error({ err: String(err) }, "recordProductInterest failed");
  }
}

export async function findOrCreateProfileByEmail(
  email: string,
  name?: string
): Promise<string | null> {
  if (!config.dbEnabled) return null;
  try {
    const normalized = String(email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(normalized)) return null;
    const res = await query<{ id: string }>(
      `INSERT INTO profiles (email, name) VALUES ($1,$2)
       ON CONFLICT (email) DO UPDATE SET name=COALESCE(profiles.name, EXCLUDED.name),
       updated_at=now() RETURNING id`,
      [normalized, name ?? null]
    );
    if (!res || res.rows.length === 0) return null;
    return res.rows[0]?.id ?? null;
  } catch (err) {
    logger.error({ err: String(err) }, "findOrCreateProfileByEmail failed");
    return null;
  }
}

export async function linkVisitorToProfile(visitorId: string, profileId: string): Promise<void> {
  if (!config.dbEnabled) return;
  try {
    if (!visitorId || !VISITOR_RE.test(visitorId) || !profileId) return;
    await query(`UPDATE visitors SET profile_id=$2 WHERE id=$1`, [visitorId, profileId]);
    await query(
      `UPDATE messages SET profile_id=$2 WHERE visitor_id=$1 AND profile_id IS NULL`,
      [visitorId, profileId]
    );
    await query(
      `UPDATE product_interests SET profile_id=$2 WHERE visitor_id=$1 AND profile_id IS NULL`,
      [visitorId, profileId]
    );
  } catch (err) {
    logger.error({ err: String(err) }, "linkVisitorToProfile failed");
  }
}

export async function rememberCustomer(
  visitorId: string,
  data: { email?: string; name?: string; prefs?: Record<string, unknown> }
): Promise<{ ok: boolean; profileId?: string }> {
  if (!config.dbEnabled) return { ok: false };
  try {
    if (!visitorId || !VISITOR_RE.test(visitorId)) return { ok: false };
    await ensureVisitor(visitorId);
    const prefsJson = JSON.stringify(data?.prefs ?? {});

    if (data?.email) {
      const pid = await findOrCreateProfileByEmail(data.email, data.name);
      if (pid) {
        await linkVisitorToProfile(visitorId, pid);
        if (data.name || data.prefs) {
          await query(
            `UPDATE profiles SET name=COALESCE($2,name), prefs=prefs||$3::jsonb,
             updated_at=now() WHERE id=$1`,
            [pid, data.name ?? null, prefsJson]
          );
        }
        return { ok: true, profileId: pid };
      }
      return { ok: false };
    }

    if (data?.name || data?.prefs) {
      const res = await query<{ profile_id: string | null }>(
        `SELECT profile_id FROM visitors WHERE id=$1`,
        [visitorId]
      );
      const pid = res?.rows?.[0]?.profile_id ?? null;
      if (pid) {
        await query(
          `UPDATE profiles SET name=COALESCE($2,name), prefs=prefs||$3::jsonb,
           updated_at=now() WHERE id=$1`,
          [pid, data.name ?? null, prefsJson]
        );
        return { ok: true, profileId: pid };
      }
    }

    return { ok: false };
  } catch (err) {
    logger.error({ err: String(err) }, "rememberCustomer failed");
    return { ok: false };
  }
}

export async function getProfileContext(visitorId: string): Promise<string | null> {
  if (!config.dbEnabled) return null;
  try {
    if (!visitorId || !VISITOR_RE.test(visitorId)) return null;

    const profRes = await query<{
      name: string | null;
      email: string | null;
      prefs: Record<string, unknown> | null;
    }>(
      `SELECT p.name, p.email, p.prefs FROM visitors v
       LEFT JOIN profiles p ON p.id=v.profile_id
       WHERE v.id=$1 AND (p.deleted_at IS NULL OR p.id IS NULL)`,
      [visitorId]
    );
    const prof = profRes?.rows?.[0] ?? null;

    const piRes = await query<{ product_title: string }>(
      `SELECT product_title FROM product_interests WHERE visitor_id=$1
       GROUP BY product_title ORDER BY max(created_at) DESC LIMIT 8`,
      [visitorId]
    );
    const titles = (piRes?.rows ?? []).map((r) => r.product_title).filter(Boolean);

    const cntRes = await query<{ count: string }>(
      `SELECT count(*) AS count FROM messages WHERE visitor_id=$1`,
      [visitorId]
    );
    const priorCount = Number(cntRes?.rows?.[0]?.count ?? 0) || 0;

    const prefs = prof?.prefs && typeof prof.prefs === "object" ? prof.prefs : {};
    const prefEntries = Object.entries(prefs).filter(
      ([, v]) => v !== null && v !== undefined && v !== ""
    );
    const hasName = !!prof?.name;

    if (!hasName && prefEntries.length === 0 && titles.length === 0 && priorCount === 0) {
      return null;
    }

    const lines: string[] = [
      "Returning-customer context (for your awareness — use naturally, do not recite verbatim, and still verify identity before sharing any private order details):",
    ];
    if (hasName) lines.push(`- Name: ${prof!.name}`);
    if (prefEntries.length > 0) {
      lines.push(
        `- Known preferences: ${prefEntries
          .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
          .join("; ")}`
      );
    }
    if (titles.length > 0) lines.push(`- Previously interested in: ${titles.join(", ")}`);
    if (priorCount > 0) {
      lines.push(
        "- You have spoken with this customer before — continue the relationship naturally."
      );
    }
    return lines.join("\n");
  } catch (err) {
    logger.error({ err: String(err) }, "getProfileContext failed");
    return null;
  }
}

export async function forget(opts: {
  visitorId?: string;
  email?: string;
}): Promise<{ ok: boolean }> {
  if (!config.dbEnabled) return { ok: false };
  try {
    let ran = false;
    const email = opts?.email ? opts.email.trim().toLowerCase() : "";
    if (email && EMAIL_RE.test(email)) {
      await query(
        `UPDATE profiles SET deleted_at=now(), name=NULL, phone=NULL, prefs='{}'::jsonb WHERE email=$1`,
        [email]
      );
      await query(
        `DELETE FROM messages WHERE profile_id IN (SELECT id FROM profiles WHERE email=$1)`,
        [email]
      );
      ran = true;
    }
    const visitorId = opts?.visitorId ?? "";
    if (visitorId && VISITOR_RE.test(visitorId)) {
      await query(`DELETE FROM messages WHERE visitor_id=$1`, [visitorId]);
      await query(`DELETE FROM product_interests WHERE visitor_id=$1`, [visitorId]);
      ran = true;
    }
    return { ok: ran };
  } catch (err) {
    logger.error({ err: String(err) }, "forget failed");
    return { ok: false };
  }
}

export async function purgeExpired(): Promise<void> {
  if (!config.dbEnabled) return;
  try {
    const days = String(config.memoryRetentionDays);
    await query(`DELETE FROM messages WHERE created_at < now() - ($1 || ' days')::interval`, [
      days,
    ]);
    await query(
      `DELETE FROM product_interests WHERE created_at < now() - ($1 || ' days')::interval`,
      [days]
    );
  } catch (err) {
    logger.error({ err: String(err) }, "purgeExpired failed");
  }
}
