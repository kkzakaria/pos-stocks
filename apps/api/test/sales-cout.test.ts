import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { and, eq } from "drizzle-orm"
import app from "../src/index"
import * as schema from "../src/db/schema"
import { applyMovements } from "../src/services/stock"
import {
  affecterEntrepot,
  bootstrapOwner,
  createUserWithRole,
  creerEntrepot,
  creerProduitSimple,
} from "./helpers"

function req(cookie: string, method: string, url: string, body?: unknown) {
  return app.request(
    url,
    {
      method,
      headers: { "content-type": "application/json", cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env
  )
}

type ReponseVente = { sale: { id: string } }

// Boutique CMP 200, réserve CMP 300 (dépannage discriminant), caissier avec
// session ouverte — motif seedVente de sales.test.ts.
async function seedCout() {
  const { organizationId, ownerId } = await bootstrapOwner()
  const storeId = await creerEntrepot(organizationId, "Boutique C", "store")
  const reserveId = await creerEntrepot(organizationId, "Réserve C")
  const caissier = await createUserWithRole(organizationId, "staff")
  await affecterEntrepot(organizationId, caissier.userId, storeId, "cashier")
  const { variantId } = await creerProduitSimple(organizationId, {
    nom: "Produit C",
    prix: 500,
  })
  const db = drizzle(env.DB, { schema })
  await applyMovements(db, {
    organizationId,
    userId: ownerId,
    mouvements: [
      {
        warehouseId: storeId,
        variantId,
        delta: 10,
        type: "purchase",
        unitCost: 200,
      },
      {
        warehouseId: reserveId,
        variantId,
        delta: 20,
        type: "purchase",
        unitCost: 300,
      },
    ],
  })
  const ouverture = await req(
    caissier.cookie,
    "POST",
    "/api/v1/register-sessions",
    { storeId, openingFloat: 0 }
  )
  expect(ouverture.status).toBe(201)
  return {
    organizationId,
    ownerId,
    storeId,
    reserveId,
    caissier,
    variantId,
    db,
  }
}

async function vendre(
  cookie: string,
  storeId: string,
  variantId: string,
  quantity: number,
  sourceWarehouseId?: string
) {
  const res = await req(cookie, "POST", "/api/v1/sales", {
    storeId,
    clientRequestId: crypto.randomUUID(),
    items: [
      {
        variantId,
        quantity,
        unitPrice: 500,
        ...(sourceWarehouseId ? { sourceWarehouseId } : {}),
      },
    ],
    payments: [{ method: "cash", amount: quantity * 500 }],
  })
  expect(res.status).toBe(201)
  return (await res.json<ReponseVente>()).sale.id
}

async function coutsLigne(saleId: string) {
  const db = drizzle(env.DB, { schema })
  return db
    .select({ unitCost: schema.saleItems.unitCost })
    .from(schema.saleItems)
    .where(eq(schema.saleItems.saleId, saleId))
}

async function cmpNiveau(warehouseId: string, variantId: string) {
  const db = drizzle(env.DB, { schema })
  const rows = await db
    .select({ avgCost: schema.stockLevels.avgCost })
    .from(schema.stockLevels)
    .where(
      and(
        eq(schema.stockLevels.warehouseId, warehouseId),
        eq(schema.stockLevels.variantId, variantId)
      )
    )
    .limit(1)
  return rows[0]?.avgCost ?? null
}

describe("sale_items.unitCost — CMP figé au moment de la vente (Phase 7)", () => {
  it("fige le CMP courant de la boutique sur la ligne", async () => {
    const { storeId, caissier, variantId } = await seedCout()
    const saleId = await vendre(caissier.cookie, storeId, variantId, 2)
    const lignes = await coutsLigne(saleId)
    expect(lignes).toHaveLength(1)
    expect(lignes[0].unitCost).toBe(200)
  })

  it("le unitCost figé ne bouge PAS quand une réception ultérieure change le CMP", async () => {
    const { organizationId, ownerId, storeId, caissier, variantId, db } =
      await seedCout()
    const saleId = await vendre(caissier.cookie, storeId, variantId, 2)
    // Réception à 800 : reste 8 @ 200, +10 @ 800 →
    // ROUND((8×200 + 10×800) / 18) = ROUND(533,33) = 533
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId: storeId,
          variantId,
          delta: 10,
          type: "purchase",
          unitCost: 800,
        },
      ],
    })
    expect(await cmpNiveau(storeId, variantId)).toBe(533)
    // La ligne historique est IMMUABLE au coût d'alors…
    const lignes = await coutsLigne(saleId)
    expect(lignes[0].unitCost).toBe(200)
    // …et une NOUVELLE vente gèle le nouveau CMP.
    const saleId2 = await vendre(caissier.cookie, storeId, variantId, 1)
    const lignes2 = await coutsLigne(saleId2)
    expect(lignes2[0].unitCost).toBe(533)
  })

  it("dépannage : gèle le CMP de l'entrepôt SOURCE, pas celui de la boutique", async () => {
    const { storeId, reserveId, caissier, variantId } = await seedCout()
    const saleId = await vendre(
      caissier.cookie,
      storeId,
      variantId,
      3,
      reserveId
    )
    const lignes = await coutsLigne(saleId)
    expect(lignes[0].unitCost).toBe(300)
  })
})
