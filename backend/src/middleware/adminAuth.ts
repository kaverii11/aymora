import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";

/**
 * Minimal MVP admin gate: a single shared key checked via a header. This is
 * deliberately not a real admin RBAC system (no per-admin identity, no audit
 * log of who acted) — it's a seam so the trust & safety endpoints exist and
 * are not publicly open, to be replaced before this handles real user
 * reports at scale.
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const key = request.headers["x-admin-key"];
  if (!config.ADMIN_API_KEY || key !== config.ADMIN_API_KEY) {
    return reply.code(401).send({ error: "unauthorized" });
  }
}
