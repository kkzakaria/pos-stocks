import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ModalePaiement } from "./modale-paiement"

function rendre(total = 1400, onValider = vi.fn()) {
  render(
    <ModalePaiement
      total={total}
      enCours={false}
      erreur={null}
      onValider={onValider}
      onFermer={vi.fn()}
    />
  )
  return onValider
}

describe("ModalePaiement", () => {
  it("affiche le total et le reste à payer", () => {
    rendre(1400)
    // formaterMontant insère un espace insécable U+202F — normalisé par le
    // matcher texte, mais présent à la fois dans le total et « reste à
    // payer » (rien n'est encore payé), d'où getAllByText.
    expect(screen.getAllByText(/1 400/).length).toBeGreaterThan(0)
    expect(screen.getByText(/reste à payer/i)).toBeTruthy()
  })

  it("les billets rapides s'ADDITIONNENT et la monnaie s'affiche dès que reçu ≥ dû", () => {
    rendre(1400)
    // Intl.NumberFormat("fr-FR") sépare les milliers par U+202F : le
    // matcher de rôle compare le nom exact, insensible à \s via regex.
    fireEvent.click(screen.getByRole("button", { name: /^1\s000$/ }))
    fireEvent.click(screen.getByRole("button", { name: /^1\s000$/ }))
    // reçu 2000 ≥ 1400 → monnaie 600 en énorme
    const monnaie = screen.getByTestId("monnaie")
    expect(monnaie.textContent).toMatch(/600/)
  })

  it("valide une vente cash : paiement net avec montant reçu", () => {
    const onValider = rendre(1400)
    fireEvent.click(screen.getByRole("button", { name: /^2\s000$/ }))
    fireEvent.click(screen.getByRole("button", { name: /valider/i }))
    expect(onValider).toHaveBeenCalledWith([
      { method: "cash", amount: 1400, receivedAmount: 2000 },
    ])
  })

  it("mobile money exige une référence", () => {
    const onValider = rendre(1000)
    fireEvent.click(screen.getByRole("button", { name: /mobile money/i }))
    fireEvent.change(screen.getByLabelText(/montant mobile money/i), {
      target: { value: "1000" },
    })
    const valider = screen.getByRole<HTMLButtonElement>("button", {
      name: /valider/i,
    })
    expect(valider.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/référence/i), {
      target: { value: "OM-123" },
    })
    expect(valider.disabled).toBe(false)
    fireEvent.click(valider)
    expect(onValider).toHaveBeenCalledWith([
      { method: "mobile_money", amount: 1000, reference: "OM-123" },
    ])
  })

  it("paiement mixte : les montants s'empilent jusqu'à couvrir le total", () => {
    const onValider = rendre(1000)
    fireEvent.click(screen.getByRole("button", { name: /mobile money/i }))
    fireEvent.change(screen.getByLabelText(/montant mobile money/i), {
      target: { value: "400" },
    })
    fireEvent.change(screen.getByLabelText(/référence/i), {
      target: { value: "OM-9" },
    })
    // reste 600 en cash
    fireEvent.click(screen.getByRole("button", { name: /^1\s000$/ }))
    fireEvent.click(screen.getByRole("button", { name: /valider/i }))
    expect(onValider).toHaveBeenCalledWith([
      { method: "mobile_money", amount: 400, reference: "OM-9" },
      { method: "cash", amount: 600, receivedAmount: 1000 },
    ])
  })

  it("impossible de valider tant que le total n'est pas couvert", () => {
    rendre(1400)
    fireEvent.click(screen.getByRole("button", { name: /^1\s000$/ }))
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: /valider/i })
        .disabled
    ).toBe(true)
  })
})
