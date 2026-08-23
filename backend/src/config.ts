import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8787),
  APP_BASE_URL: z.string().url().default("http://localhost:8787"),
  WEB_BASE_URL: z.string().url().default("http://localhost:5500"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),

  RESEND_API_KEY: z.string().optional().default(""),
  EMAIL_FROM: z.string().default("Aymora <hello@aymora.in>"),

  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_MODEL: z.string().default("gemini-3.6-flash"),

  RAZORPAY_KEY_ID: z.string().optional().default(""),
  RAZORPAY_KEY_SECRET: z.string().optional().default(""),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(""),

  ADMIN_API_KEY: z.string().optional().default(""),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

export const config = parsed.data;

export const flags = {
  emailEnabled: config.RESEND_API_KEY.length > 0,
  aiEnabled: config.GEMINI_API_KEY.length > 0,
  paymentsEnabled: config.RAZORPAY_KEY_ID.length > 0 && config.RAZORPAY_KEY_SECRET.length > 0,
};
