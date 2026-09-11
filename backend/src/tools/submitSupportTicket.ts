import { putObject, dateKey } from "../storage/s3.js";
import { randomUUID } from "node:crypto";
import { logger } from "../logger.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function submitSupportTicket(args: {
  name?: string;
  email?: string;
  message?: string;
  orderNumber?: string;
  sessionId?: string;
}): Promise<string> {
  try {
    const email = typeof args?.email === "string" ? args.email.trim() : "";
    const message = typeof args?.message === "string" ? args.message.trim() : "";

    if (!email || !message || !EMAIL_RE.test(email)) {
      return JSON.stringify({ error: "need_email_and_message" });
    }

    const domain = email.split("@")[1]?.toLowerCase() || "";
    if (/(^|\.)example\.(com|org|net)$/.test(domain) || domain === "test.com" || /^(test|customer|noreply|no-reply|none|na)@/i.test(email)) {
      // Reserved/placeholder domains are almost always fabricated — force asking for a real one.
      return JSON.stringify({ error: "need_real_email" });
    }

    const ticketId = randomUUID();
    const key = `tempest-ai/support/${dateKey()}/${ticketId}.json`;

    await putObject(
      key,
      JSON.stringify(
        {
          ticketId,
          createdAt: new Date().toISOString(),
          source: "ai_tool",
          ...args,
          email,
          message,
        },
        null,
        2
      ),
      "application/json"
    );

    logger.info({ ticketId, key }, "support ticket submitted");
    return JSON.stringify({ ok: true, ticketId });
  } catch (err) {
    logger.error({ err }, "submitSupportTicket: failed");
    return JSON.stringify({ error: "submit_failed" });
  }
}
