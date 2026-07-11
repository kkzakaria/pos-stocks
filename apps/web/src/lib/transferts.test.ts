import { describe, it, expect } from "vitest"
import { preparerReception, STATUTS_TRANSFERT_FR } from "./transferts"

describe("preparerReception", () => {
  const lignes = [
    { id: "l1", quantity: 10 },
    { id: "l2", quantity: 5 },
  ]

  it("saisie vide ou égale à l'expédié = tout reçu (aucun item envoyé)", () => {
    expect(preparerReception(lignes, {})).toEqual({ ok: true, items: [] })
    expect(preparerReception(lignes, { l1: "10", l2: "" })).toEqual({
      ok: true,
      items: [],
    })
  })

  it("ne transmet que les écarts", () => {
    expect(preparerReception(lignes, { l1: "7", l2: "5" })).toEqual({
      ok: true,
      items: [{ itemId: "l1", receivedQuantity: 7 }],
    })
  })

  it("zéro reçu est une saisie valide", () => {
    expect(preparerReception(lignes, { l1: "0" })).toEqual({
      ok: true,
      items: [{ itemId: "l1", receivedQuantity: 0 }],
    })
  })

  it("refuse un reçu supérieur à l'expédié ou une saisie non entière", () => {
    const trop = preparerReception(lignes, { l2: "6" })
    expect(trop.ok).toBe(false)
    const decimal = preparerReception(lignes, { l1: "2.5" })
    expect(decimal.ok).toBe(false)
    const negatif = preparerReception(lignes, { l1: "-1" })
    expect(negatif.ok).toBe(false)
  })
})

describe("STATUTS_TRANSFERT_FR", () => {
  it("couvre les quatre statuts", () => {
    expect(Object.keys(STATUTS_TRANSFERT_FR).sort()).toEqual([
      "cancelled",
      "pending",
      "received",
      "sent",
    ])
  })
})
