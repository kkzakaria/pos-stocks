import { describe, it, expect, afterEach } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { SectionStock } from "@/components/produit/section-stock"
import { installerMatchMedia } from "@/test/media-query"
import { texteMontant } from "@/test/texte-montant"
import { jetons } from "@/test/jetons"
import { valeurPaire } from "@/test/valeur-paire"
import type { LigneStockProduit } from "@/components/produit/types"

const lignes: LigneStockProduit[] = [
  {
    warehouseId: "w1",
    warehouseName: "Boutique S",
    variantId: "v1",
    variantName: "Standard",
    quantity: 4,
    avgCost: 300,
  },
  {
    warehouseId: "w2",
    warehouseName: "Dépôt Central",
    variantId: "v1",
    variantName: "Standard",
    quantity: 10,
    avgCost: 200,
  },
]

const LIGNE_GRAND: LigneStockProduit = {
  warehouseId: "w1",
  warehouseName: "Boutique S",
  variantId: "v2",
  variantName: "Grand",
  quantity: 2,
  avgCost: 500,
}

/**
 * Warehouse and variant names are free user text. The token has no space at
 * all: that is the case `break-words` cannot handle, since
 * `overflow-wrap: break-word` contributes no break opportunity to the
 * min-content width a table column is sized on.
 */
const NOM_HOSTILE = "EntrepotRegionalDeSanPedroZoneIndustrielleNordSecteur7"

/**
 * Total width the footer row actually covers, spans included. The invariant
 * that matters is that it equals the header's column count — asserting the
 * "Total" label's own `colSpan` and the header's column count SEPARATELY
 * leaves both green when the footer's blank cell is deleted as useless, even
 * though every figure then slides one column to the left.
 */
function couverturePied(): number {
  const cellules = document.querySelectorAll("tfoot td")
  return Array.from(cellules).reduce(
    (somme, c) => somme + Number(c.getAttribute("colspan") ?? "1"),
    0
  )
}

/** The card-mode total: a distinct block, deliberately outside the list. */
function blocTotal(): HTMLElement {
  const bloc = document.querySelector<HTMLElement>('[data-slot="stock-total"]')
  if (!bloc) throw new Error("Bloc de synthèse « Total » absent")
  return bloc
}

describe("SectionStock", () => {
  // Cleared by afterEach rather than at the end of each test: a failing
  // assertion would otherwise leak the matchMedia stub into the next test
  // and bury the real cause under a cascade of unrelated failures.
  let nettoyer: (() => void) | undefined

  afterEach(() => {
    nettoyer?.()
    nettoyer = undefined
  })

  it("liste entrepôts, quantités, CMP et total ; une seule variante → pas de colonne Variante", () => {
    render(
      <SectionStock
        lignes={lignes}
        enChargement={false}
        devise="XOF"
        plusieursVariantes={false}
      />
    )
    // matchMedia absent → the hook degrades to the desktop tier, so it is the
    // TABLE tree that must be mounted. Stated explicitly: every other
    // assertion of this test is satisfied by the card tree just as well.
    expect(document.querySelector("table")).toBeTruthy()
    expect(screen.getByText("Boutique S")).toBeTruthy()
    expect(screen.getByText("10")).toBeTruthy()
    expect(screen.getByText(texteMontant(200))).toBeTruthy()
    // Line values: 4 × 300 = 1 200 and 10 × 200 = 2 000
    expect(screen.getByText(texteMontant(1200))).toBeTruthy()
    expect(screen.getByText(texteMontant(2000))).toBeTruthy()
    // Totals: 14 units, value 1 200 + 2 000 = 3 200
    expect(screen.getByText("14")).toBeTruthy()
    expect(screen.getByText(texteMontant(3200))).toBeTruthy()
    expect(screen.queryByText("Variante")).toBeNull()
  })

  it("plusieurs variantes → colonne Variante visible", () => {
    render(
      <SectionStock
        lignes={[...lignes, LIGNE_GRAND]}
        enChargement={false}
        devise="XOF"
        plusieursVariantes
      />
    )
    expect(screen.getByText("Variante")).toBeTruthy()
    expect(screen.getByText("Grand")).toBeTruthy()
  })

  it("liste vide → état vide", () => {
    render(
      <SectionStock
        lignes={[]}
        enChargement={false}
        devise="XOF"
        plusieursVariantes={false}
      />
    )
    const cellule = screen.getByText(/Aucun stock visible pour ce produit\./)
    expect(cellule).toBeTruthy()
    // Longest string of the table (84 characters) in a container that falls
    // to 480 px at the `lg` tier: without this, `TableCell`'s
    // `whitespace-nowrap` puts a horizontal scrollbar under an empty state.
    expect(jetons(cellule)).toContain("whitespace-normal")
  })

  describe("mode table (≥ 768 px)", () => {
    function afficher(
      plusieursVariantes: boolean,
      lignesRendues = lignes,
      enChargement = false
    ) {
      nettoyer = installerMatchMedia(1280)
      render(
        <SectionStock
          lignes={lignesRendues}
          enChargement={enChargement}
          devise="XOF"
          plusieursVariantes={plusieursVariantes}
        />
      )
    }

    it("fait porter au libellé « Total » les seules colonnes de texte, sans variante", () => {
      afficher(false)
      const cellule = screen.getByText("Total")
      expect(cellule.getAttribute("colspan")).toBe("1")
      expect(document.querySelectorAll("thead th")).toHaveLength(4)
      // The invariant the two assertions above only imply: the footer covers
      // the header exactly, so no figure can slide under the wrong heading.
      expect(couverturePied()).toBe(4)
    })

    it("fait porter au libellé « Total » les deux colonnes de texte, avec variante", () => {
      afficher(true, [...lignes, LIGNE_GRAND])
      const cellule = screen.getByText("Total")
      expect(cellule.getAttribute("colspan")).toBe("2")
      expect(document.querySelectorAll("thead th")).toHaveLength(5)
      expect(couverturePied()).toBe(5)
    })

    it("en chargement → squelette de table à la largeur de l'en-tête, sans état vide", () => {
      afficher(true, [], true)
      const lignesSquelette = document.querySelectorAll("tbody tr")
      expect(lignesSquelette.length).toBeGreaterThan(0)
      expect(
        document.querySelectorAll('tbody [data-slot="skeleton"]').length
      ).toBeGreaterThan(0)

      // The column count is forwarded to the skeleton: every skeleton row is
      // as wide as the header, variant column included.
      const colonnes = document.querySelectorAll("thead th").length
      expect(colonnes).toBe(5)
      for (const ligne of lignesSquelette) {
        expect(ligne.querySelectorAll("td")).toHaveLength(colonnes)
      }

      // A skeleton is not an empty state: announcing "aucun stock" while the
      // query is still in flight states something false.
      expect(screen.queryByText(/Aucun stock visible pour ce produit\./)).toBe(
        null
      )
    })

    // jsdom has neither a layout engine nor a cascade: this guards that the
    // class is applied, never that it produces its effect. The effect was
    // measured in a real browser — an unbreakable 120-character warehouse
    // name took the table from 1012 px (identical with `break-words`) down
    // to 736 px, inside its 736 px container.
    it("retient les noms d'entrepôt et de variante insécables", () => {
      afficher(true, [
        {
          ...LIGNE_GRAND,
          warehouseName: NOM_HOSTILE,
          variantName: NOM_HOSTILE,
        },
      ])
      for (const cellule of screen.getAllByText(NOM_HOSTILE)) {
        expect(jetons(cellule)).toContain("wrap-anywhere")
        // `wrap-anywhere` alone is inert here: `TableCell` sets
        // `whitespace-nowrap`, which forbids any wrap in the first place.
        expect(jetons(cellule)).toContain("whitespace-normal")
      }
    })
  })

  describe("mode carte (< 768 px)", () => {
    function afficher(
      plusieursVariantes: boolean,
      lignesRendues = lignes,
      enChargement = false
    ) {
      nettoyer = installerMatchMedia(375)
      render(
        <SectionStock
          lignes={lignesRendues}
          enChargement={enChargement}
          devise="XOF"
          plusieursVariantes={plusieursVariantes}
        />
      )
    }

    it("en chargement → squelette de cartes, sans table ni état vide", () => {
      afficher(false, [], true)
      expect(
        document.querySelectorAll('[data-slot="skeleton"]').length
      ).toBeGreaterThan(0)

      // The loading branch of the card path is the one the phase 2a reports
      // all missed: rendering the empty state instead would tell the user
      // "aucun stock" while the query is still running, and rendering the
      // table skeleton would put a dense scrolling table back at 375 px.
      expect(screen.queryByText(/Aucun stock visible pour ce produit\./)).toBe(
        null
      )
      expect(document.querySelector("table")).toBeNull()
    })

    it('porte un role="list" explicite sur la liste de cartes', () => {
      afficher(false)
      // Redundant in plain HTML, so `getByRole("list")` passes either way.
      // Tailwind's Preflight sets `list-style: none` on every `<ul>`, and
      // VoiceOver on Safari/iOS then drops the list role: the user loses the
      // item count and their position, which table mode announces for free.
      expect(document.querySelector("ul")?.getAttribute("role")).toBe("list")
    })

    it("rend une carte par ligne : entrepôt en titre, valeur en vis-à-vis, puis les paires", () => {
      afficher(false)
      expect(document.querySelector("table")).toBeNull()

      const cartes = screen.getAllByRole("listitem")
      expect(cartes).toHaveLength(2)

      const premiere = cartes[0]
      expect(within(premiere).getByText("Boutique S")).toBeTruthy()
      // Headline figure, opposite the title: 4 × 300 = 1 200.
      expect(within(premiere).getByText(texteMontant(1200))).toBeTruthy()
      expect(valeurPaire(premiere, "Quantité")).toBe("4")
      expect(valeurPaire(premiere, "CMP")).toMatch(texteMontant(300))
    })

    it("garde le total visible, hors de la liste", () => {
      afficher(false)
      const total = blocTotal()
      expect(total.closest("li")).toBeNull()
      expect(within(total).getByText("Total")).toBeTruthy()
      // 1 200 + 2 000 = 3 200, pour 14 unités.
      expect(within(total).getByText(texteMontant(3200))).toBeTruthy()
      expect(valeurPaire(total, "Quantité")).toBe("14")
    })

    it("une seule variante → aucune paire « Variante »", () => {
      afficher(false)
      expect(screen.queryByText("Variante")).toBeNull()
      expect(screen.queryByText("Standard")).toBeNull()
    })

    it("plusieurs variantes → la variante devient une paire de la carte", () => {
      afficher(true, [...lignes, LIGNE_GRAND])
      const cartes = screen.getAllByRole("listitem")
      expect(cartes).toHaveLength(3)
      expect(valeurPaire(cartes[0], "Variante")).toBe("Standard")
      expect(valeurPaire(cartes[2], "Variante")).toBe("Grand")
    })

    it("liste vide → état vide, sans bloc de total", () => {
      afficher(false, [])
      expect(
        screen.getByText(/Aucun stock visible pour ce produit\./)
      ).toBeTruthy()
      expect(screen.queryAllByRole("listitem")).toHaveLength(0)
      expect(document.querySelector('[data-slot="stock-total"]')).toBeNull()
    })

    it("ne perd aucune donnée en passant en carte", () => {
      afficher(true, [...lignes, LIGNE_GRAND])
      const cartes = screen.getAllByRole("listitem")

      // Every column the table renders must resurface in the card: the
      // warehouse as the title, the value opposite it, the rest as pairs.
      const attendus: [string, string, string, RegExp | string][] = [
        ["Boutique S", "Standard", "4", texteMontant(1200)],
        ["Dépôt Central", "Standard", "10", texteMontant(2000)],
        ["Boutique S", "Grand", "2", texteMontant(1000)],
      ]
      attendus.forEach(([entrepot, variante, quantite, valeur], i) => {
        const carte = cartes[i]
        expect(within(carte).getByText(entrepot)).toBeTruthy()
        expect(valeurPaire(carte, "Variante")).toBe(variante)
        expect(valeurPaire(carte, "Quantité")).toBe(quantite)
        expect(within(carte).getByText(valeur)).toBeTruthy()
      })
      expect(valeurPaire(cartes[0], "CMP")).toMatch(texteMontant(300))
      expect(valeurPaire(cartes[1], "CMP")).toMatch(texteMontant(200))
      expect(valeurPaire(cartes[2], "CMP")).toMatch(texteMontant(500))

      // Totals: 16 units, 1 200 + 2 000 + 1 000 = 4 200.
      const total = blocTotal()
      expect(valeurPaire(total, "Quantité")).toBe("16")
      expect(within(total).getByText(texteMontant(4200))).toBeTruthy()
    })

    it("n'affiche aucune donnée deux fois en carte", () => {
      afficher(true, [...lignes, LIGNE_GRAND])

      // The mirror image of the test above. The warehouse is carried by the
      // title and the line value by the headline figure, so neither may ALSO
      // appear as a label/value pair — a duplicate is invisible to a
      // presence-only assertion, and makes a screen reader read the row twice.
      expect(screen.queryByText("Entrepôt")).toBeNull()
      expect(screen.queryByText("Valeur")).toBeNull()
      expect(screen.getAllByText("Dépôt Central")).toHaveLength(1)
      expect(screen.getAllByText(texteMontant(2000))).toHaveLength(1)

      // "Boutique S" holds two rows, hence exactly two occurrences — one per
      // card, never four.
      expect(screen.getAllByText("Boutique S")).toHaveLength(2)

      // The total left the list: it must not have stayed in it as well.
      expect(screen.getAllByText("Total")).toHaveLength(1)
      expect(screen.getAllByText(texteMontant(4200))).toHaveLength(1)
    })

    // Same caveat as in table mode: jsdom checks the class, not its effect.
    // In a card the flex row is the real trap — an item's `min-width: auto`
    // resolves to min-content, so `break-words` can only break the token once
    // `min-w-0` lets the item shrink below it.
    it("retient les valeurs insécables dans la carte", () => {
      afficher(true, [
        {
          ...LIGNE_GRAND,
          warehouseName: NOM_HOSTILE,
          variantName: NOM_HOSTILE,
        },
      ])
      const carte = screen.getAllByRole("listitem")[0]
      const titre = within(carte).getAllByText(NOM_HOSTILE)[0]
      expect(jetons(titre)).toContain("min-w-0")
      expect(jetons(titre)).toContain("break-words")

      const dt = within(carte).getByText("Variante")
      const dd = dt.nextElementSibling
      expect(jetons(dd)).toContain("min-w-0")
      expect(jetons(dd)).toContain("break-words")
    })
  })
})
