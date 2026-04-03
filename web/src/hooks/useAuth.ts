import { useAuth as useAuthBase } from "@filtreplante/auth/frontend";

const API_URL = import.meta.env.VITE_API_URL || "";
const AUTH_PORTAL =
  import.meta.env.VITE_AUTH_URL || "https://auth.filtreplante.com";

export function useAuth() {
  const auth = useAuthBase({ apiUrl: API_URL, authPortalUrl: AUTH_PORTAL });
  return {
    user: auth.user,
    loading: auth.isLoading,
    isAdmin: auth.isAdmin,
    logout: auth.logout,
  };
}
