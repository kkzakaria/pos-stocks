import { and, eq, inArray, ne } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import * as schema from "../db/schema"
import { requeterParLots } from "./db-batch"

type Db = DrizzleD1Database<typeof schema>

// Unicité des codes-barres PAR ORGANISATION, produits et variantes
// CONFONDUS (un scan POS doit résoudre vers un seul article). Les index
// partiels org-scopés couvrent chaque table ; cette vérification couvre le
// croisement inter-tables, impossible à indexer en SQLite. `exclure` permet
// à un PATCH de re-poser son propre code-barres.
//
// LIMITE ASSUMÉE (v1) : entre tables, la garantie est best-effort — deux
// écritures concurrentes (produit + variante, même code) passant chacune ce
// pré-contrôle avant l'insert de l'autre peuvent toutes deux aboutir, sans
// rattrapage possible en base. Fenêtre jugée négligeable (saisie back-office
// humaine) ; le POS Phase 6 devra tolérer un scan multi-résultats résiduel
// ou une réconciliation corrigera le doublon.
export async function barcodeDejaUtilise(
  db: Db,
  organizationId: string,
  barcode: string,
  exclure: { produitId?: string; varianteId?: string } = {}
): Promise<boolean> {
  const conditionsProduits: SQL[] = [
    eq(schema.products.organizationId, organizationId),
    eq(schema.products.barcode, barcode),
  ]
  if (exclure.produitId) {
    conditionsProduits.push(ne(schema.products.id, exclure.produitId))
  }
  const produits = await db
    .select({ id: schema.products.id })
    .from(schema.products)
    .where(and(...conditionsProduits))
    .limit(1)
  if (produits.length > 0) {
    return true
  }

  const conditionsVariantes: SQL[] = [
    eq(schema.productVariants.organizationId, organizationId),
    eq(schema.productVariants.barcode, barcode),
  ]
  if (exclure.varianteId) {
    conditionsVariantes.push(ne(schema.productVariants.id, exclure.varianteId))
  }
  const variantes = await db
    .select({ id: schema.productVariants.id })
    .from(schema.productVariants)
    .where(and(...conditionsVariantes))
    .limit(1)
  return variantes.length > 0
}

// Batched counterpart of `barcodeDejaUtilise`, for callers that hold several
// barcodes at once (product creation carrying its variants). The one-at-a-time
// helper issues TWO selects per call, so validating 50 variants meant ~100
// sequential D1 round trips before the first write. Here the whole payload
// costs two queries, whatever its size.
//
// Same cross-table rule as above: unicity spans products AND variants within an
// organization. The batching goes through `requeterParLots` because an inArray
// fed by an unbounded list would blow past D1's 100 bound-parameter cap.
export async function barcodesDejaUtilises(
  db: Db,
  organizationId: string,
  barcodes: string[]
): Promise<Set<string>> {
  if (barcodes.length === 0) return new Set()
  const uniques = [...new Set(barcodes)]

  const [surProduits, surVariantes] = await Promise.all([
    requeterParLots(uniques, (lot) =>
      db
        .select({ barcode: schema.products.barcode })
        .from(schema.products)
        .where(
          and(
            eq(schema.products.organizationId, organizationId),
            inArray(schema.products.barcode, lot)
          )
        )
    ),
    requeterParLots(uniques, (lot) =>
      db
        .select({ barcode: schema.productVariants.barcode })
        .from(schema.productVariants)
        .where(
          and(
            eq(schema.productVariants.organizationId, organizationId),
            inArray(schema.productVariants.barcode, lot)
          )
        )
    ),
  ])

  const pris = new Set<string>()
  for (const { barcode } of [...surProduits, ...surVariantes]) {
    if (barcode !== null) pris.add(barcode)
  }
  return pris
}

// Same reasoning for explicit variant SKUs: the unique index is
// (organizationId, sku) across the whole organization, so each SKU of the
// payload had to be looked up on its own before this existed.
export async function skusVariantesDejaUtilises(
  db: Db,
  organizationId: string,
  skus: string[]
): Promise<Set<string>> {
  if (skus.length === 0) return new Set()
  const lignes = await requeterParLots([...new Set(skus)], (lot) =>
    db
      .select({ sku: schema.productVariants.sku })
      .from(schema.productVariants)
      .where(
        and(
          eq(schema.productVariants.organizationId, organizationId),
          inArray(schema.productVariants.sku, lot)
        )
      )
  )
  return new Set(lignes.map((l) => l.sku))
}
