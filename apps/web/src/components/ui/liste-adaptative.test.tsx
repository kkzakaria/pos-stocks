import { render, screen } from "@testing-library/react"
import { ListeAdaptative } from "./liste-adaptative"
import type { ColonneAdaptative } from "./liste-adaptative"
import { installerMatchMedia } from "@/test/media-query"

type Mouvement = { id: string; article: string; delta: number; motif: string }

const LIGNES: Mouvement[] = [
  { id: "1", article: "Ciment 50kg", delta: 12, motif: "Réception" },
  { id: "2", article: "Sable fin", delta: -3, motif: "Vente" },
]

const COLONNES: ColonneAdaptative<Mouvement>[] = [
  {
    cle: "article",
    entete: "Article",
    cellule: (l) => l.article,
    masquerEnCarte: true,
  },
  {
    cle: "delta",
    entete: "Delta",
    numeric: true,
    cellule: (l) => l.delta,
    masquerEnCarte: true,
  },
  { cle: "motif", entete: "Motif", cellule: (l) => l.motif },
]

function afficher(
  extra?: Partial<React.ComponentProps<typeof ListeAdaptative<Mouvement>>>
) {
  return render(
    <ListeAdaptative<Mouvement>
      colonnes={COLONNES}
      lignes={LIGNES}
      cle={(l) => l.id}
      titre={(l) => l.article}
      valeur={(l) => l.delta}
      {...extra}
    />
  )
}

describe("ListeAdaptative", () => {
  it("rend une table à partir de md", () => {
    const nettoyer = installerMatchMedia(1280)
    afficher()
    expect(screen.getByRole("table")).toBeTruthy()
    expect(screen.getAllByRole("row")).toHaveLength(3) // en-tête + 2 lignes
    nettoyer()
  })

  it("rend des cartes sous md, sans table", () => {
    const nettoyer = installerMatchMedia(375)
    afficher()
    expect(screen.queryByRole("table")).toBeNull()
    expect(screen.getAllByRole("listitem")).toHaveLength(2)
    nettoyer()
  })

  it("ne duplique jamais une valeur entre les deux modes", () => {
    const nettoyer = installerMatchMedia(375)
    afficher()
    expect(screen.getAllByText("Ciment 50kg")).toHaveLength(1)
    nettoyer()
  })

  it("affiche le titre et la valeur en tête de carte, les autres en paires", () => {
    const nettoyer = installerMatchMedia(375)
    afficher()
    const carte = screen.getAllByRole("listitem")[0]
    expect(carte.textContent).toContain("Ciment 50kg")
    expect(carte.textContent).toContain("12")
    // `motif` n'est pas masqué : il apparaît en paire libellé/valeur.
    expect(carte.textContent).toContain("Motif")
    expect(carte.textContent).toContain("Réception")
    nettoyer()
  })

  it("n'affiche pas le libellé des colonnes masquées en carte", () => {
    const nettoyer = installerMatchMedia(375)
    afficher()
    const carte = screen.getAllByRole("listitem")[0]
    expect(carte.textContent).not.toContain("Article")
    nettoyer()
  })

  it("rend l'état vide dans les deux modes", () => {
    for (const largeur of [375, 1280]) {
      const nettoyer = installerMatchMedia(largeur)
      const { unmount } = afficher({
        lignes: [],
        etatVide: <p>Aucun mouvement</p>,
      })
      expect(screen.getByText("Aucun mouvement")).toBeTruthy()
      unmount()
      nettoyer()
    }
  })

  it("rend un squelette pendant le chargement dans les deux modes", () => {
    for (const largeur of [375, 1280]) {
      const nettoyer = installerMatchMedia(largeur)
      const { container, unmount } = afficher({ chargement: true })
      expect(
        container.querySelectorAll('[data-slot="skeleton"]').length
      ).toBeGreaterThan(0)
      unmount()
      nettoyer()
    }
  })
})
