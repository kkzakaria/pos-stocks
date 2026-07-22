import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { FicheProduit } from "@/routes/_app/catalogue/produits/$productId"
import type * as ReactRouter from "@tanstack/react-router"

const produit = {
  id: "p1",
  name: "Article Fiche",
  sku: "PRD-1",
  description: null,
  categoryId: null,
  barcode: null,
  price: 5000,
  minPrice: null,
  defaultMinStock: null,
  isActive: true,
  hasVariants: false,
  trackLots: false,
  imageKey: null,
  variants: [],
}

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn((url: string) => {
    if (url === "/api/v1/products/p1")
      return Promise.resolve({ product: produit })
    if (url === "/api/v1/products/p1/stock")
      return Promise.resolve({
        stock: [
          {
            warehouseId: "w1",
            warehouseName: "Dépôt",
            variantId: "v1",
            variantName: "Standard",
            quantity: 14,
            avgCost: 200,
          },
        ],
      })
    if (url === "/api/v1/organization")
      return Promise.resolve({ currency: "XOF" })
    if (url === "/api/v1/categories") return Promise.resolve({ categories: [] })
    return Promise.resolve({})
  }),
  apiUrl: (chemin: string) => chemin,
}))

vi.mock("@/lib/permissions", () => ({ usePeutEcrire: () => true }))
// The route file's Link needs a router context: mock the bare minimum.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original = await importOriginal<typeof ReactRouter>()
  return {
    ...original,
    Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
    createFileRoute: () => () => ({ useParams: () => ({ productId: "p1" }) }),
  }
})

afterEach(() => vi.clearAllMocks())

describe("FicheProduit", () => {
  it("affiche en-tête, synthèse, stock et variantes", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <FicheProduit productId="p1" />
      </QueryClientProvider>
    )
    expect(await screen.findByText("Article Fiche")).toBeTruthy()
    expect(screen.getByText("PRD-1")).toBeTruthy()
    expect(await screen.findByText("Stock par entrepôt")).toBeTruthy()
    // Quantity (14) also equals the stock total and the table footer total
    // in this fixture, so several elements legitimately show "14".
    expect((await screen.findAllByText("14")).length).toBeGreaterThan(0)
    expect(screen.getByText("Variantes")).toBeTruthy()
  })
})
