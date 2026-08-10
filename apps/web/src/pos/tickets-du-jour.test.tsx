import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { jetons } from "@/test/jetons"
import { TicketsDuJour } from "@/pos/tickets-du-jour"
import * as posApi from "@/lib/pos-api"
import type { VenteListe } from "@/lib/pos-api"

// Gérer les erreurs de réimpression : CodeRabbit PR #8. Un rejet de
// fetchVente ne doit pas rester une promesse non gérée — le caissier voit
// l'erreur et le bouton se désactive pendant le chargement.

const vente: VenteListe = {
  id: "sale1",
  ticketNumber: 1,
  total: 500,
  currency: "XOF",
  status: "completed",
  createdAt: new Date().toISOString(),
  cashierName: "Caissier",
  itemCount: 1,
}

function rendre() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <TicketsDuJour
        storeId="store1"
        onReimprimer={vi.fn()}
        onFermer={vi.fn()}
      />
    </QueryClientProvider>
  )
}

describe("TicketsDuJour — erreurs de réimpression", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("affiche une erreur (pas de promesse non gérée) et réactive le bouton après un échec", async () => {
    vi.spyOn(posApi, "fetchVentesDuJour").mockResolvedValue({
      sales: [vente],
      total: 1,
      page: 1,
      limite: 50,
    })
    const fetchVente = vi
      .spyOn(posApi, "fetchVente")
      .mockRejectedValue(new Error("Échec réseau"))
    rendre()

    const bouton = await screen.findByRole<HTMLButtonElement>("button", {
      name: /réimprimer/i,
    })
    fireEvent.click(bouton)

    await waitFor(() => expect(fetchVente).toHaveBeenCalledWith("sale1"))
    // L'erreur est affichée (pas de promesse non gérée) et le bouton se
    // réactive — le caissier peut réessayer.
    await screen.findByRole("alert")
    await waitFor(() => expect(bouton.disabled).toBe(false))
  })

  it("appelle onReimprimer au succès", async () => {
    vi.spyOn(posApi, "fetchVentesDuJour").mockResolvedValue({
      sales: [vente],
      total: 1,
      page: 1,
      limite: 50,
    })
    const sale = {
      id: "sale1",
      ticketNumber: 1,
      total: 500,
      currency: "XOF",
      status: "completed",
      createdAt: vente.createdAt,
      storeId: "store1",
      storeName: "Boutique",
      cashierName: "Caissier",
      items: [],
      payments: [],
    }
    vi.spyOn(posApi, "fetchVente").mockResolvedValue({ sale })
    const onReimprimer = vi.fn()
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <TicketsDuJour
          storeId="store1"
          onReimprimer={onReimprimer}
          onFermer={vi.fn()}
        />
      </QueryClientProvider>
    )

    const bouton = await screen.findByRole("button", { name: /réimprimer/i })
    fireEvent.click(bouton)
    await waitFor(() => expect(onReimprimer).toHaveBeenCalledWith(sale))
  })
})

describe("TicketsDuJour — erreur de chargement (différé P6)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("affiche une erreur et Réessayer quand la liste échoue", async () => {
    const spy = vi
      .spyOn(posApi, "fetchVentesDuJour")
      .mockRejectedValue(new Error("réseau"))
    rendre()
    await screen.findByText("Impossible de charger les tickets du jour.")
    spy.mockResolvedValue({ sales: [vente], total: 1, page: 1, limite: 50 })
    fireEvent.click(screen.getByRole("button", { name: /réessayer/i }))
    await screen.findByText(/N° 1/)
  })
})

describe("TicketsDuJour — pagination (différé P6)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("masque la pagination à 50 tickets ou moins", async () => {
    vi.spyOn(posApi, "fetchVentesDuJour").mockResolvedValue({
      sales: [vente],
      total: 1,
      page: 1,
      limite: 50,
    })
    rendre()
    await screen.findByText(/N° 1/)
    expect(screen.queryByRole("button", { name: "Suivant" })).toBeNull()
  })

  it("pagine au-delà de 50 tickets : Suivant recharge la page 2", async () => {
    const spy = vi.spyOn(posApi, "fetchVentesDuJour").mockResolvedValue({
      sales: [vente],
      total: 51,
      page: 1,
      limite: 50,
    })
    rendre()
    await screen.findByText(/Page 1 \/ 2/)
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }))
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith("store1", expect.any(String), 2)
    )
  })
})

// jsdom has neither a layout engine nor a CSS cascade: these cases guard that
// the classes are APPLIED, never that they produce their effect. This overlay
// is the fifth copy in `pos/` of the `grid place-items-center` pattern whose
// implicit `auto` column is floored at the panel's min-content; it is the only
// one that was never audited. Nothing in this list overflows TODAY — every row
// is breakable — so `grid-cols-1` is inert here (identical rendering with and
// without, checked in the browser at 375 x 812: panel x 16..359 either way).
// It is pinned all the same, so the faulty pattern stops being copyable.
describe("TicketsDuJour — tenue à 375 px", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("le calque met sa colonne à minimum zéro au lieu du plancher min-content", () => {
    vi.spyOn(posApi, "fetchVentesDuJour").mockResolvedValue({
      sales: [vente],
      total: 1,
      page: 1,
      limite: 50,
    })
    rendre()
    // `auto` floors the track at the panel's min-content and free space is
    // distributed only while it is positive: `grid-cols-1` is `minmax(0, 1fr)`
    // and it is the zero MINIMUM that corrects this — `1fr` alone
    // (`minmax(auto, 1fr)`) keeps the floor and would not.
    const calque = screen.getByRole("dialog").parentElement
    expect(jetons(calque)).toContain("grid")
    expect(jetons(calque)).toContain("grid-cols-1")
  })

  it("le bouton « Fermer » ne cède pas ses pixels au titre", () => {
    vi.spyOn(posApi, "fetchVentesDuJour").mockResolvedValue({
      sales: [vente],
      total: 1,
      page: 1,
      limite: 50,
    })
    rendre()
    expect(jetons(screen.getByRole("button", { name: "Fermer" }))).toContain(
      "shrink-0"
    )
  })
})
