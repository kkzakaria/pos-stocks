import { describe, it, expect, vi, afterEach } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { ImpressionTicket } from "./ticket-recu"
import type { ReglagesTicket, VenteDetail } from "@/lib/pos-api"

const vente: VenteDetail = {
  id: "sale-1",
  ticketNumber: 42,
  total: 1500,
  currency: "XOF",
  status: "completed",
  createdAt: "2026-07-12T10:00:00.000Z",
  storeId: "store-1",
  storeName: "Boutique Test",
  cashierName: "Awa",
  items: [
    {
      id: "item-1",
      variantId: "variant-1",
      productName: "Riz 5kg",
      variantName: "Standard",
      sku: "RIZ-5",
      quantity: 2,
      unitPrice: 750,
      catalogPrice: 750,
      sourceWarehouseId: "wh-1",
      sourceWarehouseName: "Entrepôt central",
      lotNumber: null,
    },
  ],
  payments: [
    {
      method: "cash",
      amount: 1500,
      reference: null,
      receivedAmount: 2000,
      changeGiven: 500,
    },
  ],
}

const reglages: ReglagesTicket = {
  name: "Boutique Test",
  currency: "XOF",
  receiptHeader: "",
  receiptFooter: "",
}

afterEach(() => {
  cleanup()
})

describe("ImpressionTicket — portail d'impression (finding page blanche)", () => {
  it("monte le ticket .ticket-80mm dans document.body, hors de tout conteneur <main>", () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {})
    const onImprime = vi.fn()

    // Reproduit la structure de ecran-vente.tsx : <main class="print:hidden">
    // enveloppant le point de montage d'ImpressionTicket. Sans portail, le
    // nœud .ticket-80mm serait un descendant DOM de <main> et hériterait de
    // son display:none à l'impression — page blanche.
    const { container } = render(
      <main className="print:hidden">
        <ImpressionTicket
          sale={vente}
          reglages={reglages}
          onImprime={onImprime}
        />
      </main>
    )

    const main = container.querySelector("main")
    expect(main).not.toBeNull()

    // Le ticket ne doit PAS être un descendant DOM de <main> ...
    const ticketDansMain = main?.querySelector(".ticket-80mm")
    expect(ticketDansMain).toBeNull()

    // ... il doit être un enfant direct de document.body (portail react-dom).
    const ticket = document.body.querySelector(".ticket-80mm")
    expect(ticket).not.toBeNull()
    expect(ticket?.parentElement).toBe(document.body)

    // Classes print du brief : masqué à l'écran, visible à l'impression.
    expect(ticket?.classList.contains("hidden")).toBe(true)
    expect(ticket?.classList.contains("print:block")).toBe(true)

    // Contenu du ticket présent (ticket number, montant).
    expect(ticket?.textContent).toContain("42")

    expect(printSpy).toHaveBeenCalledTimes(1)
    expect(onImprime).toHaveBeenCalledTimes(1)

    printSpy.mockRestore()
  })
})
