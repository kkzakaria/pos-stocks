import { render, screen, within } from "@testing-library/react"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import { installerMatchMedia } from "@/test/media-query"
import { texteMontant } from "@/test/texte-montant"
import {
  COLONNES_LIGNES_VENTE,
  titreLigneVente,
  valeurLigneVente,
  sousTitreLigneVente,
} from "./$saleId"
import type { LigneVenteAffichee } from "./$saleId"

const ITEM: LigneVenteAffichee = {
  id: "li1",
  variantId: "v1",
  productName: "Riz parfumé 5kg",
  variantName: "Standard",
  sku: "RIZ-5KG",
  quantity: 2,
  unitPrice: 4500,
  catalogPrice: 5000,
  sourceWarehouseId: "w1",
  sourceWarehouseName: "Entrepôt central",
  lotNumber: "LOT-42",
  currency: "XOF",
}

const ITEM_VARIANTE: LigneVenteAffichee = {
  ...ITEM,
  id: "li2",
  productName: "T-shirt",
  variantName: "Bleu / M",
}

/**
 * Card mode renders non-hidden columns as `<dt>`/`<dd>` pairs inside a
 * `<dl>` — reading the `<dd>` next to a given `<dt>` label targets that
 * specific pair instead of the whole card's `textContent`, which other
 * fields can satisfy by coincidence.
 */
function valeurPaire(carte: HTMLElement, libelle: string): string {
  const dt = within(carte).getByText(libelle)
  const dd = dt.nextElementSibling
  if (!(dd instanceof HTMLElement)) {
    throw new Error(`Aucune <dd> associée au libellé « ${libelle} »`)
  }
  return dd.textContent
}

function afficher(largeur: number, lignes: LigneVenteAffichee[] = [ITEM]) {
  const nettoyer = installerMatchMedia(largeur)
  render(
    <ListeAdaptative<LigneVenteAffichee>
      colonnes={COLONNES_LIGNES_VENTE}
      lignes={lignes}
      cleLigne={(item) => item.id}
      titre={titreLigneVente}
      valeur={valeurLigneVente}
      sousTitre={sousTitreLigneVente}
    />
  )
  return nettoyer
}

describe("colonnes du détail de vente", () => {
  it("expose 8 colonnes", () => {
    expect(COLONNES_LIGNES_VENTE).toHaveLength(8)
  })

  it("rend les 8 en-têtes en table à 1280 px", () => {
    const nettoyer = afficher(1280)
    for (const entete of [
      "Article",
      "SKU",
      "Qté",
      "PU appliqué",
      "Prix catalogue",
      "Remise",
      "Source",
      "Lot",
    ]) {
      expect(screen.getByText(entete)).toBeTruthy()
    }
    nettoyer()
  })

  it("porte l'article en titre et le PU appliqué en valeur à 375 px", () => {
    const nettoyer = afficher(375)
    const carte = screen.getAllByRole("listitem")[0]
    expect(carte.textContent).toContain("Riz parfumé 5kg")
    expect(within(carte).getByText(texteMontant(4500))).toBeDefined()
    nettoyer()
  })

  it("ajoute la variante au titre quand elle n'est pas « Standard »", () => {
    const nettoyer = afficher(375, [ITEM_VARIANTE])
    const carte = screen.getAllByRole("listitem")[0]
    expect(carte.textContent).toContain("T-shirt — Bleu / M")
    nettoyer()
  })

  it("ne perd aucune donnée en mode carte : les colonnes masquées resurgissent", () => {
    const nettoyer = afficher(375)
    const carte = screen.getAllByRole("listitem")[0]

    // masquerEnCarte: true columns — must resurface via titre/valeur/sousTitre,
    // otherwise this data would be hidden by screen width.
    // "article" → titreLigneVente.
    expect(carte.textContent).toContain("Riz parfumé 5kg")
    // "puApplique" → valeurLigneVente: formatted amount at the top of the card.
    expect(within(carte).getByText(texteMontant(4500))).toBeDefined()
    // "sku" → sousTitreLigneVente.
    expect(carte.textContent).toContain("RIZ-5KG")

    nettoyer()
  })

  it("garde Source, Lot, Qté, Prix catalogue et Remise lisibles en carte", () => {
    const nettoyer = afficher(375)
    const carte = screen.getAllByRole("listitem")[0]

    expect(valeurPaire(carte, "Qté")).toBe("2")
    expect(valeurPaire(carte, "Prix catalogue")).toMatch(texteMontant(5000))
    // Remise = (catalogPrice - unitPrice) * quantity = (5000 - 4500) * 2 = 1000.
    expect(valeurPaire(carte, "Remise")).toMatch(texteMontant(1000))
    expect(valeurPaire(carte, "Source")).toBe("Entrepôt central")
    expect(valeurPaire(carte, "Lot")).toBe("LOT-42")

    nettoyer()
  })

  it("affiche un tiret quand le lot est absent", () => {
    const nettoyer = afficher(375, [{ ...ITEM, lotNumber: null }])
    const carte = screen.getAllByRole("listitem")[0]
    expect(valeurPaire(carte, "Lot")).toBe("—")
    nettoyer()
  })
})
