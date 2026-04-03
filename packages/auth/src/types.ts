/**
 * Types partagés pour l'auth Filtreplante
 * Utilisés par le backend (Workers) et le frontend (React)
 */

export interface SessionPayload {
  id: number;
  username: string;
  nom: string;
  role: string;
  apps: string[];
  type: "session";
}

export interface AuthEnv {
  JWT_SECRET: string;
  DATABASE_URL: string;
  CRYPTO_SECRET?: string; // Optionnel — seulement sur le Worker auth pour dual-write
}
