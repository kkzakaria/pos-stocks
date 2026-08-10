import { within } from "@testing-library/react"

/**
 * Reads the value of a `<dt>`/`<dd>` pair rendered inside a card, by its
 * label.
 *
 * Targets the specific pair instead of the whole card's `textContent`,
 * which another field could satisfy by coincidence — the assertion must be
 * able to fail on the ONE field that regressed, not pass because some other
 * field happens to contain the same text.
 */
export function valeurPaire(carte: HTMLElement, libelle: string): string {
  const dt = within(carte).getByText(libelle)
  const dd = dt.nextElementSibling
  if (!(dd instanceof HTMLElement)) {
    throw new Error(`Aucune <dd> associée au libellé « ${libelle} »`)
  }
  return dd.textContent
}
