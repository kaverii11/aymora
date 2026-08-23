import jwt from "jsonwebtoken";
import { config } from "../config.js";

export interface AccessTokenPayload {
  sub: string; // user id
  onboardingStatus: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, config.JWT_ACCESS_SECRET, { expiresIn: "15m" });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, config.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

/** Refresh tokens are opaque (see lib/tokens.ts) and looked up in the DB, not JWTs. */
