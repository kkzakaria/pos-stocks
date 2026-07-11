import { describe, it, expect } from "vitest"
import { estDateExpiree } from "./dates"

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
