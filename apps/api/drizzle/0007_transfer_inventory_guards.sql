-- Custom SQL migration file, put your code below! --

-- 1) Un seul inventaire ouvert par entrepôt (index partiel : HORS snapshot
--    drizzle-kit, comme les index barcode de 0005). La violation remonte
--    « UNIQUE constraint failed: inventory_counts.warehouse_id » →
--    estViolationUnicite(err, 'inventory_counts.warehouse_id').
CREATE UNIQUE INDEX IF NOT EXISTS inventory_counts_open_wh_uidx
  ON inventory_counts(warehouse_id) WHERE status = 'open';--> statement-breakpoint

-- 2) Transferts — mêmes garanties que purchases_recu_immuable (0005) :
--    le RAISE(ABORT) annule le STATEMENT ET SA TRANSACTION (tout db.batch
--    en cours), ce qui rend les courses double-send / double-receive /
--    cancel-après-send atomiquement impossibles.
-- 2a) Un transfert terminé (received/cancelled) est immuable.
CREATE TRIGGER IF NOT EXISTS transfers_termine_immuable
BEFORE UPDATE ON transfers
WHEN old.status IN ('received', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'TRANSFERT_TERMINE');
END;--> statement-breakpoint
-- 2b) Un transfert expédié n'accepte plus qu'UNE transition : received.
--     Tue le double-send (sent -> sent), l'annulation après expédition
--     (sent -> cancelled) et toute édition du document une fois expédié.
CREATE TRIGGER IF NOT EXISTS transfers_expedie_fige
BEFORE UPDATE ON transfers
WHEN old.status = 'sent' AND new.status <> 'received'
BEGIN
  SELECT RAISE(ABORT, 'TRANSFERT_EXPEDIE');
END;--> statement-breakpoint

-- 3) Lignes de transfert.
-- 3a) État terminal : plus aucune écriture.
CREATE TRIGGER IF NOT EXISTS transfer_items_termine_insert
BEFORE INSERT ON transfer_items
WHEN (SELECT status FROM transfers WHERE id = new.transfer_id)
  IN ('received', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'TRANSFERT_TERMINE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS transfer_items_termine_update
BEFORE UPDATE ON transfer_items
WHEN (SELECT status FROM transfers WHERE id = old.transfer_id)
  IN ('received', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'TRANSFERT_TERMINE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS transfer_items_termine_delete
BEFORE DELETE ON transfer_items
WHEN (SELECT status FROM transfers WHERE id = old.transfer_id)
  IN ('received', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'TRANSFERT_TERMINE');
END;--> statement-breakpoint
-- 3b) État sent : pas d'ajout ni de retrait de ligne…
CREATE TRIGGER IF NOT EXISTS transfer_items_expedie_insert
BEFORE INSERT ON transfer_items
WHEN (SELECT status FROM transfers WHERE id = new.transfer_id) = 'sent'
BEGIN
  SELECT RAISE(ABORT, 'TRANSFERT_EXPEDIE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS transfer_items_expedie_delete
BEFORE DELETE ON transfer_items
WHEN (SELECT status FROM transfers WHERE id = old.transfer_id) = 'sent'
BEGIN
  SELECT RAISE(ABORT, 'TRANSFERT_EXPEDIE');
END;--> statement-breakpoint
-- 3c) …et seule received_quantity peut changer (écrite par la réception,
--     dont le batch met à jour les lignes AVANT le passage received).
--     `IS NOT` et non `<>` : lot_id/unit_cost sont nullables.
--     NB : le gel du CMP à l'expédition met à jour unit_cost PENDANT que le
--     parent est encore 'pending' (ordre du batch : lignes puis statut) —
--     ce trigger ne le concerne donc pas.
CREATE TRIGGER IF NOT EXISTS transfer_items_expedie_update
BEFORE UPDATE ON transfer_items
WHEN (SELECT status FROM transfers WHERE id = old.transfer_id) = 'sent'
  AND (new.quantity IS NOT old.quantity
    OR new.variant_id IS NOT old.variant_id
    OR new.lot_id IS NOT old.lot_id
    OR new.unit_cost IS NOT old.unit_cost
    OR new.transfer_id IS NOT old.transfer_id)
BEGIN
  SELECT RAISE(ABORT, 'TRANSFERT_EXPEDIE');
END;--> statement-breakpoint

-- 4) Inventaires : un document clos est immuable, lignes comprises.
CREATE TRIGGER IF NOT EXISTS inventory_counts_clos_immuable
BEFORE UPDATE ON inventory_counts
WHEN old.status = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'INVENTAIRE_CLOS');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS inventory_count_items_clos_insert
BEFORE INSERT ON inventory_count_items
WHEN (SELECT status FROM inventory_counts WHERE id = new.count_id) = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'INVENTAIRE_CLOS');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS inventory_count_items_clos_update
BEFORE UPDATE ON inventory_count_items
WHEN (SELECT status FROM inventory_counts WHERE id = old.count_id) = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'INVENTAIRE_CLOS');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS inventory_count_items_clos_delete
BEFORE DELETE ON inventory_count_items
WHEN (SELECT status FROM inventory_counts WHERE id = old.count_id) = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'INVENTAIRE_CLOS');
END;
