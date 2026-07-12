-- Custom SQL migration file, put your code below! --

-- Revue CodeRabbit PR #6 (vague de correctifs sur 0007/0008).

-- 1) Gardes BEFORE DELETE sur les documents terminaux — jusqu'ici seuls les
--    UPDATE étaient gardés (0007) ; un DELETE SQL direct d'un transfert
--    received/cancelled ou d'un inventaire closed effacerait l'audit et
--    cascaderait (onDelete: "cascade") sur les lignes sans laisser de trace.
--    Mêmes codes que les triggers UPDATE existants pour rester cohérent.
CREATE TRIGGER IF NOT EXISTS transfers_termine_delete
BEFORE DELETE ON transfers
WHEN old.status IN ('received', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'TRANSFERT_TERMINE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS inventory_counts_clos_delete
BEFORE DELETE ON inventory_counts
WHEN old.status = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'INVENTAIRE_CLOS');
END;--> statement-breakpoint

-- 2) Verrouille les transitions de statut d'un transfert 'pending' : rien
--    n'empêchait en SQL brut un saut direct pending -> received (sans passer
--    par 'sent', donc sans gel du CMP ni mouvement transfer_out/transfer_in).
--    Seules pending -> sent (expédition, encadrée par 0008), pending ->
--    cancelled (annulation) et pending -> pending (édition de brouillon)
--    restent permises.
CREATE TRIGGER IF NOT EXISTS transfers_pending_transitions
BEFORE UPDATE ON transfers
WHEN old.status = 'pending' AND new.status NOT IN ('pending', 'sent', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'STATUT_INVALIDE');
END;--> statement-breakpoint

-- 3) Élargit transfer_items_expedie_update (0007, recréé en 0008) pour figer
--    aussi created_at pendant l'état 'sent' — colonne omise à tort jusqu'ici.
--    received_quantity reste seule colonne modifiable (saisie de réception,
--    dont le batch met à jour les lignes AVANT le passage à 'received').
--    Recréé sous le MÊME nom via DROP + CREATE plutôt qu'en éditant 0007/0008,
--    déjà appliquées en local — ces migrations restent un historique fidèle
--    de ce qui a tourné en base à l'époque.
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
    OR new.organization_id IS NOT old.organization_id
    OR new.created_at IS NOT old.created_at)
BEGIN
  SELECT RAISE(ABORT, 'TRANSFERT_EXPEDIE');
END;
