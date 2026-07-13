import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ModaleConfirmation } from "./modale-confirmation"
import type { VenteDetail } from "@/lib/pos-api"

function vente(changeGiven: number): VenteDetail {
  return {
    id: "s1",
    ticketNumber: 42,
    total: 1400,
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
        amount: 1400,
        reference: null,
        receivedAmount: 2000,
        changeGiven,
      },
    ],
  }
}

function rendre(changeGiven = 600) {
  const onNouvelleVente = vi.fn()
  const onReimprimer = vi.fn()
  render(
    <ModaleConfirmation
      vente={vente(changeGiven)}
      onNouvelleVente={onNouvelleVente}
      onReimprimer={onReimprimer}
    />
  )
  return { onNouvelleVente, onReimprimer }
}

describe("ModaleConfirmation", () => {
  it("est une vraie modale : role dialog, aria-modal et nom accessible", () => {
    rendre()
    // getByRole résout aria-labelledby → le nom accessible porte le n° de
    // ticket ; la requête échouerait si le libellé n'était pas relié.
    const dialogue = screen.getByRole("dialog", { name: /vente n° 42/i })
    expect(dialogue.getAttribute("aria-modal")).toBe("true")
  })

  it("place le focus initial sur « Nouvelle vente » (Entrée enchaîne)", () => {
    rendre()
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /nouvelle vente/i })
    )
  })

  it("Échap referme (équivaut à « Nouvelle vente »)", () => {
    const { onNouvelleVente } = rendre()
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    expect(onNouvelleVente).toHaveBeenCalledTimes(1)
  })

  it("un focus échappé hors de la modale est ramené sur le conteneur", () => {
    const onNouvelleVente = vi.fn()
    render(
      <>
        <button>Dehors</button>
        <ModaleConfirmation
          vente={vente(600)}
          onNouvelleVente={onNouvelleVente}
          onReimprimer={vi.fn()}
        />
      </>
    )
    screen.getByRole("button", { name: "Dehors" }).focus()
    expect(document.activeElement).toBe(screen.getByRole("dialog"))
  })

  it("Réimprimer déclenche onReimprimer sans fermer", () => {
    const { onReimprimer, onNouvelleVente } = rendre()
    fireEvent.click(screen.getByRole("button", { name: /réimprimer/i }))
    expect(onReimprimer).toHaveBeenCalledTimes(1)
    expect(onNouvelleVente).not.toHaveBeenCalled()
  })

  it("affiche la monnaie à rendre quand elle est positive", () => {
    // Montant à séparateur : formaterMontant insère un espace insécable étroit
    // (U+202F), toléré ici par \s comme dans les autres tests POS.
    rendre(2500)
    expect(screen.getByText(/monnaie/i).textContent).toMatch(/2\s?500/)
  })

  it("masque la monnaie quand aucune n'est due", () => {
    rendre(0)
    expect(screen.queryByText(/monnaie/i)).toBeNull()
  })
})
