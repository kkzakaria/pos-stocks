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
    expect(screen.getAllByText(/(?<!\d)1 400(?!\d)/).length).toBeGreaterThan(0)
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

  it("masquer le panneau mobile money efface montant et référence", () => {
    const onValider = rendre(1000)
    fireEvent.click(screen.getByRole("button", { name: /mobile money/i }))
    fireEvent.change(screen.getByLabelText(/montant mobile money/i), {
      target: { value: "400" },
    })
    fireEvent.change(screen.getByLabelText(/référence/i), {
      target: { value: "OM-9" },
    })
    // Masquer le panneau : le montant mobile ne doit plus réduire duCash
    // ni être envoyé comme paiement mobile_money.
    fireEvent.click(screen.getByRole("button", { name: /mobile money/i }))
    // Cash exact du total (les 400 mobiles ne sont plus déduits) : sans le
    // fix, il resterait 600 dus (1000 - 400) et « Montant exact » ne
    // couvrirait pas le total.
    fireEvent.click(screen.getByRole("button", { name: /montant exact/i }))
    fireEvent.click(screen.getByRole("button", { name: /valider/i }))
    expect(onValider).toHaveBeenCalledWith([
      { method: "cash", amount: 1000, receivedAmount: 1000 },
    ])
    // Ré-ouvrir le panneau : les champs sont bien repartis à zéro.
    fireEvent.click(screen.getByRole("button", { name: /mobile money/i }))
    expect(
      screen.getByLabelText<HTMLInputElement>(/montant mobile money/i).value
    ).toBe("")
    expect(screen.getByLabelText<HTMLInputElement>(/référence/i).value).toBe("")
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

describe("ModalePaiement — piège de focus durci (différé P6)", () => {
  it("Shift+Tab depuis le conteneur boucle vers le dernier focusable", () => {
    render(
      <ModalePaiement
        total={1000}
        enCours={false}
        erreur={null}
        onValider={vi.fn()}
        onFermer={vi.fn()}
      />
    )
    const dialogue = screen.getByRole("dialog")
    dialogue.focus()
    fireEvent.keyDown(dialogue, { key: "Tab", shiftKey: true })
    const focusables = dialogue.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    expect(document.activeElement).toBe(focusables[focusables.length - 1])
  })

  it("un focus échappé hors de la modale est ramené sur le conteneur", () => {
    render(
      <>
        <button>Dehors</button>
        <ModalePaiement
          total={1000}
          enCours={false}
          erreur={null}
          onValider={vi.fn()}
          onFermer={vi.fn()}
        />
      </>
    )
    const dehors = screen.getByRole("button", { name: "Dehors" })
    dehors.focus()
    expect(document.activeElement).toBe(screen.getByRole("dialog"))
  })
})
