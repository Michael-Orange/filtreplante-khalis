import { getStoredToken } from "./token";

/**
 * Fetch wrapper avec auth Bearer automatique
 * Remplace credentials: 'include' (cookies) par Authorization: Bearer (pas de CORS cookie)
 */
export function createAuthFetch(apiBaseUrl: string) {
  return async function authFetch(
    path: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const token = getStoredToken();
    const headers = new Headers(options.headers);

    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    if (!headers.has("Content-Type") && options.body) {
      headers.set("Content-Type", "application/json");
    }

    return fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers,
    });
  };
}
