import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { jetons } from "@/test/jetons"
import { texteMontant } from "@/test/texte-montant"
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

// jsdom has neither a layout engine nor a CSS cascade: these cases guard that
// the classes are APPLIED, never that they produce their effect. The effect
// was measured in Chrome (mobile emulation, coarse pointer) at 375 x 812 with
// a 39 513 672 F CFA total — the modal is `position: fixed`, so
// `documentElement.scrollWidth` stays equal to `clientWidth` and NO
// document-level overflow assertion can see any of this; only element
// rectangles and `document.elementFromPoint` can.
//
//   before → panel x 16..504 (488 px wide in a 375 px viewport),
//            « Fermer » x 440..484 and « Montant exact » x 370..484, both
//            missed by `elementFromPoint` at their centre;
//   after  → panel x 16..359 (343 px), « Fermer » x 295..339 (44 x 44) and
//            every pad button returned by `elementFromPoint`, the pad folding
//            5 + 2 instead of overflowing on one line.
//   1280 x 900, before === after: panel x 384..896 (512 x 328), the seven pad
//            buttons on one row from x 404 to x 876, total rendered at 48 px.
describe("ModalePaiement — tenue à 375 px (mesurée au navigateur)", () => {
  it("le calque met sa colonne à minimum zéro au lieu du plancher min-content", () => {
    rendre(1400)
    // `place-items-center` alone leaves the implicit column in `auto`, whose
    // base size is the panel's MIN-content — free space is distributed only
    // while it is positive, so a panel that overflows keeps the track at that
    // floor and drags `w-full` past the viewport. `grid-cols-1` is
    // `minmax(0, 1fr)`: the zero MINIMUM is what corrects this, and `1fr`
    // alone (`minmax(auto, 1fr)`) would not.
    const calque = screen.getByRole("dialog").parentElement
    expect(jetons(calque)).toContain("grid")
    expect(jetons(calque)).toContain("grid-cols-1")
  })

  it("l'en-tête laisse le bouton « Fermer » à sa place", () => {
    rendre(1400)
    // An amount is a single unbreakable run (U+202F thousands separators,
    // U+00A0 before the currency), so the amount block's automatic minimum
    // size is its full width: without `min-w-0` it refuses to shrink and
    // pushes the close button out of the panel.
    const bloc = screen.getByText("Total à encaisser").parentElement
    expect(jetons(bloc)).toContain("min-w-0")
    expect(jetons(screen.getByRole("button", { name: "Fermer" }))).toContain(
      "shrink-0"
    )
  })

  it("le total descend d'un cran sous sm et garde text-5xl au-delà", () => {
    rendre(1400)
    const bloc = screen.getByText("Total à encaisser").parentElement
    const montant = bloc?.lastElementChild ?? null
    // Confirms the node under test really is the total, not the label.
    expect(montant?.textContent).toMatch(texteMontant(1400))
    // At 375 the header leaves 259 px next to the 44 px target, where
    // `text-5xl` renders 273 px for the SMALLEST realistic total (7 500 F CFA)
    // and 404 px for a multi-million one; `text-3xl` renders 171 to 252 px.
    expect(jetons(montant)).toContain("text-3xl")
    expect(jetons(montant)).toContain("sm:text-5xl")
    // The unprefixed class would win at every width and undo the step.
    expect(jetons(montant)).not.toContain("text-5xl")
  })
})
