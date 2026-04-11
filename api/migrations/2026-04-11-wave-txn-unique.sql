-- Migration : Unique index (session_id, transaction_id) sur wave_transactions
-- Date : 2026-04-11
-- Motivation : garantir au niveau BDD qu'un même CSV Wave ne peut pas être
-- importé deux fois dans la même session. Complète la déduplication JS déjà
-- présente dans api/src/routes/import-wave.ts (nécessaire contre les races).
--
-- À appliquer manuellement sur Neon via le dashboard SQL Editor :
--   1. Backup recommandé (branch Neon si possible)
--   2. Vérifier qu'aucun doublon n'existe déjà :
--        SELECT session_id, transaction_id, COUNT(*)
--        FROM khalis.wave_transactions
--        GROUP BY session_id, transaction_id
--        HAVING COUNT(*) > 1;
--      Si des lignes remontent, supprimer les doublons en gardant la plus ancienne
--      (via createdAt ASC) avant de créer l'index.
--   3. Exécuter la commande ci-dessous.
--
-- Sécurité : CONCURRENTLY évite le lock table et permet l'exécution sans downtime,
-- mais doit être exécuté hors transaction (donc une ligne à la fois dans Neon UI).

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS wave_txn_session_tid_uniq
  ON khalis.wave_transactions (session_id, transaction_id);

-- Vérification post-migration :
--   SELECT indexname, indexdef FROM pg_indexes
--   WHERE schemaname = 'khalis' AND tablename = 'wave_transactions';
-- L'index `wave_txn_session_tid_uniq` doit apparaître.
