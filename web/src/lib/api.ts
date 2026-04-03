import { createAuthFetch, clearStoredToken } from "@filtreplante/auth/frontend";

const API_BASE = import.meta.env.VITE_API_URL || "";
const AUTH_PORTAL =
  import.meta.env.VITE_AUTH_URL || "https://auth.filtreplante.com";
const REQUEST_TIMEOUT = 15_000;

const authFetch = createAuthFetch(API_BASE);

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  let res: Response;
  try {
    res = await authFetch(path, {
      ...options,
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      throw new ApiError(0, "La requête a expiré (timeout)");
    }
    throw err;
  }
  clearTimeout(timeout);

  if (res.status === 401 && !path.includes("/auth/me")) {
    clearStoredToken();
    window.location.href = `${AUTH_PORTAL}/login?returnTo=${encodeURIComponent(window.location.href)}`;
    throw new ApiError(401, "Session expirée");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error || res.statusText);
  }

  return res.json();
}

export { ApiError };

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: any) =>
    request<T>(path, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }),
  put: <T>(path: string, body: any) =>
    request<T>(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  patch: <T>(path: string, body: any) =>
    request<T>(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
