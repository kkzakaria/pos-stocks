import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { SectionIdentite } from "@/components/produit/section-identite"
import { apiFetch } from "@/lib/api"
import type { Produit } from "@/components/produit/types"

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn((url: string) =>
    url === "/api/v1/categories"
      ? Promise.resolve({ categories: [{ id: "c1", name: "Outillage" }] })
      : Promise.resolve({})
  ),
  apiUrl: (chemin: string) => chemin,
}))

afterEach(() => vi.clearAllMocks())

const produit: Produit = {
  id: "p1",
  name: "Article",
  sku: "PRD-1",
  description: "Une description",
  categoryId: "c1",
  barcode: "123456",
  price: 5000,
  minPrice: null,
  defaultMinStock: null,
  hasVariants: false,
  isActive: true,
  trackLots: false,
  imageKey: null,
  variants: [],
}

function rendre(
  surcharges: Partial<Parameters<typeof SectionIdentite>[0]> = {}
) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SectionIdentite
        produit={produit}
        productId="p1"
        peutEcrire
        onModifie={() => Promise.resolve()}
        {...surcharges}
      />
    </QueryClientProvider>
  )
}

describe("SectionIdentite", () => {
  it("affiche catégorie, code-barres et description en lecture", async () => {
    rendre()
    expect(await screen.findByText("Outillage")).toBeTruthy()
    expect(screen.getByText("123456")).toBeTruthy()
    expect(screen.getByText("Une description")).toBeTruthy()
  })

  it("sans écriture : ni Modifier ni upload d'image", () => {
    rendre({ peutEcrire: false })
    expect(screen.queryByRole("button", { name: "Modifier" })).toBeNull()
    expect(screen.queryByText(/Choisir une image/)).toBeNull()
  })

  it("édition : PATCH partiel avec champs vides normalisés à null", async () => {
    const onModifie = vi.fn(() => Promise.resolve())
    rendre({ onModifie })
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }))
    fireEvent.change(screen.getByLabelText("Code-barres"), {
      target: { value: "" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }))
    await waitFor(() => expect(onModifie).toHaveBeenCalled())
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/products/p1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          name: "Article",
          description: "Une description",
          categoryId: "c1",
          barcode: null,
          isActive: true,
        }),
      })
    )
  })
})
