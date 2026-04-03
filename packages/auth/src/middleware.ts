import { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { verifySessionToken } from "./jwt";
import type { SessionPayload, AuthEnv } from "./types";

type AuthVariables = {
  user: SessionPayload;
};

type AuthContext = Context<{ Bindings: AuthEnv; Variables: AuthVariables }>;

/**
 * Middleware d'authentification standard
 * Vérifie le cookie auth_session OU le header Authorization: Bearer
 * À utiliser sur toutes les routes protégées de chaque app
 */
export async function requireAuth(c: AuthContext, next: Next) {
  // 1. Essayer le cookie (rétrocompat)
  let token = getCookie(c, "auth_session");

  // 2. Fallback Bearer header (méthode principale pour les nouvelles apps)
  if (!token) {
    const authHeader = c.req.header("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.slice(7);
    }
  }

  if (!token) {
    return c.json({ error: "Non authentifié" }, 401);
  }

  const payload = await verifySessionToken(token, c.env.JWT_SECRET);

  if (!payload) {
    return c.json({ error: "Session invalide" }, 401);
  }

  c.set("user", payload);
  await next();
}

/**
 * Middleware admin — vérifie que l'utilisateur a le rôle admin
 * Doit être utilisé APRÈS requireAuth
 */
export async function requireAdmin(c: AuthContext, next: Next) {
  const user = c.get("user");

  if (user.role !== "admin") {
    return c.json({ error: "Accès refusé : droits administrateur requis" }, 403);
  }

  await next();
}

/**
 * Factory pour middleware de permission par app
 * Exemple : requireApp("stock") vérifie que user.apps inclut "stock"
 */
export function requireApp(appId: string) {
  return async (c: AuthContext, next: Next) => {
    const user = c.get("user");

    if (user.role !== "admin" && !user.apps.includes(appId)) {
      return c.json(
        { error: `Accès refusé : permission '${appId}' requise` },
        403
      );
    }

    await next();
  };
}
