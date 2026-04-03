/**
 * Gestion du token JWT côté frontend
 * Utilisé par toutes les apps Filtreplante
 */

const TOKEN_KEY = "filtreplante_token";

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function storeToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Lit le token depuis ?token= dans l'URL (après redirect depuis auth portal)
 * Si trouvé, le stocke dans localStorage et nettoie l'URL
 * Retourne true si un token a été capturé
 */
export function captureTokenFromUrl(): boolean {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");

  if (token) {
    storeToken(token);
    // Nettoyer l'URL sans recharger la page
    // Aussi nettoyer les paths SSO résiduels (/sso/login, /sso/*)
    params.delete("token");
    let pathname = window.location.pathname;
    if (pathname.startsWith("/sso")) {
      pathname = "/";
    }
    const cleanUrl =
      pathname + (params.toString() ? `?${params.toString()}` : "");
    window.history.replaceState({}, "", cleanUrl);
    return true;
  }
  return false;
}

/**
 * Redirige vers le portail auth pour login
 * @param authPortalUrl URL du portail auth (ex: https://auth.filtreplante.com)
 * @param returnTo URL de retour après login (défaut: page courante)
 */
export function redirectToLogin(
  authPortalUrl: string,
  returnTo?: string
): void {
  // Nettoyer les paths SSO résiduels du returnTo
  let returnUrl = returnTo || window.location.href;
  try {
    const url = new URL(returnUrl);
    if (url.pathname.startsWith("/sso")) {
      url.pathname = "/";
      returnUrl = url.toString();
    }
  } catch {}
  window.location.href = `${authPortalUrl}/login?returnTo=${encodeURIComponent(returnUrl)}`;
}
