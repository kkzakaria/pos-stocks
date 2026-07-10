import { describe, it, expect } from "vitest"
import { formaterMontant } from "./format"

// Intl insère des espaces insécables (U+202F pour les milliers, U+00A0 avant
// la devise) : on normalise pour asserter le contenu réel sans dépendre du
// type d'espace.
const normaliser = (s: string) => s.replace(/[\u202f\u00a0]/g, " ")

describe("formaterMontant", () => {
  it("formate 22000 XOF en « 22 000 F CFA »", () => {
    expect(normaliser(formaterMontant(22000))).toBe("22 000 F CFA")
  })

  it("formate un petit montant sans décimales", () => {
    expect(normaliser(formaterMontant(500))).toBe("500 F CFA")
  })
})
