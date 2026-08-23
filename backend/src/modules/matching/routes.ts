import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import * as service from "./service.js";

const decideSchema = z.object({ interested: z.boolean() });

export async function matchingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/matches/next", { preHandler: requireAuth }, async (request, reply) => {
    const next = await service.getNextMatch(request.userId!);
    if (!next) return reply.code(204).send();
    return reply.send(next);
  });

  app.post(
    "/api/matches/:candidateId/decide",
    { preHandler: requireAuth },
    async (request, reply) => {
      const params = z.object({ candidateId: z.string().uuid() }).safeParse(request.params);
      const body = decideSchema.safeParse(request.body);
      if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });

      const outcome = await service.decide(
        request.userId!,
        params.data.candidateId,
        body.data.interested,
      );

      if (outcome === "not_found") return reply.code(404).send({ error: "not_found" });
      return reply.send({ outcome });
    },
  );
}
