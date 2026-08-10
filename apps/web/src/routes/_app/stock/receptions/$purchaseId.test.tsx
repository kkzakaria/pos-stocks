import { render, screen, within, fireEvent } from "@testing-library/react"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import { installerMatchMedia } from "@/test/media-query"
import { texteMontant } from "@/test/texte-montant"
import { jetons } from "@/test/jetons"
import { valeurPaire } from "@/test/valeur-paire"
import {
  COLONNES_LIGNES_RECEPTION,
  COLONNES_LIGNES_RECEPTION_ECRITURE,
  actionsLigneReception,
  titreLigneReception,
} from "./$purchaseId"
import type { LigneReceptionAffichee } from "./$purchaseId"

/** One mock per row, never shared: a closure that captured the wrong row
 * (`supprimerLigne.mutate(items[0].id)` instead of `item.id`) would still
 * satisfy a single shared spy, while writing to the wrong line. */
const MODIFIER_LIGNE_1 = vi.fn()
const MODIFIER_LIGNE_2 = vi.fn()
const RETIRER_LIGNE_1 = vi.fn()
const RETIRER_LIGNE_2 = vi.fn()

const LIGNE_1: LigneReceptionAffichee = {
  id: "li1",
  variantId: "v1",
  productName: "Riz parfumé 5kg",
  variantName: "Standard",
  sku: "RIZ-5KG",
  trackLots: true,
  quantity: 50,
  unitCost: 3200,
  lotNumber: "LOT-2026-08",
  expiryDate: "2026-12-31T09:00:00.000Z",
  surModifier: MODIFIER_LIGNE_1,
  surRetirer: RETIRER_LIGNE_1,
}

const LIGNE_2: LigneReceptionAffichee = {
  id: "li2",
  variantId: "v2",
  productName: "Huile végétale 1L",
  variantName: "Standard",
  sku: "HUI-1L",
  trackLots: false,
  quantity: 24,
  unitCost: 1500,
  lotNumber: null,
  expiryDate: null,
  surModifier: MODIFIER_LIGNE_2,
  surRetirer: RETIRER_LIGNE_2,
}

describe("colonnes du détail de réception", () => {
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
    lignes: LigneReceptionAffichee[] = [LIGNE_1],
    peutEcrire = true
  ) {
    nettoyer = installerMatchMedia(largeur)
    render(
      <ListeAdaptative<LigneReceptionAffichee>
        colonnes={
          peutEcrire
            ? COLONNES_LIGNES_RECEPTION_ECRITURE
            : COLONNES_LIGNES_RECEPTION
        }
        lignes={lignes}
        cleLigne={(l) => l.id}
        titre={titreLigneReception}
        actionCarte={peutEcrire ? actionsLigneReception : undefined}
      />
    )
  }

  it("expose 5 colonnes de données, l'action venant s'y ajouter en écriture", () => {
    expect(COLONNES_LIGNES_RECEPTION).toHaveLength(5)
    expect(COLONNES_LIGNES_RECEPTION_ECRITURE).toHaveLength(6)
    expect(COLONNES_LIGNES_RECEPTION_ECRITURE.at(-1)!.cle).toBe("action")
  })

  it("rend les 6 colonnes en table à 1280 px quand le brouillon est modifiable", () => {
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
    // titreLigneReception.
    expect(within(carte).getAllByText("Riz parfumé 5kg")).toHaveLength(1)
  })

  it("garde Quantité, Coût unitaire et Lot lisibles en paires", () => {
    afficher(375, [LIGNE_1], false)
    const carte = screen.getAllByRole("listitem")[0]

    expect(valeurPaire(carte, "Quantité")).toBe("50")
    expect(valeurPaire(carte, "Coût unitaire")).toMatch(texteMontant(3200))
    expect(valeurPaire(carte, "Lot")).toBe("LOT-2026-08")
    expect(valeurPaire(carte, "Péremption")).toBe("31/12/2026")
  })

  it("affiche un tiret pour Lot et Péremption quand la ligne n'a ni lot ni date", () => {
    afficher(375, [LIGNE_2], false)
    const carte = screen.getAllByRole("listitem")[0]

    expect(valeurPaire(carte, "Lot")).toBe("—")
    expect(valeurPaire(carte, "Péremption")).toBe("—")
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

  it("laisse quantité, coût unitaire et péremption sans traitement de texte libre", () => {
    afficher(1280)
    // A quantity, a formatted amount and a formatted date are atomic values:
    // breaking one across two lines would be a defect, not a fix — precisely
    // the defect the product sheet suffered on its own date column. Asserted
    // so that a blanket `classeCellule` on every column fails here rather
    // than shipping.
    const cellules = [
      screen.getByText("50").closest("td"),
      screen.getByText(texteMontant(3200)).closest("td"),
      screen.getByText("31/12/2026").closest("td"),
    ]

    for (const cellule of cellules) {
      expect(jetons(cellule)).not.toContain("wrap-anywhere")
      expect(jetons(cellule)).not.toContain("whitespace-normal")
    }
  })

  it("garde la péremption en text-sm", () => {
    afficher(1280)
    // `text-sm` is carried over from the old cell — a deliberate typographic
    // exception, same reasoning as the receipt list's date column.
    const cellule = screen.getByText("31/12/2026").closest("td")
    expect(jetons(cellule)).toContain("text-sm")
  })
})

// No automated case for the `l-variante` `SelectValue` fix (brief step 4):
// `ReceptionDetailPage` is not exported (unlike the already-migrated list
// screens, whose page component IS exported for this exact purpose), and
// mounting it via `Route.options.component` — the only route in the file —
// suspends indefinitely outside a real `RouterProvider`, confirmed empirically:
// `Route.useParams()` never resolves and the tree stays an empty `<div>`, even
// before any network mock settles. No other test in the repo mounts a
// `$param` detail route for the same reason (`ventes/$saleId.test.tsx`, the
// domain's exemplar, only exercises the exported column/title functions
// through `ListeAdaptative`, never the page itself). Per the brief's
// documented fallback, this is covered by browser verification instead: with
// both dev servers running, a draft receipt's "Ajouter une ligne" dialog
// showed "— choisir —" on the untouched `l-variante` select, and the correct
// product label ("4 trous carré — Standard (PRD-20260414-XJGZ-STD)") after
// picking an option — never the variant's raw UUID, in either state.
