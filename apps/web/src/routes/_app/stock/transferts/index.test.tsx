import { render, screen, within, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import { installerMatchMedia } from "@/test/media-query"
import { jetons } from "@/test/jetons"
import { valeurPaire } from "@/test/valeur-paire"
import {
  COLONNES_TRANSFERTS,
  sousTitreTransfert,
  titreTransfert,
  TransfertsPage,
  valeurTransfert,
} from "./index"
import type { TransfertListe } from "@/lib/transferts"

// The mock serialises `params.transferId` into the href: without it, pointing
// the link at the wrong transfer — or at the list itself — would satisfy any
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
      params?: { transferId?: string }
    }) => (
      // `preventDefault` and NOT `stopPropagation`: jsdom would otherwise
      // schedule a real navigation that lands AFTER the test ends and gets
      // reported against the NEXT one — an error attached to a case that never
      // caused it. Propagation must keep bubbling, since that is what exercises
      // the row-click guard.
      <a
        href={`/stock/transferts/${params?.transferId ?? ""}`}
        onClick={(e) => e.preventDefault()}
      >
        {children}
      </a>
    ),
  }
})

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn((chemin: string) => {
    if (chemin.startsWith("/api/v1/warehouses/destinations")) {
      return Promise.resolve({
        warehouses: [{ id: "w2", name: "Entrepôt Nord" }],
      })
    }
    // One transfer, not an empty list: the page-level cases below assert how
    // the screen WIRES the list (which function it hands to `titre`), and an
    // empty list would only ever render the empty state.
    return Promise.resolve({
      transfers: [
        {
          id: "t1",
          fromWarehouseId: "w1",
          fromWarehouseName: "Boutique Centre",
          toWarehouseId: "w2",
          toWarehouseName: "Entrepôt Nord",
          reference: "REF-2026-0007",
          status: "pending",
          itemCount: 4,
          totalQuantity: 42,
          createdAt: "2026-08-07T09:00:00.000Z",
          sentAt: null,
          receivedAt: null,
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

const T: TransfertListe = {
  id: "t1",
  fromWarehouseId: "w1",
  fromWarehouseName: "Boutique Centre",
  toWarehouseId: "w2",
  toWarehouseName: "Entrepôt Nord",
  reference: "REF-2026-0007",
  status: "pending",
  createdAt: "2026-08-07T10:30:00.000Z",
  sentAt: null,
  receivedAt: null,
  itemCount: 4,
  totalQuantity: 42,
}

describe("colonnes de la liste des transferts", () => {
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
      <ListeAdaptative<TransfertListe>
        colonnes={COLONNES_TRANSFERTS}
        lignes={[T]}
        cleLigne={(t) => t.id}
        titre={titreTransfert}
        valeur={valeurTransfert}
        sousTitre={sousTitreTransfert}
        surClicLigne={surClicLigne}
      />
    )
    return { surClicLigne }
  }

  it("expose 7 colonnes", () => {
    expect(COLONNES_TRANSFERTS).toHaveLength(7)
  })

  it("rend les 7 en-têtes en table à 1280 px", () => {
    afficher(1280)
    for (const entete of [
      "Date",
      "Origine",
      "Destination",
      "Référence",
      "Lignes",
      "Quantité",
      "Statut",
    ]) {
      expect(screen.getByText(entete)).toBeTruthy()
    }
    // No action column on this screen: every header is named, so the count
    // must match the named ones exactly.
    expect(screen.getAllByRole("columnheader")).toHaveLength(7)
  })

  it("affiche la quantité totale du transfert", () => {
    afficher(1280)
    expect(screen.getByText("42")).toBeTruthy()
  })

  it("porte le lien vers la fiche exactement une fois à 375 px", () => {
    afficher(375)
    const carte = screen.getAllByRole("listitem")[0]
    const liens = within(carte).getAllByRole("link")
    expect(liens).toHaveLength(1)
    expect(liens[0].getAttribute("href")).toBe("/stock/transferts/t1")
    expect(liens[0].textContent).toBe("Entrepôt Nord")
  })

  it("porte le même lien dans la cellule « Destination » en table", () => {
    afficher(1280)
    expect(
      screen.getByText("Entrepôt Nord").closest("a")?.getAttribute("href")
    ).toBe("/stock/transferts/t1")
  })

  it("ne déclenche pas surClicLigne au clic sur le lien de la fiche", () => {
    const { surClicLigne } = afficher(375)
    fireEvent.click(screen.getByText("Entrepôt Nord"))
    expect(surClicLigne).not.toHaveBeenCalled()
  })

  it("ne duplique aucune colonne masquée en mode carte", () => {
    afficher(375)
    const carte = screen.getAllByRole("listitem")[0]

    // Each `masquerEnCarte` column resurfaces through titre/valeur/sousTitre, so
    // it must NOT also appear as a label/value pair. Dropping a flag would render
    // the data twice — invisible to a presence-only assertion.
    expect(within(carte).queryByText("Destination")).toBeNull()
    expect(within(carte).queryByText("Date")).toBeNull()
    expect(within(carte).queryByText("Quantité")).toBeNull()
    // …and the data itself exists exactly once.
    expect(within(carte).getAllByText("Entrepôt Nord")).toHaveLength(1)
    expect(within(carte).getAllByText("42")).toHaveLength(1)
    expect(within(carte).getAllByText("07/08/2026")).toHaveLength(1)
  })

  it("garde les 4 colonnes visibles en paires à 375 px", () => {
    afficher(375)
    const carte = screen.getAllByRole("listitem")[0]

    // The positive counterpart: these columns go through `paires` by
    // construction, but the assertion keeps the coverage explicit.
    expect(valeurPaire(carte, "Origine")).toBe("Boutique Centre")
    expect(valeurPaire(carte, "Référence")).toBe("REF-2026-0007")
    expect(valeurPaire(carte, "Lignes")).toBe("4")
    expect(valeurPaire(carte, "Statut")).toBe("En attente")
  })

  // jsdom has neither a layout engine nor a CSS cascade: these two cases guard
  // that the classes are APPLIED to the right cells, never that they produce
  // their effect — that is measured in the browser.
  it("porte les deux jetons de texte libre sur l'origine, la destination et la référence", () => {
    afficher(1280)
    const cellules = [
      screen.getByText("Boutique Centre").closest("td"),
      screen.getByText("Entrepôt Nord").closest("td"),
      screen.getByText("REF-2026-0007").closest("td"),
    ]

    for (const cellule of cellules) {
      expect(jetons(cellule)).toContain("wrap-anywhere")
      // `wrap-anywhere` alone is inert: `TableCell` sets `whitespace-nowrap`,
      // which forbids any wrap in the first place. See the JSDoc of
      // `TEXTE_LIBRE` in `components/ui/table.tsx`.
      expect(jetons(cellule)).toContain("whitespace-normal")
    }
  })

  it("laisse la date, les lignes, la quantité et le statut sans traitement de texte libre", () => {
    afficher(1280)
    // A formatted date, a count, a quantity and a badge from a closed set
    // are atomic values: breaking one across two lines would be a defect,
    // not a fix. Asserted so that a blanket `classeCellule` on every column
    // fails here rather than shipping. Unlike receptions' date cell, this
    // one carries no `classeCellule` at all — it never had a `text-sm`
    // exception to preserve, so `jetons(cellule)` is expected to be empty.
    const cellules = [
      screen.getByText("07/08/2026").closest("td"),
      screen.getByText("4").closest("td"),
      screen.getByText("42").closest("td"),
      screen.getByText("En attente").closest("td"),
    ]

    for (const cellule of cellules) {
      expect(jetons(cellule)).not.toContain("wrap-anywhere")
      expect(jetons(cellule)).not.toContain("whitespace-normal")
    }
  })
})

describe("TransfertsPage — dialogue de création", () => {
  let nettoyer: (() => void) | undefined

  afterEach(() => {
    nettoyer?.()
    nettoyer = undefined
  })

  it("affiche « — choisir — » sur les deux sélecteurs tant qu'aucune valeur n'est choisie", async () => {
    // Both selects had a render function but no fallback: base-ui calls the
    // function even on the empty initial value, and an `undefined` return
    // left the field blank instead of showing a placeholder. The fallback has
    // to live inside the function, which is exactly what this case observes
    // at the initial empty state.
    nettoyer = installerMatchMedia(1280)
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <TransfertsPage />
      </QueryClientProvider>
    )

    fireEvent.click(screen.getByRole("button", { name: "Nouveau transfert" }))

    // The trigger also holds the chevron icon: read the value slot itself, so
    // the assertion sees the rendered label and nothing else.
    const libelle = (declencheur: HTMLElement) =>
      declencheur.querySelector('[data-slot="select-value"]')?.textContent

    expect(libelle(await screen.findByLabelText("Entrepôt d'origine"))).toBe(
      "— choisir —"
    )
    expect(libelle(screen.getByLabelText("Entrepôt de destination"))).toBe(
      "— choisir —"
    )
  })
})

describe("TransfertsPage — câblage de la liste", () => {
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
        <TransfertsPage />
      </QueryClientProvider>
    )
  }

  // The cases above hand `titre`/`valeur`/`sousTitre` to `ListeAdaptative`
  // themselves, so they prove those functions are correct — never that the
  // SCREEN passes them. Swapping `titre={titreTransfert}` for a bare string is
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
    expect(liens[0].getAttribute("href")).toBe("/stock/transferts/t1")
    expect(liens[0].textContent).toBe("Entrepôt Nord")
  })

  it("rend la liste en table à 1280 px, avec ses 7 en-têtes", async () => {
    monter(1280)

    // Awaited on the LINK, not on the table: the loading skeleton renders a
    // table too, so `findByRole("table")` resolves before the data lands.
    const lien = await screen.findByRole("link", { name: "Entrepôt Nord" })
    expect(lien.getAttribute("href")).toBe("/stock/transferts/t1")
    expect(screen.getAllByRole("columnheader")).toHaveLength(7)
  })
})
