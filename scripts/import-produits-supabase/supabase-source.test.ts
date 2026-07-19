import { expect, test } from "bun:test"
import { parseStores, parseInventaire } from "./supabase-source"

const STORES_JSON = `Initialising login role...
{"boundary":"x","rows":[
  {"id":"s1","name":"Quincaillerie","address":"Abidjan"},
  {"id":"s2","name":"Symo","address":null}
]}`

test("parseStores isole le JSON et mappe les colonnes", () => {
  const r = parseStores(STORES_JSON)
  expect(r).toEqual([
    { id: "s1", name: "Quincaillerie", address: "Abidjan" },
    { id: "s2", name: "Symo", address: null },
  ])
})

const INV_JSON = `{"rows":[
  {"sku":"PRD-1","store_id":"s1","quantity":10,"cost":3500.3},
  {"sku":"PRD-2","store_id":"s1","quantity":5,"cost":null}
]}`

test("parseInventaire mappe store_id/cost et garde les décimaux bruts", () => {
  const r = parseInventaire(INV_JSON)
  expect(r).toEqual([
    { sku: "PRD-1", storeId: "s1", quantity: 10, cost: 3500.3 },
    { sku: "PRD-2", storeId: "s1", quantity: 5, cost: null },
  ])
})

// `supabase db query` serializes numeric columns as strings — coerce to number.
const INV_JSON_COUT_CHAINE = `{"rows":[
  {"sku":"PRD-9","store_id":"s1","quantity":3,"cost":"4200.50"}
]}`

test("parseInventaire coerce un cost numeric renvoyé en chaîne", () => {
  const r = parseInventaire(INV_JSON_COUT_CHAINE)
  expect(r).toEqual([
    { sku: "PRD-9", storeId: "s1", quantity: 3, cost: 4200.5 },
  ])
})
