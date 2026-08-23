import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import * as service from "./service.js";

const answersSchema = z.object({ answers: z.record(z.string(), z.unknown()) });

export async function questionnaireRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/questionnaire", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const data = await service.getQuestionnaireForUser(request.userId!);
      return reply.send(data);
    } catch (err) {
      if (err instanceof service.NoActiveQuestionnaireError) {
        return reply.code(503).send({ error: "no_active_questionnaire" });
      }
      throw err;
    }
  });

  app.patch(
    "/api/questionnaire/responses",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = answersSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

      await service.saveAnswers(request.userId!, parsed.data.answers);
      return reply.code(204).send();
    },
  );

  app.post(
    "/api/questionnaire/responses/complete",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        await service.completeQuestionnaire(request.userId!);
      } catch (err) {
        if (err instanceof service.NotStartedError) {
          return reply.code(400).send({ error: "no_answers_submitted" });
        }
        throw err;
      }
      return reply.send({ status: "profile_generation_started" });
    },
  );
}
