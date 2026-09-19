import { query } from "../db/pool.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

const VISITOR_RE = /^[A-Za-z0-9_-]{1,64}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Reject fabricated/placeholder emails so the model can't invent a cross-linkable
// identity (e.g. alex.rivera@email.com, customer@example.com, test@test.com).
const PLACEHOLDER_EMAIL_RE =
  /@(example|test|sample|domain|email|mail|acme|demo|company|yourdomain|placeholder)\.(com|org|net|io)$/i;
const PLACEHOLDER_LOCAL_RE = /^(test|customer|user|example|noreply|no-reply|name|email|firstname|john\.?doe|jane\.?doe)@/i;

function isRealEmail(email: string): boolean {
  const e = String(email ?? "").trim().toLowerCase();
  return EMAIL_RE.test(e) && !PLACEHOLDER_EMAIL_RE.test(e) && !PLACEHOLDER_LOCAL_RE.test(e);
}

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

// Per-person daily voice-time accounting (cost control). Best-effort; a DB failure
// must never block a voice session.
export async function addVoiceSeconds(visitorId: string, seconds: number): Promise<void> {
  if (!config.dbEnabled) return;
  try {
    if (!visitorId || !VISITOR_RE.test(visitorId)) return;
    // Clamp per report so a bad client value can't poison the tally (max 6h/session).
    const s = Math.max(0, Math.min(Math.round(seconds), 6 * 3600));
    if (!s) return;
    await query(
      `INSERT INTO voice_usage (visitor_id, day, seconds) VALUES ($1, current_date, $2)
       ON CONFLICT (visitor_id, day)
       DO UPDATE SET seconds = voice_usage.seconds + EXCLUDED.seconds, updated_at = now()`,
      [visitorId, s]
    );
  } catch (err) {
    logger.error({ err: String(err) }, "addVoiceSeconds failed");
  }
}

export async function getVoiceSecondsToday(visitorId: string): Promise<number> {
  if (!config.dbEnabled) return 0;
  try {
    if (!visitorId || !VISITOR_RE.test(visitorId)) return 0;
    const res = await query<{ seconds: string }>(
      `SELECT seconds FROM voice_usage WHERE visitor_id=$1 AND day=current_date`,
      [visitorId]
    );
    return Number(res?.rows?.[0]?.seconds ?? 0) || 0;
  } catch (err) {
    logger.error({ err: String(err) }, "getVoiceSecondsToday failed");
    return 0;
  }
}

// How many room renders this visitor has generated today (per-person render cap).
// Counts the 'visualization' events logged after each successful render.
export async function getVisualizeCountToday(visitorId: string): Promise<number> {
  if (!config.dbEnabled) return 0;
  try {
    if (!visitorId || !VISITOR_RE.test(visitorId)) return 0;
    const res = await query<{ n: string }>(
      `SELECT count(*)::int AS n FROM events
       WHERE visitor_id=$1 AND type='visualization' AND created_at::date = current_date`,
      [visitorId]
    );
    return Number(res?.rows?.[0]?.n ?? 0) || 0;
  } catch (err) {
    logger.error({ err: String(err) }, "getVisualizeCountToday failed");
    return 0;
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

// SECURITY: only call this AFTER the email has been verified (e.g. OTP) in the
// current session. Linking a visitor to a profile by an UNVERIFIED email allows
// identity takeover. rememberCustomer intentionally does NOT use this.
export async function findOrCreateProfileByEmail(
  email: string,
  name?: string
): Promise<string | null> {
  if (!config.dbEnabled) return null;
  try {
    const normalized = String(email ?? "").trim().toLowerCase();
    if (!isRealEmail(normalized)) return null;
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
  data: { email?: string; name?: string; phone?: string; prefs?: Record<string, unknown> }
): Promise<{ ok: boolean; profileId?: string }> {
  if (!config.dbEnabled) return { ok: false };
  try {
    if (!visitorId || !VISITOR_RE.test(visitorId)) return { ok: false };
    await ensureVisitor(visitorId);

    const hasName = typeof data?.name === "string" && data.name.trim().length > 0;
    const hasPhone = typeof data?.phone === "string" && data.phone.trim().length > 0;
    const hasPrefs = data?.prefs && Object.keys(data.prefs).length > 0;
    // A self-asserted email is NOT proof of identity. We store it only as an
    // unverified contact attribute on THIS visitor's own profile — we never use
    // it to look up or merge into another visitor's profile (that would allow
    // identity takeover: claim victim@x.com -> inherit their data). Cross-device
    // merge requires an out-of-band verification step (future: OTP), which would
    // set the reserved unique `email` column.
    const realEmail = data?.email && isRealEmail(data.email) ? data.email.trim().toLowerCase() : undefined;
    if (!realEmail && !hasName && !hasPhone && !hasPrefs) return { ok: false };

    // Build the prefs patch; fold the unverified email in as contact_email.
    const prefsPatch: Record<string, unknown> = { ...(data?.prefs ?? {}) };
    if (realEmail) prefsPatch.contact_email = realEmail;
    const prefsJson = JSON.stringify(prefsPatch);

    // Always operate on THIS visitor's own profile (create an anonymous one if
    // needed). Never touch another visitor's profile.
    const res = await query<{ profile_id: string | null }>(
      `SELECT profile_id FROM visitors WHERE id=$1`,
      [visitorId]
    );
    let pid = res?.rows?.[0]?.profile_id ?? null;
    if (!pid) {
      const created = await query<{ id: string }>(
        `INSERT INTO profiles (name) VALUES ($1) RETURNING id`,
        [hasName ? data.name : null]
      );
      pid = created?.rows?.[0]?.id ?? null;
      if (pid) await linkVisitorToProfile(visitorId, pid);
    }
    if (!pid) return { ok: false };

    await query(
      `UPDATE profiles SET name=COALESCE($2,name), phone=COALESCE($4,phone),
       prefs=prefs||$3::jsonb, updated_at=now() WHERE id=$1`,
      [pid, hasName ? data.name : null, prefsJson, hasPhone ? data.phone : null]
    );
    return { ok: true, profileId: pid };
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
    if (titles.length > 0) {
      lines.push(
        `- Products this customer viewed or saved in a PAST visit (do NOT claim you discussed these in the current conversation, and do NOT assume they still want them — only bring one up if the customer raises it first): ${titles.join(", ")}`
      );
    }
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
