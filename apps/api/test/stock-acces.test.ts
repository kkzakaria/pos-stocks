import { describe, it, expect } from "vitest"
import { estDansPortee, filtrePortee } from "../src/lib/stock-acces"
import * as schema from "../src/db/schema"

describe("estDansPortee", () => {
  it("portée totale : tout entrepôt est lisible", () => {
    expect(estDansPortee({ tous: true }, "w1")).toBe(true)
  })
  it("portée restreinte : vrai si L'UN des entrepôts est dans la liste", () => {
    const portee = { tous: false as const, warehouseIds: ["w1", "w2"] }
    expect(estDansPortee(portee, "w1")).toBe(true)
    expect(estDansPortee(portee, "w9")).toBe(false)
    // cas bi-entrepôt des transferts : origine OU destination
    expect(estDansPortee(portee, "w9", "w2")).toBe(true)
    expect(estDansPortee(portee, "w9", "w8")).toBe(false)
  })
  it("portée vide : rien n'est lisible", () => {
    expect(estDansPortee({ tous: false, warehouseIds: [] }, "w1")).toBe(false)
  })
})

describe("filtrePortee", () => {
  it("portée totale : aucune restriction SQL", () => {
    const filtre = filtrePortee(
      { tous: true },
      schema.stockMovements.warehouseId
    )
    expect(filtre.vide).toBe(false)
    expect(filtre.condition).toBeNull()
  })
  it("portée vide : signale vide, sans condition", () => {
    const filtre = filtrePortee(
      { tous: false, warehouseIds: [] },
      schema.stockMovements.warehouseId
    )
    expect(filtre.vide).toBe(true)
    expect(filtre.condition).toBeNull()
  })
  it("portée restreinte : produit une condition SQL", () => {
    const filtre = filtrePortee(
      { tous: false, warehouseIds: ["w1"] },
      schema.transfers.fromWarehouseId,
      schema.transfers.toWarehouseId
    )
    expect(filtre.vide).toBe(false)
    expect(filtre.condition).not.toBeNull()
  })
})
