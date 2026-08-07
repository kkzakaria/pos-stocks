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
  reason: "Casse",
  refType: null,
  refId: null,
  userName: "Awa",
  lotNumber: "LOT-042",
}

function afficher(largeur: number) {
  const nettoyer = installerMatchMedia(largeur)
  render(
    <ListeAdaptative<MouvementJournal>
      colonnes={COLONNES_MOUVEMENTS}
      lignes={[M]}
      cleLigne={(m) => m.id}
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

  it("ne perd aucune donnée en mode carte : les 3 colonnes masquées resurgissent, les 5 autres restent en paires", () => {
    const nettoyer = afficher(375)
    const carte = screen.getAllByRole("listitem")[0]

    // Colonnes masquerEnCarte: true — doivent resurgir via titre/valeur/sous-titre,
    // sans quoi cette donnée serait masquée par la largeur d'écran.
    // "date" → sousTitreMouvement : fragment stable de la locale fr-FR (l'année).
    expect(carte.textContent).toContain("2026")
    // "article" → titreMouvement : le nom du produit ET le fragment variante/SKU.
    expect(carte.textContent).toContain("Ciment 50kg")
    expect(carte.textContent).toContain("Sac (CIM-50)")
    // "delta" → valeurMouvement : le delta signé en tête de carte.
    expect(carte.textContent).toContain("+12")

    // Colonnes non masquées — passent par `paires`, jamais masquées par construction,
    // mais toujours vérifiées pour garder la couverture explicite.
    expect(carte.textContent).toContain("Boutique Centre")
    expect(carte.textContent).toContain("Réception")
    expect(carte.textContent).toContain("LOT-042")
    expect(carte.textContent).toContain("Casse")
    expect(carte.textContent).toContain("Awa")
    nettoyer()
  })
})
