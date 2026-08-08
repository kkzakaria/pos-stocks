import { describe, it, expect, vi, afterEach } from "vitest"
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { installerMatchMedia } from "@/test/media-query"
import {
  COLONNES_MARGES,
  RapportMarges,
  sousTitreLigneMarge,
  titreLigneMarge,
  valeurLigneMarge,
} from "@/rapports/rapport-marges"
import * as rapports from "@/lib/rapports"
import type { LigneMarge } from "@/lib/rapports"
import { formaterMontant } from "@/lib/format"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"

// formaterMontant insère des espaces insécables (narrow no-break space côté
// ICU) : getByText(string) compare une chaîne normalisée (espaces classiques)
// à la chaîne brute — un match direct échoue selon la version d'ICU (même
// motif que rapport-ventes.test.tsx). On matche donc par regex : le
// normaliseur de Testing Library s'applique aux deux côtés lors d'une
// comparaison RegExp.
function texteMontant(montant: number): RegExp {
  const echappe = formaterMontant(montant)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+")
  return new RegExp(`^${echappe}$`)
}

const ligneNormale: LigneMarge = {
  productId: "p1",
  productName: "Cola",
  variantId: "v1",
  variantName: "Standard",
  sku: "SKU1",
  quantite: 7,
  ca: 3400,
  cout: 2000,
  marge: 1400,
  estime: false,
}

const ligneEstimee: LigneMarge = {
  productId: "p2",
  productName: "Fanta",
  variantId: "v2",
  variantName: "Standard",
  sku: "SKU2",
  quantite: 3,
  ca: 900,
  cout: 500,
  marge: 400,
  estime: true,
}

const donneesMarges: rapports.RapportMarges = {
  periode: { du: "2026-07-06", au: "2026-07-12" },
  total: { ca: 4300, cout: 2500, marge: 1800, estime: false },
  lignes: [ligneNormale, ligneEstimee],
}

function rendre() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <RapportMarges />
    </QueryClientProvider>
  )
}

describe("RapportMarges", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("affiche les tuiles et les lignes (montants formatés)", async () => {
    vi.spyOn(rapports, "fetchRapportMarges").mockResolvedValue(donneesMarges)
    rendre()
    await screen.findByText("Cola")
    expect(screen.getByText(texteMontant(4300))).toBeDefined()
    expect(screen.getByText(texteMontant(2500))).toBeDefined()
  })

  it("affiche le badge estimé sur la ligne concernée (table)", async () => {
    vi.spyOn(rapports, "fetchRapportMarges").mockResolvedValue(donneesMarges)
    rendre()
    await screen.findByText("Fanta")
    const ligneFanta = screen.getByText("Fanta").closest("tr")
    expect(ligneFanta).not.toBeNull()
    expect(ligneFanta && within(ligneFanta).getByText("estimé")).toBeDefined()
    const ligneCola = screen.getByText("Cola").closest("tr")
    expect(ligneCola).not.toBeNull()
    expect(ligneCola && within(ligneCola).queryByText("estimé")).toBeNull()
  })

  it("Exporter CSV appelle telechargerCsv avec le chemin et le nom datés", async () => {
    vi.spyOn(rapports, "fetchRapportMarges").mockResolvedValue(donneesMarges)
    const spyCsv = vi
      .spyOn(rapports, "telechargerCsv")
      .mockResolvedValue(undefined)
    rendre()
    await screen.findByText("Cola")
    fireEvent.click(screen.getByRole("button", { name: "Exporter CSV" }))
    await waitFor(() => expect(spyCsv).toHaveBeenCalledTimes(1))
    const [path, nom] = spyCsv.mock.calls[0]
    expect(path).toContain("/api/v1/reports/margins?")
    expect(path).toContain("format=csv")
    expect(nom).toMatch(
      /^rapport-marges_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/
    )
  })
})

describe("colonnes du rapport des marges", () => {
  function afficher(largeur: number, lignes: LigneMarge[]) {
    const nettoyer = installerMatchMedia(largeur)
    render(
      <ListeAdaptative<LigneMarge>
        colonnes={COLONNES_MARGES}
        lignes={lignes}
        cleLigne={(ligne) => ligne.variantId}
        titre={titreLigneMarge}
        valeur={valeurLigneMarge}
        sousTitre={sousTitreLigneMarge}
      />
    )
    return nettoyer
  }

  it("expose 7 colonnes", () => {
    expect(COLONNES_MARGES).toHaveLength(7)
  })

  it("rend les 7 en-têtes en table à 1280 px", () => {
    const nettoyer = afficher(1280, [ligneNormale])
    for (const entete of [
      "Produit",
      "Variante",
      "SKU",
      "Quantité",
      "CA",
      "Coût",
      "Marge",
    ]) {
      expect(screen.getByText(entete)).toBeTruthy()
    }
    nettoyer()
  })

  it("le badge estimé reste visible en table pour une ligne estimée", () => {
    const nettoyer = afficher(1280, [ligneEstimee])
    expect(screen.getByText("estimé")).toBeTruthy()
    nettoyer()
  })

  // Colonnes masquées en carte : produit (→ titre), sku (→ sousTitre) et
  // marge (→ valeur). Les colonnes VISIBLES en carte (variante, quantité,
  // CA, coût) passent par les paires libellé/valeur par construction — les
  // asserter ne prouverait rien sur la logique masquerEnCarte elle-même.
  it("ne perd aucune donnée en mode carte : produit, SKU et marge masqués resurgissent, sans doublon", () => {
    const nettoyer = afficher(375, [ligneNormale])
    const carte = screen.getAllByRole("listitem")[0]

    // "produit" → titre.
    expect(carte.textContent).toContain("Cola")
    // "sku" → sousTitre.
    expect(carte.textContent).toContain("SKU1")
    // "marge" → valeur : rendu une seule fois (pas de doublon dt/dd).
    expect(within(carte).getAllByText(texteMontant(1400))).toHaveLength(1)

    nettoyer()
  })

  it("le badge estimé reste visible en mode carte pour une ligne estimée", () => {
    const nettoyer = afficher(375, [ligneEstimee])
    const carte = screen.getAllByRole("listitem")[0]
    expect(within(carte).getByText("estimé")).toBeDefined()
    nettoyer()
  })
})
