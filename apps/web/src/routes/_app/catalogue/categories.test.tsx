import { render, screen, within, fireEvent } from "@testing-library/react"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import { installerMatchMedia } from "@/test/media-query"
import { jetons } from "@/test/jetons"
import {
  COLONNES_CATEGORIES,
  COLONNES_CATEGORIES_ECRITURE,
  boutonModifier,
  libelleCategorie,
  titreCategorie,
} from "./categories"
import type { CategorieAffichee } from "./categories"
import type { ColonneAdaptative } from "@/components/ui/liste-adaptative"

const PARENTS = new Map([
  ["c1", "Outils"],
  ["c2", "Marteaux"],
])

/** One mock per row, never shared: a closure that captured the wrong row
 * (`ouvrirEdition(listeCategories[0])` instead of `ouvrirEdition(cat)`) would
 * still satisfy a single shared spy, and would open the editor on the wrong
 * category in the application. */
const MODIFIER_RACINE = vi.fn()
const MODIFIER_ENFANT = vi.fn()

/** A root category and one child, so the hierarchical prefix is exercised
 * rather than assumed. */
const RACINE: CategorieAffichee = {
  id: "c1",
  name: "Outils",
  parentId: null,
  libelle: libelleCategorie(
    { id: "c1", name: "Outils", parentId: null },
    PARENTS
  ),
  surModifier: MODIFIER_RACINE,
}

const ENFANT: CategorieAffichee = {
  id: "c2",
  name: "Marteaux",
  parentId: "c1",
  libelle: libelleCategorie(
    { id: "c2", name: "Marteaux", parentId: "c1" },
    PARENTS
  ),
  surModifier: MODIFIER_ENFANT,
}

const LIBELLE_ENFANT = "Outils > Marteaux"

describe("colonnes des catégories", () => {
  // Cleared by afterEach rather than at the end of each test: a failing
  // assertion would otherwise leak the matchMedia stub into the next test
  // and bury the real cause under a cascade of unrelated failures.
  let nettoyer: (() => void) | undefined

  afterEach(() => {
    nettoyer?.()
    nettoyer = undefined
    MODIFIER_RACINE.mockClear()
    MODIFIER_ENFANT.mockClear()
  })

  // No default arguments: `afficher(375, …, undefined)` would silently fall
  // back to the default and re-render the very button the read-only cases
  // assert the absence of.
  function afficher(
    largeur: number,
    colonnes: ColonneAdaptative<CategorieAffichee>[],
    actionCarte: ((cat: CategorieAffichee) => React.ReactNode) | undefined
  ) {
    nettoyer = installerMatchMedia(largeur)
    render(
      <ListeAdaptative<CategorieAffichee>
        colonnes={colonnes}
        lignes={[RACINE, ENFANT]}
        cleLigne={(cat) => cat.id}
        titre={titreCategorie}
        actionCarte={actionCarte}
      />
    )
  }

  it("construit le libellé hiérarchique, et dégrade un parent inconnu", () => {
    expect(ENFANT.libelle).toBe(LIBELLE_ENFANT)
    expect(RACINE.libelle).toBe("Outils")
    expect(
      libelleCategorie({ id: "c9", name: "Orphelin", parentId: "zz" }, PARENTS)
    ).toBe("? > Orphelin")
  })

  it("expose 1 colonne de données, l'action venant s'y ajouter en écriture", () => {
    expect(COLONNES_CATEGORIES).toHaveLength(1)
    expect(COLONNES_CATEGORIES[0].cle).toBe("categorie")
    expect(COLONNES_CATEGORIES_ECRITURE).toHaveLength(2)
    expect(COLONNES_CATEGORIES_ECRITURE.at(-1)!.cle).toBe("action")
  })

  it("rend « Catégorie » et l'en-tête d'action vide en table à 1280 px", () => {
    afficher(1280, COLONNES_CATEGORIES_ECRITURE, boutonModifier)
    const entetes = screen.getAllByRole("columnheader")
    expect(entetes).toHaveLength(2)
    expect(entetes[0].textContent).toBe("Catégorie")
    expect(entetes[1].textContent).toBe("")
    expect(screen.getByText(LIBELLE_ENFANT)).toBeTruthy()
    expect(screen.getAllByRole("button", { name: "Modifier" })).toHaveLength(2)
  })

  it("porte le libellé hiérarchique en titre de carte à 375 px", () => {
    afficher(375, COLONNES_CATEGORIES_ECRITURE, boutonModifier)
    const cartes = screen.getAllByRole("listitem")
    expect(cartes).toHaveLength(2)
    // The title is the card's dominant line, not a label/value pair.
    expect(within(cartes[1]).getByText(LIBELLE_ENFANT).tagName).toBe("P")
  })

  it("ne perd ni ne duplique aucune colonne masquée en mode carte", () => {
    afficher(375, COLONNES_CATEGORIES_ECRITURE, boutonModifier)
    const carte = screen.getAllByRole("listitem")[1]

    // "categorie" → titreCategorie. Present, and exactly once: dropping
    // masquerEnCarte would render the label a second time as a pair, which a
    // presence-only assertion could never see.
    expect(within(carte).queryByText("Catégorie")).toBeNull()
    expect(within(carte).getAllByText(LIBELLE_ENFANT)).toHaveLength(1)

    // "action" → actionCarte. Same reasoning: the button lives in the card's
    // trailing action only, never also in the pairs.
    expect(
      within(carte).getAllByRole("button", { name: "Modifier" })
    ).toHaveLength(1)

    // Both columns are masquerEnCarte, so the card renders NO label/value pair
    // at all — asserted last so a regression surfaces on the column it
    // actually concerns rather than on this blanket check.
    expect(carte.querySelector("dl")).toBeNull()
  })

  it("déclenche la modification de la ligne cliquée, et d'elle seule", () => {
    afficher(375, COLONNES_CATEGORIES_ECRITURE, boutonModifier)
    const carte = screen.getAllByRole("listitem")[1]
    fireEvent.click(within(carte).getByRole("button", { name: "Modifier" }))
    expect(MODIFIER_ENFANT).toHaveBeenCalledTimes(1)
    expect(MODIFIER_RACINE).not.toHaveBeenCalled()
  })

  it("n'expose ni colonne d'action ni action de carte sans droit d'écriture", () => {
    afficher(1280, COLONNES_CATEGORIES, undefined)
    expect(screen.getAllByRole("columnheader")).toHaveLength(1)
    expect(screen.queryByRole("button", { name: "Modifier" })).toBeNull()
  })

  it("ne rend aucun bouton « Modifier » en carte sans droit d'écriture", () => {
    afficher(375, COLONNES_CATEGORIES, undefined)
    const carte = screen.getAllByRole("listitem")[1]
    expect(within(carte).getByText(LIBELLE_ENFANT)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Modifier" })).toBeNull()
  })

  // jsdom has neither a layout engine nor a CSS cascade: this case guards that
  // the two classes are APPLIED to the right cell, never that they produce
  // their effect. The effect was measured in Chrome on this very screen, with
  // the hierarchical label of a long ZZZRESP category: 1 075 px of table for a
  // 736 px container at the 1024 px tier — 339 px of horizontal scroll, which
  // pushed the "Modifier" button's right edge to 1 331 px against a container
  // ending at 1 000. With the pair: 736 px of table, no scroll left, button
  // right edge back at 992 px. Same reading at 768 (339 → 0) and at 1280
  // (83 → 0).
  it("porte les deux jetons de texte libre sur la cellule du libellé", () => {
    afficher(1280, COLONNES_CATEGORIES_ECRITURE, boutonModifier)
    const cellule = screen.getByText(LIBELLE_ENFANT).closest("td")

    expect(jetons(cellule)).toContain("wrap-anywhere")
    // `wrap-anywhere` alone is inert: `TableCell` sets `whitespace-nowrap`,
    // which forbids any wrap in the first place. The two go together or not
    // at all — see the JSDoc of `TEXTE_LIBRE` in `components/ui/table.tsx`.
    expect(jetons(cellule)).toContain("whitespace-normal")
  })

  it("laisse la colonne d'action sans traitement de texte libre", () => {
    afficher(1280, COLONNES_CATEGORIES_ECRITURE, boutonModifier)
    // A button label is a fixed word from a closed set, not user text:
    // breaking it mid-word would only cost readability. Asserted so that a
    // future blanket `classeCellule` on every column fails here instead of
    // shipping.
    const cellule = screen
      .getAllByRole("button", { name: "Modifier" })[0]
      .closest("td")

    expect(jetons(cellule)).not.toContain("wrap-anywhere")
    expect(jetons(cellule)).not.toContain("whitespace-normal")
  })
})
