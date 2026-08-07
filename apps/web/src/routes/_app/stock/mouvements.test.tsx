import { render, screen } from "@testing-library/react"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import { installerMatchMedia } from "@/test/media-query"
import {
  COLONNES_MOUVEMENTS,
  titreMouvement,
  valeurMouvement,
  sousTitreMouvement,
} from "./mouvements"
import type { MouvementJournal } from "@/lib/stock"

const M: MouvementJournal = {
  id: "m1",
  createdAt: "2026-08-07T10:30:00.000Z",
  warehouseId: "w1",
  warehouseName: "Boutique Centre",
  variantId: "v1",
  productName: "Ciment 50kg",
  variantName: "Sac",
  sku: "CIM-50",
  delta: 12,
  type: "purchase",
  reason: null,
  refType: null,
  refId: null,
  userName: "Awa",
  lotNumber: null,
}

function afficher(largeur: number) {
  const nettoyer = installerMatchMedia(largeur)
  render(
    <ListeAdaptative<MouvementJournal>
      colonnes={COLONNES_MOUVEMENTS}
      lignes={[M]}
      cle={(m) => m.id}
      titre={titreMouvement}
      valeur={valeurMouvement}
      sousTitre={sousTitreMouvement}
    />
  )
  return nettoyer
}

describe("colonnes du journal des mouvements", () => {
  it("expose les 8 colonnes du journal", () => {
    expect(COLONNES_MOUVEMENTS).toHaveLength(8)
  })

  it("rend les 8 colonnes en table à 1280 px", () => {
    const nettoyer = afficher(1280)
    for (const entete of [
      "Date",
      "Entrepôt",
      "Article",
      "Type",
      "Delta",
      "Lot",
      "Motif",
      "Par",
    ]) {
      expect(screen.getByText(entete)).toBeTruthy()
    }
    nettoyer()
  })

  it("montre l'article en titre et le delta signé en valeur à 375 px", () => {
    const nettoyer = afficher(375)
    const carte = screen.getAllByRole("listitem")[0]
    expect(carte.textContent).toContain("Ciment 50kg")
    expect(carte.textContent).toContain("+12")
    nettoyer()
  })

  it("ne perd aucune donnée en mode carte", () => {
    const nettoyer = afficher(375)
    const carte = screen.getAllByRole("listitem")[0]
    // Toutes les valeurs restent lisibles : rien n'est masqué par la largeur.
    expect(carte.textContent).toContain("Boutique Centre")
    expect(carte.textContent).toContain("Réception")
    expect(carte.textContent).toContain("Awa")
    nettoyer()
  })
})
