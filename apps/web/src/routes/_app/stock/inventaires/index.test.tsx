import { render, screen, within, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import { installerMatchMedia } from "@/test/media-query"
import { jetons } from "@/test/jetons"
import { valeurPaire } from "@/test/valeur-paire"
import {
  COLONNES_INVENTAIRES,
  InventairesPage,
  sousTitreInventaire,
  titreInventaire,
} from "./index"
import type { InventaireListe } from "./index"

// The mock serialises `params.countId` into the href: without it, pointing
// the link at the wrong count — or at the list itself — would satisfy any
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
      params?: { countId?: string }
    }) => (
      // `preventDefault` and NOT `stopPropagation`: jsdom would otherwise
      // schedule a real navigation that lands AFTER the test ends and gets
      // reported against the NEXT one — an error attached to a case that never
      // caused it. Propagation must keep bubbling, since that is what exercises
      // the row-click guard.
      <a
        href={`/stock/inventaires/${params?.countId ?? ""}`}
        onClick={(e) => e.preventDefault()}
      >
        {children}
      </a>
    ),
  }
})

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(() =>
    // One count, not an empty list: the page-level cases below assert how
    // the screen WIRES the list (which function it hands to `titre`), and an
    // empty list would only ever render the empty state.
    Promise.resolve({
      counts: [
        {
          id: "c1",
          warehouseId: "w1",
          warehouseName: "Boutique Centre",
          status: "open",
          openedAt: "2026-08-07T09:00:00.000Z",
          closedAt: null,
          itemCount: 12,
          countedCount: 3,
        },
      ],
      total: 1,
      page: 1,
      limite: 50,
    })
  ),
  apiUrl: (chemin: string) => chemin,
}))

// Both hooks read the router context, which no test mounts. A write-capable
// account is what makes the creation dialog — and its select — exist.
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

const I: InventaireListe = {
  id: "c1",
  warehouseId: "w1",
  warehouseName: "Boutique Centre",
  status: "open",
  openedAt: "2026-08-07T10:30:00.000Z",
  closedAt: null,
  itemCount: 12,
  countedCount: 3,
}

describe("colonnes de la liste des inventaires", () => {
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
      <ListeAdaptative<InventaireListe>
        colonnes={COLONNES_INVENTAIRES}
        lignes={[I]}
        cleLigne={(i) => i.id}
        titre={titreInventaire}
        sousTitre={sousTitreInventaire}
        surClicLigne={surClicLigne}
      />
    )
    return { surClicLigne }
  }

  it("expose 5 colonnes", () => {
    expect(COLONNES_INVENTAIRES).toHaveLength(5)
  })

  it("rend les 5 en-têtes en table à 1280 px", () => {
    afficher(1280)
    for (const entete of [
      "Ouvert le",
      "Entrepôt",
      "Avancement",
      "Clos le",
      "Statut",
    ]) {
      expect(screen.getByText(entete)).toBeTruthy()
    }
    // No action column on this screen: every header is named, so the count
    // must match the named ones exactly.
    expect(screen.getAllByRole("columnheader")).toHaveLength(5)
  })

  it("affiche l'avancement du comptage", () => {
    afficher(1280)
    expect(screen.getByText("3 / 12")).toBeTruthy()
  })

  it("porte le lien vers la fiche exactement une fois à 375 px", () => {
    afficher(375)
    const carte = screen.getAllByRole("listitem")[0]
    const liens = within(carte).getAllByRole("link")
    expect(liens).toHaveLength(1)
    expect(liens[0].getAttribute("href")).toBe("/stock/inventaires/c1")
    expect(liens[0].textContent).toBe("Boutique Centre")
  })

  it("porte le même lien dans la cellule « Entrepôt » en table", () => {
    afficher(1280)
    expect(
      screen.getByText("Boutique Centre").closest("a")?.getAttribute("href")
    ).toBe("/stock/inventaires/c1")
  })

  it("ne déclenche pas surClicLigne au clic sur le lien de la fiche", () => {
    const { surClicLigne } = afficher(375)
    fireEvent.click(screen.getByText("Boutique Centre"))
    expect(surClicLigne).not.toHaveBeenCalled()
  })

  it("ne duplique aucune colonne masquée en mode carte", () => {
    afficher(375)
    const carte = screen.getAllByRole("listitem")[0]

    // Each `masquerEnCarte` column resurfaces through titre/sousTitre, so it
    // must NOT also appear as a label/value pair. Dropping a flag would
    // render the data twice — invisible to a presence-only assertion.
    expect(within(carte).queryByText("Entrepôt")).toBeNull()
    expect(within(carte).queryByText("Ouvert le")).toBeNull()
    // …and the data itself exists exactly once.
    expect(within(carte).getAllByText("Boutique Centre")).toHaveLength(1)
    expect(
      within(carte).getAllByText(new Date(I.openedAt).toLocaleString("fr-FR"))
    ).toHaveLength(1)
  })

  it("garde les 3 colonnes visibles en paires à 375 px", () => {
    afficher(375)
    const carte = screen.getAllByRole("listitem")[0]

    // The positive counterpart: these columns go through `paires` by
    // construction, but the assertion keeps the coverage explicit.
    expect(valeurPaire(carte, "Avancement")).toBe("3 / 12 comptés")
    expect(valeurPaire(carte, "Clos le")).toBe("—")
    expect(valeurPaire(carte, "Statut")).toBe("Ouvert")
  })

  // jsdom has neither a layout engine nor a CSS cascade: this case guards
  // that the class is APPLIED to the right cell, never that it produces its
  // effect — that is measured in the browser.
  it("porte les deux jetons de texte libre sur l'entrepôt uniquement", () => {
    afficher(1280)
    const cellule = screen.getByText("Boutique Centre").closest("td")

    expect(jetons(cellule)).toContain("wrap-anywhere")
    // `wrap-anywhere` alone is inert: `TableCell` sets `whitespace-nowrap`,
    // which forbids any wrap in the first place. See the JSDoc of
    // `TEXTE_LIBRE` in `components/ui/table.tsx`.
    expect(jetons(cellule)).toContain("whitespace-normal")
  })

  it("laisse la date d'ouverture, l'avancement, la date de clôture et le statut sans traitement de texte libre", () => {
    afficher(1280)
    // A formatted timestamp, a progress phrase and a badge from a closed set
    // are atomic values: breaking one across two lines would be a defect,
    // not a fix. Asserted so that a blanket `classeCellule` on every column
    // fails here rather than shipping. "Ouvert le" carries `masquerEnCarte`
    // but still renders as its own `<td>` in table mode.
    const cellules = [
      screen
        .getByText(new Date(I.openedAt).toLocaleString("fr-FR"))
        .closest("td"),
      screen.getByText("3 / 12").closest("td"),
      screen.getByText("Ouvert").closest("td"),
    ]

    for (const cellule of cellules) {
      expect(jetons(cellule)).not.toContain("wrap-anywhere")
      expect(jetons(cellule)).not.toContain("whitespace-normal")
    }
  })
})

describe("InventairesPage — dialogue d'ouverture", () => {
  let nettoyer: (() => void) | undefined

  afterEach(() => {
    nettoyer?.()
    nettoyer = undefined
  })

  it("affiche « — choisir — » sur le sélecteur tant qu'aucune valeur n'est choisie", async () => {
    // The select had a render function but no fallback: base-ui calls the
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
        <InventairesPage />
      </QueryClientProvider>
    )

    fireEvent.click(
      screen.getByRole("button", { name: "Ouvrir un inventaire" })
    )

    // The trigger also holds the chevron icon: read the value slot itself, so
    // the assertion sees the rendered label and nothing else.
    const libelle = (declencheur: HTMLElement) =>
      declencheur.querySelector('[data-slot="select-value"]')?.textContent

    expect(libelle(await screen.findByLabelText("Entrepôt"))).toBe(
      "— choisir —"
    )
  })
})

describe("InventairesPage — repli du filtre de statut", () => {
  let nettoyer: (() => void) | undefined

  afterEach(() => {
    nettoyer?.()
    nettoyer = undefined
  })

  it("affiche « Tous » sur le filtre de statut au premier rendu", async () => {
    // `STATUTS_INVENTAIRE_FR` is a `Record<string, string>`: indexing it with
    // a value outside the three known keys returns `undefined`, which
    // base-ui's render function would show as a blank field. The initial
    // empty string is exactly such a value, so this observes the `?? "Tous"`
    // fallback directly rather than only through the browser.
    nettoyer = installerMatchMedia(1280)
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <InventairesPage />
      </QueryClientProvider>
    )

    const declencheur = await screen.findByLabelText("Statut")
    expect(
      declencheur.querySelector('[data-slot="select-value"]')?.textContent
    ).toBe("Tous")
  })
})

describe("InventairesPage — câblage de la liste", () => {
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
        <InventairesPage />
      </QueryClientProvider>
    )
  }

  // The cases above hand `titre`/`sousTitre` to `ListeAdaptative` themselves,
  // so they prove those functions are correct — never that the SCREEN passes
  // them. Swapping `titre={titreInventaire}` for a bare string is a plausible
  // simplification (the column cell keeps its link), and it would leave the
  // sheet unreachable by keyboard and screen reader in card mode while the
  // mouse still works through `surClicLigne`. That is the very defect this
  // migration exists to close, and nothing else here would catch it.
  it("passe le lien de la fiche en titre de carte à 375 px", async () => {
    monter(375)

    const carte = await screen.findByRole("listitem")
    const liens = within(carte).getAllByRole("link")
    expect(liens).toHaveLength(1)
    expect(liens[0].getAttribute("href")).toBe("/stock/inventaires/c1")
    expect(liens[0].textContent).toBe("Boutique Centre")
  })

  it("rend la liste en table à 1280 px, avec ses 5 en-têtes", async () => {
    monter(1280)

    // Awaited on the LINK, not on the table: the loading skeleton renders a
    // table too, so `findByRole("table")` resolves before the data lands.
    const lien = await screen.findByRole("link", { name: "Boutique Centre" })
    expect(lien.getAttribute("href")).toBe("/stock/inventaires/c1")
    expect(screen.getAllByRole("columnheader")).toHaveLength(5)
  })
})
