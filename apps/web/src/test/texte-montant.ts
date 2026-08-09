import { formaterMontant } from "@/lib/format"

/**
 * Matches a `formaterMontant` output regardless of the ICU narrow no-break
 * space variant (fr-FR renders amounts with U+202F, but a direct
 * `getByText(string)` comparison can fail depending on the ICU build).
 * Testing Library normalises whitespace on both sides of a RegExp
 * comparison, so escaping the literal amount and replacing its whitespace
 * with `\s+` — anchored at both ends so it never partially matches inside a
 * larger digit string (e.g. matching "400" inside "3400") — is enough to
 * make the match ICU-independent.
 */
export function texteMontant(montant: number): RegExp {
  const echappe = formaterMontant(montant)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+")
  return new RegExp(`^${echappe}$`)
}
