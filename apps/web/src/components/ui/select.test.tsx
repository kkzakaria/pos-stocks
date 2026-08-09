import { render } from "@testing-library/react"

import { jetons } from "@/test/jetons"
import { Select, SelectItem, SelectTrigger, SelectValue } from "./select"

/**
 * jsdom resolves no width and applies no Tailwind cascade, so the overflow
 * these classes prevent cannot be observed here — only their presence can. The
 * measurements quoted below come from Chrome at 375px on « Modifier la
 * catégorie », whose parent category carries a deliberately long label.
 */

function afficher(valeur: string) {
  return render(
    <Select value={valeur} onValueChange={() => undefined}>
      <SelectTrigger id="c-parent" className="w-full">
        <SelectValue>{() => valeur}</SelectValue>
      </SelectTrigger>
      <SelectItem value={valeur}>{valeur}</SelectItem>
    </Select>
  )
}

const LIBELLE_LONG =
  "ZZZRESP Catégorie parente au libellé délibérément long avec espaces"

describe("SelectTrigger — contribution en largeur", () => {
  it("autorise le déclencheur à passer sous sa largeur min-content", () => {
    // The trigger is `whitespace-nowrap`, so its min-content width is the whole
    // label. As a flex/grid child, `min-width: auto` resolves to that
    // min-content width and the trigger IMPOSES it on its track: in the dialog
    // it ran from 32 to 536px on a 375px screen, leaving 161px of the
    // « Enregistrer » button off-screen with no scrollbar to reveal it — and
    // `document.documentElement.scrollWidth` still read 375. `min-w-0` lifts
    // that floor; the trigger then measures 311px wide, ending at 343.
    const { container } = afficher(LIBELLE_LONG)
    const declencheur = container.querySelector('[data-slot="select-trigger"]')
    const t = jetons(declencheur)

    expect(t).toContain("min-w-0")
    // Kept on purpose: `min-w-0` is only needed BECAUSE of `nowrap`. If the
    // nowrap ever goes, this pairing deserves a fresh look rather than silent
    // drift.
    expect(t).toContain("whitespace-nowrap")
    // The value is a flex child of the trigger and needs the same treatment,
    // otherwise the shrink stops one level too high.
    expect(t).toContain("*:data-[slot=select-value]:min-w-0")
    // `line-clamp-1` clips the PAINT only; it does not reduce the min-content
    // contribution. It is not, and was never, a substitute for `min-w-0`.
    expect(t).toContain("*:data-[slot=select-value]:line-clamp-1")
  })

  it("laisse le consommateur fixer la largeur du déclencheur", () => {
    // Negative control. Every SelectTrigger call site in the repo passes an
    // explicit width (`w-full`, `w-36`, `w-48`, `w-52`, `w-56`); `min-w-0` only
    // removes the automatic FLOOR, it must never override that width. Measured
    // in the browser at 375px: `u-filtre-statut` (w-36) still 144px,
    // `u-filtre-role` (w-52) 208px, `n-entrepot` (w-56) 224px — unchanged.
    const { container } = afficher("Boutique Centre")
    const declencheur = container.querySelector('[data-slot="select-trigger"]')
    const t = jetons(declencheur)

    expect(t).toContain("w-full")
    // `cn` merges the width family, so the consumer's `w-full` REPLACES the
    // component's `w-fit` — while `min-w-0`, being a different family, rides
    // along untouched.
    expect(t).not.toContain("w-fit")
    expect(t).toContain("min-w-0")
  })

  it("garde `w-fit` quand le consommateur n'impose pas de largeur", () => {
    const { container } = render(
      <Select value="Court" onValueChange={() => undefined}>
        <SelectTrigger>
          <SelectValue>{() => "Court"}</SelectValue>
        </SelectTrigger>
      </Select>
    )
    const t = jetons(container.querySelector('[data-slot="select-trigger"]'))

    expect(t).toContain("w-fit")
    expect(t).toContain("min-w-0")
  })
})

describe("SelectValue — rétrécissement et découpe", () => {
  it("rétrécit et masque le débordement du libellé", () => {
    const { container } = afficher(LIBELLE_LONG)
    const valeur = container.querySelector('[data-slot="select-value"]')
    const t = jetons(valeur)

    expect(t).toContain("min-w-0")
    expect(t).toContain("overflow-hidden")
    // `flex-1` without `min-w-0` is exactly the trap this guards against: the
    // value grows to its content and never yields.
    expect(t).toContain("flex-1")
  })
})
