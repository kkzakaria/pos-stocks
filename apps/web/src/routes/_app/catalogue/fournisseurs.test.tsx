import { render, screen, within, fireEvent } from "@testing-library/react"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import { installerMatchMedia } from "@/test/media-query"
import {
  COLONNES_FOURNISSEURS,
  COLONNES_FOURNISSEURS_ECRITURE,
  boutonBascule,
  titreFournisseur,
} from "./fournisseurs"
import type { FournisseurAffiche } from "./fournisseurs"

/** One mock per row, never shared: a closure that captured the wrong row
 * (`basculer.mutate(fournisseurs[0])` instead of `mutate(f)`) would still
 * satisfy a single shared spy, while writing to the wrong supplier. */
const BASCULE_ACTIF = vi.fn()
const BASCULE_INACTIF = vi.fn()

const ACTIF: FournisseurAffiche = {
  id: "f1",
  name: "Sotra Distribution",
  contact: "Awa Koné",
  phone: "+225 07 00 00 00",
  isActive: true,
  surBascule: BASCULE_ACTIF,
}

const INACTIF: FournisseurAffiche = {
  id: "f2",
  name: "Comptoir du Nord",
  contact: null,
  phone: null,
  isActive: false,
  surBascule: BASCULE_INACTIF,
}

/**
 * Card mode renders non-hidden columns as `<dt>`/`<dd>` pairs inside a
 * `<dl>` — reading the `<dd>` next to a given `<dt>` label targets that
 * specific pair instead of the whole card's `textContent`, which another
 * field can satisfy by coincidence.
 */
function valeurPaire(carte: HTMLElement, libelle: string): string {
  const dt = within(carte).getByText(libelle)
  const dd = dt.nextElementSibling
  if (!(dd instanceof HTMLElement)) {
    throw new Error(`Aucune <dd> associée au libellé « ${libelle} »`)
  }
  return dd.textContent
}

describe("colonnes de la liste des fournisseurs", () => {
  // Cleared by afterEach rather than at the end of each test: a failing
  // assertion would otherwise leak the matchMedia stub into the next test
  // and bury the real cause under a cascade of unrelated failures.
  let nettoyer: (() => void) | undefined

  afterEach(() => {
    nettoyer?.()
    nettoyer = undefined
    BASCULE_ACTIF.mockClear()
    BASCULE_INACTIF.mockClear()
  })

  /** `peutEcrire` drives both the extra column and `actionCarte` on the
   * screen, so the helper mirrors that pairing rather than letting a test
   * exercise one without the other. */
  function afficher(
    largeur: number,
    lignes: FournisseurAffiche[] = [ACTIF],
    peutEcrire = true
  ) {
    nettoyer = installerMatchMedia(largeur)
    render(
      <ListeAdaptative<FournisseurAffiche>
        colonnes={
          peutEcrire ? COLONNES_FOURNISSEURS_ECRITURE : COLONNES_FOURNISSEURS
        }
        lignes={lignes}
        cleLigne={(f) => f.id}
        titre={titreFournisseur}
        actionCarte={peutEcrire ? boutonBascule : undefined}
      />
    )
  }

  it("expose 4 colonnes de données, l'action venant s'y ajouter en écriture", () => {
    expect(COLONNES_FOURNISSEURS).toHaveLength(4)
    expect(COLONNES_FOURNISSEURS_ECRITURE).toHaveLength(5)
    expect(COLONNES_FOURNISSEURS_ECRITURE.at(-1)!.cle).toBe("action")
  })

  it("rend les 5 colonnes en table à 1280 px quand le compte peut écrire", () => {
    afficher(1280)
    for (const entete of ["Nom", "Contact", "Téléphone", "Statut"]) {
      expect(screen.getByText(entete)).toBeTruthy()
    }
    // The action column carries an empty header: only the header count can
    // see it, and it is what distinguishes 5 columns from 4.
    expect(screen.getAllByRole("columnheader")).toHaveLength(5)
    expect(screen.getByRole("button", { name: "Désactiver" })).toBeTruthy()
  })

  it("porte le nom en titre et le statut en paire visible à 375 px", () => {
    afficher(375)
    const carte = screen.getAllByRole("listitem")[0]
    expect(carte.textContent).toContain("Sotra Distribution")
    expect(valeurPaire(carte, "Statut")).toBe("Actif")
    expect(valeurPaire(carte, "Contact")).toBe("Awa Koné")
    expect(valeurPaire(carte, "Téléphone")).toBe("+225 07 00 00 00")
  })

  it("ne duplique aucune colonne masquée en mode carte", () => {
    afficher(375)
    const carte = screen.getAllByRole("listitem")[0]

    // The garde-fou: it targets the `masquerEnCarte` columns and asserts
    // their ABSENCE from the pairs — the visible columns go through `paires`
    // by construction and can never regress. Dropping either flag would
    // render the data twice, which a presence-only assertion cannot see.
    // "nom" → titreFournisseur.
    expect(within(carte).queryByText("Nom")).toBeNull()
    expect(within(carte).getAllByText("Sotra Distribution")).toHaveLength(1)
    // "action" → actionCarte, never in the pairs, never duplicated.
    expect(within(carte).getAllByRole("button")).toHaveLength(1)
  })

  it("libelle le bouton selon l'état de la ligne", () => {
    afficher(1280, [ACTIF, INACTIF])
    expect(screen.getByRole("button", { name: "Désactiver" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Réactiver" })).toBeTruthy()
  })

  it("déclenche la bascule de la ligne cliquée, et d'elle seule", () => {
    afficher(375, [ACTIF, INACTIF])
    const carte = screen.getAllByRole("listitem")[1]
    fireEvent.click(within(carte).getByRole("button", { name: "Réactiver" }))
    expect(BASCULE_INACTIF).toHaveBeenCalledTimes(1)
    expect(BASCULE_ACTIF).not.toHaveBeenCalled()
  })

  it("n'expose ni colonne d'action ni action de carte en lecture seule", () => {
    afficher(1280, [ACTIF], false)
    expect(screen.getAllByRole("columnheader")).toHaveLength(4)
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("n'expose aucun bouton en carte en lecture seule", () => {
    afficher(375, [ACTIF], false)
    const carte = screen.getAllByRole("listitem")[0]
    expect(within(carte).queryByRole("button")).toBeNull()
    // The name still reaches the card through `titre`, even without the
    // action: read-only must not cost the user any data.
    expect(within(carte).getAllByText("Sotra Distribution")).toHaveLength(1)
  })

  it("remplace une valeur absente par un tiret cadratin", () => {
    afficher(375, [INACTIF])
    const carte = screen.getAllByRole("listitem")[0]
    expect(valeurPaire(carte, "Contact")).toBe("—")
    expect(valeurPaire(carte, "Téléphone")).toBe("—")
    expect(valeurPaire(carte, "Statut")).toBe("Inactif")
  })
})
