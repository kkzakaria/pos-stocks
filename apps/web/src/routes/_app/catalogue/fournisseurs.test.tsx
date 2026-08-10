import {
  render,
  screen,
  within,
  fireEvent,
  waitFor,
} from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import { installerMatchMedia } from "@/test/media-query"
import { jetons } from "@/test/jetons"
import { valeurPaire } from "@/test/valeur-paire"
import {
  COLONNES_FOURNISSEURS,
  COLONNES_FOURNISSEURS_ECRITURE,
  FournisseursPage,
  boutonBascule,
  titreFournisseur,
} from "./fournisseurs"
import type { FournisseurAffiche } from "./fournisseurs"

// The screen reads the writing permission from the router context, which no
// test mounts: the toggle only exists for a write-capable account.
vi.mock("@/lib/permissions", () => ({ usePeutEcrire: () => true }))

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn((_chemin: string, init?: RequestInit) => {
    // The PATCH never settles: the whole point of the concurrency case is to
    // observe the screen WHILE two writes are still travelling.
    if (init?.method === "PATCH") return new Promise(() => undefined)
    return Promise.resolve({
      suppliers: [
        { id: "f1", name: "Alpha", contact: null, phone: null, isActive: true },
        { id: "f2", name: "Beta", contact: null, phone: null, isActive: true },
        { id: "f3", name: "Gamma", contact: null, phone: null, isActive: true },
      ],
    })
  }),
  apiUrl: (chemin: string) => chemin,
}))

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
  basculeEnCours: false,
}

const INACTIF: FournisseurAffiche = {
  id: "f2",
  name: "Comptoir du Nord",
  contact: null,
  phone: null,
  isActive: false,
  surBascule: BASCULE_INACTIF,
  basculeEnCours: false,
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

  it("désactive le bouton de la ligne en cours de bascule, et de celle-là seule", () => {
    // A second click before the PATCH lands sends a second PATCH: the supplier
    // returns to its starting state without the user understanding why, and
    // two writes are recorded for nothing. The disabling is row-scoped, so the
    // untouched supplier must stay clickable — freezing the whole list would
    // block rows that have nothing to do with the call in flight.
    afficher(1280, [{ ...ACTIF, basculeEnCours: true }, INACTIF])
    const enCours = screen.getByRole<HTMLButtonElement>("button", {
      name: "Désactiver",
    })
    const autre = screen.getByRole<HTMLButtonElement>("button", {
      name: "Réactiver",
    })
    expect(enCours.disabled).toBe(true)
    expect(autre.disabled).toBe(false)
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

  // jsdom has neither a layout engine nor a CSS cascade: these two cases guard
  // that the classes are APPLIED to the right cells, never that they produce
  // their effect. The effect was measured in Chrome on this very screen at the
  // 1024 px tier, where its container is 736 px: 1 578 px of table — Nom 576 ·
  // Contact 502 · Téléphone 348 — i.e. 842 px of horizontal scroll. With the
  // pair on those three columns: 736 px of table, Nom 216 · Contact 204 ·
  // Téléphone 164, no scroll left.
  it("porte les deux jetons de texte libre sur le nom, le contact et le téléphone", () => {
    afficher(1280, [ACTIF])
    const cellules = [
      screen.getByText("Sotra Distribution").closest("td"),
      screen.getByText("Awa Koné").closest("td"),
      screen.getByText("+225 07 00 00 00").closest("td"),
    ]

    for (const cellule of cellules) {
      expect(jetons(cellule)).toContain("wrap-anywhere")
      // `wrap-anywhere` alone is inert: `TableCell` sets `whitespace-nowrap`,
      // which forbids any wrap in the first place. The contact is the proof
      // that the second token is not decoration — it carries SPACES and still
      // refused to fold at 502 px. See the JSDoc of `TEXTE_LIBRE` in
      // `components/ui/table.tsx`.
      expect(jetons(cellule)).toContain("whitespace-normal")
    }
  })

  it("laisse le statut et l'action sans traitement de texte libre", () => {
    afficher(1280, [ACTIF])
    // A badge and a button label are fixed words from closed sets, not user
    // text: breaking them mid-word would only cost readability. Asserted so
    // that a blanket `classeCellule` on every column fails here rather than
    // shipping.
    const cellules = [
      screen.getByText("Actif").closest("td"),
      screen.getByRole("button", { name: "Désactiver" }).closest("td"),
    ]

    for (const cellule of cellules) {
      expect(jetons(cellule)).not.toContain("wrap-anywhere")
      expect(jetons(cellule)).not.toContain("whitespace-normal")
    }
  })
})

describe("FournisseursPage — bascules concurrentes", () => {
  let nettoyer: (() => void) | undefined

  afterEach(() => {
    nettoyer?.()
    nettoyer = undefined
  })

  /** Re-queried on every call: each re-render replaces the DOM nodes, and a
   * button captured before a click would be asserted after it has been
   * detached — always reporting its stale `disabled`. */
  function boutonLigne(nom: string): HTMLButtonElement {
    const ligne = screen.getByText(nom).closest("tr")
    if (!ligne) throw new Error(`Aucune ligne pour « ${nom} »`)
    return within(ligne).getByRole<HTMLButtonElement>("button")
  }

  it("désactive les boutons de TOUTES les bascules en vol, pas seulement la dernière", async () => {
    // Two toggles fired before the first answer. Tracking only the mutation's
    // last observed variables re-enables the FIRST supplier's button while its
    // PATCH is still travelling: a second click sends a second PATCH, and each
    // one FLIPS the flag — the supplier lands active again, which nobody asked
    // for. The untouched third row proves the guard stays row-scoped and does
    // not freeze the list.
    nettoyer = installerMatchMedia(1280)
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <FournisseursPage />
      </QueryClientProvider>
    )

    await screen.findByText("Alpha")
    fireEvent.click(boutonLigne("Alpha"))
    fireEvent.click(boutonLigne("Beta"))

    await waitFor(() => {
      expect(boutonLigne("Alpha").disabled).toBe(true)
      expect(boutonLigne("Beta").disabled).toBe(true)
    })
    expect(boutonLigne("Gamma").disabled).toBe(false)
  })
})
