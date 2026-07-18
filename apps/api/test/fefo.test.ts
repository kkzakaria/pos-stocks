import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import * as schema from "../src/db/schema"
import { allouerFefo, lireLotsDisponibles } from "../src/services/fefo"
import { applyMovements } from "../src/services/stock"
import { bootstrapOwner, creerEntrepot, creerProduitSimple } from "./helpers"

describe("allouerFefo (pur)", () => {
  const lot = (lotId: string, expiry: string | null, disponible: number) => ({
    lotId,
    expiryDate: expiry ? new Date(expiry) : null,
    disponible,
  })

  it("déduit du lot qui expire le premier", () => {
    const lots = [lot("tard", "2027-06-01", 10), lot("tot", "2026-08-01", 10)]
    expect(allouerFefo(lots, 3)).toEqual([{ lotId: "tot", quantite: 3 }])
  })

  it("répartit sur plusieurs lots quand le premier ne suffit pas", () => {
    const lots = [lot("tot", "2026-08-01", 2), lot("tard", "2027-06-01", 10)]
    expect(allouerFefo(lots, 5)).toEqual([
      { lotId: "tot", quantite: 2 },
      { lotId: "tard", quantite: 3 },
    ])
  })

  it("les lots sans date de péremption passent en dernier", () => {
    const lots = [lot("sans-date", null, 10), lot("date", "2026-08-01", 2)]
    expect(allouerFefo(lots, 3)).toEqual([
      { lotId: "date", quantite: 2 },
      { lotId: "sans-date", quantite: 1 },
    ])
  })

  it("repli : le reliquat non couvert par les lots sort SANS lot", () => {
    const lots = [lot("seul", "2026-08-01", 2)]
    expect(allouerFefo(lots, 5)).toEqual([
      { lotId: "seul", quantite: 2 },
      { lotId: null, quantite: 3 },
    ])
  })

  it("ignore les lots à disponible nul ou négatif et tiebreak par lotId", () => {
    const lots = [
      lot("b", "2026-08-01", 5),
      lot("vide", "2025-01-01", 0),
      lot("a", "2026-08-01", 5),
    ]
    expect(allouerFefo(lots, 6)).toEqual([
      { lotId: "a", quantite: 5 },
      { lotId: "b", quantite: 1 },
    ])
  })
})

describe("lireLotsDisponibles (dérivé du journal)", () => {
  it("somme les deltas par lot et joint la péremption", async () => {
    const { organizationId, ownerId } = await bootstrapOwner()
    const warehouseId = await creerEntrepot(organizationId, "FEFO lecture")
    const { variantId } = await creerProduitSimple(organizationId, {
      trackLots: true,
    })
    const db = drizzle(env.DB, { schema })
    const maintenant = new Date()
    const lotA = crypto.randomUUID()
    const lotB = crypto.randomUUID()
    await db.insert(schema.lots).values([
      {
        id: lotA,
        organizationId,
        variantId,
        lotNumber: "A",
        expiryDate: new Date("2026-08-01"),
        createdAt: maintenant,
      },
      {
        id: lotB,
        organizationId,
        variantId,
        lotNumber: "B",
        expiryDate: new Date("2027-06-01"),
        createdAt: maintenant,
      },
    ])
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId,
          variantId,
          lotId: lotA,
          delta: 5,
          type: "purchase",
          unitCost: 100,
        },
        {
          warehouseId,
          variantId,
          lotId: lotB,
          delta: 8,
          type: "purchase",
          unitCost: 100,
        },
      ],
    })
    // Une sortie de 2 sur le lot A : disponible dérivé = 3
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId, variantId, lotId: lotA, delta: -2, type: "sale" },
      ],
    })
    const lots = await lireLotsDisponibles(db, warehouseId, variantId)
    expect(lots).toEqual([
      { lotId: lotA, expiryDate: new Date("2026-08-01"), disponible: 3 },
      { lotId: lotB, expiryDate: new Date("2027-06-01"), disponible: 8 },
    ])
  })

  it("scope par entrepôt : un même lot dans deux entrepôts ne fusionne pas", async () => {
    const { organizationId, ownerId } = await bootstrapOwner()
    const entrepot1 = await creerEntrepot(organizationId, "FEFO E1")
    const entrepot2 = await creerEntrepot(organizationId, "FEFO E2")
    const { variantId } = await creerProduitSimple(organizationId, {
      trackLots: true,
    })
    const db = drizzle(env.DB, { schema })
    const lotA = crypto.randomUUID()
    await db.insert(schema.lots).values({
      id: lotA,
      organizationId,
      variantId,
      lotNumber: "A",
      expiryDate: new Date("2026-08-01"),
      createdAt: new Date(),
    })
    // Même lot acheté dans les deux entrepôts : 5 dans E1, 8 dans E2.
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId: entrepot1,
          variantId,
          lotId: lotA,
          delta: 5,
          type: "purchase",
          unitCost: 100,
        },
        {
          warehouseId: entrepot2,
          variantId,
          lotId: lotA,
          delta: 8,
          type: "purchase",
          unitCost: 100,
        },
      ],
    })
    // Chaque entrepôt ne voit QUE sa propre quantité (jamais la somme 13).
    expect(await lireLotsDisponibles(db, entrepot1, variantId)).toEqual([
      { lotId: lotA, expiryDate: new Date("2026-08-01"), disponible: 5 },
    ])
    expect(await lireLotsDisponibles(db, entrepot2, variantId)).toEqual([
      { lotId: lotA, expiryDate: new Date("2026-08-01"), disponible: 8 },
    ])
  })
})
