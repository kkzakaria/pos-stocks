import { render, screen, within, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import { installerMatchMedia } from "@/test/media-query"
import { texteMontant } from "@/test/texte-montant"
import { jetons } from "@/test/jetons"
import {
  COLONNES_RECEPTIONS,
  ReceptionsPage,
  sousTitreReception,
  titreReception,
  valeurReception,
} from "./index"
import type { ReceptionListe } from "./index"

// The mock serialises `params.purchaseId` into the href: without it, pointing
// the link at the wrong receipt — or at the list itself — would satisfy any
// assertion that only checks an <a> exists. `useNavigate` is stubbed too, so
// the page can mount without a router.
vi.mock("@tanstack/react-router", async () => {
  const reel = await vi.importActual<Record<string, unknown>>(
    "@tanstack/react-router"
  )
  return {
    ...reel,
    useNavigate: () => () => undefined,
    Link: ({
      children,
      params,
    }: {
      children: React.ReactNode
      params?: { purchaseId?: string }
    }) => (
      // `preventDefault` and NOT `stopPropagation`: jsdom would otherwise
      // schedule a real navigation that lands AFTER the test ends and gets
      // reported against the NEXT one — an error attached to a case that never
      // caused it. Propagation must keep bubbling, since that is what exercises
      // the row-click guard.
      <a
        href={`/stock/receptions/${params?.purchaseId ?? ""}`}
        onClick={(e) => e.preventDefault()}
      >
        {children}
      </a>
    ),
  }
})

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn((chemin: string) => {
    if (chemin.startsWith("/api/v1/suppliers")) {
      return Promise.resolve({
        suppliers: [{ id: "f1", name: "Sotra Distribution", isActive: true }],
      })
    }
    // One receipt, not an empty list: the page-level cases below assert how the
    // screen WIRES the list (which function it hands to `titre`), and an empty
    // list would only ever render the empty state.
    return Promise.resolve({
      purchases: [
        {
          id: "p1",
          warehouseId: "w1",
          warehouseName: "Boutique Centre",
          supplierId: "f1",
          supplierName: "Sotra Distribution",
          reference: "BL-2026-0042",
          status: "draft",
          itemCount: 3,
          totalCost: 1250000,
          createdAt: "2026-08-07T09:00:00.000Z",
        },
      ],
      total: 1,
      page: 1,
      limite: 50,
    })
  }),
  apiUrl: (chemin: string) => chemin,
}))

// Both hooks read the router context, which no test mounts. A write-capable
// account is what makes the creation dialog — and its two selects — exist.
vi.mock("@/lib/permissions", () => ({
  useAccesStock: () => ({
    lecture: true,
    lectureTous: true,
    entrepotsLecture: [],
    ecritureTous: true,
    entrepotsEcriture: [],
  }),
}))

vi.mock("@/lib/stock", () => ({
  useEntrepotsVisibles: () => ({
    options: [{ id: "w1", name: "Boutique Centre" }],
    isPending: false,
  }),
}))

const R: ReceptionListe = {
  id: "p1",
  warehouseId: "w1",
  warehouseName: "Boutique Centre",
  supplierId: "f1",
  supplierName: "Sotra Distribution",
  reference: "BL-2026-0042",
  status: "draft",
  createdAt: "2026-08-07T10:30:00.000Z",
  receivedAt: null,
  itemCount: 3,
  totalCost: 1250000,
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

describe("colonnes de la liste des réceptions", () => {
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
      <ListeAdaptative<ReceptionListe>
        colonnes={COLONNES_RECEPTIONS}
        lignes={[R]}
        cleLigne={(r) => r.id}
        titre={titreReception}
        valeur={valeurReception}
        sousTitre={sousTitreReception}
        surClicLigne={surClicLigne}
      />
    )
    return { surClicLigne }
  }

  it("expose 7 colonnes", () => {
    expect(COLONNES_RECEPTIONS).toHaveLength(7)
  })

  it("rend les 7 en-têtes en table à 1280 px", () => {
    afficher(1280)
    for (const entete of [
      "Date",
      "Entrepôt",
      "Fournisseur",
      "Référence",
      "Lignes",
      "Total",
      "Statut",
    ]) {
      expect(screen.getByText(entete)).toBeTruthy()
    }
    // No action column on this screen: every header is named, so the count
    // must match the named ones exactly.
    expect(screen.getAllByRole("columnheader")).toHaveLength(7)
  })

  it("formate le total de la réception", () => {
    afficher(1280)
    expect(screen.getByText(texteMontant(1250000))).toBeTruthy()
  })

  it("porte le lien vers la fiche exactement une fois à 375 px", () => {
    afficher(375)
    const carte = screen.getAllByRole("listitem")[0]
    const liens = within(carte).getAllByRole("link")
    expect(liens).toHaveLength(1)
    expect(liens[0].getAttribute("href")).toBe("/stock/receptions/p1")
    expect(liens[0].textContent).toBe("Sotra Distribution")
  })

  it("porte le même lien dans la cellule « Fournisseur » en table", () => {
    afficher(1280)
    expect(
      screen.getByText("Sotra Distribution").closest("a")?.getAttribute("href")
    ).toBe("/stock/receptions/p1")
  })

  it("ne déclenche pas surClicLigne au clic sur le lien de la fiche", () => {
    const { surClicLigne } = afficher(375)
    fireEvent.click(screen.getByText("Sotra Distribution"))
    expect(surClicLigne).not.toHaveBeenCalled()
  })

  it("ne duplique aucune colonne masquée en mode carte", () => {
    afficher(375)
    const carte = screen.getAllByRole("listitem")[0]

    // Each `masquerEnCarte` column resurfaces through titre/valeur/sousTitre, so
    // it must NOT also appear as a label/value pair. Dropping a flag would render
    // the data twice — invisible to a presence-only assertion.
    expect(within(carte).queryByText("Fournisseur")).toBeNull()
    expect(within(carte).queryByText("Date")).toBeNull()
    expect(within(carte).queryByText("Total")).toBeNull()
    // …and the data itself exists exactly once.
    expect(within(carte).getAllByText("Sotra Distribution")).toHaveLength(1)
    expect(within(carte).getAllByText(texteMontant(1250000))).toHaveLength(1)
    expect(within(carte).getAllByText("07/08/2026")).toHaveLength(1)
  })

  it("garde les 4 colonnes visibles en paires à 375 px", () => {
    afficher(375)
    const carte = screen.getAllByRole("listitem")[0]

    // The positive counterpart: these columns go through `paires` by
    // construction, but the assertion keeps the coverage explicit.
    expect(valeurPaire(carte, "Entrepôt")).toBe("Boutique Centre")
    expect(valeurPaire(carte, "Référence")).toBe("BL-2026-0042")
    expect(valeurPaire(carte, "Lignes")).toBe("3")
    expect(valeurPaire(carte, "Statut")).toBe("Brouillon")
  })

  // jsdom has neither a layout engine nor a CSS cascade: these two cases guard
  // that the classes are APPLIED to the right cells, never that they produce
  // their effect — that is measured in the browser.
  it("porte les deux jetons de texte libre sur l'entrepôt, le fournisseur et la référence", () => {
    afficher(1280)
    const cellules = [
      screen.getByText("Boutique Centre").closest("td"),
      screen.getByText("Sotra Distribution").closest("td"),
      screen.getByText("BL-2026-0042").closest("td"),
    ]

    for (const cellule of cellules) {
      expect(jetons(cellule)).toContain("wrap-anywhere")
      // `wrap-anywhere` alone is inert: `TableCell` sets `whitespace-nowrap`,
      // which forbids any wrap in the first place. See the JSDoc of
      // `TEXTE_LIBRE` in `components/ui/table.tsx`.
      expect(jetons(cellule)).toContain("whitespace-normal")
    }
  })

  it("garde la date en text-sm, sans traitement de texte libre", () => {
    afficher(1280)
    // `text-sm` is carried over from the old cell — a deliberate typographic
    // exception on the only column that had one. Dropping it looks like noise
    // removal (the card does not depend on it) but shrinks the date past `md`.
    // And `TEXTE_LIBRE` added here "for symmetry" would let `07/08/2026` break
    // mid-token: a formatted date is atomic.
    const cellule = screen.getByText("07/08/2026").closest("td")
    expect(jetons(cellule)).toContain("text-sm")
    expect(jetons(cellule)).not.toContain("wrap-anywhere")
  })

  it("laisse le total, le compte de lignes et le statut sans traitement de texte libre", () => {
    afficher(1280)
    // A formatted amount, a count and a badge are atomic values: breaking one
    // across two lines would be a defect, not a fix. Asserted so that a blanket
    // `classeCellule` on every column fails here rather than shipping.
    const cellules = [
      screen.getByText(texteMontant(1250000)).closest("td"),
      screen.getByText("3").closest("td"),
      screen.getByText("Brouillon").closest("td"),
      screen.getByText("07/08/2026").closest("td"),
    ]

    for (const cellule of cellules) {
      expect(jetons(cellule)).not.toContain("wrap-anywhere")
      expect(jetons(cellule)).not.toContain("whitespace-normal")
    }
  })
})

describe("ReceptionsPage — dialogue de création", () => {
  let nettoyer: (() => void) | undefined

  afterEach(() => {
    nettoyer?.()
    nettoyer = undefined
  })

  it("affiche « — choisir — » sur les deux sélecteurs tant qu'aucune valeur n'est choisie", async () => {
    // Both selects used to render a bare self-closing `<SelectValue>`: base-ui
    // then falls back to the RAW value and shows the UUID once a warehouse or
    // supplier is picked. Adding a render function alone is not enough either —
    // base-ui calls it on the empty value too, and an `undefined` return leaves
    // the field blank. The fallback has to live inside the function, which is
    // exactly what this case observes at the initial empty state.
    nettoyer = installerMatchMedia(1280)
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ReceptionsPage />
      </QueryClientProvider>
    )

    fireEvent.click(screen.getByRole("button", { name: "Nouvelle réception" }))

    // The trigger also holds the chevron icon: read the value slot itself, so
    // the assertion sees the rendered label and nothing else.
    const libelle = (declencheur: HTMLElement) =>
      declencheur.querySelector('[data-slot="select-value"]')?.textContent

    expect(libelle(await screen.findByLabelText("Entrepôt"))).toBe(
      "— choisir —"
    )
    expect(libelle(screen.getByLabelText("Fournisseur"))).toBe("— choisir —")
  })
})

describe("ReceptionsPage — câblage de la liste", () => {
  let nettoyer: (() => void) | undefined

  afterEach(() => {
    nettoyer?.()
    nettoyer = undefined
  })

  function monter(largeur: number) {
    nettoyer = installerMatchMedia(largeur)
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ReceptionsPage />
      </QueryClientProvider>
    )
  }

  // The cases above hand `titre`/`valeur`/`sousTitre` to `ListeAdaptative`
  // themselves, so they prove those functions are correct — never that the
  // SCREEN passes them. Swapping `titre={titreReception}` for a bare string is
  // a plausible simplification (the column cell keeps its link), and it would
  // leave the sheet unreachable by keyboard and screen reader in card mode
  // while the mouse still works through `surClicLigne`. That is the very
  // defect this migration exists to close, and nothing else here would catch
  // it.
  it("passe le lien de la fiche en titre de carte à 375 px", async () => {
    monter(375)

    const carte = await screen.findByRole("listitem")
    const liens = within(carte).getAllByRole("link")
    expect(liens).toHaveLength(1)
    expect(liens[0].getAttribute("href")).toBe("/stock/receptions/p1")
    expect(liens[0].textContent).toBe("Sotra Distribution")
  })

  it("rend la liste en table à 1280 px, avec ses 7 en-têtes", async () => {
    monter(1280)

    // Awaited on the LINK, not on the table: the loading skeleton renders a
    // table too, so `findByRole("table")` resolves before the data lands.
    const lien = await screen.findByRole("link", { name: "Sotra Distribution" })
    expect(lien.getAttribute("href")).toBe("/stock/receptions/p1")
    expect(screen.getAllByRole("columnheader")).toHaveLength(7)
  })
})
