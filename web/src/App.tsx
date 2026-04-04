import { Route, Switch } from "wouter";
import React from "react";
import { useAuth } from "./hooks/useAuth";
import { AppHeader } from "./components/app-header";
import { SessionsListPage } from "./pages/sessions-list";
import { WorkspacePage } from "./pages/workspace";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="p-8 text-center">
          <p className="text-red-600 font-medium mb-2">Erreur d'affichage</p>
          <pre className="text-xs text-red-500 bg-red-50 p-4 rounded-lg text-left max-w-xl mx-auto overflow-auto">
            {this.state.error.message}
            {"\n"}
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 text-sm text-pine underline"
          >
            Recharger la page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AuthenticatedApp() {
  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader />
      <main>
        <ErrorBoundary>
          <Switch>
            <Route path="/" component={SessionsListPage} />
            <Route path="/sessions/:id" component={WorkspacePage} />
            <Route>
              <div className="text-center py-16 text-gray-400">
                Page introuvable
              </div>
            </Route>
          </Switch>
        </ErrorBoundary>
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
