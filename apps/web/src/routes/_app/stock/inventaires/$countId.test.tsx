import { render, screen, within, fireEvent } from "@testing-library/react"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import { installerMatchMedia } from "@/test/media-query"
import { jetons } from "@/test/jetons"
import { valeurPaire } from "@/test/valeur-paire"
import {
  COLONNES_LIGNES_INVENTAIRE,
  COLONNES_LIGNES_INVENTAIRE_ECRITURE,
  COLONNES_ECARTS_CLOTURE,
  actionEnregistrerLigne,
  titreLigneInventaire,
  titreEcartCloture,
} from "./$countId"
import type { LigneInventaireAffichee, EcartClotureAffiche } from "./$countId"

/** One mock per row, never shared: a closure that captured the wrong row
 * (`enregistrer.mutate({ itemId: items[0].id, ... })` instead of `item.id`)
 * would still satisfy a single shared spy, while writing to the wrong
 * article — the exact defect this case exists to catch. */
const SAISIR_LIGNE_1 = vi.fn()
const SAISIR_LIGNE_2 = vi.fn()
const ENREGISTRER_LIGNE_1 = vi.fn()
const ENREGISTRER_LIGNE_2 = vi.fn()

const LIGNE_1: LigneInventaireAffichee = {
  id: "li1",
  variantId: "v1",
  productName: "Riz parfumé 5kg",
  variantName: "Standard",
  sku: "RIZ-5KG",
  expectedQuantity: 50,
  countedQuantity: 45,
  saisissable: true,
  saisie: null,
  surSaisie: SAISIR_LIGNE_1,
  surEnregistrer: ENREGISTRER_LIGNE_1,
  enregistrementDesactive: false,
}

const LIGNE_2: LigneInventaireAffichee = {
  id: "li2",
  variantId: "v2",
  productName: "Ciment 50kg",
  variantName: "Standard",
  sku: "CIM-50",
  expectedQuantity: 20,
  countedQuantity: null,
  saisissable: true,
  saisie: "18",
  surSaisie: SAISIR_LIGNE_2,
  surEnregistrer: ENREGISTRER_LIGNE_2,
  enregistrementDesactive: false,
}

// Read-only counterparts: `saisissable: false`, matching what the screen
// splices onto every row when `saisieOuverte` is false (never a mix within
// one render, same as production).
const LIGNE_1_LECTURE: LigneInventaireAffichee = {
  ...LIGNE_1,
  saisissable: false,
}
const LIGNE_2_LECTURE: LigneInventaireAffichee = {
  ...LIGNE_2,
  saisissable: false,
}

const ECART_POSITIF: EcartClotureAffiche = {
  variantId: "v1",
  productName: "Riz parfumé 5kg",
  variantName: "Standard",
  sku: "RIZ-5KG",
  attendu: 50,
  compte: 55,
  quantiteAvantCloture: 50,
  delta: 5,
}

const ECART_NEGATIF: EcartClotureAffiche = {
  variantId: "v2",
  productName: "Ciment 50kg",
  variantName: "Standard",
  sku: "CIM-50",
  attendu: 20,
  compte: 15,
  quantiteAvantCloture: 20,
  delta: -5,
}

// A variant deleted between opening and closing the count: `productName`
// and `sku` fall back per `titreEcartCloture`'s untouched logic.
const ECART_NUL_SANS_VARIANTE: EcartClotureAffiche = {
  variantId: "v3",
  productName: null,
  variantName: null,
  sku: null,
  attendu: 10,
  compte: 10,
  quantiteAvantCloture: 10,
  delta: 0,
}

describe("colonnes du détail d'inventaire", () => {
  // Cleared by afterEach rather than at the end of each test: a failing
  // assertion would otherwise leak the matchMedia stub into the next test
  // and bury the real cause under a cascade of unrelated failures.
  let nettoyer: (() => void) | undefined

  afterEach(() => {
    nettoyer?.()
    nettoyer = undefined
    SAISIR_LIGNE_1.mockClear()
    SAISIR_LIGNE_2.mockClear()
    ENREGISTRER_LIGNE_1.mockClear()
    ENREGISTRER_LIGNE_2.mockClear()
  })

  function afficherSaisie(
    largeur: number,
    lignes: LigneInventaireAffichee[] = [LIGNE_1],
    peutEcrire = true
  ) {
    nettoyer = installerMatchMedia(largeur)
    render(
      <ListeAdaptative<LigneInventaireAffichee>
        colonnes={
          peutEcrire
            ? COLONNES_LIGNES_INVENTAIRE_ECRITURE
            : COLONNES_LIGNES_INVENTAIRE
        }
        lignes={lignes}
        cleLigne={(l) => l.id}
        titre={titreLigneInventaire}
        actionCarte={peutEcrire ? actionEnregistrerLigne : undefined}
      />
    )
  }

  function afficherRecap(
    largeur: number,
    lignes: EcartClotureAffiche[] = [ECART_POSITIF]
  ) {
    nettoyer = installerMatchMedia(largeur)
    render(
      <ListeAdaptative<EcartClotureAffiche>
        colonnes={COLONNES_ECARTS_CLOTURE}
        lignes={lignes}
        cleLigne={(e) => e.variantId}
        titre={titreEcartCloture}
      />
    )
  }

  // Case 1.
  it("expose 4 colonnes de données, l'action venant s'y ajouter en écriture ; 4 colonnes au récapitulatif", () => {
    expect(COLONNES_LIGNES_INVENTAIRE).toHaveLength(4)
    expect(COLONNES_LIGNES_INVENTAIRE_ECRITURE).toHaveLength(5)
    expect(COLONNES_LIGNES_INVENTAIRE_ECRITURE.at(-1)!.cle).toBe("action")
    expect(COLONNES_ECARTS_CLOTURE).toHaveLength(4)
  })

  // Case 2 — the accessible-name assertion is the one that proves the
  // `aria-label` survived migration character-for-character.
  it("rend les 5 colonnes en table à 1280 px en saisie, avec le nom accessible du champ intact", () => {
    afficherSaisie(1280, [LIGNE_1, LIGNE_2], true)
    expect(screen.getAllByRole("columnheader")).toHaveLength(5)
    expect(
      screen.getByRole("spinbutton", { name: "Quantité comptée — CIM-50" })
    ).toBeTruthy()
  })

  // Case 3.
  it("rend 4 colonnes sans aucun champ ni bouton en lecture seule, sans perdre la valeur comptée", () => {
    afficherSaisie(1280, [LIGNE_1_LECTURE, LIGNE_2_LECTURE], false)
    expect(screen.getAllByRole("columnheader")).toHaveLength(4)
    expect(screen.queryByRole("spinbutton")).toBeNull()
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.getByText("45")).toBeTruthy()
    expect(screen.getByText("— (non compté)")).toBeTruthy()
  })

  // Case 4.
  it("à 375 px en saisie, le champ et le bouton apparaissent chacun exactement une fois", () => {
    afficherSaisie(375, [LIGNE_1], true)
    const carte = screen.getAllByRole("listitem")[0]

    const champs = within(carte).getAllByRole("spinbutton")
    expect(champs).toHaveLength(1)
    const dt = within(carte).getByText("Compté")
    expect(dt.nextElementSibling?.contains(champs[0])).toBe(true)

    expect(
      within(carte).getAllByRole("button", { name: "Enregistrer" })
    ).toHaveLength(1)
  })

  // Case 5 — the case that protects against a save on the wrong article.
  it("câble Enregistrer sur la ligne cliquée, et sur elle seule", () => {
    afficherSaisie(375, [LIGNE_1, LIGNE_2], true)
    const carte = screen.getAllByRole("listitem")[1]

    fireEvent.change(within(carte).getByRole("spinbutton"), {
      target: { value: "22" },
    })
    fireEvent.click(within(carte).getByRole("button", { name: "Enregistrer" }))

    expect(SAISIR_LIGNE_2).toHaveBeenCalled()
    expect(SAISIR_LIGNE_1).not.toHaveBeenCalled()
    expect(ENREGISTRER_LIGNE_2).toHaveBeenCalledTimes(1)
    expect(ENREGISTRER_LIGNE_1).not.toHaveBeenCalled()
  })

  // Case 6 — new assertion shape for the phase: the first per-row
  // DISABLED-state test, since `enregistrementDesactive` is unique to this
  // screen's mutation (a single shared `isPending` flag combined with a
  // per-row "in saisies" check).
  it("désactive uniquement le bouton de la ligne dont enregistrementDesactive vaut true", () => {
    const ligneDesactivee: LigneInventaireAffichee = {
      ...LIGNE_1,
      enregistrementDesactive: true,
    }
    afficherSaisie(1280, [ligneDesactivee, LIGNE_2], true)
    const boutons = screen.getAllByRole("button", { name: "Enregistrer" })
    expect(boutons).toHaveLength(2)
    expect(boutons[0].hasAttribute("disabled")).toBe(true)
    expect(boutons[1].hasAttribute("disabled")).toBe(false)
  })

  // Case 7, table de saisie.
  it("ne duplique aucune colonne masquée en mode carte — table de saisie", () => {
    afficherSaisie(375, [LIGNE_1], true)
    const carte = screen.getAllByRole("listitem")[0]

    // The garde-fou: it targets the `masquerEnCarte` column and asserts its
    // ABSENCE from the pairs — the visible columns go through `paires` by
    // construction and can never regress silently.
    expect(within(carte).queryByText("Article")).toBeNull()
    expect(within(carte).getAllByText("Riz parfumé 5kg")).toHaveLength(1)
    // One button per card of the count table: only "Enregistrer".
    expect(within(carte).getAllByRole("button")).toHaveLength(1)
  })

  // Case 7, récapitulatif.
  it("ne duplique aucune colonne masquée en mode carte — récapitulatif", () => {
    afficherRecap(375, [ECART_POSITIF])
    const carte = screen.getAllByRole("listitem")[0]

    expect(within(carte).queryByText("Article")).toBeNull()
    expect(within(carte).getAllByText("Riz parfumé 5kg")).toHaveLength(1)
    // Purely read-only: no button at all in the recap card.
    expect(within(carte).queryAllByRole("button")).toHaveLength(0)
  })

  // Case 8.
  it("le récapitulatif rend les trois paires et les trois formes de ecartRendu", () => {
    afficherRecap(375, [ECART_POSITIF, ECART_NEGATIF, ECART_NUL_SANS_VARIANTE])
    const cartes = screen.getAllByRole("listitem")

    expect(valeurPaire(cartes[0], "Compté")).toBe("55")
    expect(valeurPaire(cartes[0], "Stock avant clôture")).toBe("50")
    expect(valeurPaire(cartes[0], "Écart appliqué")).toBe("+5")

    expect(valeurPaire(cartes[1], "Compté")).toBe("15")
    expect(valeurPaire(cartes[1], "Écart appliqué")).toBe("-5")

    expect(valeurPaire(cartes[2], "Écart appliqué")).toBe("0")
    // The deleted-variant fallback: `productName ?? variantId`, no "(sku)".
    expect(within(cartes[2]).getByText("v3")).toBeTruthy()
  })

  // Case 9, table de saisie. jsdom has neither a layout engine nor a CSS
  // cascade: these cases guard that the classes are APPLIED to the right
  // cells, never that they produce their effect — that is measured in the
  // browser.
  it("porte TEXTE_LIBRE sur Article, absent des colonnes chiffrées — table de saisie", () => {
    afficherSaisie(1280, [LIGNE_1_LECTURE], false)
    const celluleArticle = screen.getByText("Riz parfumé 5kg").closest("td")
    expect(jetons(celluleArticle)).toContain("wrap-anywhere")
    // `wrap-anywhere` alone is inert: `TableCell` sets `whitespace-nowrap`,
    // which forbids any wrap in the first place. See the JSDoc of
    // `TEXTE_LIBRE` in `components/ui/table.tsx`.
    expect(jetons(celluleArticle)).toContain("whitespace-normal")

    const cellulesChiffrees = [
      screen.getByText("50").closest("td"), // attendu
      screen.getByText("45").closest("td"), // compte
      screen.getByText("-5").closest("td"), // écart
    ]
    for (const cellule of cellulesChiffrees) {
      expect(jetons(cellule)).not.toContain("wrap-anywhere")
      expect(jetons(cellule)).not.toContain("whitespace-normal")
    }
  })

  // Case 9, récapitulatif.
  it("porte TEXTE_LIBRE sur Article, absent des colonnes chiffrées — récapitulatif", () => {
    afficherRecap(1280, [ECART_POSITIF])
    const celluleArticle = screen.getByText("Riz parfumé 5kg").closest("td")
    expect(jetons(celluleArticle)).toContain("wrap-anywhere")
    expect(jetons(celluleArticle)).toContain("whitespace-normal")

    const cellulesChiffrees = [
      screen.getByText("55").closest("td"), // compte
      screen.getByText("50").closest("td"), // stock avant clôture
      screen.getByText("+5").closest("td"), // écart appliqué
    ]
    for (const cellule of cellulesChiffrees) {
      expect(jetons(cellule)).not.toContain("wrap-anywhere")
      expect(jetons(cellule)).not.toContain("whitespace-normal")
    }
  })
})

// No automated case mounts `InventaireDetailPage` itself: it is not exported
// (same as `ReceptionDetailPage` and `TransfertDetailPage`, Tasks 5-6), and
// mounting it via `Route.options.component` — the only route in the file —
// suspends indefinitely outside a real `RouterProvider`, confirmed
// empirically for the same shape of screen in `receptions/$purchaseId.test.tsx`
// and `transferts/$transferId.test.tsx`: `Route.useParams()` never resolves
// and the tree stays an empty `<div>`, even before any network mock settles.
// Per the brief's documented fallback, the page-level wiring — the header
// fix, the `saisieOuverte` predicate driving both `ListeAdaptative` calls,
// and the closing-summary `Dialog`'s `md:max-w-2xl` widening — is covered by
// browser verification instead (plan §Definition of Done, dialog #9 and the
// three-layer gap it explicitly asks this task to fill).
