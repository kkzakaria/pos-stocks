import { describe, test, expect } from "bun:test"
import { executerAvecConcurrence } from "./concurrency"

function attendre(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("executerAvecConcurrence", () => {
  test("traite tous les éléments exactement une fois", async () => {
    const traites: number[] = []
    await executerAvecConcurrence([1, 2, 3, 4, 5], 2, async (item) => {
      traites.push(item)
    })
    expect(traites.slice().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  test("ne dépasse jamais la limite de concurrence", async () => {
    let enCours = 0
    let maxObserve = 0
    await executerAvecConcurrence(
      Array.from({ length: 10 }, (_, i) => i),
      3,
      async () => {
        enCours += 1
        maxObserve = Math.max(maxObserve, enCours)
        await attendre(5)
        enCours -= 1
      }
    )
    expect(maxObserve).toBeLessThanOrEqual(3)
  })

  test("propage une erreur issue d'une tâche", async () => {
    await expect(
      executerAvecConcurrence([1, 2, 3], 2, async (item) => {
        if (item === 2) throw new Error("boom")
      })
    ).rejects.toThrow("boom")
  })
})
