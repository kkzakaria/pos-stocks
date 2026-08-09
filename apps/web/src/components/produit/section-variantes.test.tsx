import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, within, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { SectionVariantes } from "@/components/produit/section-variantes"
import { installerMatchMedia } from "@/test/media-query"
import { texteMontant } from "@/test/texte-montant"
import { jetons } from "@/test/jetons"
import type { Produit, Variante } from "@/components/produit/types"

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(() => Promise.resolve({})),
  apiUrl: (chemin: string) => chemin,
}))

afterEach(() => vi.clearAllMocks())

// Cleared by afterEach rather than at the end of each test: a failing
// assertion would otherwise leak the matchMedia stub into the next test and
// bury the real cause under a cascade of unrelated failures.
let nettoyer: (() => void) | undefined

afterEach(() => {
  nettoyer?.()
  nettoyer = undefined
})

function produitAvec(trackLots: boolean): Produit {
  return {
    id: "p1",
    name: "Article",
    sku: "PRD-1",
    description: null,
    categoryId: null,
    barcode: null,
    price: 5000,
    minPrice: null,
    defaultMinStock: null,
    hasVariants: true,
    isActive: true,
    trackLots,
    imageKey: null,
    variants: [
      {
        id: "v1",
        name: "Standard",
        sku: "PRD-1-STD",
        attributes: "{}",
        barcode: null,
        priceOverride: null,
        minPriceOverride: null,
        isActive: true,
        lots: [
          { id: "l1", lotNumber: "LOT-A", expiryDate: "2020-01-01" },
          { id: "l2", lotNumber: "LOT-B", expiryDate: null },
        ],
      },
    ],
  }
}

function rendre(produit: Produit, peutEcrire = true) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SectionVariantes
        produit={produit}
        productId="p1"
        peutEcrire={peutEcrire}
        devise="XOF"
        onModifie={() => Promise.resolve()}
      />
    </QueryClientProvider>
  )
}

describe("SectionVariantes — lots imbriqués", () => {
  it("trackLots : les lots s'affichent sous leur variante, avec badge Expiré", () => {
    rendre(produitAvec(true))
    expect(screen.getByText("LOT-A")).toBeTruthy()
    expect(screen.getByText("LOT-B")).toBeTruthy()
    expect(screen.getByText("Expiré")).toBeTruthy()
    expect(screen.getByText("sans péremption")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Ajouter un lot" })).toBeTruthy()
  })

  it("sans trackLots : aucune ligne de lots", () => {
    rendre(produitAvec(false))
    expect(screen.queryByText("LOT-A")).toBeNull()
    expect(screen.queryByRole("button", { name: "Ajouter un lot" })).toBeNull()
  })
})

/** Active, overriding the product's price, and carrying two lots. */
const VARIANTE_ACTIVE: Variante = {
  id: "v1",
  name: "Standard",
  sku: "PRD-1-STD",
  attributes: '{"taille":"M"}',
  barcode: null,
  priceOverride: 7000,
  minPriceOverride: null,
  isActive: true,
  lots: [
    { id: "l1", lotNumber: "LOT-A", expiryDate: "2020-01-01" },
    { id: "l2", lotNumber: "LOT-B", expiryDate: null },
  ],
}

/**
 * Inactive, no attributes, no price override — and it DOES carry a lot, on
 * purpose: an inactive variant's lots are never listed, so "LOT-C" is the
 * probe that both trees agree on that rule.
 */
const VARIANTE_INACTIVE: Variante = {
  id: "v2",
  name: "Grand",
  sku: "PRD-1-GRD",
  attributes: "{}",
  barcode: null,
  priceOverride: null,
  minPriceOverride: null,
  isActive: false,
  lots: [{ id: "l3", lotNumber: "LOT-C", expiryDate: null }],
}

function produitDeuxVariantes(trackLots = true): Produit {
  return {
    ...produitAvec(trackLots),
    variants: [VARIANTE_ACTIVE, VARIANTE_INACTIVE],
  }
}

/**
 * Variant names, attribute values and supplier lot numbers are free user
 * text. These tokens have no space at all: that is the case `break-words`
 * cannot handle, since `overflow-wrap: break-word` contributes no break
 * opportunity to the min-content width a table column is sized on.
 */
const NOM_HOSTILE = "VarianteFormatIndustrielPaletteCompleteVingtQuatreUnites"
const LOT_HOSTILE = "LOTFOURNISSEUREXTERNE2026SEMAINE32PALETTE0004718"

function produitHostile(): Produit {
  return {
    ...produitAvec(true),
    variants: [
      {
        ...VARIANTE_ACTIVE,
        name: NOM_HOSTILE,
        sku: NOM_HOSTILE,
        attributes: JSON.stringify({ conditionnement: NOM_HOSTILE }),
        lots: [{ id: "l1", lotNumber: LOT_HOSTILE, expiryDate: null }],
      },
    ],
  }
}

/**
 * The same hostile lot, given an expiry date: the exact pairing the 1024 px
 * measurement caught, where one cell holds a value that MUST fold (the
 * supplier reference) next to one that must never be broken (the date).
 * A fixture of its own rather than an expiry added to `produitHostile`, so
 * the cases asserting on "sans péremption" keep their subject.
 */
const PEREMPTION_HOSTILE = "2027-03-15"

function produitHostileAvecPeremption(): Produit {
  const [variante] = produitHostile().variants
  return {
    ...produitAvec(true),
    variants: [
      {
        ...variante,
        lots: [
          {
            id: "l1",
            lotNumber: LOT_HOSTILE,
            expiryDate: PEREMPTION_HOSTILE,
          },
        ],
      },
    ],
  }
}

/**
 * Active, lot-tracked, and carrying NO lot: the only path by which a first
 * lot can ever be created, and the one the three fixtures above all miss.
 */
const VARIANTE_SANS_LOT: Variante = {
  id: "v3",
  name: "Petit",
  sku: "PRD-1-PTT",
  attributes: "{}",
  barcode: null,
  priceOverride: null,
  minPriceOverride: null,
  isActive: true,
  lots: [],
}

function produitVarianteSansLot(): Produit {
  return { ...produitAvec(true), variants: [VARIANTE_SANS_LOT] }
}

/**
 * Two active variants sharing a NAME and differing only by SKU — a state the
 * database allows, since no uniqueness constraint covers a variant name. It
 * is what forces the accessible name of a lots list to carry the SKU.
 */
function produitVariantesHomonymes(): Produit {
  return {
    ...produitAvec(true),
    variants: [
      VARIANTE_ACTIVE,
      {
        ...VARIANTE_ACTIVE,
        id: "v4",
        sku: "PRD-1-BIS",
        lots: [{ id: "l4", lotNumber: "LOT-D", expiryDate: null }],
      },
    ],
  }
}

/**
 * The variant cards. Card mode nests a lots list inside each card, so
 * `getAllByRole("listitem")` legitimately returns lot items too — hence the
 * named outer list, and the parent check that keeps only its own items.
 */
function cartes(): HTMLElement[] {
  const liste = screen.getByRole("list", { name: "Variantes" })
  return within(liste)
    .getAllByRole("listitem")
    .filter((item) => item.parentElement === liste)
}

/**
 * The lots list of one variant, in either tree — they share their name. The
 * SKU is required, not optional: a variant name is not unique in the database,
 * so it alone cannot designate a list. Spelled out here rather than imported
 * from the component, so a name that stopped carrying the SKU fails here.
 */
function listeLots(nomVariante: string, sku: string): HTMLElement {
  return screen.getByRole("list", { name: `Lots de ${nomVariante} (${sku})` })
}

/**
 * Card mode renders the remaining columns as `<dt>`/`<dd>` pairs inside a
 * `<dl>` — reading the `<dd>` next to a given `<dt>` targets that specific
 * pair instead of the card's whole `textContent`, which another field can
 * satisfy by coincidence.
 */
function valeurPaire(bloc: HTMLElement, libelle: string): string {
  const dt = within(bloc).getByText(libelle)
  const dd = dt.nextElementSibling
  if (!(dd instanceof HTMLElement)) {
    throw new Error(`Aucune <dd> associée au libellé « ${libelle} »`)
  }
  return dd.textContent
}

/** The full-width lots row of table mode, and the span it actually covers. */
function celluleLots(): HTMLElement {
  const cellule = document.querySelector<HTMLElement>("tbody td[colspan]")
  if (!cellule) throw new Error("Ligne de lots absente du tableau")
  return cellule
}

describe("SectionVariantes — mode table (≥ 768 px)", () => {
  function afficher(produit: Produit, peutEcrire = true) {
    nettoyer = installerMatchMedia(1280)
    rendre(produit, peutEcrire)
  }

  it("rend le tableau, pas les cartes", () => {
    afficher(produitDeuxVariantes())
    expect(document.querySelector("table")).toBeTruthy()
    expect(screen.queryByRole("list", { name: "Variantes" })).toBeNull()
  })

  it("annonce les lots comme une liste, avec leur décompte", () => {
    afficher(produitDeuxVariantes())
    // The contract has to be symmetric with card mode: siblings separated by
    // a `gap` announce as one continuous run of cell text, and on a variant
    // with several lots a screen-reader user can no longer tell which number
    // the "Expiré" badge belongs to. Losing that to width alone is the very
    // defect the explicit `role="list"` guards against on the other side.
    const liste = listeLots("Standard", "PRD-1-STD")
    expect(within(liste).getAllByRole("listitem")).toHaveLength(2)
    // Named, so the two levels of list are told apart by a reader jumping
    // from one to the next — and by this suite, without a test-only slot.
    expect(liste.getAttribute("role")).toBe("list")
  })

  it("distingue deux listes de lots de variantes homonymes", () => {
    // A variant NAME carries no uniqueness constraint in the database (only
    // the SKU does, per organisation), so two variants of one product can
    // legitimately share a name. Named on the name alone, their lots lists
    // would be indistinguishable to a reader jumping from list to list — and
    // `getByRole` would throw on the ambiguity, which is what makes this case
    // bite.
    afficher(produitVariantesHomonymes())
    expect(
      within(listeLots("Standard", "PRD-1-STD")).getAllByRole("listitem")
    ).toHaveLength(2)
    expect(
      within(listeLots("Standard", "PRD-1-BIS")).getAllByRole("listitem")
    ).toHaveLength(1)
  })

  it("fait couvrir à la ligne de lots toute la largeur, colonne d'action comprise", () => {
    afficher(produitDeuxVariantes())
    // The invariant that matters: the lots row spans the header EXACTLY.
    // Asserting a bare `colspan === 6` would stay green if a column were
    // added to the header, leaving the lots row one column short.
    const colonnes = document.querySelectorAll("thead th").length
    expect(colonnes).toBe(6)
    expect(Number(celluleLots().getAttribute("colspan"))).toBe(colonnes)
  })

  it("en lecture seule : ni colonne d'action, ni bouton, et la ligne de lots suit", () => {
    afficher(produitDeuxVariantes(), false)
    const colonnes = document.querySelectorAll("thead th").length
    expect(colonnes).toBe(5)
    expect(Number(celluleLots().getAttribute("colspan"))).toBe(colonnes)
    expect(screen.queryByRole("button", { name: "Désactiver" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Ajouter un lot" })).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Ajouter une variante" })
    ).toBeNull()
    // Read-only hides the ACTIONS, never the data.
    expect(screen.getByText("LOT-A")).toBeTruthy()
    expect(screen.getByText("Inactive")).toBeTruthy()
  })

  it("n'affiche pas les lots d'une variante inactive", () => {
    afficher(produitDeuxVariantes())
    expect(screen.getByText("LOT-A")).toBeTruthy()
    expect(screen.queryByText("LOT-C")).toBeNull()
    // One lots row for the single active variant, not one per variant.
    expect(document.querySelectorAll("tbody td[colspan]")).toHaveLength(1)
  })

  it("variante sans lot : le libellé d'absence et le bouton d'ajout restent", () => {
    afficher(produitVarianteSansLot())
    expect(within(celluleLots()).getByText("aucun")).toBeTruthy()
    expect(
      screen.queryByRole("list", { name: "Lots de Petit (PRD-1-PTT)" })
    ).toBeNull()
    // The empty list is exactly where the button matters: it is the only way
    // a first lot can be created, so gating it on `lots.length` would make
    // the feature unreachable — silently, since nothing else would change.
    expect(
      within(celluleLots()).getByRole("button", { name: "Ajouter un lot" })
    ).toBeTruthy()
  })

  // jsdom has neither a layout engine nor a cascade: this guards that the
  // class is APPLIED, never that it produces its effect. The effect was
  // measured in Chrome on the product sheet at a 1024 px viewport, the tier
  // where this section's container is at its narrowest: 2 256 px of table
  // with `whitespace-nowrap`, 1 717 px with `whitespace-normal break-words`,
  // 470 px once every free-text cell carries the two tokens — i.e. back
  // inside the container, which measures 480 px on a page short enough to
  // have no vertical scrollbar and 470 px once it has one. See the JSDoc of
  // `TableVariantes` for why the treated table is the case that summons it.
  it("retient les noms, SKU, attributs et numéros de lot insécables", () => {
    afficher(produitHostile())
    const cellules = [
      ...screen.getAllByText(NOM_HOSTILE),
      screen.getByText(`conditionnement : ${NOM_HOSTILE}`),
      celluleLots(),
    ]
    for (const cellule of cellules) {
      expect(jetons(cellule)).toContain("wrap-anywhere")
      // `wrap-anywhere` alone is inert here: `TableCell` sets
      // `whitespace-nowrap`, which forbids any wrap in the first place.
      expect(jetons(cellule)).toContain("whitespace-normal")
    }
  })

  // The mirror image of the case above, and the reason it is a separate one:
  // `TEXTE_LIBRE` sets `overflow-wrap: anywhere` on the cell and that property
  // INHERITS, so it reached a value that must never be broken. Measured in
  // Chrome at the 1024 px tier — where this section's container is at its
  // narrowest, 470 px — "15/03/2027" was laid out over TWO line boxes,
  // "15/0" then "3/2027"; with `whitespace-nowrap` it is back to one, at 375
  // and 1280 as well, and the container still measures 470 px with no
  // overflow. jsdom checks the class, not the effect.
  it("ne coupe pas une date de péremption, sans désarmer le numéro de lot", () => {
    afficher(produitHostileAvecPeremption())

    const date = screen.getByText("15/03/2027")
    expect(jetons(date)).toContain("whitespace-nowrap")

    // The other half of the contract: the supplier lot number IS free text
    // and must keep folding, otherwise the cell overflows again. A blanket
    // `whitespace-nowrap` on the whole row would pass the assertion above and
    // fail here.
    const numero = screen.getByText(LOT_HOSTILE)
    expect(jetons(numero)).toContain("break-words")
    expect(jetons(numero)).not.toContain("whitespace-nowrap")
    expect(jetons(celluleLots())).toContain("wrap-anywhere")
  })
})

describe("SectionVariantes — dialogue « Nouvelle variante »", () => {
  /**
   * The attribute pairs stack below `sm`, where the gap INSIDE a pair and the
   * gap BETWEEN two pairs are the only thing telling one pair from the next.
   * Measured in Chrome at 375 px: 8 px inside, 12 px between — a ratio of 1.5,
   * i.e. a 4 px difference in a dialog whose other transitions measure 32 to
   * 38 px, so the pairs read as one run of anonymous fields. `gap-6` takes the
   * outer gap to 24 px (ratio 3.0) while staying below those transitions, so a
   * pair stays inside the "Attributs" group instead of reading as a section.
   * `sm:gap-2` is asserted alongside: from `sm` on each pair is a single row
   * and needs no separation, and the measured desktop gap must stay 8 px.
   * jsdom resolves no media query here — it checks the classes, not the px.
   */
  it("sépare les paires d'attributs empilées sans toucher à la géométrie desktop", () => {
    nettoyer = installerMatchMedia(375)
    rendre(produitDeuxVariantes(), true)

    fireEvent.click(
      screen.getByRole("button", { name: "Ajouter une variante" })
    )
    const paire = screen.getByLabelText("Clé de l'attribut 1").parentElement
    const enveloppe = paire?.parentElement ?? null

    expect(jetons(enveloppe)).toContain("gap-6")
    expect(jetons(enveloppe)).toContain("sm:gap-2")
    // The premise: the outer gap only separates anything while the pair is a
    // COLUMN. Turn the pair into a row below `sm` and the two gaps stop being
    // comparable, which would leave the assertion above green and meaningless.
    expect(jetons(paire)).toContain("flex-col")
    expect(jetons(paire)).toContain("gap-2")
  })
})

describe("SectionVariantes — mode carte (< 768 px)", () => {
  function afficher(produit: Produit, peutEcrire = true) {
    nettoyer = installerMatchMedia(375)
    rendre(produit, peutEcrire)
  }

  // The component has no loading branch of its own: the product sheet renders
  // its own skeleton while the query is in flight and only mounts this
  // section once `produit` exists. There is therefore no `isPending` path to
  // migrate here — the phase-2a trap does not apply.

  it("rend une carte par variante, pas de tableau", () => {
    afficher(produitDeuxVariantes())
    expect(document.querySelector("table")).toBeNull()
    expect(cartes()).toHaveLength(2)
  })

  it('porte un role="list" explicite sur la liste de cartes et sur celle des lots', () => {
    afficher(produitDeuxVariantes())
    // Redundant in plain HTML, so `getByRole("list")` passes either way.
    // Tailwind's Preflight sets `list-style: none` on every `<ul>`, and
    // VoiceOver on Safari/iOS then drops the list role: the user loses the
    // item count and their position, which table mode announces for free.
    const listes = document.querySelectorAll("ul")
    expect(listes.length).toBeGreaterThan(0)
    for (const liste of listes) {
      expect(liste.getAttribute("role")).toBe("list")
    }
  })

  it("nomme les deux niveaux de liste, celui des lots par sa variante", () => {
    afficher(produitDeuxVariantes())
    // Without a name a reader jumping from list to list hears "liste, 2
    // éléments" twice with no way to tell which is which, and the visible
    // « Lots : » label has no programmatic tie to the list it introduces.
    expect(screen.getByRole("list", { name: "Variantes" })).toBeTruthy()
    expect(
      within(listeLots("Standard", "PRD-1-STD")).getAllByRole("listitem")
    ).toHaveLength(2)
  })

  it("compose la carte : nom en titre, prix en vis-à-vis, puis SKU, attributs et statut", () => {
    afficher(produitDeuxVariantes())
    const [active, inactive] = cartes()

    expect(within(active).getByText("Standard")).toBeTruthy()
    // Headline figure opposite the title: the variant's own override.
    expect(within(active).getByText(texteMontant(7000))).toBeTruthy()
    expect(valeurPaire(active, "SKU")).toBe("PRD-1-STD")
    expect(valeurPaire(active, "Attributs")).toBe("taille : M")
    expect(valeurPaire(active, "Statut")).toBe("Active")
    expect(
      within(active).getByRole("button", { name: "Désactiver" })
    ).toBeTruthy()

    // No override: the price falls back to the product's, 5 000.
    expect(within(inactive).getByText(texteMontant(5000))).toBeTruthy()
    expect(valeurPaire(inactive, "Attributs")).toBe("—")
    expect(valeurPaire(inactive, "Statut")).toBe("Inactive")
    expect(
      within(inactive).getByRole("button", { name: "Réactiver" })
    ).toBeTruthy()
  })

  it("garde les lots dans la carte de leur variante, numéro, date et badge Expiré", () => {
    afficher(produitDeuxVariantes())
    const [active, inactive] = cartes()

    // Audit information: it survives the fallback to cards in full.
    const bloc = listeLots("Standard", "PRD-1-STD")
    expect(bloc.parentElement?.closest("li")).toBe(active)
    expect(within(bloc).getByText("LOT-A")).toBeTruthy()
    expect(within(bloc).getByText("Expiré")).toBeTruthy()
    expect(within(bloc).getByText("LOT-B")).toBeTruthy()
    expect(within(bloc).getByText("sans péremption")).toBeTruthy()
    expect(
      within(active).getByRole("button", { name: "Ajouter un lot" })
    ).toBeTruthy()

    // The lot number keeps its monospace rendering — it is a reference to be
    // read character by character, not prose.
    expect(jetons(within(bloc).getByText("LOT-A"))).toContain("font-mono")

    // An inactive variant lists no lot, in card mode exactly as in table mode.
    expect(within(inactive).queryByText("Lots :")).toBeNull()
    expect(screen.queryByText("LOT-C")).toBeNull()
  })

  it("variante sans lot : le libellé d'absence et le bouton d'ajout restent", () => {
    afficher(produitVarianteSansLot())
    const [carte] = cartes()
    expect(within(carte).getByText("Lots :")).toBeTruthy()
    expect(within(carte).getByText("aucun")).toBeTruthy()
    expect(
      screen.queryByRole("list", { name: "Lots de Petit (PRD-1-PTT)" })
    ).toBeNull()
    // Same reason as in table mode: an empty list is precisely the state the
    // button exists for.
    expect(
      within(carte).getByRole("button", { name: "Ajouter un lot" })
    ).toBeTruthy()
  })

  it("sans trackLots : aucun bloc de lots en carte", () => {
    afficher(produitDeuxVariantes(false))
    expect(cartes()).toHaveLength(2)
    expect(screen.queryByText("Lots :")).toBeNull()
    expect(screen.queryByText("LOT-A")).toBeNull()
    expect(screen.queryByRole("button", { name: "Ajouter un lot" })).toBeNull()
  })

  it("en lecture seule : aucune action, mais toute la donnée", () => {
    afficher(produitDeuxVariantes(), false)
    expect(cartes()).toHaveLength(2)
    expect(screen.queryByRole("button", { name: "Désactiver" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Réactiver" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Ajouter un lot" })).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Ajouter une variante" })
    ).toBeNull()
    expect(screen.getByText("LOT-A")).toBeTruthy()
    expect(valeurPaire(cartes()[0], "Statut")).toBe("Active")
  })

  it("ne perd aucune donnée en passant en carte", () => {
    afficher(produitDeuxVariantes())
    const [active, inactive] = cartes()

    // Every column the table renders must resurface in the card: the name as
    // the title, the price opposite it, the rest as pairs, the lots inside.
    const attendus: [HTMLElement, string, string, string, string, RegExp][] = [
      [
        active,
        "Standard",
        "PRD-1-STD",
        "taille : M",
        "Active",
        texteMontant(7000),
      ],
      [inactive, "Grand", "PRD-1-GRD", "—", "Inactive", texteMontant(5000)],
    ]
    for (const [carte, nom, sku, attributs, statut, prix] of attendus) {
      expect(within(carte).getByText(nom)).toBeTruthy()
      expect(valeurPaire(carte, "SKU")).toBe(sku)
      expect(valeurPaire(carte, "Attributs")).toBe(attributs)
      expect(valeurPaire(carte, "Statut")).toBe(statut)
      expect(within(carte).getByText(prix)).toBeTruthy()
    }
    expect(within(active).getByText("LOT-A")).toBeTruthy()
    expect(within(active).getByText("LOT-B")).toBeTruthy()
  })

  it("n'affiche aucune donnée deux fois en carte", () => {
    afficher(produitDeuxVariantes())

    // The mirror image of the test above. The name is carried by the title
    // and the price by the headline figure, so neither may ALSO appear as a
    // label/value pair — a duplicate is invisible to a presence-only
    // assertion, and makes a screen reader read the variant twice.
    expect(screen.queryByText("Nom")).toBeNull()
    expect(screen.queryByText("Prix")).toBeNull()
    expect(screen.getAllByText("Standard")).toHaveLength(1)
    expect(screen.getAllByText("PRD-1-STD")).toHaveLength(1)
    expect(screen.getAllByText(texteMontant(7000))).toHaveLength(1)
    expect(screen.getAllByText("Active")).toHaveLength(1)
    expect(screen.getAllByText("LOT-A")).toHaveLength(1)
    // One toggle per variant, never one per tree.
    expect(screen.getAllByRole("button", { name: "Désactiver" })).toHaveLength(
      1
    )
    expect(
      screen.getAllByRole("button", { name: "Ajouter un lot" })
    ).toHaveLength(1)
  })

  // Same caveat as in table mode: jsdom checks the class, not its effect. In
  // a card the flex ROW is the real trap — an item's `min-width: auto`
  // resolves to min-content, so `break-words` can only break the token once
  // `min-w-0` lets the item shrink below it.
  it("retient les valeurs insécables dans la carte", () => {
    afficher(produitHostile())
    const carte = cartes()[0]

    const titre = within(carte).getAllByText(NOM_HOSTILE)[0]
    expect(jetons(titre)).toContain("min-w-0")
    expect(jetons(titre)).toContain("break-words")

    const dd = within(carte).getByText("SKU").nextElementSibling
    expect(jetons(dd)).toContain("min-w-0")
    expect(jetons(dd)).toContain("break-words")

    const numero = within(carte).getByText(LOT_HOSTILE)
    expect(jetons(numero)).toContain("min-w-0")
    expect(jetons(numero)).toContain("break-words")
  })
})
