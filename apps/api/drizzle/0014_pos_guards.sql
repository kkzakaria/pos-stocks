-- Custom SQL migration file, put your code below! --

-- 1) Unicités POS (index custom HORS snapshot, motif 0005/0007).
-- 1a) Une seule session ouverte par (boutique, caissier). Violation :
--     « UNIQUE constraint failed: register_sessions.store_id,
--     register_sessions.cashier_id » →
--     estViolationUnicite(err, 'register_sessions.store_id').
CREATE UNIQUE INDEX IF NOT EXISTS register_sessions_open_uidx
  ON register_sessions(store_id, cashier_id) WHERE status = 'open';--> statement-breakpoint
-- 1b) Numéro de ticket séquentiel par boutique — ceinture : la sous-requête
--     MAX+1 s'exécute dans la transaction du batch (mono-écrivain SQLite),
--     l'index rend toute anomalie bruyante plutôt que silencieuse.
CREATE UNIQUE INDEX IF NOT EXISTS sales_store_ticket_uidx
  ON sales(store_id, ticket_number);--> statement-breakpoint
-- 1c) Idempotence client (décision 5) : un retry réseau rejoue la violation
--     et la route renvoie la vente existante.
CREATE UNIQUE INDEX IF NOT EXISTS sales_org_request_uidx
  ON sales(organization_id, client_request_id);--> statement-breakpoint

-- 2) Immuabilité des ventes : une vente naît TERMINALE (`completed`), il
--    n'existe aucun cycle brouillon — tout UPDATE/DELETE est interdit, sur
--    le document comme sur ses lignes et paiements. Les INSERT de lignes/
--    paiements restent permis : ils arrivent DANS le batch de création,
--    après l'insert de la vente (fenêtre théorique assumée : un INSERT SQL
--    direct pourrait rattacher une ligne à une vente ancienne — aucune
--    route ne le fait, et sales.total, figé, ne bougerait pas).
--    `refunded` (v2) rouvrira ces triggers par une NOUVELLE migration.
CREATE TRIGGER IF NOT EXISTS sales_immuable_update
BEFORE UPDATE ON sales
BEGIN
  SELECT RAISE(ABORT, 'VENTE_IMMUABLE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS sales_immuable_delete
BEFORE DELETE ON sales
BEGIN
  SELECT RAISE(ABORT, 'VENTE_IMMUABLE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS sale_items_immuables_update
BEFORE UPDATE ON sale_items
BEGIN
  SELECT RAISE(ABORT, 'VENTE_IMMUABLE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS sale_items_immuables_delete
BEFORE DELETE ON sale_items
BEGIN
  SELECT RAISE(ABORT, 'VENTE_IMMUABLE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS payments_immuables_update
BEFORE UPDATE ON payments
BEGIN
  SELECT RAISE(ABORT, 'VENTE_IMMUABLE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS payments_immuables_delete
BEFORE DELETE ON payments
BEGIN
  SELECT RAISE(ABORT, 'VENTE_IMMUABLE');
END;--> statement-breakpoint

-- 3) Session fermée immuable : la fermeture fait son UPDATE SANS filtre de
--    statut (motif P4/P5) — une double fermeture concurrente meurt ici.
CREATE TRIGGER IF NOT EXISTS register_sessions_fermee_immuable
BEFORE UPDATE ON register_sessions
WHEN old.status = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'SESSION_FERMEE');
END;--> statement-breakpoint
-- 3b) Une vente ne peut naître QUE dans une session ouverte : ferme la
--     course fermeture/vente (la vente référence une session résolue côté
--     serveur AVANT le batch ; si la fermeture commite entre-temps, ce
--     trigger tue le batch de vente ENTIER — mouvements compris).
--     `IS NOT 'open'` couvre aussi une session inexistante (NULL).
CREATE TRIGGER IF NOT EXISTS sales_session_ouverte
BEFORE INSERT ON sales
WHEN (SELECT status FROM register_sessions
      WHERE id = new.register_session_id) IS NOT 'open'
BEGIN
  SELECT RAISE(ABORT, 'SESSION_FERMEE');
END;--> statement-breakpoint

-- 4) FEFO — garde par lot (décision 1 du plan) : les quantités par lot sont
--    DÉRIVÉES du journal, la lecture hors transaction peut être périmée
--    (deux caisses choisissent le même lot). Ce trigger est l'invariant
--    transactionnel : tout mouvement NÉGATIF portant un lot_id dont la somme
--    (entrepôt, variante, lot) deviendrait négative tue le batch ENTIER —
--    symétrique par lot du CHECK stock_levels_quantity_positive. Il couvre
--    AUSSI transfer_out/adjustment avec lot : l'invariant « aucun lot
--    négatif au journal » devient global.
CREATE TRIGGER IF NOT EXISTS stock_movements_lot_solde_positif
BEFORE INSERT ON stock_movements
WHEN new.lot_id IS NOT NULL AND new.delta < 0
  AND (SELECT COALESCE(SUM(delta), 0) FROM stock_movements
       WHERE warehouse_id = new.warehouse_id
         AND variant_id = new.variant_id
         AND lot_id = new.lot_id) + new.delta < 0
BEGIN
  SELECT RAISE(ABORT, 'LOT_INSUFFISANT');
END;--> statement-breakpoint
-- Index de soutien de la somme par lot (partiel : seuls les mouvements
-- lotés participent).
CREATE INDEX IF NOT EXISTS stock_movements_wh_variant_lot_idx
  ON stock_movements(warehouse_id, variant_id, lot_id)
  WHERE lot_id IS NOT NULL;
