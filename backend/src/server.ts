import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { config } from "./config.js";
import { redis } from "./lib/redis.js";
import { authRoutes } from "./modules/auth/routes.js";
import { chatRoutes } from "./modules/chat/routes.js";
import { matchingRoutes } from "./modules/matching/routes.js";
import { questionnaireRoutes } from "./modules/questionnaire/routes.js";
import { subscriptionsRoutes } from "./modules/subscriptions/routes.js";
import { subscriptionsWebhookRoutes } from "./modules/subscriptions/webhook.js";
import { trustSafetyRoutes } from "./modules/trustSafety/routes.js";
import { waitlistRoutes } from "./modules/waitlist/routes.js";

export async function buildServer() {
  const app = Fastify({
    logger:
      config.NODE_ENV === "development"
        ? { transport: { target: "pino-pretty", options: { colorize: true } } }
        : true,
    trustProxy: true,
  });

  // JSON API with no browser-rendered HTML of its own, so a strict default
  // CSP (helmet's default) can't break anything here and just adds baseline
  // header hardening (X-Content-Type-Options, X-Frame-Options, etc.).
  // crossOriginResourcePolicy is relaxed to "cross-origin" deliberately: the
  // frontend is a *separately hosted* origin that is meant to fetch() this
  // API, and helmet's "same-origin" default would have browsers silently
  // block those responses despite CORS otherwise allowing them.
  await app.register(helmet, { crossOriginResourcePolicy: { policy: "cross-origin" } });

  await app.register(cors, { origin: config.WEB_BASE_URL });

  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: "1 minute",
    redis,
  });

  app.get("/health", async () => ({ status: "ok" }));

  await app.register(waitlistRoutes);
  await app.register(authRoutes);
  await app.register(questionnaireRoutes);
  await app.register(matchingRoutes);
  await app.register(chatRoutes);
  await app.register(subscriptionsRoutes);
  await app.register(trustSafetyRoutes);

  // Registered as a separate encapsulated plugin: it installs its own
  // raw-body JSON parser for webhook signature verification and must not
  // affect JSON parsing on every other route. See webhook.ts.
  await app.register(subscriptionsWebhookRoutes);

  return app;
}
