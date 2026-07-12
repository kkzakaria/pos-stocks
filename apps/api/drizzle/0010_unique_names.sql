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
--    Le rang de chaque ligne est calculé UNE FOIS, via une CTE
--    `AS MATERIALIZED` (ROW_NUMBER() OVER PARTITION BY organization_id,
--    name COLLATE NOCASE ORDER BY rowid), avant que l'UPDATE ne commence à
--    muter les noms. MATERIALIZED force SQLite à évaluer et stocker le
--    résultat de la CTE comme une table temporaire figée : sans ce mot-clé,
--    SQLite peut choisir d'inliner la CTE et de la ré-évaluer ligne par
--    ligne pendant l'UPDATE, auquel cas le rang recalculé "voit" les noms
--    déjà renommés par les lignes précédentes du même UPDATE et se
--    réinitialise (bug constaté empiriquement avec 3+ doublons dans la même
--    organisation : « Foo », « foo », « FOO » finissaient en « Foo »,
--    « foo (2) », « FOO (2) » — collision NOCASE résiduelle faisant échouer
--    la CRÉATION D'INDEX ci-dessous). Avec la CTE matérialisée, le rang est
--    figé sur l'état initial de la table : « Foo », « foo (2) », « FOO (3) ».
--    Risque résiduel documenté : si « X (2) » existe déjà en tant que nom
--    distinct préexistant, la CRÉATION D'INDEX ci-dessous échoue — migration
--    bloquée, visible, à corriger à la main (aucun silencieux).
WITH ranked_warehouses AS MATERIALIZED (
  SELECT rowid AS rid,
         ROW_NUMBER() OVER (
           PARTITION BY organization_id, name COLLATE NOCASE
           ORDER BY rowid
         ) AS rang
  FROM warehouses
)
UPDATE warehouses
SET name = name || ' (' || (SELECT rang FROM ranked_warehouses WHERE ranked_warehouses.rid = warehouses.rowid) || ')'
WHERE rowid IN (SELECT rid FROM ranked_warehouses WHERE rang > 1);--> statement-breakpoint
WITH ranked_products AS MATERIALIZED (
  SELECT rowid AS rid,
         ROW_NUMBER() OVER (
           PARTITION BY organization_id, name COLLATE NOCASE
           ORDER BY rowid
         ) AS rang
  FROM products
)
UPDATE products
SET name = name || ' (' || (SELECT rang FROM ranked_products WHERE ranked_products.rid = products.rowid) || ')'
WHERE rowid IN (SELECT rid FROM ranked_products WHERE rang > 1);--> statement-breakpoint
WITH ranked_categories AS MATERIALIZED (
  SELECT rowid AS rid,
         ROW_NUMBER() OVER (
           PARTITION BY organization_id, name COLLATE NOCASE
           ORDER BY rowid
         ) AS rang
  FROM categories
)
UPDATE categories
SET name = name || ' (' || (SELECT rang FROM ranked_categories WHERE ranked_categories.rid = categories.rowid) || ')'
WHERE rowid IN (SELECT rid FROM ranked_categories WHERE rang > 1);--> statement-breakpoint
WITH ranked_suppliers AS MATERIALIZED (
  SELECT rowid AS rid,
         ROW_NUMBER() OVER (
           PARTITION BY organization_id, name COLLATE NOCASE
           ORDER BY rowid
         ) AS rang
  FROM suppliers
)
UPDATE suppliers
SET name = name || ' (' || (SELECT rang FROM ranked_suppliers WHERE ranked_suppliers.rid = suppliers.rowid) || ')'
WHERE rowid IN (SELECT rid FROM ranked_suppliers WHERE rang > 1);--> statement-breakpoint

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
