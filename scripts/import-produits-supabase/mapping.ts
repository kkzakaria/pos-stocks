import { productCreateSchema  } from "shared"
import type {ProductCreateInput} from "shared";
import type { ProduitSource } from "./snapshot"

export function construireProduitCible(
  source: ProduitSource,
  categoryId: string
): ProductCreateInput {
  const prix = Math.round(source.price)
  const prixPlancherArrondi =
    source.min_price !== null ? Math.round(source.min_price) : null
  const minPrice =
    prixPlancherArrondi !== null &&
    prixPlancherArrondi > 0 &&
    prixPlancherArrondi < prix
      ? prixPlancherArrondi
      : undefined

  const payload: ProductCreateInput = {
    name: source.name,
    sku: source.sku,
    price: prix,
    categoryId,
    ...(source.description !== null ? { description: source.description } : {}),
    ...(minPrice !== undefined ? { minPrice } : {}),
    ...(source.min_stock_level !== null
      ? { defaultMinStock: source.min_stock_level }
      : {}),
  }

  // Valide contre le vrai schéma cible : une régression de mapping casse ce
  // test plutôt que d'échouer silencieusement (ou de manière confuse) côté
  // API pendant l'import réel des 744 produits.
  return productCreateSchema.parse(payload)
}

export function extraireNomsCategories(produits: ProduitSource[]): string[] {
  return [...new Set(produits.map((p) => p.category))].sort()
}
