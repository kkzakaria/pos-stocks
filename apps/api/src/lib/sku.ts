import { and, eq, like } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import * as schema from "../db/schema"

const MOTIF_SKU_AUTO = /^PRD-(\d+)$/

export async function genererSkuProduit(
  db: DrizzleD1Database<typeof schema>,
  organizationId: string
): Promise<string> {
  const rows = await db
    .select({ sku: schema.products.sku })
    .from(schema.products)
    .where(
      and(
        eq(schema.products.organizationId, organizationId),
        like(schema.products.sku, "PRD-%")
      )
    )
  let max = 0
  for (const { sku } of rows) {
    const correspondance = MOTIF_SKU_AUTO.exec(sku)
    if (correspondance) {
      max = Math.max(max, Number(correspondance[1]))
    }
  }
  return `PRD-${String(max + 1).padStart(4, "0")}`
}

export function genererSkuVariante(
  skuProduit: string,
  attributes: Record<string, string>
): string {
  const suffixe = Object.values(attributes)
    .map((valeur) =>
      valeur
        // « Rouge foncé » → « ROUGE-FONCE » : accents décomposés puis retirés
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    )
    .filter((valeur) => valeur.length > 0)
    .join("-")
  return suffixe ? `${skuProduit}-${suffixe}` : `${skuProduit}-STD`
}
