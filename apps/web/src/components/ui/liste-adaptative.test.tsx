import { render, screen, fireEvent } from "@testing-library/react"
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
      cleLigne={(l) => l.id}
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
    expect(screen.getAllByRole("row")).toHaveLength(3) // header + 2 rows
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
    // `motif` is not hidden: it appears as a label/value pair.
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

  it("affiche le sous-titre en carte quand il est fourni", () => {
    const nettoyer = installerMatchMedia(375)
    afficher({ sousTitre: (l) => `Motif : ${l.motif}` })
    expect(screen.getByText("Motif : Réception")).toBeTruthy()
    nettoyer()
  })

  it("n'affiche aucun sous-titre en carte quand la prop est omise", () => {
    const nettoyer = installerMatchMedia(375)
    afficher()
    const carte = screen.getAllByRole("listitem")[0]
    expect(carte.textContent).not.toContain("Motif :")
    nettoyer()
  })

  it("affiche une action par carte quand actionCarte est fourni", () => {
    const nettoyer = installerMatchMedia(375)
    afficher({ actionCarte: (l) => <button>Détails {l.article}</button> })
    expect(
      screen.getByRole("button", { name: "Détails Ciment 50kg" })
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Détails Sable fin" })
    ).toBeTruthy()
    nettoyer()
  })

  it("n'affiche aucune action en carte quand actionCarte est omis", () => {
    const nettoyer = installerMatchMedia(375)
    afficher()
    expect(screen.queryAllByRole("button")).toHaveLength(0)
    nettoyer()
  })

  it("utilise libelle comme dt de la paire quand il est fourni, sinon entete", () => {
    const nettoyer = installerMatchMedia(375)
    const colonnesAvecLibelle: ColonneAdaptative<Mouvement>[] = [
      ...COLONNES.slice(0, 2),
      {
        cle: "motif",
        entete: "Motif",
        cellule: (l) => l.motif,
        libelle: "Raison",
      },
    ]
    afficher({ colonnes: colonnesAvecLibelle })
    const carte = screen.getAllByRole("listitem")[0]
    expect(carte.textContent).toContain("Raison")
    expect(carte.textContent).not.toContain("Motif")
    nettoyer()
  })

  it("transmet containerClassName au conteneur de la table à partir de md", () => {
    const nettoyer = installerMatchMedia(1280)
    const { container } = afficher({
      containerClassName: "ma-classe-conteneur",
    })
    expect(
      container.querySelector(
        '[data-slot="table-container"].ma-classe-conteneur'
      )
    ).toBeTruthy()
    nettoyer()
  })

  it("transmet containerClassName à la liste de cartes sous md", () => {
    const nettoyer = installerMatchMedia(375)
    const { container } = afficher({
      containerClassName: "ma-classe-conteneur",
    })
    expect(container.querySelector("ul.ma-classe-conteneur")).toBeTruthy()
    nettoyer()
  })

  it("surClicLigne rend les lignes cliquables et activables au clavier en mode table", () => {
    const nettoyer = installerMatchMedia(1280)
    const clics: string[] = []
    afficher({ surClicLigne: (l) => clics.push(l.id) })

    const lignes = screen.getAllByRole("button")
    expect(lignes).toHaveLength(2)
    expect(lignes[0].tabIndex).toBe(0)

    fireEvent.click(lignes[0])
    fireEvent.keyDown(lignes[1], { key: "Enter" })
    fireEvent.keyDown(lignes[1], { key: " " })

    expect(clics).toEqual(["1", "2", "2"])
    nettoyer()
  })

  it("surClicLigne rend les cartes cliquables et activables au clavier en mode carte", () => {
    const nettoyer = installerMatchMedia(375)
    const clics: string[] = []
    afficher({ surClicLigne: (l) => clics.push(l.id) })

    const cartes = screen.getAllByRole("button")
    expect(cartes).toHaveLength(2)
    expect(cartes[0].tabIndex).toBe(0)

    fireEvent.click(cartes[0])
    fireEvent.keyDown(cartes[1], { key: "Enter" })
    fireEvent.keyDown(cartes[1], { key: " " })

    expect(clics).toEqual(["1", "2", "2"])
    nettoyer()
  })

  it("sans surClicLigne, ni la ligne ni la carte ne portent de sémantique cliquable", () => {
    for (const largeur of [1280, 375]) {
      const nettoyer = installerMatchMedia(largeur)
      const { unmount } = afficher()
      expect(screen.queryAllByRole("button")).toHaveLength(0)
      unmount()
      nettoyer()
    }
  })

  it("classeLigne applique une classe additionnelle à la ligne, en table et en carte", () => {
    for (const largeur of [1280, 375]) {
      const nettoyer = installerMatchMedia(largeur)
      const { container, unmount } = afficher({
        classeLigne: () => "ma-classe-ligne",
      })
      const ligne =
        largeur === 1280
          ? container.querySelector(
              '[data-slot="table-body"] [data-slot="table-row"]'
            )
          : container.querySelector("li")
      expect(ligne?.className).toContain("ma-classe-ligne")
      unmount()
      nettoyer()
    }
  })

  it("un lien dans une cellule ne déclenche pas surClicLigne, en mode table", () => {
    const nettoyer = installerMatchMedia(1280)
    const clics: string[] = []
    const colonnesAvecLien: ColonneAdaptative<Mouvement>[] = [
      ...COLONNES.slice(0, 2),
      {
        cle: "lien",
        entete: "Lien",
        // preventDefault avoids jsdom's "not implemented: navigation" noise —
        // irrelevant here, only the click's propagation is under test.
        cellule: () => (
          <a href="/detail" onClick={(e) => e.preventDefault()}>
            Détail
          </a>
        ),
      },
    ]
    afficher({
      colonnes: colonnesAvecLien,
      surClicLigne: (l) => clics.push(l.id),
    })

    fireEvent.click(screen.getAllByRole("link", { name: "Détail" })[0])
    expect(clics).toEqual([])

    // Activating the row itself still works. `role="button"` overrides the
    // native `row` role here (tracked phase-2 decision, untouched by this
    // fix), so the rows are queried as buttons, as the existing
    // surClicLigne tests above already do.
    fireEvent.click(screen.getAllByRole("button")[0])
    expect(clics).toEqual(["1"])
    nettoyer()
  })

  it("actionCarte ne déclenche pas surClicLigne, en mode carte", () => {
    const nettoyer = installerMatchMedia(375)
    const clics: string[] = []
    const { container } = afficher({
      surClicLigne: (l) => clics.push(l.id),
      actionCarte: () => <button>Détails</button>,
    })

    const boutons = screen.getAllByRole("button", { name: "Détails" })
    fireEvent.click(boutons[0])
    fireEvent.keyDown(boutons[0], { key: "Enter" })
    expect(clics).toEqual([])

    // Activating the card itself still works. `role="button"` overrides the
    // native `listitem` role here (tracked phase-2 decision, untouched by
    // this fix), so the card is queried directly as an `<li>`.
    const carte = container.querySelector("li")
    expect(carte).not.toBeNull()
    fireEvent.click(carte as Element)
    expect(clics).toEqual(["1"])
    nettoyer()
  })

  it("classeCellule applique une classe additionnelle à la cellule, en table et en carte", () => {
    const colonnesAvecClasse: ColonneAdaptative<Mouvement>[] = [
      ...COLONNES.slice(0, 2),
      {
        cle: "motif",
        entete: "Motif",
        cellule: (l) => l.motif,
        classeCellule: "font-mono",
      },
    ]
    for (const largeur of [1280, 375]) {
      const nettoyer = installerMatchMedia(largeur)
      const { container, unmount } = afficher({ colonnes: colonnesAvecClasse })
      const cellule =
        largeur === 1280
          ? Array.from(
              container.querySelectorAll('[data-slot="table-cell"]')
            ).find((td) => td.textContent === "Réception")
          : container.querySelector("dd")
      expect(cellule?.className).toContain("font-mono")
      unmount()
      nettoyer()
    }
  })
})
