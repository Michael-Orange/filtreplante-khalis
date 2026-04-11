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
    sessions.ts           CRUD sessions + compteurs waveCount/linkCount (ownership check PATCH/DELETE)
    import-wave.ts        Import CSV Wave Business → wave_transactions (db.transaction + onConflictDoNothing)
    invoices.ts           Lecture factures Fatou non archivées de la période
    reconcile.ts          Linker wave ↔ facture (spill-over même fournisseur, db.transaction)
    auto-match.ts         Suggestions match amount + date ±5j
    metadata.ts           PATCH wave allocations (projectId + allocations JSONB, validation sum ≤ wave.amount)
    cash.ts               CRUD cash_allocations (session × project × person)
    summary.ts            Totaux session (waves, cash, orphelins)
  src/schema/khalis.ts    4 tables : sessions, wave_transactions, cash_allocations, reconciliation_links
                          + uniqueIndex (session_id, transaction_id) sur wave_transactions
  src/schema/facture.ts   Lecture cross-schema : invoices, payments, suppliers, projects, categories
  src/lib/csv-parser.ts   Parser RFC 4180 minimal (champs quotés, guillemets échappés)
  migrations/             Migrations SQL manuelles à appliquer sur Neon
packages/auth/            Copie locale de @filtreplante/auth
web/
  src/pages/workspace.tsx Orchestrateur (~360 l) — queries session/invoices/links/summary/cash,
                          montage des 3 onglets (Rapprochement Wave / Caisse / Résumé)
  src/components/
    khalis-data-tab.tsx      Onglets Caisse + Résumé — queries cash/projects/persons,
                              consolidation, mergedProjectMap, rendu 4 sections (~710 l)
    wave-link-panel.tsx      Panel droit Rapprochement Wave (liaison facture fournisseur)
                              + SupplierGroup interne (~490 l)
    cash-project-block.tsx   Bloc éditeur cash par projet + CashLineRow + AddProjectButton (~320 l)
    wave-row.tsx             Une ligne de la liste waves (panel gauche Rapprochement Wave)
    wave-metadata.tsx        Chevron RFE : projet + allocations par personne
    csv-upload.tsx           Upload CSV Wave
    summary-bar.tsx          Stats session en haut
    app-header.tsx           Header global avec user menu
  src/lib/
    consolidate.ts           Pure fn : consolidateFactures + findCycleThrough (pas de React)
    auto-link.ts             Pure fn : computeAutoLinks (pas de React)
    toast.tsx                Système de toast minimal (ToastProvider + useToast)
    format.ts                formatCFA / formatDate / formatDateShort (fr-FR)
    api.ts                   Wrapper fetch Bearer + timeout + ApiError + getErrorMessage
  src/types/
    khalis.ts                Interfaces partagées (SessionDetail, WaveTransaction,
                              CashAllocation, Project, InvoiceRow, ReconciliationLink,
                              Summary, WaveFilter, WaveLinkEntry)
  src/hooks/useAuth.ts       Wrapper @filtreplante/auth/frontend
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

10. **Authz ownership sur sessions** (2026-04-11) — `PATCH /api/sessions/:id` et `DELETE /api/sessions/:id` vérifient que `session.createdBy === user.nom` avant d'appliquer la modification. Les admins (`user.role === "admin"`) contournent ce filtre. Sans cette vérification, tout utilisateur authentifié pouvait modifier/supprimer la session d'un autre.

11. **Transactions atomiques sur les opérations multi-étapes** (2026-04-11) — `POST /api/sessions/:id/import-wave` et `POST /api/reconcile` sont entièrement wrapped dans `db.transaction()` (via `drizzle-orm/neon-serverless` avec `Pool`, qui supporte les transactions contrairement à `neon-http`). Import : plus de state partiel en cas d'erreur. Reconcile : plus de race condition sur le spill-over — pré-calcul des `remaining` en 2 requêtes `groupBy` au lieu de N×2 appels `getRemaining`.

12. **Validation serveur `sum(allocations) ≤ wave.amount`** (2026-04-11) — `PATCH /api/metadata/transactions/:id` vérifie côté backend que la somme des allocations ne dépasse pas le montant du wave. Double le garde-fou frontend (qui peut être contourné via appel API direct). Max 50 personnes par wave.

13. **Unique index `(session_id, transaction_id)` sur `wave_transactions`** (2026-04-11) — Schéma mis à jour + `api/migrations/2026-04-11-wave-txn-unique.sql` à appliquer manuellement sur Neon (CREATE UNIQUE INDEX CONCURRENTLY). Complète la dédup JS dans `import-wave.ts`. `onConflictDoNothing()` ajouté sur les inserts pour ne pas planter si l'index est en place.

14. **Zod `.max(N)` sur tous les champs string** (2026-04-11) — 100/200 caractères selon le champ, amounts plafonnés à 1 milliard FCFA. Évite DoS léger + JSONB bloated côté BDD.

15. **Parser CSV RFC 4180 minimal** (2026-04-11) — `api/src/lib/csv-parser.ts` gère les champs quotés `"..."` et les guillemets échappés `""`. Un counterparty Wave avec une virgule (ex: "SARL Durand, Michel") ne casse plus le parsing.

16. **Système de toast minimal** (2026-04-11) — `web/src/lib/toast.tsx` expose `ToastProvider` + `useToast`. Pas de dépendance externe. Auto-dismiss 2.5s (success/info) ou 4s (error). Branché sur toutes les mutations (chevron wave, cash CRUD, link/unlink, paiement espèces).

17. **Bannière session archivée** (2026-04-11) — Badge "Archivée" dans le titre + bandeau ambré sous le header. Signal visuel fort pour éviter d'éditer une session figée. Le blocage effectif des mutations côté backend/frontend reste à faire si ça devient un problème concret.

18. **Badge "consolidée" sur Section Résumé** (2026-04-11) — Petit pill explicatif sur le titre "Facture par projet et par personne", avec tooltip expliquant que la matrice est optimisée et que les données brutes (chevrons wave, cash_allocations) ne sont pas modifiées. Répond à la confusion "où est ma facture Bocar×CTD ?".

19. **Refactor workspace.tsx en 8 fichiers** (2026-04-11) — L'ancien monolithe de 2329 lignes a été découpé en modules spécialisés pour améliorer la maintenabilité. `pages/workspace.tsx` est désormais un **orchestrateur pur** (~360 lignes) qui ne fait que charger les queries principales et déléguer le rendu aux sous-composants. Les pure functions (`consolidateFactures`, `computeAutoLinks`) vivent dans `lib/` sans dépendance React et peuvent être testées en isolation. Les types de données sont centralisés dans `types/khalis.ts` (point de vérité pour les modèles API).

    **Propriétés préservées après refactor** :
    - Clés React Query identiques (`["session", sessionId]`, `["cash", sessionId]`, `["allLinks", sessionId]`, `["invoices", sessionId]`, `["summary", sessionId]`, `["projects"]`, `["persons"]`) → aucun impact sur le cache partagé entre composants
    - `KhalisDataTab` reste monté tant que `activeTab ∈ {rapprochement-caisse, resume}` → state local (`pendingManualProjectIds`, `expandedFactureKeys`) et caches survivent au switch
    - Exports tous nommés (pas de `default`) pour faciliter les imports groupés

    **Règle pour les futures modifications** : tout ajout de composant doit préférer un nouveau fichier dans `components/` plutôt qu'une fonction inline dans `workspace.tsx`. Toute logique pure (calcul, transformation de données) doit aller dans `lib/` pour rester testable. Si `workspace.tsx` dépasse 500 lignes, c'est le signal qu'un nouveau composant doit être extrait.

20. **Breakdown BRS sur chaque facture d'équipe** (2026-04-11) — Section Résumé, sur chaque ligne facture (projet × personne), un bandeau en `text-[11px] text-gray-500` sous le nom affiche le détail nécessaire à la génération de la facture externe. Le **montant affiché à droite reste le NET** (inchangé, utilisé par tous les calculs internes). Les valeurs supplémentaires sont purement pour l'UI :

    - `brut (Prestation) = net / 0.95`
    - `BRS 5% = brut - net`

    **Seuil métier : < 25 000 FCFA → pas de BRS.** Pour ces factures, le bandeau affiche uniquement `Net X FCFA`. Le seuil est **inclusif** (`total >= 25000` → BRS appliqué). Voir `components/khalis-data-tab.tsx` constante `BRS_THRESHOLD`.

    **Aucune logique métier ne consomme ces valeurs** — elles existent uniquement pour aider l'utilisateur à copier-coller vers le document de facture hors de l'app. Ne pas les réutiliser pour des calculs internes (la source de vérité reste le `total` net).

21. **Auto-rapprochement Khalis → Facture** (2026-04-11) — `POST /api/auto-match/:sessionId` (réécriture complète de l'ancien endpoint de suggestions). Le bouton **Auto-rapprocher** dans la barre de filtres de l'onglet Rapprochement Wave crée directement les `reconciliation_links` sans passer par une modale de revue.

    **Algorithme** (`api/src/routes/auto-match.ts`) :
    - **Filtrage waves** : on ignore les waves flaggés RFE (`projectId` non-null OU `allocations` non-vide) et les waves déjà partiellement liés dans la session courante. On traite le reste par ordre `transactionDate` ASC.
    - **Pool A** — lignes `facture.payments` avec `paymentType ILIKE '%Wave%'` dont la facture parente est Fatou, non-archivée, `invoiceType='supplier_invoice'`.
    - **Pool B** — factures `invoiceType='expense'` de Fatou dont `invoice.paymentType ILIKE '%Wave%'` (pas de ligne `payments`, le règlement est porté par la facture elle-même).
    - **Période** : `[session.dateStart − 1j, session.dateEnd + 1j]` pour absorber les écarts en bord de session. Pool A filtre sur `payments.paymentDate`, Pool B sur `invoices.invoiceDate`.
    - **Multiset consommé** : pour éviter qu'une ligne déjà rapprochée (même dans une session antérieure) soit reprise, on charge TOUS les `reconciliation_links` existants (toutes sessions confondues) pour les invoices candidates et on soustrait un multiset par `invoiceId`. Soustraction `|v1 − v2| ≤ 0.01`. Pool A trié par `paymentDate` ASC pour un résultat déterministe.
    - **Matching** : pour chaque wave W, candidats = `{c ∈ poolA ∪ poolB disponibles : |c.amount − W.amount| ≤ 0.01 ET |c.date − W.transactionDate| ≤ 1j}`. 0 candidat → `unmatched`, 1 candidat → `matched` (lien créé, candidat consommé dans le run), ≥2 candidats → `ambiguous` (laissé manuel).
    - **Insertion atomique** : tous les liens dans un seul `db.transaction()`.

    **Idempotent** : re-cliquer exclut les waves déjà liés à l'étape 1. Fatou peut cliquer plusieurs fois sans risque de doublons.

    **Déclenchement UI** : bouton dans `pages/workspace.tsx` (barre de filtres de l'onglet Rapprochement Wave). La mutation invalide `["allLinks", sessionId]`, `["invoices", sessionId]`, `["summary", sessionId]` au succès. Toast récapitulatif : `N rapprochés · M ambigus · K sans candidat`.

    **Cas non couverts volontairement** :
    - Waves avec liens partiels préexistants (rare, on laisse Fatou finir).
    - Candidats ambigus : jamais matchés automatiquement.
    - Paiements non-Wave dans `facture.payments` : filtrés par `ILIKE '%Wave%'`.
    - Factures d'un autre user que Fatou : filtrées (hardcode §1).

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
| POST | `/api/auto-match/:sessionId` | Auto-rapprochement : crée les liens pour les waves non-RFE dont le montant+date matchent une ligne `facture.payments` Wave ou une dépense one-shot Wave avec **un seul candidat**. Montant exact ±0,01, date ±1j, multiset pour éviter double-match. Ambigus et sans candidat laissés manuels. Retourne `{matched, ambiguous, unmatched, totalCandidates, details}`. Cf. piège §21. |
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
