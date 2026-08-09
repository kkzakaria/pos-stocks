import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { jetons } from "@/test/jetons"
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

// jsdom has neither a layout engine nor a CSS cascade: these cases guard that
// the classes are APPLIED, never that they produce their effect. The effect
// was measured in Chrome (mobile emulation, coarse pointer) at 375 x 667 on a
// real sale whose change was 10 000 F CFA — the modal is `position: fixed`, so
// `documentElement.scrollWidth` stays equal to `clientWidth` and no
// document-level overflow assertion can see it.
//
//   before → panel x 16..368, i.e. 352 px inside a 343 px box, and it widens
//            with the amount (373 px of text alone at 1 800 000 F CFA);
//   after  → panel x 16..359 (343 px), widest descendant right edge 335, both
//            buttons x 40..335 returned by `document.elementFromPoint`.
//   1280 x 900, before === after: panel x 416..864 (448 x 260), the two
//            buttons side by side at x 440..636 and 644..840, change at 48 px.
describe("ModaleConfirmation — tenue à 375 px (mesurée au navigateur)", () => {
  it("le calque met sa colonne à minimum zéro au lieu du plancher min-content", () => {
    rendre()
    // `auto` floors the track at the panel's min-content and free space is
    // distributed only while it is positive: `grid-cols-1` is `minmax(0, 1fr)`
    // and it is the zero MINIMUM that corrects this — `1fr` alone
    // (`minmax(auto, 1fr)`) keeps the floor and would not.
    const calque = screen.getByRole("dialog").parentElement
    expect(jetons(calque)).toContain("grid")
    expect(jetons(calque)).toContain("grid-cols-1")
    // The 80 mm receipt is portalled to document.body, so it is never a
    // descendant of this overlay: `print:hidden` here cannot blank the print.
    expect(jetons(calque)).toContain("print:hidden")
  })

  it("la monnaie descend d'un cran sous sm et garde text-5xl au-delà", () => {
    rendre(2500)
    const monnaie = screen.getByText(/monnaie/i)
    // The panel leaves 295 px at 375: `text-5xl` renders 304 px for a
    // 75 000 F CFA change, `text-4xl` 228 px — and 280 px at 1 800 000.
    expect(jetons(monnaie)).toContain("text-4xl")
    expect(jetons(monnaie)).toContain("sm:text-5xl")
    // The unprefixed class would win at every width and undo the step.
    expect(jetons(monnaie)).not.toContain("text-5xl")
  })
})
