import { readFileSync } from "node:fs"
import { z } from "zod"

export const produitSourceSchema = z.object({
  id: z.string().min(1),
  sku: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).nullable(),
  price: z.number(),
  min_price: z.number().nullable(),
  max_price: z.number().nullable(),
  min_stock_level: z.number().nullable(),
  image_url: z.string().min(1).nullable(),
  is_active: z.boolean(),
  category: z.string().min(1),
})

export type ProduitSource = z.infer<typeof produitSourceSchema>

export function chargerSnapshot(cheminFichier: string): ProduitSource[] {
  const contenu = readFileSync(cheminFichier, "utf-8")
  const brut: unknown = JSON.parse(contenu)
  const produits = z.array(produitSourceSchema).parse(brut)

  const skusVus = new Set<string>()
  for (const produit of produits) {
    if (skusVus.has(produit.sku)) {
      throw new Error(`SKU dupliqué dans le snapshot : ${produit.sku}`)
    }
    skusVus.add(produit.sku)
  }

  return produits
}
