-- Custom SQL migration file, put your code below! --

-- 1) TOCTOU brouillon → expédition (revue finale P5, Important) : le send
--    lit les lignes en JS puis fige leur CMP (et, depuis ce correctif, leur
--    quantité) PAR SOUS-REQUÊTE/valeur-JS dans le même batch. Une ligne
--    insérée par une requête concurrente ENTRE cette lecture et le commit
--    du batch (le parent est encore 'pending', aucun trigger ne garde la
--    transition pending -> sent) échapperait aux gels : elle passerait en
--    'sent' avec unit_cost NULL et SANS mouvement transfer_out — puis, à la
--    réception, créerait un transfer_in jamais sorti de l'origine (stock
--    ex nihilo).
--    Ce trigger ferme la fenêtre : toute transition pending -> sent est
--    bloquée si UNE SEULE ligne du transfert a encore unit_cost NULL au
--    moment de la transition. Les gels du send (qui touchent TOUTES les
--    lignes vues par la lecture JS) s'exécutant AVANT ce changement de
--    statut dans le même batch (ordre déjà en place dans routes/transfers.ts,
--    ne pas le casser), le flux normal n'est jamais affecté ; seule une ligne
--    apparue après la lecture JS — donc absente des gels — fait échouer le
--    batch ENTIER (RAISE ABORT annule aussi la transaction).
CREATE TRIGGER IF NOT EXISTS transfers_send_lignes_gelees
BEFORE UPDATE ON transfers
WHEN new.status = 'sent' AND old.status = 'pending'
  AND EXISTS (
    SELECT 1 FROM transfer_items
    WHERE transfer_id = new.id AND unit_cost IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'LIGNE_NON_GELEE');
END;--> statement-breakpoint

-- 2) Recommandation revue T3 : élargit transfer_items_expedie_update (0007)
--    pour figer aussi `id` et `organization_id` pendant l'état 'sent' (ces
--    colonnes n'ont aucune raison de changer sur une ligne déjà expédiée).
--    Recréé sous le MÊME nom via DROP + CREATE plutôt qu'en éditant 0007,
--    déjà appliquée en local — 0007 reste un historique fidèle de ce qui a
--    tourné en base à l'époque.
DROP TRIGGER IF EXISTS transfer_items_expedie_update;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS transfer_items_expedie_update
BEFORE UPDATE ON transfer_items
WHEN (SELECT status FROM transfers WHERE id = old.transfer_id) = 'sent'
  AND (new.quantity IS NOT old.quantity
    OR new.variant_id IS NOT old.variant_id
    OR new.lot_id IS NOT old.lot_id
    OR new.unit_cost IS NOT old.unit_cost
    OR new.transfer_id IS NOT old.transfer_id
    OR new.id IS NOT old.id
    OR new.organization_id IS NOT old.organization_id)
BEGIN
  SELECT RAISE(ABORT, 'TRANSFERT_EXPEDIE');
END;
