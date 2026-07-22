export type Lot = { id: string; lotNumber: string; expiryDate: string | null }

export type Variante = {
  id: string
  name: string
  attributes: string
  sku: string
  barcode: string | null
  priceOverride: number | null
  minPriceOverride: number | null
  isActive: boolean
  lots: Lot[]
}

export type Produit = {
  id: string
  name: string
  description: string | null
  categoryId: string | null
  sku: string
  barcode: string | null
  price: number
  minPrice: number | null
  defaultMinStock: number | null
  hasVariants: boolean
  trackLots: boolean
  imageKey: string | null
  isActive: boolean
  variants: Variante[]
}

export function lireAttributs(brut: string): Record<string, string> {
  try {
    return JSON.parse(brut) as Record<string, string>
  } catch {
    return {}
  }
}

/** One row of GET /products/:id/stock — per warehouse and variant. */
export type LigneStockProduit = {
  warehouseId: string
  warehouseName: string
  variantId: string
  variantName: string
  quantity: number
  avgCost: number
}
