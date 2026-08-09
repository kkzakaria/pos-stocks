import { render, screen, within, fireEvent } from "@testing-library/react"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import { installerMatchMedia } from "@/test/media-query"
import { texteMontant } from "@/test/texte-montant"
import { COLONNES_PRODUITS, titreProduit, sousTitreProduit } from "./index"
import type { ProduitAffiche } from "./index"
import type { RechercheProduits } from "@/lib/recherche-produits"

// The mock serialises `search` into the href: without it, dropping
// `search={…}` from the product link would silently lose the list's filters
// on the way back from the sheet, and no assertion here could see it.
vi.mock("@tanstack/react-router", async () => {
  const reel = await vi.importActual<Record<string, unknown>>(
    "@tanstack/react-router"
  )
  return {
    ...reel,
    Link: ({
      children,
      params,
      search,
    }: {
      children: React.ReactNode
      params?: { productId?: string }
      search?: Record<string, unknown>
    }) => {
      const requete = new URLSearchParams(
        Object.entries(search ?? {}).map(([cle, valeur]) => [
          cle,
          String(valeur),
        ])
      ).toString()
      return (
        <a
          href={`/catalogue/produits/${params?.productId ?? ""}${requete ? `?${requete}` : ""}`}
        >
          {children}
        </a>
      )
    },
  }
})

vi.mock("@/lib/api", () => ({
  apiUrl: (chemin: string) => chemin,
}))

// Deliberately non-empty and distinct from the defaults: an empty filter set
// would make a lost `search` prop invisible.
const FILTRES: RechercheProduits = { q: "mar", categorie: "c1", page: 2 }
const HREF_FICHE = "/catalogue/produits/p1?q=mar&categorie=c1&page=2"
// Deliberately NOT the "XOF" default of `formaterMontant`: with the default,
// dropping the currency from the price cell would leave every test green.
const DEVISE = "EUR"

const P: ProduitAffiche = {
  id: "p1",
  name: "Marteau",
  sku: "PRD-0001",
  price: 12500,
  imageKey: "img-1",
  isActive: true,
  updatedAt: "2026-08-07T10:30:00.000Z",
  variants: [
    { id: "v1", isActive: true },
    { id: "v2", isActive: false },
  ],
  currency: DEVISE,
  recherche: FILTRES,
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

describe("colonnes de la liste des produits", () => {
  // Cleared by afterEach rather than at the end of each test: a failing
  // assertion would otherwise leak the matchMedia stub into the next test
  // and bury the real cause under a cascade of unrelated failures.
  let nettoyer: (() => void) | undefined

  afterEach(() => {
    nettoyer?.()
    nettoyer = undefined
  })

  function afficher(largeur: number, surClicLigne = vi.fn()) {
    nettoyer = installerMatchMedia(largeur)
    render(
      <ListeAdaptative<ProduitAffiche>
        colonnes={COLONNES_PRODUITS}
        lignes={[P]}
        cleLigne={(p) => p.id}
        titre={titreProduit}
        sousTitre={sousTitreProduit}
        surClicLigne={surClicLigne}
      />
    )
    return { surClicLigne }
  }

  it("expose 6 colonnes", () => {
    expect(COLONNES_PRODUITS).toHaveLength(6)
  })

  it("rend les en-têtes de données en table à 1280 px", () => {
    afficher(1280)
    for (const entete of ["Nom", "SKU", "Prix", "Variantes", "Statut"]) {
      expect(screen.getByText(entete)).toBeTruthy()
    }
  })

  it("formate le prix dans la devise de l'organisation", () => {
    afficher(1280)
    expect(screen.getByText(texteMontant(12500, DEVISE))).toBeTruthy()
  })

  it("porte la vignette et le lien vers la fiche dans le titre à 375 px", () => {
    afficher(375)
    const carte = screen.getAllByRole("listitem")[0]
    const img = carte.querySelector("img")
    expect(img).toBeTruthy()
    expect(img?.getAttribute("alt")).toBe("")
  })

  it("n'affiche le lien « Nom » qu'une seule fois en carte, en conservant les filtres de la liste", () => {
    afficher(375)
    const liens = screen.getAllByText("Marteau")
    expect(liens).toHaveLength(1)
    expect(liens[0].closest("a")?.getAttribute("href")).toBe(HREF_FICHE)
  })

  it("conserve les filtres de la liste dans le lien « Nom » en table", () => {
    afficher(1280)
    expect(screen.getByText("Marteau").closest("a")?.getAttribute("href")).toBe(
      HREF_FICHE
    )
  })

  it("ne déclenche pas surClicLigne au clic sur le lien « Nom »", () => {
    const { surClicLigne } = afficher(375)
    fireEvent.click(screen.getByText("Marteau"))
    expect(surClicLigne).not.toHaveBeenCalled()
  })

  it("ne perd aucune donnée en mode carte : les 3 colonnes masquées resurgissent, les 3 autres restent en paires", () => {
    afficher(375)
    const carte = screen.getAllByRole("listitem")[0]

    // masquerEnCarte: true columns — must resurface via titre/sousTitre,
    // otherwise this data would be hidden by screen width.
    // "vignette" and "nom" → titreProduit.
    expect(carte.querySelector("img")).toBeTruthy()
    expect(within(carte).getAllByText("Marteau")).toHaveLength(1)
    // "sku" → sousTitreProduit.
    expect(carte.textContent).toContain("PRD-0001")

    // Non-hidden columns — go through `paires`, never hidden by
    // construction, but still checked to keep coverage explicit.
    expect(valeurPaire(carte, "Prix")).toMatch(texteMontant(12500, DEVISE))
    expect(valeurPaire(carte, "Variantes")).toBe("1")
    expect(valeurPaire(carte, "Statut")).toBe("Actif")
  })

  it("ne duplique aucune colonne masquée en mode carte", () => {
    afficher(375)
    const carte = screen.getAllByRole("listitem")[0]

    // The mirror image of the test above: each `masquerEnCarte` column
    // resurfaces via titre/sousTitre, so it must NOT also appear as a
    // label/value pair. Dropping the flag would render the data twice —
    // invisible to a presence-only assertion.
    expect(within(carte).queryByText("Nom")).toBeNull()
    expect(within(carte).queryByText("SKU")).toBeNull()
    expect(carte.querySelectorAll("img")).toHaveLength(1)
    expect(within(carte).getAllByText("PRD-0001")).toHaveLength(1)
  })

  it("garde le SKU en chasse fixe en mode carte", () => {
    afficher(375)
    const carte = screen.getAllByRole("listitem")[0]
    expect(
      within(carte).getByText("PRD-0001").className.split(/\s+/)
    ).toContain("font-mono")
  })
})
