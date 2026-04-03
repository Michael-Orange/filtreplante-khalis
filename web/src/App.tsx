import { Route, Switch } from "wouter";
import { useAuth } from "./hooks/useAuth";
import { AppHeader } from "./components/app-header";
import { SessionsListPage } from "./pages/sessions-list";
import { WorkspacePage } from "./pages/workspace";

function AuthenticatedApp() {
  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader />
      <main>
        <Switch>
          <Route path="/" component={SessionsListPage} />
          <Route path="/sessions/:id" component={WorkspacePage} />
          <Route>
            <div className="text-center py-16 text-gray-400">
              Page introuvable
            </div>
          </Route>
        </Switch>
      </main>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-10 h-10 border-4 border-pine border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-10 h-10 border-4 border-pine border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <AuthenticatedApp />;
}
