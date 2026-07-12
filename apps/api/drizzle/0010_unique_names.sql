-- Custom SQL migration file, put your code below! --

-- Issue GitHub #7 — unicité des noms PAR ORGANISATION, insensible à la casse,
-- sur warehouses / products / categories / suppliers. Index custom HORS
-- snapshot drizzle (motif 0005/0007) : COLLATE NOCASE dans un index n'est de
-- toute façon pas exprimable dans le schéma TS.
-- NOCASE ne plie que l'ASCII (é/É restent distincts) : repli assumé v1.
--
-- 1) Déduplication préalable (la prod est quasi vide, mais la migration doit
--    passer même avec des doublons) : la ligne au plus petit rowid garde son
--    nom, les suivantes sont suffixées « (2) », « (3) »… par rang de rowid.
--    Risque résiduel documenté : si « X (2) » existe déjà, la CRÉATION
--    D'INDEX ci-dessous échoue — migration bloquée, visible, à corriger à la
--    main (aucun silencieux).
UPDATE warehouses SET name = name || ' (' || (
  SELECT COUNT(*) FROM warehouses w2
  WHERE w2.organization_id = warehouses.organization_id
    AND w2.name = warehouses.name COLLATE NOCASE
    AND w2.rowid <= warehouses.rowid
) || ')'
WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM warehouses
  GROUP BY organization_id, name COLLATE NOCASE
);--> statement-breakpoint
UPDATE products SET name = name || ' (' || (
  SELECT COUNT(*) FROM products p2
  WHERE p2.organization_id = products.organization_id
    AND p2.name = products.name COLLATE NOCASE
    AND p2.rowid <= products.rowid
) || ')'
WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM products
  GROUP BY organization_id, name COLLATE NOCASE
);--> statement-breakpoint
UPDATE categories SET name = name || ' (' || (
  SELECT COUNT(*) FROM categories c2
  WHERE c2.organization_id = categories.organization_id
    AND c2.name = categories.name COLLATE NOCASE
    AND c2.rowid <= categories.rowid
) || ')'
WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM categories
  GROUP BY organization_id, name COLLATE NOCASE
);--> statement-breakpoint
UPDATE suppliers SET name = name || ' (' || (
  SELECT COUNT(*) FROM suppliers s2
  WHERE s2.organization_id = suppliers.organization_id
    AND s2.name = suppliers.name COLLATE NOCASE
    AND s2.rowid <= suppliers.rowid
) || ')'
WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM suppliers
  GROUP BY organization_id, name COLLATE NOCASE
);--> statement-breakpoint

-- 2) Index uniques. La violation remonte
--    « UNIQUE constraint failed: <table>.organization_id, <table>.name »
--    → estViolationUnicite(err, "<table>.name").
CREATE UNIQUE INDEX IF NOT EXISTS warehouses_org_name_uidx
  ON warehouses(organization_id, name COLLATE NOCASE);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS products_org_name_uidx
  ON products(organization_id, name COLLATE NOCASE);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS categories_org_name_uidx
  ON categories(organization_id, name COLLATE NOCASE);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_org_name_uidx
  ON suppliers(organization_id, name COLLATE NOCASE);
