# filtreplante-khalis — Rapprochement bancaire Wave Business / Caisse

App de rapprochement des paiements Wave Business avec les factures du schéma `facture` + gestion des règlements caisse de Fatou + calcul automatique des factures d'équipe à créer.

## URLs production
- Backend : https://filtreplante-khalis.michael-orange09.workers.dev
- Frontend : https://khalis.filtreplante.com (Pages : filtreplante-khalis-web.pages.dev)
- GitHub : github.com/Michael-Orange/filtreplante-khalis

## Structure
```
api/                      Backend Cloudflare Worker (Hono + Drizzle)
  src/routes/
    sessions.ts           CRUD sessions + compteurs waveCount/linkCount
    import-wave.ts        Import CSV Wave Business → wave_transactions
    invoices.ts           Lecture factures Fatou non archivées de la période
    reconcile.ts          Linker wave ↔ facture (spill-over même fournisseur)
    auto-match.ts         Suggestions match amount + date ±5j
    metadata.ts           PATCH wave allocations (projectId + allocations JSONB)
    cash.ts               CRUD cash_allocations (session × project × person)
    summary.ts            Totaux session (waves, cash, orphelins)
  src/schema/khalis.ts    4 tables : sessions, wave_transactions, cash_allocations, reconciliation_links
  src/schema/facture.ts   Lecture cross-schema : invoices, payments, suppliers, projects, categories
packages/auth/            Copie locale de @filtreplante/auth
web/
  src/pages/workspace.tsx Page principale (Rapprochement + Résumé dépenses)
  src/components/
    wave-metadata.tsx     Chevron RFE : projet + allocations par personne
    reconciliation-panel.tsx  UI liaison wave↔facture (rapprochement)
    wave-metadata.tsx     Chevron sur chaque wave
    csv-upload.tsx        Upload CSV Wave
    summary-bar.tsx       Stats session en haut
```

## Auth v2
- Utilise `@filtreplante/auth` (copie locale)
- Toutes les routes `/api/*` protégées par `requireAuth`
- Permission portail : `peut_acces_rapprochement` (colonne `referentiel.users`) → app key `"rapprochement"`

## DB Neon — Schema `khalis` (4 tables)

### `sessions`
Période de rapprochement (ex: "Mars 2026"). 1 session = 1 mois typiquement.
- `id, label, date_start, date_end, status, created_by, archived, created_at`
- Session archivées visibles uniquement en admin (`?showArchived=true`)

### `wave_transactions`
Transactions Wave Business importées depuis CSV. Les waves « flaggés RFE » (Règlement Facture d'Équipe) sont ceux qui ont un `projectId` ou des `allocations`.
- `id, session_id, transaction_id, transaction_date, amount, counterparty_name, counterparty_mobile, raw_line, project_id, allocations JSONB, created_at`
- **`allocations: [{name, amount}]`** — liste simple personne/montant. **1 wave = 1 seul projet + plusieurs personnes**. Pas de multi-projet par ligne d'allocation (decision métier).
- **`project_id`** unique par wave.

### `cash_allocations`
Règlements caisse Fatou saisis manuellement. Une ligne par couple `(session, project, person)`.
- `id, session_id, project_id, person_name, amount, created_at`
- **Contrainte d'unicité** : `UNIQUE (session_id, project_id, person_name)` → un seul enregistrement par triple.
- Les projets avec cash allocations apparaissent comme blocs dans la section 2 "Règlements Caisse Fatou par personne".

### `reconciliation_links`
Liens wave ↔ facture Fatou pour le rapprochement classique (onglet Rapprochement, pas section 3 Résumé).
- `id, session_id, invoice_id, wave_transaction_id, wave_amount, cash_amount, created_at`
- **Spill-over** : quand un wave dépasse le `remaining` d'une facture, l'excédent se verse automatiquement sur les autres factures du **même fournisseur** (plus anciennes d'abord). Logique dans `reconcile.ts`.

## Workflow principal

### Onglet 1 — Rapprochement
1. **Import CSV Wave** (bouton en haut) → crée les `wave_transactions`
2. **Flagger un wave "Règlement facture d'équipe"** via le chevron `WaveMetadata` :
   - Sélectionner le **projet** (dropdown, projets terminés masqués sauf celui déjà sélectionné)
   - Ajouter les **personnes** concernées avec leurs montants (dropdown + bouton "+ Autre" pour nom libre)
   - **Validation** : le total des allocations ne peut pas dépasser le montant du wave (bouton Enregistrer désactivé + message rouge explicite si dépassement)
   - Sauvegarder
3. **Lier un wave à une facture Fatou** (panel droit) : sélectionne la facture, applique le montant. Le spill-over automatique étend aux autres factures du même fournisseur si nécessaire.

### Onglet 2 — Résumé dépenses (3 sections)

**Section 1 — Règlements wave par personne**
Liste plate des totaux wave par personne (somme des allocations chevron, peu importe le projet).

**Section 2 — Règlements Caisse Fatou par personne**
Blocs par projet, éditables. Deux sources :
- **Automatique** : un bloc apparaît dès qu'un projet a des `wave_transactions` avec allocations dans la session. Non supprimable.
- **Manuel** : bouton `+ Ajouter un projet` → dropdown des projets non encore présents (projets terminés exclus). Ces blocs ont un bouton ✕ pour les supprimer.

Dans chaque bloc, ajout de personnes via :
- Dropdown "+ Ajouter une personne" (liste `referentiel.users` actifs, triés alpha)
- Bouton "+ Autre" → input texte libre avec **autocomplete** (suggestions prefix match sur les noms déjà utilisés dans la session : persons connues + allocations wave + allocations cash)

Chaque ligne a un input montant éditable (sauvegarde auto au blur).

**Section 3 — Facture par projet et par personne**
**Calculée dynamiquement** à partir de `(wave.projectId × allocation.name) + cash_allocations`. Pas d'entité stockée en BDD.

Bandeau récap en haut avec :
- Total des Règlements Wave pour Factures d'équipe (= somme allocations chevron)
- Total des Règlements Caisse pour Factures d'équipe (= somme cash_allocations)
- Total règlements (somme)
- Total factures ci-dessous (avec check de cohérence : doit être égal, sinon warning rouge ⚠)
- Warning orange si `totalWaveUnlinked > 0`

Bouton **Recalculer les liaisons** à côté du titre (force un re-render + recalcul).

Chaque facture (project × person) a une flèche d'expand (lecture seule) qui montre :
- Les waves auto-liés (date, counterparty, montant) — voir §Auto-link ci-dessous
- La ligne Caisse = `facture_total - sum(linkedWaves)` (complément implicite à régler en caisse, indépendant de ce qui est dans `cash_allocations`)
- Date facture = date du 1er wave auto-lié (priorité #4 du cahier des charges)

## Auto-link wave → facture d'équipe (section 3)

Algorithme **pure function** `computeAutoLinks(wavesWithMeta, cashAllocations, projectMap)` exécutée **inline à chaque render** (pas de cache). Voir `web/src/pages/workspace.tsx:925-1052`.

**Principe** : chaque wave flagué RFE est auto-lié à **UNE personne cible**. Le wave entier (montant total) est distribué sur les factures de cette personne.

**Résolution de la personne cible (cascade avec contrainte de capacité)** :
La cascade construit une liste de candidats dans l'ordre de priorité, puis retient le **premier** dont la capacité restante (somme des `remaining` de ses factures) est **≥ au montant du wave**. Un RFE ne peut pas être attribué à une personne dont le total factures < au montant du wave (règle métier stricte).
1. **Counterparty startsWith match** : le premier token de `counterpartyName` (ex: "Mamadou Diop" → "Mamadou") est comparé `startsWith` case-insensitive aux noms dans `personFactureIndex`. Premier match.
2. **1ère personne du chevron** : si `allocations[0].name` est dans l'index.
3. **Toutes les autres personnes** dans l'ordre alphabétique (scan de `personFactureIndex.keys()`).

Si **aucun** candidat n'a une capacité ≥ wave.amount, le wave entier est marqué `totalWaveUnlinked` (warning orange dans le bandeau récap). Exemple concret : wave 54k avec counterparty "Cheikh", Cheikh a 30k de factures → capacité insuffisante, on tente chevron[0] (peut-être aussi Cheikh ou Ibrahima 10k → insuffisant), puis on cherche le premier dans l'index avec ≥ 54k (ex: Mamadou 300k) → attribué à Mamadou.

**Construction de `personFactureIndex`** : inclut **toutes** les factures d'équipe visibles en section 3, chevron + cash-only. La capacité = `facture_total` (chevron amount + cash amount).

**Distribution** : factures de la personne triées par `factureKey` alphabétique (`${projectId}|${personName}`, donc ordre UUID arbitraire). Remplissage séquentiel jusqu'à épuisement du wave ou saturation de toutes les factures. Le reliquat part dans `totalWaveUnlinked` (warning dans le bandeau).

**Ordre de traitement des waves** : par `transactionDate` croissante → priorité #4 (facture date = date du 1er wave lié) fonctionne.

**Clé subtile — fusion `mergedProjectMap`** :
- La boucle sur `projectMap` (factures chevron) récupère bien `linkedByFactureKey.get(factureKey)` pour `linkedWaves`.
- La boucle suivante sur `cashAllocations` (factures cash-only) doit **aussi** récupérer `linkedByFactureKey.get(factureKey)` sinon les liaisons des factures cash-only sont perdues. Bug déjà corrigé (commit `20cdb59`).

## Pièges spécifiques Khalis

1. **`userName='Fatou'` hardcodé** dans `invoices.ts`, `reconcile.ts`, `auto-match.ts`, `metadata.ts` — seules les factures de Fatou sont prises en compte pour le rapprochement. Si un jour un autre user doit être supporté, il faut passer ce nom en config.

2. **Parser CSV Wave simple** (`csv-parser.ts`) — split sur virgule, ne gère pas les champs avec virgules internes quotées. Format Wave strict attendu.

3. **Sous-requêtes corrélées Drizzle → 0** (BUG HISTORIQUE, corrigé) — Tenter d'utiliser `sql\`(SELECT ... WHERE session_id = ${sessions.id})\`` dans un `.select({...})` ne marche pas, l'interpolation `${sessions.id}` est mal gérée par Drizzle et la sous-requête retourne systématiquement 0 ou NULL. Solution : faire 2 requêtes groupBy séparées puis fusionner les résultats en JS via Map. Voir `api/src/routes/sessions.ts` (commit `02733b4`). Documenté dans `_docs/TROUBLESHOOTING.md`.

4. **Contrainte métier wave-metadata** : le total des allocations d'un wave ne peut pas dépasser le montant du wave. Validation frontend (bouton Enregistrer désactivé + message rouge) + garde-fou JS dans `handleSave`.

5. **Auto-link `computeAutoLinks` recalculée à chaque render** — Simple et garanti frais, coût négligeable. Pas de useMemo, pas de useState cache. Le bouton "Recalculer les liaisons" existe pour le feedback UX mais techniquement inutile.

6. **Factures d'équipe = calculées, pas stockées** — Il n'y a pas de table `team_invoices` ou équivalent. Les factures sont dérivées à chaque rendu depuis `(wave.projectId × allocations) ∪ cash_allocations`. Conséquence : modifier un chevron wave OU un cash → les factures changent immédiatement.

7. **1 wave = 1 personne dans la liaison (étape 3)** mais **1 wave = N personnes dans le chevron (étapes 1+2)**. Ces deux niveaux sont faiblement couplés. Le chevron définit les factures à créer, l'auto-link dit "qui paie quoi". Si le counterparty ne matche personne, le fallback est `chevron[0].name` → le wave entier va à la 1ère personne du chevron, les autres personnes du chevron ne reçoivent rien du wave via l'auto-link (mais leurs factures existent toujours grâce à la définition via chevron, et sont "payées par caisse implicite").

## Routes API

| Méthode | Route | Rôle |
|---------|-------|------|
| GET | `/api/sessions` | Liste sessions avec compteurs (waveCount, linkCount) — groupBy JS |
| POST | `/api/sessions` | Créer session |
| PATCH | `/api/sessions/:id` | Mettre à jour (archive, dates, label, status) |
| DELETE | `/api/sessions/:id` | Supprimer |
| GET | `/api/sessions/:id` | Détail + waveTransactions |
| POST | `/api/sessions/:sessionId/import-wave` | Import CSV |
| DELETE | `/api/sessions/:sessionId/import-wave` | Vider waves |
| GET | `/api/invoices/:sessionId` | Factures Fatou de la période avec remaining calculé |
| POST | `/api/reconcile` | Créer lien wave↔facture (spill-over) ou cash-only |
| GET | `/api/reconcile/session/:sessionId` | Liste links d'une session |
| DELETE | `/api/reconcile/:id` | Délier |
| GET | `/api/summary/:sessionId` | Totaux (imported, reconciled, orphelins) |
| POST | `/api/auto-match/:sessionId` | Suggestions auto (exact amount + date ±5j) |
| GET | `/api/metadata/projects` | Projets (schema facture) pour dropdown |
| GET | `/api/metadata/persons` | Users actifs (exclut Fatou/Marine/Michael) + Bocar |
| PATCH | `/api/metadata/transactions/:id` | Mettre à jour projectId + allocations d'un wave |
| GET | `/api/cash/:sessionId` | Liste cash_allocations |
| POST | `/api/cash` | Upsert (session, project, person) |
| PATCH | `/api/cash/:id` | Mettre à jour amount/personName |
| DELETE | `/api/cash/:id` | Supprimer une ligne |
| DELETE | `/api/cash/session/:sessionId/project/:projectId` | Supprimer toutes les lignes d'un bloc manuel |

## Secrets requis (wrangler)
- `DATABASE_URL` — Neon Postgres (schémas `khalis` + lecture `facture` + `referentiel`)
- `JWT_SECRET` — identique au portail auth

## Dev local
```bash
# Terminal 1 — API (port 8797)
cd api && npm run dev

# Terminal 2 — Web (port 5183)
cd web && npm run dev
```

Ou via `preview_start` avec les noms `khalis-api` / `khalis-web` (voir `.claude/launch.json`).

## CI/CD
- `deploy.yml` : push `main` → backend Worker
- `deploy-web.yml` : push `main` → frontend Pages
- Secrets GitHub requis : `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (ajoutés 2026-04-10)
