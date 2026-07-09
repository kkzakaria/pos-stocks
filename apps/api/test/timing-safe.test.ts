import { describe, it, expect } from "vitest"
import { safeTokenEqual } from "../src/lib/timing-safe"

describe("safeTokenEqual", () => {
  it("retourne true pour deux jetons identiques", () => {
    expect(safeTokenEqual("secret-token", "secret-token")).toBe(true)
  })

  it("retourne false pour des jetons différents de même longueur", () => {
    expect(safeTokenEqual("secret-tokeN", "secret-token")).toBe(false)
  })

  it("retourne false pour des jetons de longueurs différentes", () => {
    expect(safeTokenEqual("court", "beaucoup-plus-long")).toBe(false)
  })

  it("retourne false si le jeton attendu est undefined", () => {
    expect(safeTokenEqual("secret-token", undefined)).toBe(false)
  })

  it("retourne false si le jeton attendu est vide", () => {
    expect(safeTokenEqual("secret-token", "")).toBe(false)
  })

  it("retourne false si le jeton fourni est undefined", () => {
    expect(safeTokenEqual(undefined, "secret-token")).toBe(false)
  })
})
