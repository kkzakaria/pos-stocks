import { render, screen, within, fireEvent } from "@testing-library/react"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import { installerMatchMedia } from "@/test/media-query"
import { texteMontant } from "@/test/texte-montant"
import { jetons } from "@/test/jetons"
import { valeurPaire } from "@/test/valeur-paire"
import {
  COLONNES_LIGNES_TRANSFERT,
  COLONNES_LIGNES_TRANSFERT_ECRITURE,
  actionsLigneTransfert,
  titreLigneTransfert,
} from "./$transferId"
import type { LigneTransfertAffichee } from "./$transferId"

/** One mock per row, never shared: a closure that captured the wrong row
 * (`supprimerLigne.mutate(items[0].id)` instead of `item.id`) would still
 * satisfy a single shared spy, while writing to the wrong line. */
const MODIFIER_LIGNE_1 = vi.fn()
const MODIFIER_LIGNE_2 = vi.fn()
const RETIRER_LIGNE_1 = vi.fn()
const RETIRER_LIGNE_2 = vi.fn()

const LIGNE_1: LigneTransfertAffichee = {
  id: "ti1",
  variantId: "v1",
  productId: "p1",
  productName: "Riz parfumé 5kg",
  variantName: "Standard",
  sku: "RIZ-5KG",
  trackLots: true,
  lotId: "l1",
  lotNumber: "LOT-2026-08",
  quantity: 50,
  unitCost: 3200,
  receivedQuantity: 40,
  surModifier: MODIFIER_LIGNE_1,
  surRetirer: RETIRER_LIGNE_1,
}

const LIGNE_2: LigneTransfertAffichee = {
  id: "ti2",
  variantId: "v2",
  productId: "p2",
  productName: "Huile végétale 1L",
  variantName: "Standard",
  sku: "HUI-1L",
  trackLots: false,
  lotId: null,
  lotNumber: null,
  quantity: 24,
  unitCost: null,
  receivedQuantity: null,
  surModifier: MODIFIER_LIGNE_2,
  surRetirer: RETIRER_LIGNE_2,
}

describe("colonnes du détail de transfert", () => {
  // Cleared by afterEach rather than at the end of each test: a failing
  // assertion would otherwise leak the matchMedia stub into the next test
  // and bury the real cause under a cascade of unrelated failures.
  let nettoyer: (() => void) | undefined

  afterEach(() => {
    nettoyer?.()
    nettoyer = undefined
    MODIFIER_LIGNE_1.mockClear()
    MODIFIER_LIGNE_2.mockClear()
    RETIRER_LIGNE_1.mockClear()
    RETIRER_LIGNE_2.mockClear()
  })

  function afficher(
    largeur: number,
    lignes: LigneTransfertAffichee[] = [LIGNE_1],
    peutEcrire = true
  ) {
    nettoyer = installerMatchMedia(largeur)
    render(
      <ListeAdaptative<LigneTransfertAffichee>
        colonnes={
          peutEcrire
            ? COLONNES_LIGNES_TRANSFERT_ECRITURE
            : COLONNES_LIGNES_TRANSFERT
        }
        lignes={lignes}
        cleLigne={(l) => l.id}
        titre={titreLigneTransfert}
        actionCarte={peutEcrire ? actionsLigneTransfert : undefined}
      />
    )
  }

  it("expose 5 colonnes de données, l'action venant s'y ajouter en écriture", () => {
    expect(COLONNES_LIGNES_TRANSFERT).toHaveLength(5)
    expect(COLONNES_LIGNES_TRANSFERT_ECRITURE).toHaveLength(6)
    expect(COLONNES_LIGNES_TRANSFERT_ECRITURE.at(-1)!.cle).toBe("action")
  })

  it("rend les 6 colonnes en table à 1280 px quand la ligne est modifiable", () => {
    afficher(1280)
    // The action column carries an empty header: only the header count can
    // see it, and it is what distinguishes 6 columns from 5.
    expect(screen.getAllByRole("columnheader")).toHaveLength(6)
    expect(screen.getByRole("button", { name: "Modifier" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Retirer" })).toBeTruthy()
  })

  it("rend 5 colonnes sans aucun bouton en lecture seule, sans perdre le nom du produit", () => {
    afficher(1280, [LIGNE_1], false)
    expect(screen.getAllByRole("columnheader")).toHaveLength(5)
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.getByText("Riz parfumé 5kg")).toBeTruthy()
  })

  it("câble Modifier sur la ligne cliquée, et sur elle seule", () => {
    afficher(375, [LIGNE_1, LIGNE_2])
    const carte = screen.getAllByRole("listitem")[1]
    fireEvent.click(within(carte).getByRole("button", { name: "Modifier" }))
    expect(MODIFIER_LIGNE_2).toHaveBeenCalledTimes(1)
    expect(MODIFIER_LIGNE_1).not.toHaveBeenCalled()
  })

  it("câble Retirer sur la ligne cliquée, et sur elle seule", () => {
    afficher(375, [LIGNE_1, LIGNE_2])
    const carte = screen.getAllByRole("listitem")[1]
    fireEvent.click(within(carte).getByRole("button", { name: "Retirer" }))
    expect(RETIRER_LIGNE_2).toHaveBeenCalledTimes(1)
    expect(RETIRER_LIGNE_1).not.toHaveBeenCalled()
  })

  it("ne duplique aucune colonne masquée en mode carte", () => {
    afficher(375)
    const carte = screen.getAllByRole("listitem")[0]

    // The garde-fou: it targets the `masquerEnCarte` column and asserts its
    // ABSENCE from the pairs — the visible columns go through `paires` by
    // construction and can never regress silently.
    expect(within(carte).queryByText("Article")).toBeNull()
    // Two actions, never duplicated.
    expect(within(carte).getAllByRole("button")).toHaveLength(2)
    // The product name reaches the card exactly once, through
    // titreLigneTransfert.
    expect(within(carte).getAllByText("Riz parfumé 5kg")).toHaveLength(1)
  })

  it("garde Quantité, Lot et CMP figé lisibles en paires", () => {
    afficher(375, [LIGNE_1], false)
    const carte = screen.getAllByRole("listitem")[0]

    expect(valeurPaire(carte, "Quantité")).toBe("50")
    expect(valeurPaire(carte, "Lot")).toBe("LOT-2026-08")
    expect(valeurPaire(carte, "CMP figé")).toMatch(texteMontant(3200))
  })

  it("affiche un tiret pour Lot et CMP figé quand la ligne n'a ni lot ni coût figé", () => {
    afficher(375, [LIGNE_2], false)
    const carte = screen.getAllByRole("listitem")[0]

    expect(valeurPaire(carte, "Lot")).toBe("—")
    expect(valeurPaire(carte, "CMP figé")).toBe("—")
  })

  it("affiche un tiret pour Reçu tant que la ligne n'a pas été réceptionnée", () => {
    afficher(375, [LIGNE_2], false)
    const carte = screen.getAllByRole("listitem")[0]

    expect(valeurPaire(carte, "Reçu")).toBe("—")
  })

  it("affiche le badge d'écart quand la quantité reçue est inférieure à l'expédiée", () => {
    afficher(1280, [LIGNE_1], false)
    // LIGNE_1: quantity 50, receivedQuantity 40 → écart de 10.
    expect(screen.getByText("Écart −10")).toBeTruthy()
    expect(screen.getByText("40")).toBeTruthy()
  })

  // jsdom has neither a layout engine nor a CSS cascade: these two cases guard
  // that the classes are APPLIED to the right cells, never that they produce
  // their effect — that is measured in the browser.
  it("porte les deux jetons de texte libre sur l'article et le lot", () => {
    afficher(1280)
    const cellules = [
      screen.getByText("Riz parfumé 5kg").closest("td"),
      screen.getByText("LOT-2026-08").closest("td"),
    ]

    for (const cellule of cellules) {
      expect(jetons(cellule)).toContain("wrap-anywhere")
      // `wrap-anywhere` alone is inert: `TableCell` sets `whitespace-nowrap`,
      // which forbids any wrap in the first place. See the JSDoc of
      // `TEXTE_LIBRE` in `components/ui/table.tsx`.
      expect(jetons(cellule)).toContain("whitespace-normal")
    }
  })

  it("laisse quantité, CMP figé et reçu sans traitement de texte libre", () => {
    afficher(1280)
    // A quantity, a formatted amount and a badge+number pair are atomic
    // values: breaking one across two lines would be a defect, not a fix.
    // Asserted so that a blanket `classeCellule` on every column fails here
    // rather than shipping.
    const cellules = [
      screen.getByText("50").closest("td"),
      screen.getByText(texteMontant(3200)).closest("td"),
      screen.getByText("40").closest("td"),
    ]

    for (const cellule of cellules) {
      expect(jetons(cellule)).not.toContain("wrap-anywhere")
      expect(jetons(cellule)).not.toContain("whitespace-normal")
    }
  })
})

// No automated case for the `tl-variante`/`tl-lot` `SelectValue` fallback fix
// (brief step 4): `TransfertDetailPage` is not exported (unlike the
// already-migrated list screens, whose page component IS exported for this
// exact purpose), and mounting it via `Route.options.component` — the only
// route in the file — suspends indefinitely outside a real `RouterProvider`,
// confirmed empirically for the same shape of screen in
// `receptions/$purchaseId.test.tsx` (Task 5): `Route.useParams()` never
// resolves and the tree stays an empty `<div>`, even before any network mock
// settles. Per the brief's documented fallback, this is covered by browser
// verification instead.
