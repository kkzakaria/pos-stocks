import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { FicheProduit } from "@/routes/_app/catalogue/produits/$productId"
import { jetons } from "@/test/jetons"
import type * as ReactRouter from "@tanstack/react-router"

const produitBase = {
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

// Mutable so one case can serve a hostile name/SKU without disturbing the
// fixture the other cases assert on; restored in afterEach.
let produit = produitBase

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

vi.mock("@/lib/permissions", () => ({
  usePeutEcrire: () => true,
  useAccesStock: () => ({
    lecture: true,
    lectureTous: true,
    entrepotsLecture: [],
    ecritureTous: true,
    entrepotsEcriture: [],
  }),
}))
// The route file's Link needs a router context: mock the bare minimum.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original = await importOriginal<typeof ReactRouter>()
  return {
    ...original,
    Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
    createFileRoute: () => () => ({
      useParams: () => ({ productId: "p1" }),
      useSearch: () => ({}),
    }),
  }
})

afterEach(() => {
  vi.clearAllMocks()
  produit = produitBase
})

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

  it("en-tête : un nom et un SKU insécables portent les classes qui les retiennent", async () => {
    produit = {
      ...produitBase,
      name: "Boulonhexagonalgalvaniséàtêterondeinoxdiamètredouzemillimètres",
      sku: "PRD20260414XJGZREFERENCEFOURNISSEURSANSTIRETNIESPACE0001",
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <FicheProduit productId="p1" />
      </QueryClientProvider>
    )

    const titre = await screen.findByRole("heading", { level: 1 })
    const sku = screen.getByText(produit.sku)

    // Name and SKU are free user text laid out in a ROW flex container, where
    // `min-width: auto` resolves to min-content: a single unbreakable token
    // pins the item at its own width and pushes the whole document sideways
    // (measured 813 px of document scroll width at a 375 px viewport).
    // `min-w-0` lets the item shrink to the line, `break-words` breaks the
    // token, and `flex-wrap` drops the SKU and the badge to a second line
    // rather than crushing the title.
    //
    // jsdom has neither layout engine nor CSS cascade: no stylesheet is loaded,
    // so `getComputedStyle` never resolves a Tailwind utility and
    // offsetWidth/scrollWidth are constantly 0. This case therefore guards only
    // that the classes are PRESENT on the right nodes — that they actually stop
    // the overflow is measured in the end-of-branch browser check.
    const entete = titre.parentElement

    // The ROW direction is the premise of the whole case, so assert it rather
    // than describe it: `min-w-0` only does anything on the MAIN axis. Turn the
    // header into `flex flex-col flex-wrap sm:flex-row` and `min-width: auto`
    // moves to the cross axis where it already computes to 0 — the two
    // `min-w-0` below become pure no-ops while still passing.
    expect(jetons(entete)).toContain("flex")
    expect(jetons(entete)).not.toContain("flex-col")
    expect(jetons(entete)).toContain("flex-wrap")
    expect(jetons(titre)).toContain("min-w-0")
    expect(jetons(titre)).toContain("break-words")
    expect(jetons(sku)).toContain("min-w-0")
    expect(jetons(sku)).toContain("break-words")
  })
})
