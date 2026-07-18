import { describe, it, expect } from "vitest"
import { requeterParLots } from "../src/lib/db-batch"

describe("requeterParLots", () => {
  it("retourne un tableau vide sans appeler requete si ids est vide", async () => {
    let appels = 0
    const resultat = await requeterParLots<number>([], async () => {
      appels += 1
      return []
    })
    expect(resultat).toEqual([])
    expect(appels).toBe(0)
  })

  it("fait un seul appel quand ids tient dans un lot", async () => {
    const lotsRecus: string[][] = []
    const resultat = await requeterParLots(["a", "b", "c"], async (lot) => {
      lotsRecus.push(lot)
      return lot.map((id) => ({ id }))
    })
    expect(lotsRecus).toEqual([["a", "b", "c"]])
    expect(resultat).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }])
  })

  it("découpe en lots de 100 au maximum et concatène les résultats dans l'ordre", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`)
    const taillesLots: number[] = []
    const resultat = await requeterParLots(ids, async (lot) => {
      taillesLots.push(lot.length)
      return lot.map((id) => ({ id }))
    })
    expect(taillesLots).toEqual([100, 100, 50])
    expect(resultat).toEqual(ids.map((id) => ({ id })))
  })

  it("gère exactement un multiple de la taille de lot sans lot vide final", async () => {
    const ids = Array.from({ length: 200 }, (_, i) => `id-${i}`)
    const taillesLots: number[] = []
    await requeterParLots(ids, async (lot) => {
      taillesLots.push(lot.length)
      return []
    })
    expect(taillesLots).toEqual([100, 100])
  })
})
