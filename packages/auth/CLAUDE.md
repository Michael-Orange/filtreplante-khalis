# @filtreplante/auth — Package partagé d'authentification

Package TypeScript partagé entre toutes les apps Filtreplante pour l'auth v2.

## Distribution

Ce package est la **source** dans `packages/auth/`. Il est **copié** dans chaque repo d'app comme `<app>/packages/auth/` pour que chaque app soit autonome en CI/CD.

Dépendance dans package.json de chaque app : `"@filtreplante/auth": "file:../packages/auth"`

## Exports backend (import depuis `@filtreplante/auth`)

- `createSessionToken(payload, secret)` — Crée un JWT
- `verifySessionToken(token, secret)` — Vérifie un JWT
- `requireAuth` — Middleware Hono : vérifie Bearer token
- `requireAdmin` — Middleware Hono : vérifie Bearer + role admin
- `requireApp(appName)` — Middleware Hono : vérifie Bearer + permission app
- `encodePassword(password)` — Encode en Base64
- `decodePassword(encoded)` — Décode depuis Base64
- `verifyPassword(password, encoded)` — Vérifie un mot de passe
- `createCorsConfig()` — Config CORS standard (cast `as any` pour compat Hono)
- Types : `SessionPayload`, `AuthEnv`

## Exports frontend (import depuis `@filtreplante/auth/frontend`)

- `useAuth(config)` — Hook React : gère login/logout, capture token URL, vérifie session
- `getStoredToken()` / `storeToken()` / `clearStoredToken()` — localStorage
- `captureTokenFromUrl()` — Extrait le token de `?token=<jwt>`
- `redirectToLogin(returnTo)` — Redirige vers le portail auth
- `createAuthFetch(baseUrl)` — Fetch wrapper qui ajoute le Bearer token
- Type : `SessionPayload`

## Peer dependencies
- hono ^4.0.0
- jose ^5.0.0

## Quand modifier ce package

1. Modifier ici dans `packages/auth/`
2. Tester localement
3. **Propager** : copier la mise à jour dans chaque app qui l'utilise :
   - filtreplante-maintenance/packages/auth/
   - filtreplante-facture/packages/auth/
   - filtreplante-calculateur/packages/auth/
   - filtreplante-produit/packages/auth/ (si migré)
   - filtreplante-stock/packages/auth/ (si migré)
4. Committer et déployer chaque app affectée

## Pièges connus

- Le type `MiddlewareHandler` de Hono peut être incompatible entre versions. Solution : caster les middlewares `as any` quand nécessaire dans les apps consommatrices.
- **useAuth et erreurs réseau** : le hook distingue 401 (token expiré → clear + redirect) des erreurs réseau (offline → décode le JWT localement, conserve le token). Critique pour les apps terrain (maintenance) avec coupures fréquentes. Ne jamais revenir à un `.catch()` qui efface le token sur toute erreur.
