import type { FastifyPluginAsync } from "fastify";
import { getActiveOffer } from "../shopify/offers.js";
import { logger } from "../logger.js";

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// The widget polls this to render the persistent "Tempest Deal Lock" countdown.
// The server is the source of truth (expires_at), so the timer survives refreshes
// and never resets, and the offer genuinely expires when the Shopify code does.
const offerRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/offer/active",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      try {
        const q = (req.query ?? {}) as Record<string, unknown>;
        const sessionId = String(q.sessionId ?? "");
        if (!SESSION_ID_RE.test(sessionId)) {
          reply.code(400);
          return { ok: false, error: "invalid_session_id" };
        }
        const offer = await getActiveOffer(sessionId);
        if (!offer) return { ok: true, offer: null };
        return {
          ok: true,
          offer: {
            kind: offer.kind,
            productTitle: offer.product_title,
            discountAmount: offer.discount_amount != null ? Number(offer.discount_amount) : null,
            finalPrice: offer.final_price != null ? Number(offer.final_price) : null,
            code: offer.code,
            checkoutUrl: offer.checkout_url,
            expiresAt: offer.expires_at,
          },
        };
      } catch (err) {
        logger.error({ err: String(err) }, "offer/active failed");
        reply.code(500);
        return { ok: false };
      }
    },
  );
};

export default offerRoutes;
