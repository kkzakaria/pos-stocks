import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { EcranVente } from "@/pos/ecran-vente"
import * as posApi from "@/lib/pos-api"
import type { ArticlePos } from "@/lib/pos"
import type { Me } from "@/lib/me"
import type { SessionCaisse, VenteDetail } from "@/lib/pos-api"

// Verrouillage du panier après une soumission AMBIGUË (réponse réseau
// perdue) : CodeRabbit PR #8. Une erreur réseau (Error brute, pas
// ApiError) doit bloquer le scan/les tuiles jusqu'à retry ou fermeture
// explicite de la modale de paiement — sinon un retry rejouerait
// l'ancienne vente (même clientRequestId) et effacerait silencieusement
// un panier modifié entre-temps.

const article: ArticlePos = {
  variantId: "v1",
  productId: "p1",
  productName: "Coca 50cl",
  variantName: "Standard",
  nom: "Coca 50cl",
  sku: "SKU1",
  barcode: "123",
  categoryId: null,
  trackLots: false,
  imageKey: null,
  price: 500,
  minPrice: null,
  quantity: 10,
}

const me: Me = {
  user: {
    id: "u1",
    email: "cashier@example.com",
    name: "Caissier",
    mustChangePassword: false,
  },
  membership: {
    organizationId: "org1",
    organizationName: "Org",
    role: "staff",
  },
  assignments: [
    { warehouseId: "store1", warehouseName: "Boutique", role: "cashier" },
  ],
}

const session: SessionCaisse = {
  id: "sess1",
  openingFloat: 0,
  openedAt: new Date().toISOString(),
}

function renderEcran() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <EcranVente
        me={me}
        boutique={{ id: "store1", name: "Boutique" }}
        session={session}
        onSessionFermee={() => undefined}
      />
    </QueryClientProvider>
  )
}

describe("EcranVente — verrouillage panier après échec ambigu", () => {
  beforeEach(() => {
    vi.spyOn(window, "print").mockImplementation(() => undefined)
    vi.spyOn(posApi, "fetchCataloguePos").mockResolvedValue({
      categories: [],
      articles: [article],
    })
    vi.spyOn(posApi, "fetchReglagesTicket").mockResolvedValue({
      name: "Org",
      currency: "XOF",
      receiptHeader: "",
      receiptFooter: "",
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("bloque les tuiles après une erreur réseau ambiguë, et la fermeture ne déverrouille pas", async () => {
    const envoyerVente = vi
      .spyOn(posApi, "envoyerVente")
      .mockRejectedValue(new Error("Failed to fetch"))
    // La consultation échoue aussi : l'ambiguïté n'est pas levée, donc le
    // verrou doit tenir — y compris après fermeture de la modale (issue #21).
    vi.spyOn(posApi, "fetchVenteParCleRequete").mockRejectedValue(
      new Error("Failed to fetch")
    )
    renderEcran()

    const tuile = await screen.findByRole("button", { name: /^Coca 50cl/ })
    fireEvent.click(tuile)

    fireEvent.click(screen.getByRole("button", { name: /ENCAISSER/ }))
    fireEvent.click(screen.getByRole("button", { name: "Montant exact" }))
    fireEvent.click(screen.getByRole("button", { name: "Valider la vente" }))

    await waitFor(() => expect(envoyerVente).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0)
    )
    const totalAvant =
      screen.getByText("Total à encaisser").nextSibling?.textContent

    // Panier verrouillé : re-cliquer la tuile ne doit PAS ajouter une
    // 2e unité — le total affiché en tête de modale ne bouge pas.
    fireEvent.click(tuile)
    const totalApres =
      screen.getByText("Total à encaisser").nextSibling?.textContent
    expect(totalApres).toBe(totalAvant)

    // Fermer la modale ne lève plus le verrou : le stepper reste désactivé.
    fireEvent.click(screen.getByLabelText("Fermer"))
    fireEvent.click(tuile)
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Diminuer la quantité de Coca 50cl",
      }).disabled
    ).toBe(true)
  })

  it("n'active PAS le verrou sur une erreur API structurée (le serveur a répondu)", async () => {
    const { ApiError } = await import("@/lib/api")
    vi.spyOn(posApi, "envoyerVente").mockRejectedValue(
      new ApiError(
        "Session de caisse requise",
        409,
        "SESSION_CAISSE_REQUISE",
        null
      )
    )
    renderEcran()

    const tuile = await screen.findByRole("button", { name: /Coca 50cl/ })
    fireEvent.click(tuile)
    fireEvent.click(screen.getByRole("button", { name: /ENCAISSER/ }))
    fireEvent.click(screen.getByRole("button", { name: "Montant exact" }))
    fireEvent.click(screen.getByRole("button", { name: "Valider la vente" }))

    await waitFor(() =>
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0)
    )

    // Pas de verrou : re-cliquer la tuile ajoute bien une 2e unité.
    fireEvent.click(tuile)
    // 2nd unit added: the "Diminuer la quantité" stepper (disabled at 1)
    // becomes enabled.
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: "Diminuer la quantité de Coca 50cl",
        }).disabled
      ).toBe(false)
    )
  })
})

// Attendre le succès de `reglages` avant de monter `ImpressionTicket` :
// CodeRabbit PR #8. Sinon le premier tirage part sans en-tête/pied de
// ticket (reglages encore en cours) et le rerender ne relance pas
// l'impression (l'effet ne tourne qu'au montage).
describe("EcranVente — impression différée jusqu'à reglages résolu", () => {
  const vente: VenteDetail = {
    id: "sale1",
    ticketNumber: 1,
    total: 500,
    currency: "XOF",
    status: "completed",
    createdAt: new Date().toISOString(),
    storeId: "store1",
    storeName: "Boutique",
    cashierName: "Caissier",
    items: [],
    payments: [
      {
        method: "cash",
        amount: 500,
        reference: null,
        receivedAmount: 500,
        changeGiven: 0,
      },
    ],
  }

  beforeEach(() => {
    vi.spyOn(posApi, "fetchCataloguePos").mockResolvedValue({
      categories: [],
      articles: [article],
    })
    vi.spyOn(posApi, "envoyerVente").mockResolvedValue({
      sale: vente,
      dejaEnregistree: false,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("n'imprime pas tant que reglages est en attente, puis imprime une fois résolu", async () => {
    const printSpy = vi
      .spyOn(window, "print")
      .mockImplementation(() => undefined)
    let resoudreReglages!: (v: posApi.ReglagesTicket) => void
    vi.spyOn(posApi, "fetchReglagesTicket").mockReturnValue(
      new Promise((resolve) => {
        resoudreReglages = resolve
      })
    )
    renderEcran()

    const tuile = await screen.findByRole("button", { name: /Coca 50cl/ })
    fireEvent.click(tuile)
    fireEvent.click(screen.getByRole("button", { name: /ENCAISSER/ }))
    fireEvent.click(screen.getByRole("button", { name: "Montant exact" }))
    fireEvent.click(screen.getByRole("button", { name: "Valider la vente" }))

    await screen.findByText("Vente n° 1 enregistrée")
    // reglages toujours en attente : pas d'impression prématurée.
    expect(printSpy).not.toHaveBeenCalled()

    resoudreReglages({
      name: "Boutique",
      currency: "XOF",
      receiptHeader: "",
      receiptFooter: "",
    })
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1))
  })
})

describe("EcranVente — raccourci Suppr : vider le panier", () => {
  beforeEach(() => {
    vi.spyOn(posApi, "fetchCataloguePos").mockResolvedValue({
      categories: [],
      articles: [article],
    })
    vi.spyOn(posApi, "fetchReglagesTicket").mockResolvedValue({
      name: "Org",
      currency: "XOF",
      receiptHeader: "",
      receiptFooter: "",
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("ouvre la confirmation puis vide le panier après validation", async () => {
    renderEcran()
    const tuile = await screen.findByRole("button", { name: /Coca 50cl/ })
    fireEvent.click(tuile)
    // Non-empty cart: ENCAISSER enabled.
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: /ENCAISSER/ })
        .disabled
    ).toBe(false)

    fireEvent.keyDown(window, { key: "Delete" })
    const valider = await screen.findByRole("button", { name: "Vider" })
    fireEvent.click(valider)

    // Cart cleared: the empty-state prompt reappears, ENCAISSER goes inactive.
    await screen.findByText("Scannez ou touchez un article.")
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: /ENCAISSER/ })
        .disabled
    ).toBe(true)
  })

  it("n'ouvre rien quand le panier est vide", () => {
    renderEcran()
    fireEvent.keyDown(window, { key: "Delete" })
    expect(screen.queryByText("Vider le panier ?")).toBeNull()
  })

  it("ignore Suppr quand le focus est dans un champ de saisie", async () => {
    renderEcran()
    const tuile = await screen.findByRole("button", { name: /Coca 50cl/ })
    fireEvent.click(tuile)
    // Focus in the search field: Suppr deletes a character, not the cart.
    screen.getByPlaceholderText(/Rechercher/).focus()
    fireEvent.keyDown(window, { key: "Delete" })
    expect(screen.queryByText("Vider le panier ?")).toBeNull()
  })
})

describe("EcranVente — erreurPrix réinitialisée après une vente réussie", () => {
  const articleAvecPlancher: ArticlePos = { ...article, minPrice: 400 }
  const vente: VenteDetail = {
    id: "sale1",
    ticketNumber: 1,
    total: 500,
    currency: "XOF",
    status: "completed",
    createdAt: new Date().toISOString(),
    storeId: "store1",
    storeName: "Boutique",
    cashierName: "Caissier",
    items: [],
    payments: [
      {
        method: "cash",
        amount: 500,
        reference: null,
        receivedAmount: 500,
        changeGiven: 0,
      },
    ],
  }

  beforeEach(() => {
    vi.spyOn(window, "print").mockImplementation(() => undefined)
    vi.spyOn(posApi, "fetchCataloguePos").mockResolvedValue({
      categories: [],
      articles: [articleAvecPlancher],
    })
    vi.spyOn(posApi, "fetchReglagesTicket").mockResolvedValue({
      name: "Org",
      currency: "XOF",
      receiptHeader: "",
      receiptFooter: "",
    })
    vi.spyOn(posApi, "envoyerVente").mockResolvedValue({
      sale: vente,
      dejaEnregistree: false,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("l'alerte de prix ne rejoue pas sur le panier suivant", async () => {
    renderEcran()
    fireEvent.click(await screen.findByRole("button", { name: /Coca 50cl/ }))

    // Price below the floor → alert attached to the line (price unchanged).
    fireEvent.click(
      screen.getByRole("button", { name: "Modifier le prix de Coca 50cl" })
    )
    const champ = screen.getByLabelText("Nouveau prix de Coca 50cl")
    fireEvent.change(champ, { target: { value: "100" } })
    fireEvent.blur(champ)
    expect(await screen.findByRole("alert")).toBeTruthy()

    // Successful sale (at the valid catalog price), then a new sale.
    fireEvent.click(screen.getByRole("button", { name: /ENCAISSER/ }))
    fireEvent.click(screen.getByRole("button", { name: "Montant exact" }))
    fireEvent.click(screen.getByRole("button", { name: "Valider la vente" }))
    await screen.findByText("Vente n° 1 enregistrée")
    fireEvent.click(screen.getByRole("button", { name: "Nouvelle vente" }))

    // Same item scanned again: no residual alert.
    fireEvent.click(await screen.findByRole("button", { name: /Coca 50cl/ }))
    expect(screen.queryByRole("alert")).toBeNull()
  })
})

describe("EcranVente — erreur de catalogue (différé P6)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("affiche l'erreur et un bouton Réessayer qui recharge le catalogue", async () => {
    const spy = vi
      .spyOn(posApi, "fetchCataloguePos")
      .mockRejectedValue(new Error("réseau"))
    vi.spyOn(posApi, "fetchReglagesTicket").mockResolvedValue({
      name: "Org",
      currency: "XOF",
      receiptHeader: "",
      receiptFooter: "",
    })
    renderEcran()
    await screen.findByText("Impossible de charger le catalogue.")
    spy.mockResolvedValue({ categories: [], articles: [article] })
    fireEvent.click(screen.getByRole("button", { name: /réessayer/i }))
    await screen.findByText("Coca 50cl")
  })
})

describe("EcranVente — persistance du panier", () => {
  const CLE = "pos:panier:store1:sess1"

  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(posApi, "fetchCataloguePos").mockResolvedValue({
      articles: [article],
      categories: [],
    })
  })
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it("restaure un panier sauvegardé au montage", async () => {
    localStorage.setItem(
      CLE,
      JSON.stringify({
        v: 1,
        lignes: [
          {
            variantId: "v1",
            nom: "Coca 50cl",
            sku: "SKU1",
            imageKey: null,
            quantite: 3,
            prixUnitaire: 500,
            prixCatalogue: 500,
            prixPlancher: null,
            sourceWarehouseId: null,
            sourceNom: null,
            enAlerte: false,
          },
        ],
        requestId: "req-restaure",
        proprietaire: "onglet-1",
        verrouille: false,
        majA: "2026-07-19T10:00:00.000Z",
      })
    )
    renderEcran()
    // DISCRIMINATING assertion: "Retirer <nom>" only exists for a CART LINE.
    // The product name alone also appears on the catalogue tile, so asserting
    // it would pass even without restoration (false positive).
    expect(
      await screen.findByRole("button", { name: "Retirer Coca 50cl" })
    ).toBeTruthy()
  })

  it("écrit le panier dans le stockage quand on ajoute un article", async () => {
    renderEcran()
    const tuile = await screen.findByRole("button", { name: /Coca 50cl/ })
    fireEvent.click(tuile)
    await waitFor(() => {
      expect(localStorage.getItem(CLE)).not.toBeNull()
    })
    const stocke = JSON.parse(localStorage.getItem(CLE) ?? "{}") as {
      v: number
      lignes: Array<{ variantId: string; quantite: number }>
    }
    expect(stocke.v).toBe(1)
    expect(stocke.lignes).toHaveLength(1)
    expect(stocke.lignes[0].variantId).toBe("v1")
  })

  it("purge le stockage quand le panier redevient vide", async () => {
    renderEcran()
    const tuile = await screen.findByRole("button", { name: /Coca 50cl/ })
    fireEvent.click(tuile)
    await waitFor(() => expect(localStorage.getItem(CLE)).not.toBeNull())
    // Exact labels from the Panier component: the trigger carries
    // aria-label="Vider le panier", and the AlertDialog's confirm button is
    // named exactly "Vider" (see pos/panier.test.tsx).
    fireEvent.click(screen.getByRole("button", { name: "Vider le panier" }))
    fireEvent.click(await screen.findByRole("button", { name: "Vider" }))
    await waitFor(() => {
      expect(localStorage.getItem(CLE)).toBeNull()
    })
  })

  it("restaure l'état verrouillé d'une soumission ambiguë", async () => {
    localStorage.setItem(
      CLE,
      JSON.stringify({
        v: 1,
        lignes: [
          {
            variantId: "v1",
            nom: "Coca 50cl",
            sku: "SKU1",
            imageKey: null,
            quantite: 1,
            prixUnitaire: 500,
            prixCatalogue: 500,
            prixPlancher: null,
            sourceWarehouseId: null,
            sourceNom: null,
            enAlerte: false,
          },
        ],
        requestId: "req-ambigu",
        proprietaire: "onglet-1",
        verrouille: true,
        majA: "2026-07-19T10:00:00.000Z",
      })
    )
    renderEcran()
    // Regex anchored at the start of the name: the restored cart already holds
    // a "Coca 50cl" line, whose "Retirer Coca 50cl" button would also match
    // /Coca 50cl/ without the anchor — an ambiguity specific to this test
    // (cart pre-filled at mount), absent from the other tests in this file
    // which query the tile before any addition.
    const tuile = await screen.findByRole("button", { name: /^Coca 50cl/ })
    fireEvent.click(tuile)
    // Locked cart: the click must add NOTHING (quantity stays 1).
    await waitFor(() => {
      const stocke = JSON.parse(localStorage.getItem(CLE) ?? "{}") as {
        lignes: Array<{ quantite: number }>
      }
      expect(stocke.lignes[0].quantite).toBe(1)
    })
  })

  function panierStocke(
    quantite: number,
    prixCatalogue: number,
    requestId = "req-1",
    verrouille = false
  ) {
    return JSON.stringify({
      v: 1,
      lignes: [
        {
          variantId: "v1",
          nom: "Coca 50cl",
          sku: "SKU1",
          imageKey: null,
          quantite,
          prixUnitaire: 500,
          prixCatalogue,
          prixPlancher: null,
          sourceWarehouseId: null,
          sourceNom: null,
          enAlerte: false,
        },
      ],
      requestId,
      proprietaire: "onglet-1",
      verrouille,
      majA: "2026-07-19T10:00:00.000Z",
    })
  }

  const venteMinimale: VenteDetail = {
    id: "sale1",
    ticketNumber: 1,
    total: 500,
    currency: "XOF",
    status: "completed",
    createdAt: new Date().toISOString(),
    storeId: "store1",
    storeName: "Boutique",
    cashierName: "Caissier",
    items: [],
    payments: [
      {
        method: "cash",
        amount: 500,
        reference: null,
        receivedAmount: 500,
        changeGiven: 0,
      },
    ],
  }

  it("envoie le requestId restauré comme clientRequestId lors de l'encaissement", async () => {
    localStorage.setItem(CLE, panierStocke(1, 500, "req-restaure"))
    const envoyerVente = vi.spyOn(posApi, "envoyerVente").mockResolvedValue({
      sale: venteMinimale,
      dejaEnregistree: false,
    })
    vi.spyOn(posApi, "fetchReglagesTicket").mockResolvedValue({
      name: "Org",
      currency: "XOF",
      receiptHeader: "",
      receiptFooter: "",
    })
    vi.spyOn(window, "print").mockImplementation(() => undefined)
    renderEcran()
    await screen.findByRole("button", { name: "Retirer Coca 50cl" })
    fireEvent.click(screen.getByRole("button", { name: /ENCAISSER/ }))
    fireEvent.click(screen.getByRole("button", { name: "Montant exact" }))
    fireEvent.click(screen.getByRole("button", { name: "Valider la vente" }))

    await waitFor(() => expect(envoyerVente).toHaveBeenCalledTimes(1))
    expect(envoyerVente.mock.calls[0][0]).toMatchObject({
      clientRequestId: "req-restaure",
    })
  })

  it("purge le stockage après une vente réussie sur un panier VERROUILLÉ", async () => {
    // Regression: after the sale `requestId` rotates while the stored entry
    // still carries the old id and `verrouille: true`. When the guard keyed on
    // `requestId`, the tab failed its OWN guard and stranded a stale locked
    // entry, restored on the next reload. The ownership token does not rotate.
    localStorage.setItem(CLE, panierStocke(1, 500, "req-ambigu", true))
    vi.spyOn(posApi, "envoyerVente").mockResolvedValue({
      sale: venteMinimale,
      dejaEnregistree: true,
    })
    vi.spyOn(posApi, "fetchReglagesTicket").mockResolvedValue({
      name: "Org",
      currency: "XOF",
      receiptHeader: "",
      receiptFooter: "",
    })
    vi.spyOn(window, "print").mockImplementation(() => undefined)
    renderEcran()
    await screen.findByRole("button", { name: "Retirer Coca 50cl" })
    fireEvent.click(screen.getByRole("button", { name: /ENCAISSER/ }))
    fireEvent.click(screen.getByRole("button", { name: "Montant exact" }))
    fireEvent.click(screen.getByRole("button", { name: "Valider la vente" }))

    await screen.findByText("Vente n° 1 enregistrée")
    await waitFor(() => {
      expect(localStorage.getItem(CLE)).toBeNull()
    })
  })

  it("purge le stockage après un encaissement réussi (pas seulement Vider)", async () => {
    localStorage.setItem(CLE, panierStocke(1, 500))
    vi.spyOn(posApi, "envoyerVente").mockResolvedValue({
      sale: venteMinimale,
      dejaEnregistree: false,
    })
    vi.spyOn(posApi, "fetchReglagesTicket").mockResolvedValue({
      name: "Org",
      currency: "XOF",
      receiptHeader: "",
      receiptFooter: "",
    })
    vi.spyOn(window, "print").mockImplementation(() => undefined)
    renderEcran()
    await screen.findByRole("button", { name: "Retirer Coca 50cl" })
    fireEvent.click(screen.getByRole("button", { name: /ENCAISSER/ }))
    fireEvent.click(screen.getByRole("button", { name: "Montant exact" }))
    fireEvent.click(screen.getByRole("button", { name: "Valider la vente" }))

    await screen.findByText("Vente n° 1 enregistrée")
    expect(localStorage.getItem(CLE)).toBeNull()
  })

  it("affiche le message d'ambiguïté quand un panier verrouillé est restauré", async () => {
    localStorage.setItem(
      CLE,
      JSON.stringify({
        v: 1,
        lignes: [
          {
            variantId: "v1",
            nom: "Coca 50cl",
            sku: "SKU1",
            imageKey: null,
            quantite: 1,
            prixUnitaire: 500,
            prixCatalogue: 500,
            prixPlancher: null,
            sourceWarehouseId: null,
            sourceNom: null,
            enAlerte: false,
          },
        ],
        requestId: "req-ambigu",
        proprietaire: "onglet-1",
        verrouille: true,
        majA: "2026-07-19T10:00:00.000Z",
      })
    )
    renderEcran()
    expect(
      await screen.findByText(/Vente peut-être déjà enregistrée/)
    ).toBeTruthy()
  })

  it("signale un prix catalogue modifié depuis la mise au panier", async () => {
    // Stored at 450, catalogue at 500 -> 1 price changed, 0 removal.
    localStorage.setItem(CLE, panierStocke(1, 450))
    renderEcran()
    expect(await screen.findByText(/Panier restauré/)).toBeTruthy()
    expect(screen.getByText(/1 prix modifié/)).toBeTruthy()
  })

  it("retire une ligne dont l'article a disparu du catalogue", async () => {
    vi.spyOn(posApi, "fetchCataloguePos").mockResolvedValue({
      articles: [],
      categories: [],
    })
    localStorage.setItem(CLE, panierStocke(1, 500))
    renderEcran()
    expect(await screen.findByText(/Panier restauré/)).toBeTruthy()
    expect(screen.getByText(/1 article\(s\) retiré/)).toBeTruthy()
    // Discriminating: no CART LINE left for this article.
    expect(
      screen.queryByRole("button", { name: "Retirer Coca 50cl" })
    ).toBeNull()
  })

  it("n'affiche aucun bandeau si rien n'a changé", async () => {
    localStorage.setItem(CLE, panierStocke(1, 500))
    renderEcran()
    await screen.findByRole("button", { name: /^Coca 50cl/ })
    expect(screen.queryByText(/Panier restauré/)).toBeNull()
  })
})

describe("EcranVente — levée de l'ambiguïté après réponse perdue", () => {
  const venteResolue: VenteDetail = {
    id: "sale-resolue",
    ticketNumber: 7,
    total: 500,
    currency: "XOF",
    status: "completed",
    createdAt: new Date().toISOString(),
    storeId: "store1",
    storeName: "Boutique",
    cashierName: "Caissier",
    items: [],
    payments: [
      {
        method: "cash",
        amount: 500,
        reference: null,
        receivedAmount: 500,
        changeGiven: 0,
      },
    ],
  }

  beforeEach(() => {
    vi.spyOn(window, "print").mockImplementation(() => undefined)
    vi.spyOn(posApi, "fetchCataloguePos").mockResolvedValue({
      categories: [],
      articles: [article],
    })
    vi.spyOn(posApi, "fetchReglagesTicket").mockResolvedValue({
      name: "Org",
      currency: "XOF",
      receiptHeader: "",
      receiptFooter: "",
    })
    vi.spyOn(posApi, "envoyerVente").mockRejectedValue(
      new Error("Failed to fetch")
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function soumettreEtEchouer() {
    renderEcran()
    const tuile = await screen.findByRole("button", { name: /^Coca 50cl/ })
    fireEvent.click(tuile)
    fireEvent.click(screen.getByRole("button", { name: /ENCAISSER/ }))
    fireEvent.click(screen.getByRole("button", { name: "Montant exact" }))
    fireEvent.click(screen.getByRole("button", { name: "Valider la vente" }))
  }

  it("vente retrouvée : imprime, confirme et vide le panier", async () => {
    vi.spyOn(posApi, "fetchVenteParCleRequete").mockResolvedValue({
      sale: venteResolue,
    })
    await soumettreEtEchouer()

    expect(await screen.findByText("Vente n° 7 enregistrée")).toBeTruthy()
    // Panier vidé : plus aucune ligne.
    expect(
      screen.queryByRole("button", { name: "Retirer Coca 50cl" })
    ).toBeNull()
  })

  it("404 : déverrouille le panier ET régénère la clé d'idempotence", async () => {
    const { ApiError } = await import("@/lib/api")
    vi.spyOn(posApi, "fetchVenteParCleRequete").mockRejectedValue(
      new ApiError("Vente introuvable", 404, "INTROUVABLE", null)
    )
    const envoyer = vi.spyOn(posApi, "envoyerVente")
    await soumettreEtEchouer()

    await waitFor(() => expect(envoyer).toHaveBeenCalledTimes(1))
    const premiereCle = (
      envoyer.mock.calls[0][0] as { clientRequestId: string }
    ).clientRequestId

    // Panier déverrouillé : la tuile ajoute de nouveau une unité.
    const tuile = screen.getByRole("button", { name: /^Coca 50cl/ })
    fireEvent.click(tuile)
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: "Diminuer la quantité de Coca 50cl",
        }).disabled
      ).toBe(false)
    )

    // Assertion DISCRIMINANTE : le prochain encaissement doit porter une clé
    // DIFFÉRENTE — rejouer l'ancienne renverrait l'ancienne vente.
    fireEvent.click(screen.getByRole("button", { name: /ENCAISSER/ }))
    fireEvent.click(screen.getByRole("button", { name: "Montant exact" }))
    fireEvent.click(screen.getByRole("button", { name: "Valider la vente" }))
    await waitFor(() => expect(envoyer).toHaveBeenCalledTimes(2))
    const secondeCle = (envoyer.mock.calls[1][0] as { clientRequestId: string })
      .clientRequestId
    expect(secondeCle).not.toBe(premiereCle)
  })

  it("consultation en échec : le verrou reste posé", async () => {
    vi.spyOn(posApi, "fetchVenteParCleRequete").mockRejectedValue(
      new Error("Failed to fetch")
    )
    await soumettreEtEchouer()

    await waitFor(() =>
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0)
    )
    // Verrou maintenu : la tuile n'ajoute RIEN (le stepper reste désactivé
    // à la quantité 1).
    fireEvent.click(screen.getByRole("button", { name: /^Coca 50cl/ }))
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Diminuer la quantité de Coca 50cl",
      }).disabled
    ).toBe(true)
  })

  it("consultation en échec : propose « Vérifier », qui relance la consultation", async () => {
    const consultation = vi
      .spyOn(posApi, "fetchVenteParCleRequete")
      .mockRejectedValue(new Error("Failed to fetch"))
    await soumettreEtEchouer()

    const bouton = await screen.findByRole("button", { name: /Vérifier/ })
    await waitFor(() => expect(consultation).toHaveBeenCalledTimes(1))

    // Le réseau revient : la seconde consultation trouve la vente.
    consultation.mockResolvedValue({ sale: venteResolue })
    fireEvent.click(bouton)

    expect(await screen.findByText("Vente n° 7 enregistrée")).toBeTruthy()
    expect(consultation).toHaveBeenCalledTimes(2)
  })

  it("fermer la modale ne lève PAS le verrou tant que l'ambiguïté persiste", async () => {
    vi.spyOn(posApi, "fetchVenteParCleRequete").mockRejectedValue(
      new Error("Failed to fetch")
    )
    await soumettreEtEchouer()
    await screen.findByRole("button", { name: /Vérifier/ })

    fireEvent.click(screen.getByLabelText("Fermer"))

    // Verrou maintenu : la tuile n'ajoute rien (stepper toujours désactivé).
    fireEvent.click(screen.getByRole("button", { name: /^Coca 50cl/ }))
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Diminuer la quantité de Coca 50cl",
      }).disabled
    ).toBe(true)
  })
})
