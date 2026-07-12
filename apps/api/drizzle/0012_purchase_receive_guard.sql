-- Custom SQL migration file, put your code below! --

-- TOCTOU brouillon -> validation des réceptions (jumeau du correctif
-- transferts 0008, différé P5) : le receive lit les lignes en JS puis les
-- gèle (quantité, coût, lot, péremption + frozen_at) PAR VALEURS-JS dans le
-- même batch que la transition. Une ligne insérée par une requête
-- concurrente ENTRE cette lecture et le commit (le parent est encore
-- 'draft', aucun trigger ne garde cette fenêtre) échapperait au gel : elle
-- passerait 'received' SANS mouvement d'entrée correspondant — ligne de
-- document jamais entrée en stock.
-- Ce trigger ferme la fenêtre : toute transition draft -> received est
-- bloquée si UNE SEULE ligne a encore frozen_at NULL au moment de la
-- transition. Les gels du receive s'exécutent AVANT le changement de statut
-- dans le même batch (ordre posé dans routes/purchases.ts, ne pas le
-- casser) : le flux normal n'est jamais affecté ; le RAISE ABORT annule le
-- batch ENTIER (mouvements compris).
CREATE TRIGGER IF NOT EXISTS purchases_receive_lignes_gelees
BEFORE UPDATE ON purchases
WHEN new.status = 'received' AND old.status = 'draft'
  AND EXISTS (
    SELECT 1 FROM purchase_items
    WHERE purchase_id = new.id AND frozen_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'LIGNE_NON_GELEE');
END;
