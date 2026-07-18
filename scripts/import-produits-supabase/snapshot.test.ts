import { describe, test, expect } from "bun:test"
import { writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { chargerSnapshot } from "./snapshot"

const LIGNE_VALIDE = {
  id: "a1",
  sku: "SKU-1",
  name: "Produit 1",
  description: null,
  price: 1000,
  min_price: null,
  max_price: null,
  min_stock_level: 5,
  image_url: null,
  is_active: true,
  category: "Divers / à classer",
}

function ecrireSnapshotTemporaire(produits: unknown[]): string {
  const dossier = mkdtempSync(path.join(tmpdir(), "snapshot-test-"))
  const fichier = path.join(dossier, "produits.json")
  writeFileSync(fichier, JSON.stringify(produits))
  return fichier
}

describe("chargerSnapshot", () => {
  test("charge un snapshot valide", () => {
    const fichier = ecrireSnapshotTemporaire([LIGNE_VALIDE])
    const produits = chargerSnapshot(fichier)
    expect(produits).toHaveLength(1)
    expect(produits[0]?.sku).toBe("SKU-1")
  })

  test("rejette un SKU dupliqué", () => {
    const fichier = ecrireSnapshotTemporaire([
      LIGNE_VALIDE,
      { ...LIGNE_VALIDE, id: "a2" },
    ])
    expect(() => chargerSnapshot(fichier)).toThrow("SKU dupliqué")
  })

  test("rejette une ligne invalide (prix manquant)", () => {
    const fichier = ecrireSnapshotTemporaire([
      { id: "a1", sku: "SKU-1", name: "x" },
    ])
    expect(() => chargerSnapshot(fichier)).toThrow()
  })

  test("charge le vrai snapshot exporté (744 produits)", () => {
    const cheminReel = path.join(
      import.meta.dir,
      "data",
      "produits-supabase.json"
    )
    const produits = chargerSnapshot(cheminReel)
    expect(produits).toHaveLength(744)
  })
})
