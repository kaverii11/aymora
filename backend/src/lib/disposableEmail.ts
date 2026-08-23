// A short, high-signal blocklist of common disposable/temp-mail domains.
// Not exhaustive by design — the goal is to stop casual list-gaming (see
// docs/backend-architecture-prompt.md section 3.4), not run an arms race.
// For production, swap this for a maintained list such as the `mailchecker`
// package's domain list.
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "tempmail.com",
  "temp-mail.org",
  "throwawaymail.com",
  "yopmail.com",
  "trashmail.com",
  "getnada.com",
  "dispostable.com",
  "fakeinbox.com",
  "sharklasers.com",
  "maildrop.cc",
  "mintemail.com",
  "mytemp.email",
]);

export function isDisposableEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase().trim();
  if (!domain) return false;
  return DISPOSABLE_DOMAINS.has(domain);
}
