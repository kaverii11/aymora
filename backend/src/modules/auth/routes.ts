import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../config.js";
import { requireAuth } from "../../middleware/auth.js";
import * as service from "./service.js";

const signupSchema = z.object({
  email: z.string().email(),
  display_name: z.string().trim().min(1).max(60),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
  gender: z.string().optional(),
  seeking: z.array(z.string()).optional(),
  city: z.string().optional(),
});

const loginSchema = z.object({ email: z.string().email() });
const exchangeSchema = z.object({ code: z.string().min(1) });
const refreshSchema = z.object({ refresh_token: z.string().min(1) });
const phoneStartSchema = z.object({ phone: z.string().min(6).max(20) });
const phoneVerifySchema = z.object({ code: z.string().length(6) });

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/signup", async (request, reply) => {
    const parsed = signupSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

    try {
      await service.signup({
        email: parsed.data.email,
        displayName: parsed.data.display_name,
        dateOfBirth: parsed.data.date_of_birth,
        gender: parsed.data.gender,
        seeking: parsed.data.seeking,
        city: parsed.data.city,
        ip: request.ip,
      });
    } catch (err) {
      if (err instanceof service.ValidationError) {
        return reply.code(400).send({ error: "must_be_18_or_older" });
      }
      request.log.error({ err }, "signup failed");
      return reply.code(500).send({ error: "internal_error" });
    }

    return reply.code(202).send({ status: "check_your_email" });
  });

  app.post("/api/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

    await service.requestLogin(parsed.data.email);
    return reply.code(202).send({ status: "check_your_email" });
  });

  // Clicked from the email. Consumes the magic link and redirects to the
  // frontend with a one-time exchange code (see service.ts for why this
  // isn't just handing back tokens directly over GET).
  app.get("/api/auth/callback", async (request, reply) => {
    const query = z.object({ token: z.string().min(1) }).safeParse(request.query);
    if (!query.success) return reply.redirect(`${config.WEB_BASE_URL}/?auth=invalid`);

    const result = await service.consumeMagicLink(query.data.token);
    if (result.outcome === "invalid_or_expired") {
      return reply.redirect(`${config.WEB_BASE_URL}/?auth=invalid`);
    }

    return reply.redirect(`${config.WEB_BASE_URL}/auth-complete.html?code=${result.code}`);
  });

  app.post("/api/auth/exchange", async (request, reply) => {
    const parsed = exchangeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

    const pair = await service.exchangeCode(parsed.data.code);
    if (!pair) return reply.code(400).send({ error: "invalid_or_expired_code" });

    return reply.send({
      access_token: pair.accessToken,
      refresh_token: pair.refreshToken,
      user: toPublicUser(pair.user),
    });
  });

  app.post("/api/auth/refresh", async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

    const pair = await service.refresh(parsed.data.refresh_token);
    if (!pair) return reply.code(401).send({ error: "invalid_refresh_token" });

    return reply.send({
      access_token: pair.accessToken,
      refresh_token: pair.refreshToken,
      user: toPublicUser(pair.user),
    });
  });

  app.get("/api/me", { preHandler: requireAuth }, async (request, reply) => {
    const user = await service.getUser(request.userId!);
    if (!user) return reply.code(404).send({ error: "not_found" });
    return reply.send(toPublicUser(user));
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

    await service.logout(parsed.data.refresh_token);
    return reply.code(204).send();
  });

  app.post(
    "/api/auth/phone/start",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = phoneStartSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

      await service.startPhoneVerification(request.userId!, parsed.data.phone);
      return reply.code(202).send({ status: "code_sent" });
    },
  );

  app.post(
    "/api/auth/phone/verify",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = phoneVerifySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

      const result = await service.verifyPhoneOtp(request.userId!, parsed.data.code);
      if (result !== "verified") return reply.code(400).send({ error: result });

      return reply.send({ status: "verified" });
    },
  );
}

function toPublicUser(user: {
  id: string;
  email: string;
  display_name: string | null;
  onboarding_status: string;
  phone_verified_at: string | null;
}) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    onboarding_status: user.onboarding_status,
    phone_verified: user.phone_verified_at !== null,
  };
}
