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

  it("bloque les tuiles après une erreur réseau ambiguë, puis débloque à la fermeture explicite", async () => {
    const envoyerVente = vi
      .spyOn(posApi, "envoyerVente")
      .mockRejectedValue(new Error("Failed to fetch"))
    renderEcran()

    const tuile = await screen.findByRole("button", { name: /Coca 50cl/ })
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

    // Abandon explicite : fermer la modale de paiement déverrouille.
    fireEvent.click(screen.getByLabelText("Fermer"))
    fireEvent.click(tuile)
    // 2ᵉ unité ajoutée : le stepper « Diminuer la quantité » (désactivé à 1)
    // devient actif.
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: "Diminuer la quantité",
        }).disabled
      ).toBe(false)
    )
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
    // 2ᵉ unité ajoutée : le stepper « Diminuer la quantité » (désactivé à 1)
    // devient actif.
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: "Diminuer la quantité",
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
    // Panier non vide : ENCAISSER actif.
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: /ENCAISSER/ })
        .disabled
    ).toBe(false)

    fireEvent.keyDown(window, { key: "Delete" })
    const valider = await screen.findByRole("button", { name: "Vider" })
    fireEvent.click(valider)

    // Panier vidé : l'invite de départ réapparaît, ENCAISSER redevient inactif.
    await screen.findByText("Scannez ou touchez un article.")
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: /ENCAISSER/ })
        .disabled
    ).toBe(true)
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
