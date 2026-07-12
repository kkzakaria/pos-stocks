import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { and, eq } from "drizzle-orm"
import * as schema from "../src/db/schema"
import { applyMovements } from "../src/services/stock"
import { bootstrapOwner, creerEntrepot, creerProduitSimple } from "./helpers"

// Retour annoté `| null` (piège eslint no-unnecessary-condition)
async function lireNiveau(
  warehouseId: string,
  variantId: string
): Promise<{ quantity: number; avgCost: number } | null> {
  const db = drizzle(env.DB, { schema })
  const rows = await db
    .select({
      quantity: schema.stockLevels.quantity,
      avgCost: schema.stockLevels.avgCost,
    })
    .from(schema.stockLevels)
    .where(
      and(
        eq(schema.stockLevels.warehouseId, warehouseId),
        eq(schema.stockLevels.variantId, variantId)
      )
    )
    .limit(1)
  return rows[0] ?? null
}

async function seed() {
  const { organizationId, ownerId } = await bootstrapOwner()
  const entrepotId = await creerEntrepot(organizationId)
  const { variantId } = await creerProduitSimple(organizationId)
  return { organizationId, ownerId, entrepotId, variantId }
}

describe("applyMovements — transfer_in est un apport valorisé", () => {
  it("absorbe l'unitCost dans le CMP existant (formule CMP identique à purchase)", async () => {
    const { organizationId, ownerId, entrepotId, variantId } = await seed()
    const db = drizzle(env.DB, { schema })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId: entrepotId,
          variantId,
          delta: 10,
          type: "purchase",
          unitCost: 100,
        },
      ],
    })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId: entrepotId,
          variantId,
          delta: 10,
          type: "transfer_in",
          unitCost: 200,
        },
      ],
    })
    // (10 × 100 + 10 × 200) / 20 = 150
    expect(await lireNiveau(entrepotId, variantId)).toEqual({
      quantity: 20,
      avgCost: 150,
    })
  })

  it("initialise le CMP d'un niveau vierge à l'unitCost de l'apport", async () => {
    const { organizationId, ownerId, entrepotId, variantId } = await seed()
    const db = drizzle(env.DB, { schema })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId: entrepotId,
          variantId,
          delta: 8,
          type: "transfer_in",
          unitCost: 250,
        },
      ],
    })
    expect(await lireNiveau(entrepotId, variantId)).toEqual({
      quantity: 8,
      avgCost: 250,
    })
  })

  it("transfer_out ne modifie jamais le CMP", async () => {
    const { organizationId, ownerId, entrepotId, variantId } = await seed()
    const db = drizzle(env.DB, { schema })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId: entrepotId,
          variantId,
          delta: 10,
          type: "purchase",
          unitCost: 100,
        },
      ],
    })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId: entrepotId, variantId, delta: -4, type: "transfer_out" },
      ],
    })
    expect(await lireNiveau(entrepotId, variantId)).toEqual({
      quantity: 6,
      avgCost: 100,
    })
  })

  it("refuse un transfer_in sans unitCost, avant toute écriture", async () => {
    const { organizationId, ownerId, entrepotId, variantId } = await seed()
    const db = drizzle(env.DB, { schema })
    await expect(
      applyMovements(db, {
        organizationId,
        userId: ownerId,
        mouvements: [
          { warehouseId: entrepotId, variantId, delta: 5, type: "transfer_in" },
        ],
      })
    ).rejects.toThrow(/apport valorisé/)
    expect(await lireNiveau(entrepotId, variantId)).toBeNull()
  })
})
