import { describe, test, expect } from "bun:test"
import { construireProduitCible, extraireNomsCategories } from "./mapping"
import type { ProduitSource } from "./snapshot"

function produit(overrides: Partial<ProduitSource> = {}): ProduitSource {
  return {
    id: "a1",
    sku: "SKU-1",
    name: "Produit test",
    description: null,
    price: 1000,
    min_price: null,
    max_price: null,
    min_stock_level: 5,
    image_url: null,
    is_active: true,
    category: "Divers / à classer",
    ...overrides,
  }
}

describe("construireProduitCible", () => {
  test("arrondit le prix et omet minPrice quand absent", () => {
    const resultat = construireProduitCible(produit({ price: 3500.3 }), "cat-1")
    expect(resultat.price).toBe(3500)
    expect(resultat.minPrice).toBeUndefined()
  })

  test("inclut minPrice arrondi quand strictement inférieur au prix", () => {
    const resultat = construireProduitCible(
      produit({ price: 5000, min_price: 4000.6 }),
      "cat-1"
    )
    expect(resultat.minPrice).toBe(4001)
  })

  test("omet minPrice quand égal au prix (prix fixe côté cible)", () => {
    const resultat = construireProduitCible(
      produit({ price: 2000, min_price: 2000 }),
      "cat-1"
    )
    expect(resultat.minPrice).toBeUndefined()
  })

  test("omet description quand nulle côté source", () => {
    const resultat = construireProduitCible(
      produit({ description: null }),
      "cat-1"
    )
    expect(resultat.description).toBeUndefined()
  })

  test("conserve description quand présente", () => {
    const resultat = construireProduitCible(
      produit({ description: "Un vrai texte" }),
      "cat-1"
    )
    expect(resultat.description).toBe("Un vrai texte")
  })

  test("reporte categoryId, sku et defaultMinStock tels quels", () => {
    const resultat = construireProduitCible(
      produit({ sku: "PRD-1", min_stock_level: 12 }),
      "cat-42"
    )
    expect(resultat.categoryId).toBe("cat-42")
    expect(resultat.sku).toBe("PRD-1")
    expect(resultat.defaultMinStock).toBe(12)
  })

  test("rejette un prix invalide (0) via le schéma cible", () => {
    expect(() =>
      construireProduitCible(produit({ price: 0 }), "cat-1")
    ).toThrow()
  })
})

describe("extraireNomsCategories", () => {
  test("dédoublonne et trie les catégories", () => {
    const noms = extraireNomsCategories([
      produit({ category: "B" }),
      produit({ category: "A" }),
      produit({ category: "B" }),
    ])
    expect(noms).toEqual(["A", "B"])
  })
})
