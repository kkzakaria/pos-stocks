import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RapportVentes } from "@/rapports/rapport-ventes"
import * as rapports from "@/lib/rapports"
import { formaterMontant } from "@/lib/format"

// formaterMontant insère des espaces insécables (narrow no-break space côté
// ICU) : getByText(string) compare une chaîne normalisée (espaces classiques)
// à la chaîne brute — un match direct échoue selon la version d'ICU (même
// motif que pos/panier.test.tsx). On matche donc par regex : le normaliseur
// de Testing Library s'applique aux deux côtés lors d'une comparaison RegExp.
function texteMontant(montant: number): RegExp {
  const echappe = formaterMontant(montant)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+")
  return new RegExp(`^${echappe}$`)
}

const donneesBoutiques: rapports.RapportVentesBoutiques = {
  periode: { du: "2026-07-06", au: "2026-07-12" },
  groupe: "boutique",
  total: {
    ca: 3400,
    tickets: 3,
    panierMoyen: 1133,
    cash: 3100,
    mobileMoney: 300,
  },
  lignes: [
    {
      storeId: "s1",
      storeName: "Boutique Alpha",
      ca: 1400,
      tickets: 2,
      panierMoyen: 700,
      cash: 1100,
      mobileMoney: 300,
    },
  ],
}

const donneesProduits: rapports.RapportVentesProduits = {
  periode: { du: "2026-07-06", au: "2026-07-12" },
  groupe: "produit",
  total: {
    ca: 3400,
    tickets: 3,
    panierMoyen: 1133,
    cash: 3100,
    mobileMoney: 300,
  },
  lignes: [
    {
      productId: "p1",
      productName: "Cola",
      variantId: "v1",
      variantName: "Standard",
      sku: "SKU1",
      quantite: 7,
      ca: 3400,
      remise: 100,
      tickets: 3,
    },
  ],
}

function rendre() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <RapportVentes />
    </QueryClientProvider>
  )
}

describe("RapportVentes", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("affiche totaux et lignes par boutique (montants formatés)", async () => {
    vi.spyOn(rapports, "fetchRapportVentesBoutiques").mockResolvedValue(
      donneesBoutiques
    )
    rendre()
    await screen.findByText("Boutique Alpha")
    // Mêmes montants que l'API, passés par LE formateur du dépôt
    expect(screen.getByText(texteMontant(3400))).toBeDefined()
    expect(screen.getByText(texteMontant(1400))).toBeDefined()
    expect(screen.getByText("3 tickets")).toBeDefined()
  })

  it("bascule vers le groupement par produit", async () => {
    vi.spyOn(rapports, "fetchRapportVentesBoutiques").mockResolvedValue(
      donneesBoutiques
    )
    const spyProduits = vi
      .spyOn(rapports, "fetchRapportVentesProduits")
      .mockResolvedValue(donneesProduits)
    rendre()
    await screen.findByText("Boutique Alpha")
    fireEvent.click(screen.getByRole("button", { name: "Par produit" }))
    await screen.findByText("Cola")
    expect(spyProduits).toHaveBeenCalled()
    expect(screen.getByText("7")).toBeDefined()
  })

  it("Exporter CSV appelle telechargerCsv avec le chemin et le nom datés", async () => {
    vi.spyOn(rapports, "fetchRapportVentesBoutiques").mockResolvedValue(
      donneesBoutiques
    )
    const spyCsv = vi
      .spyOn(rapports, "telechargerCsv")
      .mockResolvedValue(undefined)
    rendre()
    await screen.findByText("Boutique Alpha")
    fireEvent.click(screen.getByRole("button", { name: "Exporter CSV" }))
    await waitFor(() => expect(spyCsv).toHaveBeenCalledTimes(1))
    const [path, nom] = spyCsv.mock.calls[0]
    expect(path).toContain("/api/v1/reports/sales?")
    expect(path).toContain("groupe=boutique")
    expect(path).toContain("format=csv")
    expect(nom).toMatch(
      /^rapport-ventes-boutiques_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/
    )
  })

  it("affiche l'erreur d'export sans casser l'écran", async () => {
    vi.spyOn(rapports, "fetchRapportVentesBoutiques").mockResolvedValue(
      donneesBoutiques
    )
    vi.spyOn(rapports, "telechargerCsv").mockRejectedValue(
      new Error("Export impossible (erreur 403)")
    )
    rendre()
    await screen.findByText("Boutique Alpha")
    fireEvent.click(screen.getByRole("button", { name: "Exporter CSV" }))
    await screen.findByRole("alert")
    expect(screen.getByText("Export impossible (erreur 403)")).toBeDefined()
  })
})
