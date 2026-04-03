import { cors } from "hono/cors";

/**
 * Factory CORS standard pour les apps Filtreplante
 * Chaque app passe ses domaines spécifiques en plus des domaines communs
 */
export function createCorsConfig(extraOrigins: string[] = []) {
  return cors({
    origin: (origin) => {
      // Domaines communs à toutes les apps
      if (
        origin.endsWith(".filtreplante.com") ||
        origin.endsWith(".pages.dev") ||
        origin.includes("localhost") ||
        origin.includes("127.0.0.1")
      ) {
        return origin;
      }
      // Domaines spécifiques à l'app
      if (extraOrigins.includes(origin)) {
        return origin;
      }
      return "";
    },
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
}
