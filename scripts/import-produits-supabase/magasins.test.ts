import { expect, test } from "bun:test"
import { construireMagasinCible } from "./magasins"

test("mappe store → warehouse type store, address optionnelle", () => {
  expect(
    construireMagasinCible({
      id: "s1",
      name: "Quincaillerie",
      address: "Abidjan",
    })
  ).toEqual({ name: "Quincaillerie", type: "store", address: "Abidjan" })
  expect(
    construireMagasinCible({ id: "s2", name: "Symo", address: null })
  ).toEqual({ name: "Symo", type: "store" })
})
