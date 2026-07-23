import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { SectionVariantes } from "@/components/produit/section-variantes"
import type { Produit } from "@/components/produit/types"

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(() => Promise.resolve({})),
  apiUrl: (chemin: string) => chemin,
}))

afterEach(() => vi.clearAllMocks())

function produitAvec(trackLots: boolean): Produit {
  return {
    id: "p1",
    name: "Article",
    sku: "PRD-1",
    description: null,
    categoryId: null,
    barcode: null,
    price: 5000,
    minPrice: null,
    defaultMinStock: null,
    hasVariants: true,
    isActive: true,
    trackLots,
    imageKey: null,
    variants: [
      {
        id: "v1",
        name: "Standard",
        sku: "PRD-1-STD",
        attributes: "{}",
        barcode: null,
        priceOverride: null,
        minPriceOverride: null,
        isActive: true,
        lots: [
          { id: "l1", lotNumber: "LOT-A", expiryDate: "2020-01-01" },
          { id: "l2", lotNumber: "LOT-B", expiryDate: null },
        ],
      },
    ],
  }
}

function rendre(produit: Produit) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SectionVariantes
        produit={produit}
        productId="p1"
        peutEcrire
        devise="XOF"
        onModifie={() => Promise.resolve()}
      />
    </QueryClientProvider>
  )
}

describe("SectionVariantes — lots imbriqués", () => {
  it("trackLots : les lots s'affichent sous leur variante, avec badge Expiré", () => {
    rendre(produitAvec(true))
    expect(screen.getByText("LOT-A")).toBeTruthy()
    expect(screen.getByText("LOT-B")).toBeTruthy()
    expect(screen.getByText("Expiré")).toBeTruthy()
    expect(screen.getByText("sans péremption")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Ajouter un lot" })).toBeTruthy()
  })

  it("sans trackLots : aucune ligne de lots", () => {
    rendre(produitAvec(false))
    expect(screen.queryByText("LOT-A")).toBeNull()
    expect(screen.queryByRole("button", { name: "Ajouter un lot" })).toBeNull()
  })
})
