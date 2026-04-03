import { useEffect, useState, useCallback } from "react";
import {
  getStoredToken,
  clearStoredToken,
  captureTokenFromUrl,
  redirectToLogin,
} from "./token";
import type { SessionPayload } from "../types";

interface UseAuthOptions {
  /** URL de l'API backend de l'app (ex: import.meta.env.VITE_API_URL) */
  apiUrl: string;
  /** URL du portail auth (ex: https://auth.filtreplante.com) */
  authPortalUrl: string;
  /** Rediriger automatiquement vers le login si pas authentifié (défaut: true) */
  autoRedirect?: boolean;
}

interface AuthState {
  user: SessionPayload | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  logout: () => void;
}

/**
 * Hook React standard pour l'auth Filtreplante
 * 1. Capture le ?token= de l'URL si présent (retour du portail auth)
 * 2. Vérifie le token via GET /api/auth/me
 * 3. Redirige vers le portail auth si pas de token
 */
export function useAuth({
  apiUrl,
  authPortalUrl,
  autoRedirect = true,
}: UseAuthOptions): AuthState {
  const [user, setUser] = useState<SessionPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Étape 1 : capturer le token depuis l'URL (retour auth portal)
    captureTokenFromUrl();

    // Étape 2 : vérifier le token
    const token = getStoredToken();
    if (!token) {
      setIsLoading(false);
      if (autoRedirect) {
        redirectToLogin(authPortalUrl);
      }
      return;
    }

    fetch(`${apiUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (res.status === 401) {
          // Token invalide ou expiré — effacer et rediriger
          clearStoredToken();
          if (autoRedirect) {
            redirectToLogin(authPortalUrl);
          }
          return null;
        }
        if (!res.ok) throw new Error("Erreur serveur");
        return res.json();
      })
      .then((data: SessionPayload | null) => {
        if (data) setUser(data);
      })
      .catch(() => {
        // Erreur réseau (offline, timeout, etc.) — NE PAS effacer le token
        // L'app peut continuer en mode offline avec le token existant
        // On considère l'utilisateur comme authentifié (token en localStorage)
        try {
          // Décoder le payload JWT sans vérifier la signature (offline)
          const parts = token.split(".");
          if (parts.length === 3) {
            const payload = JSON.parse(atob(parts[1])) as SessionPayload;
            setUser(payload);
          }
        } catch {
          // Token malformé — on ne peut rien faire
        }
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [apiUrl, authPortalUrl, autoRedirect]);

  const logout = useCallback(() => {
    clearStoredToken();
    redirectToLogin(authPortalUrl);
  }, [authPortalUrl]);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    isAdmin: user?.role === "admin",
    logout,
  };
}
