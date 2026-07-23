import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { SectionStock } from "@/components/produit/section-stock"
import { formaterMontant } from "@/lib/format"
import type { LigneStockProduit } from "@/components/produit/types"

function texteMontant(montant: number): RegExp {
  const echappe = formaterMontant(montant)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+")
  return new RegExp(`^${echappe}$`)
}

const lignes: LigneStockProduit[] = [
  {
    warehouseId: "w1",
    warehouseName: "Boutique S",
    variantId: "v1",
    variantName: "Standard",
    quantity: 4,
    avgCost: 300,
  },
  {
    warehouseId: "w2",
    warehouseName: "Dépôt Central",
    variantId: "v1",
    variantName: "Standard",
    quantity: 10,
    avgCost: 200,
  },
]

describe("SectionStock", () => {
  it("liste entrepôts, quantités, CMP et total ; une seule variante → pas de colonne Variante", () => {
    render(
      <SectionStock
        lignes={lignes}
        enChargement={false}
        devise="XOF"
        plusieursVariantes={false}
      />
    )
    expect(screen.getByText("Boutique S")).toBeTruthy()
    expect(screen.getByText("10")).toBeTruthy()
    expect(screen.getByText(texteMontant(200))).toBeTruthy()
    // Line values: 4 × 300 = 1 200 and 10 × 200 = 2 000
    expect(screen.getByText(texteMontant(1200))).toBeTruthy()
    expect(screen.getByText(texteMontant(2000))).toBeTruthy()
    // Totals: 14 units, value 1 200 + 2 000 = 3 200
    expect(screen.getByText("14")).toBeTruthy()
    expect(screen.getByText(texteMontant(3200))).toBeTruthy()
    expect(screen.queryByText("Variante")).toBeNull()
  })

  it("plusieurs variantes → colonne Variante visible", () => {
    render(
      <SectionStock
        lignes={[
          ...lignes,
          {
            warehouseId: "w1",
            warehouseName: "Boutique S",
            variantId: "v2",
            variantName: "Grand",
            quantity: 2,
            avgCost: 500,
          },
        ]}
        enChargement={false}
        devise="XOF"
        plusieursVariantes
      />
    )
    expect(screen.getByText("Variante")).toBeTruthy()
    expect(screen.getByText("Grand")).toBeTruthy()
  })

  it("liste vide → état vide", () => {
    render(
      <SectionStock
        lignes={[]}
        enChargement={false}
        devise="XOF"
        plusieursVariantes={false}
      />
    )
    expect(
      screen.getByText(/Aucun stock visible pour ce produit\./)
    ).toBeTruthy()
  })
})
