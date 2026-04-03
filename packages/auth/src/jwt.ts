import { SignJWT, jwtVerify } from "jose";
import type { SessionPayload } from "./types";

function getSecretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/**
 * Génère un token de session JWT (7 jours)
 * Utilisé par le Worker auth après login
 */
export async function createSessionToken(
  user: Omit<SessionPayload, "type">,
  secret: string
): Promise<string> {
  return new SignJWT({ ...user, type: "session" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecretKey(secret));
}

/**
 * Vérifie et décode un token de session JWT
 * Utilisé par TOUTES les apps pour valider le Bearer token
 */
export async function verifySessionToken(
  token: string,
  secret: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(secret));
    if (payload.type !== "session") return null;
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}
