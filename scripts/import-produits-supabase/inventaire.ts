import type { LigneInventaireSource } from "./supabase-source"

export interface ProduitApi {
  id: string
  sku: string
  variants: Array<{ id: string; sku: string }>
}

export interface ItemReception {
  variantId: string
  quantity: number
  unitCost: number
}

export interface LigneIgnoree {
  sku: string
  raison: "sku_absent"
}

export interface ResultatMapping {
  itemsParMagasin: Map<string, ItemReception[]>
  ignorees: LigneIgnoree[]
}

/** sku → its sole "Standard" variant id (imported products have no variants). */
export function carteSkuVariante(produits: ProduitApi[]): Map<string, string> {
  const carte = new Map<string, string>()
  for (const p of produits) {
    const v = p.variants[0] as { id: string; sku: string } | undefined
    if (v) carte.set(p.sku, v.id)
  }
  return carte
}

export function mapperInventaire(
  lignes: LigneInventaireSource[],
  skuVersVariante: Map<string, string>,
  storeIdVersWarehouse: Map<string, string>
): ResultatMapping {
  const itemsParMagasin = new Map<string, ItemReception[]>()
  const ignorees: LigneIgnoree[] = []
  for (const ligne of lignes) {
    const warehouseId = storeIdVersWarehouse.get(ligne.storeId)
    if (warehouseId === undefined) {
      throw new Error(`Magasin Supabase ${ligne.storeId} sans warehouse cible`)
    }
    const variantId = skuVersVariante.get(ligne.sku)
    if (variantId === undefined) {
      ignorees.push({ sku: ligne.sku, raison: "sku_absent" })
      continue
    }
    const item: ItemReception = {
      variantId,
      quantity: ligne.quantity,
      unitCost: Math.round(ligne.cost ?? 0),
    }
    const liste = itemsParMagasin.get(warehouseId) ?? []
    liste.push(item)
    itemsParMagasin.set(warehouseId, liste)
  }
  return { itemsParMagasin, ignorees }
}

export function chunk<T>(items: T[], taille: number): T[][] {
  const lots: T[][] = []
  for (let i = 0; i < items.length; i += taille) {
    lots.push(items.slice(i, i + taille))
  }
  return lots
}
