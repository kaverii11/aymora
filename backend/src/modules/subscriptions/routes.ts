import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import * as service from "./service.js";

const verifySchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

export async function subscriptionsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/subscriptions/status", { preHandler: requireAuth }, async (request, reply) => {
    const status = await service.getStatus(request.userId!);
    return reply.send(status);
  });

  app.post(
    "/api/subscriptions/checkout",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        const order = await service.createCheckoutOrder(request.userId!);
        return reply.send(order);
      } catch (err) {
        if (err instanceof service.PaymentsNotConfiguredError) {
          return reply.code(501).send({ error: "payments_not_configured" });
        }
        throw err;
      }
    },
  );

  app.post(
    "/api/subscriptions/verify",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = verifySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

      try {
        await service.verifyAndActivate(request.userId!, {
          orderId: parsed.data.razorpay_order_id,
          paymentId: parsed.data.razorpay_payment_id,
          signature: parsed.data.razorpay_signature,
        });
      } catch (err) {
        if (err instanceof service.InvalidSignatureError) {
          return reply.code(400).send({ error: "invalid_signature" });
        }
        if (err instanceof service.PaymentsNotConfiguredError) {
          return reply.code(501).send({ error: "payments_not_configured" });
        }
        throw err;
      }

      return reply.send({ status: "active" });
    },
  );
}
