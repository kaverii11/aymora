import type { FastifyInstance } from "fastify";
import { verifyWebhookSignature } from "../../providers/payments/razorpay.js";
import * as repo from "./repository.js";
import * as service from "./service.js";
import { logger } from "../../lib/logger.js";

/**
 * Registered as its own encapsulated plugin (not merged into the main app
 * instance) so its custom `application/json` content-type parser — which
 * captures the exact raw body string needed for HMAC signature verification
 * — doesn't leak out and affect every other route's JSON parsing.
 */
export async function subscriptionsWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request, body, done) => {
      done(null, body);
    },
  );

  app.post("/api/webhooks/razorpay", async (request, reply) => {
    const signature = request.headers["x-razorpay-signature"];
    const rawBody = request.body as string;

    if (typeof signature !== "string" || !verifyWebhookSignature(rawBody, signature)) {
      return reply.code(400).send({ error: "invalid_signature" });
    }

    const event = JSON.parse(rawBody) as {
      id: string;
      event: string;
      payload?: { payment?: { entity?: { order_id?: string; id?: string } } };
    };

    if (await repo.hasProcessedEvent(event.id)) {
      return reply.code(200).send({ status: "already_processed" });
    }

    await repo.recordPaymentEvent(event.id, event.event, event);

    if (event.event === "payment.captured") {
      const orderId = event.payload?.payment?.entity?.order_id;
      const paymentId = event.payload?.payment?.entity?.id;
      if (orderId && paymentId) {
        await service.activateFromWebhook(orderId, paymentId);
        logger.info({ orderId, paymentId }, "subscription activated via webhook");
      }
    }

    await repo.markEventProcessed(event.id);
    return reply.code(200).send({ status: "processed" });
  });
}
