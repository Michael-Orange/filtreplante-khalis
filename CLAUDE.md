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
  src/pages/workspace.tsx Page principale (3 onglets : Rapprochement Wave / Rapprochement Caisse / Résumé)
  src/components/
    wave-metadata.tsx        Chevron RFE : projet + allocations par personne
    reconciliation-panel.tsx UI liaison wave↔facture (rapprochement wave)
    csv-upload.tsx           Upload CSV Wave
    summary-bar.tsx          Stats session en haut
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

L'app est divisée en **3 onglets** (split effectué 2026-04-11, cf. §pièges `KhalisDataTab`) :

### Onglet 1 — Rapprochement Wave
1. **Import CSV Wave** (bouton en haut) → crée les `wave_transactions`
2. **Flagger un wave "Règlement facture d'équipe"** via le chevron `WaveMetadata` :
   - Sélectionner le **projet** (dropdown, projets terminés masqués sauf celui déjà sélectionné)
   - Ajouter les **personnes** concernées avec leurs montants (dropdown + bouton "+ Autre" pour nom libre avec **autocomplete**)
   - L'autocomplete du bouton `+ Autre` suggère les noms déjà utilisés dans la session (wave chevrons + cash allocations + `referentiel.users`), filtrés par substring case-insensitive (min 2 chars). Cf. §pièges autocomplete.
   - **Validation** : le total des allocations ne peut pas dépasser le montant du wave (bouton Enregistrer désactivé + message rouge explicite si dépassement)
   - Sauvegarder
3. **Lier un wave à une facture Fatou** (panel droit) : sélectionne la facture, applique le montant. Le spill-over automatique étend aux autres factures du même fournisseur si nécessaire.

### Onglet 2 — Rapprochement Caisse (éditeur seul)
Éditeur dédié des règlements caisse Fatou. Blocs par projet, éditables. Deux sources :
- **Automatique** : un bloc apparaît dès qu'un projet a des `wave_transactions` avec allocations dans la session. Non supprimable.
- **Manuel** : bouton `+ Ajouter un projet` → dropdown des projets non encore présents (projets terminés exclus). Bouton ✕ pour supprimer un bloc manuel.

Dans chaque bloc, ajout de personnes via :
- Dropdown "+ Ajouter une personne" (liste `referentiel.users` actifs, triés alpha)
- Bouton "+ Autre" → input texte libre avec **autocomplete** (prefix match sur les noms déjà utilisés dans la session)

Chaque ligne a un input montant éditable (sauvegarde auto au blur via `POST /api/cash` upsert). Persisté dans `cash_allocations`.

### Onglet 3 — Résumé (lecture seule, 4 sections dans l'ordre)

**Section 1 — Règlements wave par personne** — liste plate des totaux wave par personne (somme des allocations chevron), avatar `bg-pine-light text-pine`.

**Section 2 — Règlements caisse par personne** — liste plate des totaux caisse par personne agrégés sur toute la session, avatar `bg-amber-100 text-amber-700`. Visible uniquement si `cashPersonTotals.size > 0`. Les valeurs viennent des `cash_allocations` bruts (pas de la vue consolidée).

**Section 3 — Bandeau Récapitulatif règlements** :
- Total des Règlements Wave pour Factures d'équipe (= somme allocations chevron)
- Total des Règlements Caisse pour Factures d'équipe (= somme cash_allocations)
- Total règlements (somme)
- Total factures ci-dessous (cohérence ✓ par construction grâce à la consolidation qui préserve les totaux)
- Warning orange si `totalWaveUnlinked > 0`

**Section 4 — Facture par projet et par personne** : calculée dynamiquement et **consolidée** pour minimiser le nombre de factures à générer. Pas d'entité stockée en BDD. Cf. §Consolidation ci-dessous.

Bouton **Recalculer les liaisons** à côté du titre (force un re-render + recalcul — techniquement inutile car le calcul est fait inline à chaque render, utile pour le feedback UX).

Chaque facture (projet × personne) a une flèche d'expand (lecture seule) qui montre :
- Les waves auto-liés (date, counterparty, montant)
- La ligne Caisse = `facture_total - sum(linkedWaves)` (complément implicite à régler en caisse, indépendant de ce qui est dans `cash_allocations` bruts)
- Date facture = date du 1er wave auto-lié (priorité #4)

### Architecture composant : `KhalisDataTab`

Les onglets **Rapprochement Caisse** et **Résumé** partagent un seul composant `KhalisDataTab` (anciennement `ResumeTab`) avec un prop `view: "cash-editor" | "resume"`. Il est monté dès que `activeTab` est l'un des deux → les queries (`cashAllocations`, `projects`, `persons`), les mutations cash, et le state local (`pendingManualProjectIds`, `expandedFactureKeys`) survivent au switch entre ces 2 onglets. Un passage par **Rapprochement Wave** démonte le composant (state perdu, acceptable).

## Consolidation des factures d'équipe (2026-04-11)

Avant de faire l'auto-link, la matrice brute `(personne × projet)` construite depuis `projectMap` (wave allocations) + `cash_allocations` est **consolidée** pour minimiser le nombre de cellules non-nulles — donc le nombre de factures d'équipe à générer. Fichier : `web/src/pages/workspace.tsx`, fonctions toplevel `consolidateFactures` + `findCycleThrough`.

**Principe** : à totaux par ligne (personne) et par colonne (projet) préservés, rééquilibrer les montants pour annuler la plus petite cellule non-nulle. Exemple :

```
Avant (4 factures)           Après (3 factures)
  MIFA  CTD                    MIFA  CTD
Mamadou  100  200            Mamadou  120  180
Bocar     20   20            Bocar          40
```

Totaux préservés : Mamadou = 300, Bocar = 40, MIFA = 120, CTD = 220. Bocar n'a plus qu'une facture au lieu de deux. Économie : 1 facture.

**Algo** : annulation de cycle sur la plus petite cellule.
1. Trier les cellules non-gelées par valeur croissante.
2. Pour la plus petite, chercher un cycle dans le graphe biparti `{personne ∪ projet, arêtes = cellules non-nulles}` via BFS.
3. Si cycle trouvé : pivoter avec `delta = min(positions "-" du cycle)` → la cellule est zéro-ée, les totaux ligne/colonne restent intacts.
4. Sinon, essayer la cellule suivante. Si aucune n'a de cycle → forêt bipartie, support minimum atteint, stop.

**Projets "gelés"** (`frozenProjects`) : leurs cellules ne sont jamais pivotées. Utilisé pour `"__none__"` — les waves sans projet restent visibles comme rappel pour Fatou.

**Propriété** : pour m personnes × n projets non-dégénérés, le support minimum = m + n − 1. Sur matrice 3×3 dense, passage typique de 9 → 5 factures.

**Non-destructif** : `cash_allocations` et `wave.allocations` (chevrons) ne sont **jamais** modifiés. La consolidation est une vue calculée, éphémère, reconstruite à chaque render. Les éditeurs (Rapprochement Caisse, chevron wave) travaillent toujours sur les données brutes.

## Auto-link wave → facture d'équipe

Algorithme **pure function** `computeAutoLinks(wavesWithMeta, factureMatrix)` exécuté **inline à chaque render** (pas de cache). Prend en entrée la matrice **consolidée** (pas le couple `projectMap + cashAllocations`), donc opère sur les factures finales à générer.

**Principe** : chaque wave flagué RFE est auto-lié à **UNE personne cible**. Le wave entier (montant total) est distribué sur les factures de cette personne.

**Résolution de la personne cible (cascade avec contrainte de capacité)** :
La cascade construit une liste de candidats dans l'ordre de priorité, puis retient le **premier** dont la capacité restante (somme des `remaining` de ses factures) est **≥ au montant du wave**. Un RFE ne peut pas être attribué à une personne dont le total factures < au montant du wave (règle métier stricte).
1. **Counterparty startsWith match** : le premier token de `counterpartyName` (ex: "Mamadou Diop" → "Mamadou") est comparé `startsWith` case-insensitive aux noms dans `personFactureIndex`. Premier match.
2. **1ère personne du chevron** : si `allocations[0].name` est dans l'index.
3. **Toutes les autres personnes** dans l'ordre alphabétique (scan de `personFactureIndex.keys()`).

Si **aucun** candidat n'a une capacité ≥ wave.amount, le wave entier est marqué `totalWaveUnlinked` (warning orange dans le bandeau récap).

**Construction de `personFactureIndex`** : depuis la matrice consolidée directement. Chaque cellule non-nulle `(personName, projectId, amount)` devient une facture `{factureKey: "${projectId}|${personName}", remaining: amount}`.

**Distribution** : factures de la personne triées par `factureKey` alphabétique, remplissage séquentiel jusqu'à épuisement du wave ou saturation de toutes les factures. Reliquat → `totalWaveUnlinked`.

**Ordre de traitement des waves** : par `transactionDate` croissante → priorité #4 (facture date = date du 1er wave lié) fonctionne.

**`mergedProjectMap`** : reconstruit depuis la matrice consolidée (et non plus depuis `projectMap` + `cashAllocations`). Plus de split `wave/caisse` par cellule — chaque cellule porte un seul `total`. Le bug historique de merge `linkedWaves` pour les factures cash-only (commit `20cdb59`) ne peut plus se reproduire puisque les deux sources sont fusionnées en amont.

## Pièges spécifiques Khalis

1. **`userName='Fatou'` hardcodé** dans `invoices.ts`, `reconcile.ts`, `auto-match.ts`, `metadata.ts` — seules les factures de Fatou sont prises en compte pour le rapprochement. Si un jour un autre user doit être supporté, il faut passer ce nom en config.

2. **Parser CSV Wave simple** (`csv-parser.ts`) — split sur virgule, ne gère pas les champs avec virgules internes quotées. Format Wave strict attendu.

3. **Sous-requêtes corrélées Drizzle → 0** (BUG HISTORIQUE, corrigé) — Tenter d'utiliser `sql\`(SELECT ... WHERE session_id = ${sessions.id})\`` dans un `.select({...})` ne marche pas, l'interpolation `${sessions.id}` est mal gérée par Drizzle et la sous-requête retourne systématiquement 0 ou NULL. Solution : faire 2 requêtes groupBy séparées puis fusionner les résultats en JS via Map. Voir `api/src/routes/sessions.ts` (commit `02733b4`). Documenté dans `_docs/TROUBLESHOOTING.md`.

4. **Contrainte métier wave-metadata** : le total des allocations d'un wave ne peut pas dépasser le montant du wave. Validation frontend (bouton Enregistrer désactivé + message rouge) + garde-fou JS dans `handleSave`.

5. **Auto-link `computeAutoLinks` recalculée à chaque render** — Simple et garanti frais, coût négligeable. Pas de useMemo, pas de useState cache. Le bouton "Recalculer les liaisons" existe pour le feedback UX mais techniquement inutile.

6. **Factures d'équipe = calculées, pas stockées** — Il n'y a pas de table `team_invoices` ou équivalent. Les factures sont dérivées à chaque rendu depuis la matrice consolidée `(wave.projectId × allocations) ∪ cash_allocations`. Conséquence : modifier un chevron wave OU un cash → la matrice change, la consolidation se recalcule, les factures affichées changent immédiatement.

7. **1 wave = 1 personne dans la liaison** (auto-link) mais **1 wave = N personnes dans le chevron**. Ces deux niveaux sont faiblement couplés. Le chevron définit les contributions à la matrice brute, l'auto-link dit "qui paie quoi". Si le counterparty ne matche personne, le fallback est `chevron[0].name` → le wave entier va à la 1ère personne du chevron ; les autres personnes du chevron ne reçoivent rien du wave via l'auto-link (mais leurs factures existent toujours dans la matrice consolidée, et sont "payées par caisse implicite").

8. **Consolidation non-destructive** — La consolidation `consolidateFactures` transforme la vue `mergedProjectMap` mais n'écrit **jamais** dans `cash_allocations` ni dans `wave.allocations`. Si Fatou saisit "Bocar 20k sur CTD" dans Rapprochement Caisse et que la consolidation fait disparaître cette ligne en Résumé, l'entrée BDD reste intacte. La section plate "Règlements caisse par personne" (onglet Résumé) montre toujours les `cash_allocations` bruts (inchangés par la consolidation), pas la vue consolidée.

9. **Autocomplete `+ Autre` — pool de suggestions** — Dans le chevron `WaveMetadata` ET dans les blocs `CashProjectBlock`, le bouton `+ Autre` doit suggérer les noms déjà utilisés dans la session, quelle que soit leur source (wave chevron ou cash allocation). Au niveau `Workspace`, un `sessionPersonNames: string[]` est construit en fusionnant `waveTransactions.allocations[*].name` ∪ `cashAllocations[*].personName` (dédupliqué) et passé en prop à `WaveMetadata`. Bug historique (corrigé 2026-04-11) : `WaveMetadata` ne voyait que `allWaveAllocations` → taper "Ma" ne suggérait pas Mamadou s'il n'avait été saisi qu'en caisse.

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
