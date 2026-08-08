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
  COLONNES_VENTES_BOUTIQUE,
  COLONNES_VENTES_PRODUIT,
  RapportVentes,
  sousTitreLigneVentesProduit,
  titreLigneVentesBoutique,
  titreLigneVentesProduit,
  valeurLigneVentesBoutique,
  valeurLigneVentesProduit,
} from "@/rapports/rapport-ventes"
import type { LigneVentesBoutiqueAffichee } from "@/rapports/rapport-ventes"
import * as rapports from "@/lib/rapports"
import { formaterMontant } from "@/lib/format"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"

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

describe("colonnes du rapport des ventes par boutique", () => {
  const LIGNE: LigneVentesBoutiqueAffichee = {
    ...donneesBoutiques.lignes[0],
    totalCa: donneesBoutiques.total.ca,
  }

  function afficher(largeur: number) {
    const nettoyer = installerMatchMedia(largeur)
    render(
      <ListeAdaptative<LigneVentesBoutiqueAffichee>
        colonnes={COLONNES_VENTES_BOUTIQUE}
        lignes={[LIGNE]}
        cleLigne={(ligne) => ligne.storeId}
        titre={titreLigneVentesBoutique}
        valeur={valeurLigneVentesBoutique}
      />
    )
    return nettoyer
  }

  it("expose 6 colonnes", () => {
    expect(COLONNES_VENTES_BOUTIQUE).toHaveLength(6)
  })

  it("rend les 6 en-têtes en table à 1280 px", () => {
    const nettoyer = afficher(1280)
    for (const entete of [
      "Boutique",
      "CA",
      "Tickets",
      "Panier moyen",
      "Espèces",
      "Mobile money",
    ]) {
      expect(screen.getByText(entete)).toBeTruthy()
    }
    nettoyer()
  })

  it("ne perd aucune donnée en mode carte : la boutique masquée resurgit en titre", () => {
    const nettoyer = afficher(375)
    const carte = screen.getAllByRole("listitem")[0]

    // "boutique" is the only masquerEnCarte column of this table — the CA
    // column is deliberately left visible (its BarreProportion belongs in
    // card mode too), so it is not a resurfacing concern here.
    expect(carte.textContent).toContain("Boutique Alpha")

    nettoyer()
  })
})

describe("colonnes du rapport des ventes par produit", () => {
  const LIGNE: rapports.LigneVentesProduit = donneesProduits.lignes[0]

  function afficher(largeur: number) {
    const nettoyer = installerMatchMedia(largeur)
    render(
      <ListeAdaptative<rapports.LigneVentesProduit>
        colonnes={COLONNES_VENTES_PRODUIT}
        lignes={[LIGNE]}
        cleLigne={(ligne) => ligne.variantId}
        titre={titreLigneVentesProduit}
        valeur={valeurLigneVentesProduit}
        sousTitre={sousTitreLigneVentesProduit}
      />
    )
    return nettoyer
  }

  it("expose 7 colonnes", () => {
    expect(COLONNES_VENTES_PRODUIT).toHaveLength(7)
  })

  it("rend les 7 en-têtes en table à 1280 px", () => {
    const nettoyer = afficher(1280)
    for (const entete of [
      "Produit",
      "Variante",
      "SKU",
      "Quantité",
      "CA",
      "Remises",
      "Tickets",
    ]) {
      expect(screen.getByText(entete)).toBeTruthy()
    }
    nettoyer()
  })

  it("ne perd aucune donnée en mode carte : produit, SKU et CA masqués resurgissent", () => {
    const nettoyer = afficher(375)
    const carte = screen.getAllByRole("listitem")[0]

    // "produit" → titreLigneVentesProduit.
    expect(carte.textContent).toContain("Cola")
    // "ca" → valeurLigneVentesProduit: formatted amount at the top of the
    // card. texteMontant is anchored to a single element's full text, so it
    // targets the headline <span> rather than the card's whole textContent.
    expect(within(carte).getByText(texteMontant(3400))).toBeDefined()
    // "sku" → sousTitreLigneVentesProduit.
    expect(carte.textContent).toContain("SKU1")

    nettoyer()
  })
})
