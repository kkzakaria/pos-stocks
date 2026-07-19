import { expect, test } from "bun:test"
import { carteSkuVariante, mapperInventaire, chunk } from "./inventaire"

test("carteSkuVariante mappe sku produit → 1ère variante", () => {
  const m = carteSkuVariante([
    { id: "p1", sku: "PRD-1", variants: [{ id: "v1", sku: "PRD-1" }] },
  ])
  expect(m.get("PRD-1")).toBe("v1")
})

test("mapperInventaire arrondit le coût, ignore les SKU absents, groupe par magasin", () => {
  const sku = new Map([["PRD-1", "v1"]])
  const wh = new Map([["s1", "w1"]])
  const r = mapperInventaire(
    [
      { sku: "PRD-1", storeId: "s1", quantity: 10, cost: 3500.3 },
      { sku: "PRD-2", storeId: "s1", quantity: 5, cost: 100 },
    ],
    sku,
    wh
  )
  expect(r.itemsParMagasin.get("w1")).toEqual([
    { variantId: "v1", quantity: 10, unitCost: 3500 },
  ])
  expect(r.ignorees).toEqual([{ sku: "PRD-2", raison: "sku_absent" }])
})

test("mapperInventaire : cost null → unitCost 0", () => {
  const r = mapperInventaire(
    [{ sku: "PRD-1", storeId: "s1", quantity: 2, cost: null }],
    new Map([["PRD-1", "v1"]]),
    new Map([["s1", "w1"]])
  )
  expect(r.itemsParMagasin.get("w1")).toEqual([
    { variantId: "v1", quantity: 2, unitCost: 0 },
  ])
})

test("mapperInventaire : storeId sans warehouse → throw", () => {
  expect(() =>
    mapperInventaire(
      [{ sku: "PRD-1", storeId: "sX", quantity: 1, cost: 0 }],
      new Map([["PRD-1", "v1"]]),
      new Map()
    )
  ).toThrow()
})

test("chunk découpe en lots de taille max avec reste", () => {
  expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
})
