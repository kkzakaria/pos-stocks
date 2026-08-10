import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { installerMatchMedia } from "@/test/media-query"
import {
  COLONNES_VALORISATION,
  RapportValorisation,
  sousTitreLigneValorisation,
  titreLigneValorisation,
  valeurLigneValorisation,
} from "@/rapports/rapport-valorisation"
import * as rapports from "@/lib/rapports"
import type { LigneValorisation } from "@/lib/rapports"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import { texteMontant } from "@/test/texte-montant"
import { valeurPaire } from "@/test/valeur-paire"

const ligneCiment: LigneValorisation = {
  variantId: "v1",
  productName: "Ciment 50kg",
  variantName: "Sac",
  sku: "CIM-50",
  quantity: 12,
  avgCost: 4000,
  valeur: 48000,
}

const ligneSable: LigneValorisation = {
  variantId: "v2",
  productName: "Sable fin",
  variantName: "Standard",
  sku: "SAB-01",
  quantity: 5,
  avgCost: 2000,
  valeur: 10000,
}

const ligneGravier: LigneValorisation = {
  variantId: "v3",
  productName: "Gravier",
  variantName: "Standard",
  sku: "GRA-01",
  quantity: 3,
  avgCost: 5000,
  valeur: 15000,
}

const ligneFer: LigneValorisation = {
  variantId: "v4",
  productName: "Fer à béton",
  variantName: "8mm",
  sku: "FER-08",
  quantity: 1,
  avgCost: 6000,
  valeur: 6000,
}

// Each warehouse holds two lines on purpose: with a single line, its header
// total would equal that line's value, and an assertion on the total could
// not tell the two apart. Every figure below is distinct for the same reason.
const donnees: rapports.RapportValorisation = {
  total: 79000,
  entrepots: [
    {
      warehouseId: "w1",
      warehouseName: "Boutique Centre",
      valeur: 58000,
      lignes: [ligneCiment, ligneSable],
    },
    {
      warehouseId: "w2",
      warehouseName: "Dépôt central",
      valeur: 21000,
      lignes: [ligneGravier, ligneFer],
    },
  ],
}

function rendre() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <RapportValorisation />
    </QueryClientProvider>
  )
}

function afficherListe(largeur: number) {
  const nettoyer = installerMatchMedia(largeur)
  render(
    <ListeAdaptative<LigneValorisation>
      colonnes={COLONNES_VALORISATION}
      lignes={[ligneCiment]}
      cleLigne={(l) => l.variantId}
      titre={titreLigneValorisation}
      valeur={valeurLigneValorisation}
      sousTitre={sousTitreLigneValorisation}
    />
  )
  return nettoyer
}

describe("RapportValorisation", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("rend une liste distincte par entrepôt", async () => {
    vi.spyOn(rapports, "fetchRapportValorisation").mockResolvedValue(donnees)
    rendre()
    await screen.findByText("Boutique Centre")
    expect(screen.getByText("Dépôt central")).toBeDefined()
    // One <section> per warehouse, each with its own list.
    expect(document.querySelectorAll("section")).toHaveLength(2)
    const sections = document.querySelectorAll("section")
    // Each warehouse's lines belong to its own section, never mixed.
    expect(within(sections[0]).getByText("Ciment 50kg")).toBeDefined()
    expect(within(sections[0]).getByText("Sable fin")).toBeDefined()
    expect(within(sections[1]).getByText("Gravier")).toBeDefined()
    expect(within(sections[1]).queryByText("Ciment 50kg")).toBeNull()
  })

  // Asserted at both tiers on purpose: the per-warehouse total is the figure
  // the user opens this screen for. The section header lives outside
  // `ListeAdaptative` so it should not depend on the breakpoint — this proves
  // it rather than leaving it to code reading.
  for (const largeur of [1280, 375]) {
    it(`garde la valeur totale de chaque entrepôt visible à ${largeur} px`, async () => {
      const nettoyer = installerMatchMedia(largeur)
      vi.spyOn(rapports, "fetchRapportValorisation").mockResolvedValue(donnees)
      rendre()
      await screen.findByText("Boutique Centre")
      const sections = document.querySelectorAll("section")
      expect(within(sections[0]).getByText(texteMontant(58000))).toBeDefined()
      expect(within(sections[1]).getByText(texteMontant(21000))).toBeDefined()
      // And the grand total above the sections.
      expect(screen.getByText(texteMontant(79000))).toBeDefined()
      nettoyer()
    })
  }
})

describe("COLONNES_VALORISATION", () => {
  it("expose les 6 colonnes du rapport", () => {
    expect(COLONNES_VALORISATION).toHaveLength(6)
  })

  it("rend les 6 en-têtes en table à 1280 px", () => {
    const nettoyer = afficherListe(1280)
    for (const entete of [
      "Produit",
      "Variante",
      "SKU",
      "Quantité",
      "CMP",
      "Valeur",
    ]) {
      expect(screen.getByText(entete)).toBeDefined()
    }
    nettoyer()
  })

  it("ne perd aucune donnée en mode carte : les 3 colonnes masquées resurgissent", () => {
    const nettoyer = afficherListe(375)
    const carte = screen.getAllByRole("listitem")[0]
    // Only masquerEnCarte columns can vanish — the visible ones go through
    // the label/value pairs by construction, so asserting them proves nothing.
    expect(carte.textContent).toContain("Ciment 50kg") // produit -> titre
    expect(carte.textContent).toContain("CIM-50") // sku -> sousTitre
    expect(within(carte).getByText(texteMontant(48000))).toBeDefined() // valeur
    nettoyer()
  })

  it("n'affiche la valeur de ligne qu'une seule fois par carte", () => {
    const nettoyer = afficherListe(375)
    const carte = screen.getAllByRole("listitem")[0]
    expect(within(carte).getAllByText(texteMontant(48000))).toHaveLength(1)
    nettoyer()
  })

  it("garde les colonnes visibles en paires libellé/valeur", () => {
    const nettoyer = afficherListe(375)
    const carte = screen.getAllByRole("listitem")[0]
    expect(valeurPaire(carte, "Variante")).toBe("Sac")
    expect(valeurPaire(carte, "Quantité")).toBe("12")
    expect(within(carte).getByText(texteMontant(4000))).toBeDefined() // CMP
    nettoyer()
  })
})
