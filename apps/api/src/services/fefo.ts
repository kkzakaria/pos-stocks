import { and, eq, isNotNull, sql } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import * as schema from "../db/schema"

type Db = DrizzleD1Database<typeof schema>

export type LotDisponible = {
  lotId: string
  expiryDate: Date | null
  disponible: number
}

export type AllocationLot = {
  // null = reliquat sorti SANS lot (repli, décision 2 du plan)
  lotId: string | null
  quantite: number
}

// FEFO (First Expired, First Out — spec §5) : déduction du lot qui expire
// le premier. Fonction PURE : le choix est testable sans base. Tri :
// péremption croissante, lots sans date en DERNIER (on écoule d'abord ce
// qui périme), tiebreak lotId pour un ordre déterministe.
//
// Repli documenté (décision 2) : si les lots dérivés ne couvrent pas la
// quantité demandée alors que le niveau total suffit (stock historique
// entré sans lot : ajustements, anciennes réceptions), le reliquat sort en
// mouvement SANS lotId — sinon ce stock serait invendable. Le CHECK
// stock_levels_quantity_positive garde le total ; le trigger
// stock_movements_lot_solde_positif (0014) garde chaque lot.
export function allouerFefo(
  lots: LotDisponible[],
  quantite: number
): AllocationLot[] {
  const tries = lots
    .filter((lot) => lot.disponible > 0)
    .sort((a, b) => {
      if (a.expiryDate && b.expiryDate) {
        const parDate = a.expiryDate.getTime() - b.expiryDate.getTime()
        if (parDate !== 0) return parDate
        return a.lotId < b.lotId ? -1 : 1
      }
      if (a.expiryDate) return -1
      if (b.expiryDate) return 1
      return a.lotId < b.lotId ? -1 : 1
    })
  const allocations: AllocationLot[] = []
  let restant = quantite
  for (const lot of tries) {
    if (restant === 0) break
    const prise = Math.min(lot.disponible, restant)
    allocations.push({ lotId: lot.lotId, quantite: prise })
    restant -= prise
  }
  if (restant > 0) {
    allocations.push({ lotId: null, quantite: restant })
  }
  return allocations
}

// Quantités par lot DÉRIVÉES du journal (décision 1 du plan : pas de
// matérialisation) : SUM(delta) par lot_id sur stock_movements — cohérent
// par construction, tout mouvement loté passe par applyMovements. Lecture
// HORS transaction : photographie possiblement périmée sous concurrence —
// l'invariant est garanti par le trigger LOT_INSUFFISANT dans le batch, et
// la route de vente réalloue/rejoue une fois. Index de soutien :
// stock_movements_wh_variant_lot_idx (0014).
export async function lireLotsDisponibles(
  db: Db,
  warehouseId: string,
  variantId: string
): Promise<LotDisponible[]> {
  const rows = await db
    .select({
      lotId: schema.stockMovements.lotId,
      expiryDate: schema.lots.expiryDate,
      disponible: sql<number>`COALESCE(SUM(${schema.stockMovements.delta}), 0)`,
    })
    .from(schema.stockMovements)
    .innerJoin(schema.lots, eq(schema.stockMovements.lotId, schema.lots.id))
    .where(
      and(
        eq(schema.stockMovements.warehouseId, warehouseId),
        eq(schema.stockMovements.variantId, variantId),
        isNotNull(schema.stockMovements.lotId)
      )
    )
    .groupBy(schema.stockMovements.lotId, schema.lots.expiryDate)
    .orderBy(schema.lots.expiryDate)
  return rows.flatMap((r) =>
    r.lotId === null || r.disponible <= 0
      ? []
      : [{ lotId: r.lotId, expiryDate: r.expiryDate, disponible: r.disponible }]
  )
}
