import { render, screen, within, fireEvent } from "@testing-library/react"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import { installerMatchMedia } from "@/test/media-query"
import { texteMontant } from "@/test/texte-montant"
import { COLONNES_PRODUITS, titreProduit, sousTitreProduit } from "./index"
import type { RechercheProduits } from "@/lib/recherche-produits"

vi.mock("@tanstack/react-router", async () => {
  const reel = await vi.importActual<Record<string, unknown>>(
    "@tanstack/react-router"
  )
  return {
    ...reel,
    Link: ({
      children,
      params,
    }: {
      children: React.ReactNode
      params?: { productId?: string }
    }) => (
      <a href={`/catalogue/produits/${params?.productId ?? ""}`}>{children}</a>
    ),
  }
})

vi.mock("@/lib/api", () => ({
  apiUrl: (chemin: string) => chemin,
}))

type Variante = { id: string; isActive: boolean }
type Produit = {
  id: string
  name: string
  sku: string
  price: number
  imageKey: string | null
  isActive: boolean
  updatedAt: string
  variants: Variante[]
}

const FILTRES: RechercheProduits = {}
const DEVISE = "XOF"

const P: Produit = {
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

function afficher(largeur: number, surClicLigne = vi.fn()) {
  const nettoyer = installerMatchMedia(largeur)
  render(
    <ListeAdaptative<Produit>
      colonnes={COLONNES_PRODUITS(DEVISE, FILTRES)}
      lignes={[P]}
      cleLigne={(p) => p.id}
      titre={(p) => titreProduit(p, FILTRES)}
      sousTitre={sousTitreProduit}
      surClicLigne={surClicLigne}
    />
  )
  return { nettoyer, surClicLigne }
}

describe("colonnes de la liste des produits", () => {
  it("expose 6 colonnes", () => {
    expect(COLONNES_PRODUITS(DEVISE, FILTRES)).toHaveLength(6)
  })

  it("rend les en-têtes de données en table à 1280 px", () => {
    const { nettoyer } = afficher(1280)
    for (const entete of ["Nom", "SKU", "Prix", "Variantes", "Statut"]) {
      expect(screen.getByText(entete)).toBeTruthy()
    }
    nettoyer()
  })

  it("porte la vignette et le lien vers la fiche dans le titre à 375 px", () => {
    const { nettoyer } = afficher(375)
    const carte = screen.getAllByRole("listitem")[0]
    const img = carte.querySelector("img")
    expect(img).toBeTruthy()
    expect(img?.getAttribute("alt")).toBe("")
    nettoyer()
  })

  it("n'affiche le lien « Nom » qu'une seule fois en carte, pointant vers la bonne fiche", () => {
    const { nettoyer } = afficher(375)
    const liens = screen.getAllByText("Marteau")
    expect(liens).toHaveLength(1)
    expect(liens[0].closest("a")?.getAttribute("href")).toBe(
      "/catalogue/produits/p1"
    )
    nettoyer()
  })

  it("ne déclenche pas surClicLigne au clic sur le lien « Nom »", () => {
    const { nettoyer, surClicLigne } = afficher(375)
    fireEvent.click(screen.getByText("Marteau"))
    expect(surClicLigne).not.toHaveBeenCalled()
    nettoyer()
  })

  it("ne perd aucune donnée en mode carte : les 3 colonnes masquées resurgissent, les 3 autres restent en paires", () => {
    const { nettoyer } = afficher(375)
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
    expect(valeurPaire(carte, "Prix")).toMatch(texteMontant(12500))
    expect(valeurPaire(carte, "Variantes")).toBe("1")
    expect(valeurPaire(carte, "Statut")).toBe("Actif")
    nettoyer()
  })
})
