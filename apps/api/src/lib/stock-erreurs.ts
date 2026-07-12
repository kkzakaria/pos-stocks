import { inArray } from "drizzle-orm"
import type { Context } from "hono"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import * as schema from "../db/schema"
import type { ErreurStockInsuffisant } from "../services/stock"

// Enrichit l'erreur du service avec le SKU et le nom de variante pour un
// message actionnable côté écran. Partagé entre ajustements (stock.ts),
// expédition de transfert et clôture d'inventaire.
export async function reponseStockInsuffisant(
  c: Context,
  db: DrizzleD1Database<typeof schema>,
  err: ErreurStockInsuffisant
) {
  const variantIds = err.details.map((d) => d.variantId)
  const variantes =
    variantIds.length > 0
      ? await db
          .select({
            id: schema.productVariants.id,
            sku: schema.productVariants.sku,
            name: schema.productVariants.name,
          })
          .from(schema.productVariants)
          .where(inArray(schema.productVariants.id, variantIds))
      : []
  return c.json(
    {
      code: "STOCK_INSUFFISANT",
      message: "Stock insuffisant pour valider l'opération",
      details: err.details.map((d) => {
        const variante = variantes.find((v) => v.id === d.variantId)
        return {
          ...d,
          sku: variante?.sku ?? null,
          variantName: variante?.name ?? null,
        }
      }),
    },
    409
  )
}
