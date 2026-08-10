import { render, screen, within, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import { installerMatchMedia } from "@/test/media-query"
import { texteMontant } from "@/test/texte-montant"
import { jetons } from "@/test/jetons"
import { valeurPaire } from "@/test/valeur-paire"
import {
  COLONNES_NIVEAUX,
  COLONNES_NIVEAUX_ECRITURE,
  NiveauxStockPage,
  actionsNiveau,
  titreNiveau,
} from "./index"
import type { NiveauStockAffiche } from "./index"

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(() => Promise.resolve({ transit: [] })),
  apiUrl: (chemin: string) => chemin,
}))

// Empty options: the preselection effect (`if (!entrepotId && entrepots.length
// > 0) setEntrepotId(...)`) never fires, so `entrepotId` stays "" — the ONE
// screen-mount-blank state of the phase (brief case 8).
vi.mock("@/lib/stock", () => ({
  useEntrepotsVisibles: () => ({ options: [], isPending: false }),
}))

vi.mock("@/lib/permissions", () => ({
  useAccesStock: () => ({
    lecture: true,
    lectureTous: true,
    entrepotsLecture: [],
    ecritureTous: true,
    entrepotsEcriture: [],
  }),
}))

/** One mock per row, never shared: a closure that captured the wrong row
 * (`setAjustementPour(niveaux[0])` instead of `setAjustementPour(n)`) would
 * still satisfy a single shared spy, while writing to the wrong article. */
const AJUSTER_LIGNE_1 = vi.fn()
const AJUSTER_LIGNE_2 = vi.fn()
const SEUIL_LIGNE_1 = vi.fn()
const SEUIL_LIGNE_2 = vi.fn()

const LIGNE_1: NiveauStockAffiche = {
  variantId: "v1",
  productId: "p1",
  productName: "T-shirt col rond",
  variantName: "Rouge / M",
  sku: "TS-ROUGE-M",
  quantity: 12,
  avgCost: 2500,
  minStock: 5,
  seuilEffectif: 5,
  enAlerte: false,
  surAjuster: AJUSTER_LIGNE_1,
  surSeuil: SEUIL_LIGNE_1,
}

const LIGNE_2: NiveauStockAffiche = {
  variantId: "v2",
  productId: "p2",
  productName: "Pantalon cargo",
  variantName: "Bleu / L",
  sku: "PT-BLEU-L",
  quantity: 2,
  avgCost: 4800,
  minStock: 10,
  seuilEffectif: 10,
  enAlerte: true,
  surAjuster: AJUSTER_LIGNE_2,
  surSeuil: SEUIL_LIGNE_2,
}

describe("colonnes de la liste des niveaux de stock", () => {
  // Cleared by afterEach rather than at the end of each test: a failing
  // assertion would otherwise leak the matchMedia stub into the next test
  // and bury the real cause under a cascade of unrelated failures.
  let nettoyer: (() => void) | undefined

  afterEach(() => {
    nettoyer?.()
    nettoyer = undefined
    AJUSTER_LIGNE_1.mockClear()
    AJUSTER_LIGNE_2.mockClear()
    SEUIL_LIGNE_1.mockClear()
    SEUIL_LIGNE_2.mockClear()
  })

  function afficher(
    largeur: number,
    lignes: NiveauStockAffiche[] = [LIGNE_1],
    peutEcrire = true
  ) {
    nettoyer = installerMatchMedia(largeur)
    render(
      <ListeAdaptative<NiveauStockAffiche>
        colonnes={peutEcrire ? COLONNES_NIVEAUX_ECRITURE : COLONNES_NIVEAUX}
        lignes={lignes}
        cleLigne={(n) => n.variantId}
        titre={titreNiveau}
        actionCarte={peutEcrire ? actionsNiveau : undefined}
      />
    )
  }

  it("expose 6 colonnes de données, l'action venant s'y ajouter en écriture", () => {
    expect(COLONNES_NIVEAUX).toHaveLength(6)
    expect(COLONNES_NIVEAUX_ECRITURE).toHaveLength(7)
    expect(COLONNES_NIVEAUX_ECRITURE.at(-1)!.cle).toBe("action")
  })

  it("rend les 7 colonnes en table à 1280 px quand le compte peut écrire", () => {
    afficher(1280)
    // The action column carries an empty header: only the header count can
    // see it, and it is what distinguishes 7 columns from 6.
    expect(screen.getAllByRole("columnheader")).toHaveLength(7)
    expect(screen.getByRole("button", { name: "Ajuster" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Seuil" })).toBeTruthy()
  })

  it("rend 6 colonnes sans aucun bouton en lecture seule, sans perdre le nom du produit", () => {
    afficher(1280, [LIGNE_1], false)
    expect(screen.getAllByRole("columnheader")).toHaveLength(6)
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.getByText("T-shirt col rond")).toBeTruthy()
  })

  it("câble Ajuster sur la ligne cliquée, et sur elle seule", () => {
    afficher(375, [LIGNE_1, LIGNE_2])
    const carte = screen.getAllByRole("listitem")[1]
    fireEvent.click(within(carte).getByRole("button", { name: "Ajuster" }))
    expect(AJUSTER_LIGNE_2).toHaveBeenCalledTimes(1)
    expect(AJUSTER_LIGNE_1).not.toHaveBeenCalled()
  })

  it("câble Seuil sur la ligne cliquée, et sur elle seule", () => {
    afficher(375, [LIGNE_1, LIGNE_2])
    const carte = screen.getAllByRole("listitem")[1]
    fireEvent.click(within(carte).getByRole("button", { name: "Seuil" }))
    expect(SEUIL_LIGNE_2).toHaveBeenCalledTimes(1)
    expect(SEUIL_LIGNE_1).not.toHaveBeenCalled()
  })

  it("ne duplique aucune colonne masquée en mode carte", () => {
    afficher(375)
    const carte = screen.getAllByRole("listitem")[0]

    // The garde-fou: it targets the `masquerEnCarte` columns and asserts
    // their ABSENCE from the pairs — the visible columns go through
    // `paires` by construction and can never regress silently.
    expect(within(carte).queryByText("Produit")).toBeNull()
    expect(within(carte).queryByText("Variante")).toBeNull()
    expect(within(carte).queryByText("SKU")).toBeNull()
    // Two actions, never duplicated.
    expect(within(carte).getAllByRole("button")).toHaveLength(2)
    // The product name reaches the card exactly once, through titreNiveau.
    expect(within(carte).getAllByText("T-shirt col rond")).toHaveLength(1)
  })

  it("garde CMP et Seuil en paires visibles, et la quantité avec son badge en alerte", () => {
    // peutEcrire=false: the write-mode "Seuil" button would otherwise share
    // its exact text with the "Seuil" <dt>, making valeurPaire's lookup
    // ambiguous — this case is about the pair, not the action column.
    afficher(375, [LIGNE_2], false)
    const carte = screen.getAllByRole("listitem")[0]

    expect(valeurPaire(carte, "CMP")).toMatch(texteMontant(4800))
    expect(valeurPaire(carte, "Seuil")).toBe("10")
    // Badge and figure stay together in the same pair — no dedicated
    // `valeur`, per the plan's decision for this screen.
    expect(within(carte).getByText("Stock bas")).toBeTruthy()
    expect(valeurPaire(carte, "Quantité")).toContain("2")
  })

  // jsdom has neither a layout engine nor a CSS cascade: these two cases guard
  // that the classes are APPLIED to the right cells, never that they produce
  // their effect — that is measured in the browser.
  it("porte les deux jetons de texte libre sur le produit, la variante et le SKU", () => {
    afficher(1280)
    const cellules = [
      screen.getByText("T-shirt col rond").closest("td"),
      screen.getByText("Rouge / M").closest("td"),
      screen.getByText("TS-ROUGE-M").closest("td"),
    ]

    for (const cellule of cellules) {
      expect(jetons(cellule)).toContain("wrap-anywhere")
      // `wrap-anywhere` alone is inert: `TableCell` sets `whitespace-nowrap`,
      // which forbids any wrap in the first place. See the JSDoc of
      // `TEXTE_LIBRE` in `components/ui/table.tsx`.
      expect(jetons(cellule)).toContain("whitespace-normal")
    }
  })

  it("laisse quantité, CMP, seuil et action sans traitement de texte libre", () => {
    afficher(1280)
    // A quantity, a formatted amount and a threshold are atomic values:
    // breaking one across two lines would be a defect, not a fix. Asserted
    // so that a blanket `classeCellule` on every column fails here rather
    // than shipping.
    const cellules = [
      screen.getByText("12").closest("td"),
      screen.getByText(texteMontant(2500)).closest("td"),
      screen.getByText("5").closest("td"),
      screen.getByRole("button", { name: "Ajuster" }).closest("td"),
    ]

    for (const cellule of cellules) {
      expect(jetons(cellule)).not.toContain("wrap-anywhere")
      expect(jetons(cellule)).not.toContain("whitespace-normal")
    }
  })
})

describe("NiveauxStockPage — repli du sélecteur d'entrepôt", () => {
  let nettoyer: (() => void) | undefined

  afterEach(() => {
    nettoyer?.()
    nettoyer = undefined
  })

  it("affiche « Choisir un entrepôt » tant qu'aucun entrepôt n'est sélectionné", async () => {
    // The field is BLANK on first render, before the preselection effect
    // runs — the one screen-mount-blank state of the phase. With no
    // warehouse options at all, the effect never fires, which keeps the
    // field in that state for the whole test instead of only one paint.
    nettoyer = installerMatchMedia(1280)
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <NiveauxStockPage />
      </QueryClientProvider>
    )

    const declencheur = await screen.findByLabelText("Entrepôt")
    const libelle = declencheur.querySelector(
      '[data-slot="select-value"]'
    )?.textContent
    expect(libelle).toBe("Choisir un entrepôt")
  })
})
