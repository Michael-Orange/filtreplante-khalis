import { useAuth } from "../hooks/useAuth";

export function AppHeader() {
  const { user, logout } = useAuth();

  return (
    <header className="bg-pine text-white px-4 py-3 flex items-center justify-between sticky top-0 z-50">
      <div className="flex items-center gap-3">
        <h1 className="font-heading font-semibold text-lg">Khalis</h1>
        <span className="text-pine-light text-sm hidden sm:inline">
          Rapprochement bancaire
        </span>
      </div>
      <div className="flex items-center gap-3">
        {user && (
          <span className="text-sm text-pine-light">{user.nom}</span>
        )}
        <button
          onClick={logout}
          className="text-sm text-pine-light hover:text-white transition-colors"
        >
          Déconnexion
        </button>
      </div>
    </header>
  );
}
