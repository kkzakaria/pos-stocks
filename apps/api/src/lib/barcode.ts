import { and, eq, ne } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import * as schema from "../db/schema"

type Db = DrizzleD1Database<typeof schema>

// Unicité des codes-barres PAR ORGANISATION, produits et variantes
// CONFONDUS (un scan POS doit résoudre vers un seul article). Les index
// partiels org-scopés couvrent chaque table ; cette vérification couvre le
// croisement inter-tables, impossible à indexer en SQLite. `exclure` permet
// à un PATCH de re-poser son propre code-barres.
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
