import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import * as service from "./service.js";

const sendMessageSchema = z.object({ body: z.string().min(1).max(4000) });
const listMessagesQuerySchema = z.object({ before: z.string().datetime().optional() });

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/matches", { preHandler: requireAuth }, async (request, reply) => {
    const matches = await service.listMatches(request.userId!);
    return reply.send({ matches });
  });

  app.get(
    "/api/conversations/:id/messages",
    { preHandler: requireAuth },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
      const q = listMessagesQuerySchema.safeParse(request.query);
      if (!params.success || !q.success) return reply.code(400).send({ error: "invalid_request" });

      try {
        const messages = await service.listMessages(request.userId!, params.data.id, q.data.before);
        return reply.send({ messages });
      } catch (err) {
        if (err instanceof service.NotParticipantError) {
          return reply.code(404).send({ error: "not_found" });
        }
        throw err;
      }
    },
  );

  app.post(
    "/api/conversations/:id/messages",
    { preHandler: requireAuth },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
      const body = sendMessageSchema.safeParse(request.body);
      if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });

      try {
        const message = await service.sendMessage(request.userId!, params.data.id, body.data.body);
        return reply.code(201).send({ message });
      } catch (err) {
        if (err instanceof service.NotParticipantError) {
          return reply.code(404).send({ error: "not_found" });
        }
        if (err instanceof service.BlockedError) {
          return reply.code(403).send({ error: "blocked" });
        }
        throw err;
      }
    },
  );
}
