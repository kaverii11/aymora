import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../config.js";
import * as service from "./service.js";

const signupSchema = z.object({
  email: z.string().email(),
  // Honeypot field: real users never see or fill this (hidden via CSS on the
  // form). A non-empty value means a bot filled every field it found. See
  // docs/backend-architecture-prompt.md section 3.4.
  website: z.string().optional(),
  utm_source: z.string().optional(),
  utm_campaign: z.string().optional(),
});

export async function waitlistRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/waitlist",
    {
      config: {
        rateLimit: { max: 5, timeWindow: "1 hour" },
      },
    },
    async (request, reply) => {
      const parsed = signupSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request" });
      }

      const { email, website } = parsed.data;

      // Honeypot tripped: pretend success (don't tip off the bot) and drop it.
      if (website && website.trim().length > 0) {
        return reply.code(202).send({ status: "accepted" });
      }

      try {
        await service.signup({
          email,
          utmSource: parsed.data.utm_source,
          utmCampaign: parsed.data.utm_campaign,
          ip: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        });
      } catch (err) {
        if (err instanceof service.DisposableEmailError) {
          return reply.code(400).send({ error: "disposable_email_not_allowed" });
        }
        request.log.error({ err }, "waitlist signup failed");
        return reply.code(500).send({ error: "internal_error" });
      }

      // 202 regardless of new/duplicate/resend — never leak which emails
      // already exist (see service.ts).
      return reply.code(202).send({ status: "accepted" });
    },
  );

  app.get("/api/waitlist/verify", async (request, reply) => {
    const query = z.object({ token: z.string().min(1) }).safeParse(request.query);
    if (!query.success) {
      return reply.redirect(`${config.WEB_BASE_URL}/?verified=0`);
    }

    const result = await service.verify(query.data.token);

    if (result.outcome === "invalid_or_expired") {
      return reply.redirect(`${config.WEB_BASE_URL}/?verified=0`);
    }

    return reply.redirect(`${config.WEB_BASE_URL}/?verified=1&rank=${result.rank}`);
  });

  app.get("/api/waitlist/count", async (_request, reply) => {
    const verified_count = await service.getVerifiedCount();
    return reply.send({ verified_count });
  });
}
