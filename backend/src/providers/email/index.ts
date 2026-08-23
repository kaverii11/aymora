import { Resend } from "resend";
import { config, flags } from "../../config.js";
import { logger } from "../../lib/logger.js";

interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
}

const resend = flags.emailEnabled ? new Resend(config.RESEND_API_KEY) : null;

/**
 * Sends transactional email via Resend when RESEND_API_KEY is set. In dev
 * (no key), logs the email to the console instead — this is how you read a
 * verification link locally without a real email account. See
 * docs/backend-architecture-prompt.md section 8 for why this is a required
 * seam (deliverability + not silently dropping mail).
 */
export async function sendEmail({ to, subject, html }: SendEmailArgs): Promise<void> {
  if (!resend) {
    logger.info({ to, subject, html }, "[dev email] would send (RESEND_API_KEY not set)");
    return;
  }

  const { error } = await resend.emails.send({
    from: config.EMAIL_FROM,
    to,
    subject,
    html,
  });

  if (error) {
    logger.error({ to, subject, error }, "failed to send email via Resend");
    throw new Error(`Failed to send email: ${error.message}`);
  }
}

export function verificationEmailHtml(verifyUrl: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>Confirm your spot on the Aymora waitlist</h2>
      <p>Click below to verify your email. Your list position is locked in the moment you verify.</p>
      <p><a href="${verifyUrl}" style="display:inline-block;padding:12px 24px;background:#ff4d6d;color:#fff;border-radius:8px;text-decoration:none;">Verify my email</a></p>
      <p style="color:#888;font-size:0.85rem;">This link expires in 24 hours. If you didn't sign up for Aymora, ignore this email.</p>
    </div>
  `;
}

export function magicLinkEmailHtml(loginUrl: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>Your Aymora sign-in link</h2>
      <p><a href="${loginUrl}" style="display:inline-block;padding:12px 24px;background:#ff4d6d;color:#fff;border-radius:8px;text-decoration:none;">Sign in</a></p>
      <p style="color:#888;font-size:0.85rem;">This link expires in 15 minutes. If you didn't request this, ignore this email.</p>
    </div>
  `;
}
