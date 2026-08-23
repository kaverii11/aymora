import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyAccessToken } from "../lib/jwt.js";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
    onboardingStatus?: string;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "unauthorized" });
  }

  try {
    const payload = verifyAccessToken(header.slice("Bearer ".length));
    request.userId = payload.sub;
    request.onboardingStatus = payload.onboardingStatus;
  } catch {
    return reply.code(401).send({ error: "unauthorized" });
  }
}
