import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
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
    vi.spyOn(posApi, "fetchVentesDuJour").mockResolvedValue({ sales: [vente] })
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
    vi.spyOn(posApi, "fetchVentesDuJour").mockResolvedValue({ sales: [vente] })
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
    spy.mockResolvedValue({ sales: [vente] })
    fireEvent.click(screen.getByRole("button", { name: /réessayer/i }))
    await screen.findByText(/N° 1/)
  })
})
