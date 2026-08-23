import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/adminAuth.js";
import * as service from "./service.js";

const targetUserSchema = z.object({ user_id: z.string().uuid() });
const reportSchema = z.object({
  reported_id: z.string().uuid(),
  reason: z.string().min(1).max(200),
  details: z.string().max(2000).optional(),
});
const resolveReportSchema = z.object({ status: z.enum(["resolved", "dismissed"]) });

export async function trustSafetyRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/blocks", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = targetUserSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

    await service.blockUser(request.userId!, parsed.data.user_id);
    return reply.code(204).send();
  });

  app.delete("/api/blocks/:userId", { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ userId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });

    await service.unblockUser(request.userId!, params.data.userId);
    return reply.code(204).send();
  });

  app.post("/api/reports", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = reportSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

    await service.reportUser({
      reporterId: request.userId!,
      reportedId: parsed.data.reported_id,
      reason: parsed.data.reason,
      details: parsed.data.details,
    });
    return reply.code(202).send({ status: "received" });
  });

  app.get("/api/admin/reports", { preHandler: requireAdmin }, async (_request, reply) => {
    const reports = await service.listOpenReportsForAdmin();
    return reply.send({ reports });
  });

  app.post(
    "/api/admin/reports/:id/resolve",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
      const body = resolveReportSchema.safeParse(request.body);
      if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });

      await service.resolveReportAsAdmin(params.data.id, body.data.status);
      return reply.code(204).send();
    },
  );

  app.post("/api/privacy/export", { preHandler: requireAuth }, async (request, reply) => {
    const data = await service.exportUserData(request.userId!);
    return reply.send(data);
  });

  app.post("/api/privacy/delete", { preHandler: requireAuth }, async (request, reply) => {
    await service.deleteUserData(request.userId!);
    return reply.code(204).send();
  });
}
