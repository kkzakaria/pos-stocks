-- Custom SQL migration file, put your code below! --

-- 1) Déduplication défensive des codes-barres préexistants (la prod est
--    quasi vide, mais la migration doit passer même avec des doublons :
--    la ligne la plus ancienne garde son code-barres, les autres sont vidées).
UPDATE products SET barcode = NULL
WHERE barcode IS NOT NULL
  AND rowid NOT IN (
    SELECT MIN(rowid) FROM products
    WHERE barcode IS NOT NULL
    GROUP BY organization_id, barcode
  );--> statement-breakpoint
UPDATE product_variants SET barcode = NULL
WHERE barcode IS NOT NULL
  AND rowid NOT IN (
    SELECT MIN(rowid) FROM product_variants
    WHERE barcode IS NOT NULL
    GROUP BY organization_id, barcode
  );--> statement-breakpoint
-- Doublons croisés produits/variantes : le produit gagne, la variante est vidée.
UPDATE product_variants SET barcode = NULL
WHERE barcode IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM products p
    WHERE p.organization_id = product_variants.organization_id
      AND p.barcode = product_variants.barcode
  );--> statement-breakpoint

-- 2) Unicité des codes-barres PAR ORGANISATION, dans chaque table
--    (index partiels : plusieurs NULL restent permis). L'unicité CROISÉE
--    produits/variantes est vérifiée côté applicatif (lib/barcode.ts,
--    Task 4) : SQLite ne sait pas poser un index unique inter-tables.
CREATE UNIQUE INDEX IF NOT EXISTS products_org_barcode_uidx
  ON products(organization_id, barcode) WHERE barcode IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS product_variants_org_barcode_uidx
  ON product_variants(organization_id, barcode) WHERE barcode IS NOT NULL;--> statement-breakpoint

-- 3) Immuabilité d'une réception validée. Le RAISE(ABORT) annule le
--    STATEMENT ET SA TRANSACTION (donc tout db.batch en cours) : c'est ce
--    qui rend la double validation concurrente atomiquement impossible —
--    le batch de la seconde validation échoue en entier, mouvements compris.
CREATE TRIGGER IF NOT EXISTS purchases_recu_immuable
BEFORE UPDATE ON purchases
WHEN old.status = 'received'
BEGIN
  SELECT RAISE(ABORT, 'RECEPTION_VALIDEE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS purchase_items_recu_insert
BEFORE INSERT ON purchase_items
WHEN (SELECT status FROM purchases WHERE id = new.purchase_id) = 'received'
BEGIN
  SELECT RAISE(ABORT, 'RECEPTION_VALIDEE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS purchase_items_recu_update
BEFORE UPDATE ON purchase_items
WHEN (SELECT status FROM purchases WHERE id = old.purchase_id) = 'received'
BEGIN
  SELECT RAISE(ABORT, 'RECEPTION_VALIDEE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS purchase_items_recu_delete
BEFORE DELETE ON purchase_items
WHEN (SELECT status FROM purchases WHERE id = old.purchase_id) = 'received'
BEGIN
  SELECT RAISE(ABORT, 'RECEPTION_VALIDEE');
END;--> statement-breakpoint

-- 4) Journal append-only, verrouillé en base (aucune route ne fait
--    d'UPDATE/DELETE dessus, ceci est la ceinture ET les bretelles).
--    Effet assumé : la suppression d'une entité référencée par le journal
--    (entrepôt, variante, lot…) échouera — la piste d'audit prime, et
--    aucune route de suppression de ces entités n'existe en v1.
CREATE TRIGGER IF NOT EXISTS stock_movements_append_only_update
BEFORE UPDATE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'JOURNAL_IMMUABLE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS stock_movements_append_only_delete
BEFORE DELETE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'JOURNAL_IMMUABLE');
END;
