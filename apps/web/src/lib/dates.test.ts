import { describe, it, expect } from "vitest"
import { estDateExpiree, formatDateJour } from "./dates"

describe("estDateExpiree", () => {
  it("null n'est jamais expiré", () => {
    expect(estDateExpiree(null)).toBe(false)
  })

  it("une date passée est expirée, aujourd'hui et le futur ne le sont pas", () => {
    const aujourdHui = new Date().toLocaleDateString("fr-CA")
    expect(estDateExpiree("2020-01-01T00:00:00.000Z")).toBe(true)
    expect(estDateExpiree(`${aujourdHui}T00:00:00.000Z`)).toBe(false)
    expect(estDateExpiree("2099-12-31T00:00:00.000Z")).toBe(false)
  })
})

describe("formatDateJour", () => {
  it("formate AAAA-MM-JJ en JJ/MM/AAAA sans décalage de fuseau", () => {
    expect(formatDateJour("2025-01-05")).toBe("05/01/2025")
  })

  it("accepte un ISO complet en ne lisant que les 10 premiers caractères", () => {
    // Un `new Date("2025-01-05T00:00:00.000Z").toLocaleDateString("fr-FR")`
    // peut reculer au 04/01/2025 dans un fuseau négatif — le split direct
    // ne doit jamais dévier de la date calendaire encodée dans la chaîne.
    expect(formatDateJour("2025-01-05T00:00:00.000Z")).toBe("05/01/2025")
  })
})
