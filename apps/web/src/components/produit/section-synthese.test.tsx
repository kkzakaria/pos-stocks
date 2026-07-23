import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { SectionSynthese } from "@/components/produit/section-synthese"
import { formaterMontant } from "@/lib/format"
import { apiFetch } from "@/lib/api"
import type { Produit } from "@/components/produit/types"

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(() => Promise.resolve({})),
  apiUrl: (chemin: string) => chemin,
}))

afterEach(() => vi.clearAllMocks())

// Amounts use narrow no-break spaces (U+202F): match via regex so Testing
// Library's normalizer applies to both sides (same motif as pos tests).
function texteMontant(montant: number): RegExp {
  const echappe = formaterMontant(montant)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+")
  return new RegExp(`^${echappe}$`)
}

const produit: Produit = {
  id: "p1",
  name: "Article",
  sku: "PRD-1",
  description: null,
  categoryId: null,
  barcode: null,
  price: 5000,
  minPrice: 4000,
  defaultMinStock: 10,
  isActive: true,
  hasVariants: false,
  trackLots: false,
  imageKey: null,
  variants: [],
}

function rendre(
  surcharges: Partial<Parameters<typeof SectionSynthese>[0]> = {}
) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SectionSynthese
        produit={produit}
        productId="p1"
        peutEcrire
        devise="XOF"
        stockTotal={14}
        onModifie={() => Promise.resolve()}
        {...surcharges}
      />
    </QueryClientProvider>
  )
}

describe("SectionSynthese", () => {
  it("affiche prix, plancher, seuil et stock total", () => {
    rendre()
    expect(screen.getByText(texteMontant(5000))).toBeTruthy()
    expect(screen.getByText(texteMontant(4000))).toBeTruthy()
    expect(screen.getByText("10")).toBeTruthy()
    expect(screen.getByText("14")).toBeTruthy()
  })

  it("omet le stock total sans portée (null) et masque Modifier sans écriture", () => {
    rendre({ stockTotal: null, peutEcrire: false })
    expect(screen.queryByText("Stock total")).toBeNull()
    expect(screen.queryByRole("button", { name: "Modifier" })).toBeNull()
  })

  it("édition en place : Modifier → PATCH partiel → onModifie", async () => {
    const onModifie = vi.fn(() => Promise.resolve())
    rendre({ onModifie })
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }))
    fireEvent.change(screen.getByLabelText("Prix de vente"), {
      target: { value: "6000" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }))
    await waitFor(() => expect(onModifie).toHaveBeenCalled())
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/products/p1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          price: 6000,
          minPrice: 4000,
          defaultMinStock: 10,
        }),
      })
    )
  })

  it("Annuler restaure l'affichage sans PATCH", () => {
    rendre()
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }))
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }))
    expect(apiFetch).not.toHaveBeenCalled()
    expect(screen.getByText(texteMontant(5000))).toBeTruthy()
  })
})
