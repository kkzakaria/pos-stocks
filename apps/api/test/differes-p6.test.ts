import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { and, eq } from "drizzle-orm"
import app from "../src/index"
import * as schema from "../src/db/schema"
import { applyMovements } from "../src/services/stock"
import { lireLotsDisponibles } from "../src/services/fefo"
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

type Erreur = { code: string }
type Sessions = { sessions: Array<{ id: string; cashierId: string }> }

// Deux sessions OUVERTES par deux caissiers différents sur la même boutique
// (l'index unique partiel 0014 est par (boutique, caissier) : compatible).
async function seedSessions() {
  const { organizationId, ownerCookie } = await bootstrapOwner()
  const storeId = await creerEntrepot(organizationId, "Boutique S", "store")
  const caissierA = await createUserWithRole(organizationId, "staff")
  const caissierB = await createUserWithRole(organizationId, "staff")
  await affecterEntrepot(organizationId, caissierA.userId, storeId, "cashier")
  await affecterEntrepot(organizationId, caissierB.userId, storeId, "cashier")
  for (const caissier of [caissierA, caissierB]) {
    const res = await req(
      caissier.cookie,
      "POST",
      "/api/v1/register-sessions",
      {
        storeId,
        openingFloat: 1000,
      }
    )
    expect(res.status).toBe(201)
  }
  return { organizationId, ownerCookie, storeId, caissierA, caissierB }
}

describe("lecture élargie des sessions de caisse (matrice §4, différé P6)", () => {
  it("auditor org : POST refusé (403) mais GET / voit TOUTES les sessions", async () => {
    const { organizationId, storeId } = await seedSessions()
    const auditor = await createUserWithRole(organizationId, "auditor")
    const refus = await req(
      auditor.cookie,
      "POST",
      "/api/v1/register-sessions",
      {
        storeId,
        openingFloat: 0,
      }
    )
    expect(refus.status).toBe(403)
    expect((await refus.json<Erreur>()).code).toBe("ACCES_REFUSE")
    const lecture = await req(
      auditor.cookie,
      "GET",
      `/api/v1/register-sessions?storeId=${storeId}`
    )
    expect(lecture.status).toBe(200)
    expect((await lecture.json<Sessions>()).sessions).toHaveLength(2)
  })

  it("manager local : voit toutes les sessions de SA boutique", async () => {
    const { organizationId, storeId } = await seedSessions()
    const manager = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, manager.userId, storeId, "manager")
    const res = await req(
      manager.cookie,
      "GET",
      `/api/v1/register-sessions?storeId=${storeId}`
    )
    expect(res.status).toBe(200)
    expect((await res.json<Sessions>()).sessions).toHaveLength(2)
  })

  it("auditor local : POST refusé mais GET / voit toutes les sessions de la boutique", async () => {
    const { organizationId, storeId } = await seedSessions()
    const auditorLocal = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      auditorLocal.userId,
      storeId,
      "auditor"
    )
    const refus = await req(
      auditorLocal.cookie,
      "POST",
      "/api/v1/register-sessions",
      { storeId, openingFloat: 0 }
    )
    expect(refus.status).toBe(403)
    const lecture = await req(
      auditorLocal.cookie,
      "GET",
      `/api/v1/register-sessions?storeId=${storeId}`
    )
    expect(lecture.status).toBe(200)
    expect((await lecture.json<Sessions>()).sessions).toHaveLength(2)
  })

  it("un caissier ne voit que LES SIENNES", async () => {
    const { storeId, caissierA } = await seedSessions()
    const res = await req(
      caissierA.cookie,
      "GET",
      `/api/v1/register-sessions?storeId=${storeId}`
    )
    expect(res.status).toBe(200)
    const { sessions } = await res.json<Sessions>()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].cashierId).toBe(caissierA.userId)
  })
})

describe("lireLotsDisponibles — multi-entrepôts (différé P6)", () => {
  it("ne compte que les mouvements de l'entrepôt demandé", async () => {
    const { organizationId, ownerId } = await bootstrapOwner()
    const depot1 = await creerEntrepot(organizationId, "Dépôt 1")
    const depot2 = await creerEntrepot(organizationId, "Dépôt 2")
    const { variantId } = await creerProduitSimple(organizationId, {
      trackLots: true,
    })
    const db = drizzle(env.DB, { schema })
    const lotId = crypto.randomUUID()
    await db.insert(schema.lots).values({
      id: lotId,
      organizationId,
      variantId,
      lotNumber: "LOT-MULTI",
      expiryDate: new Date("2027-01-01T00:00:00.000Z"),
      createdAt: new Date(),
    })
    // Le MÊME lot (global à la variante) entre dans deux entrepôts avec des
    // quantités différentes — la somme par lot doit être scopée entrepôt.
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId: depot1,
          variantId,
          lotId,
          delta: 7,
          type: "purchase",
          unitCost: 100,
        },
        {
          warehouseId: depot2,
          variantId,
          lotId,
          delta: 5,
          type: "purchase",
          unitCost: 100,
        },
      ],
    })
    const lots1 = await lireLotsDisponibles(db, depot1, variantId)
    expect(lots1).toEqual([
      {
        lotId,
        expiryDate: new Date("2027-01-01T00:00:00.000Z"),
        disponible: 7,
      },
    ])
    const lots2 = await lireLotsDisponibles(db, depot2, variantId)
    expect(lots2).toHaveLength(1)
    expect(lots2[0].disponible).toBe(5)
  })
})

describe("catalogue POS — variante inactive (différé P6)", () => {
  it("exclut une variante inactive d'un produit actif", async () => {
    const { organizationId } = await bootstrapOwner()
    const storeId = await creerEntrepot(organizationId, "Boutique V", "store")
    const caissier = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, caissier.userId, storeId, "cashier")
    const { productId, variantId } = await creerProduitSimple(organizationId, {
      nom: "Produit VI",
    })
    const db = drizzle(env.DB, { schema })
    const varianteInactiveId = crypto.randomUUID()
    await db.insert(schema.productVariants).values({
      id: varianteInactiveId,
      organizationId,
      productId,
      name: "Grand",
      attributes: '{"taille":"G"}',
      sku: `TST-${productId.slice(0, 8)}-G`,
      isActive: false,
      createdAt: new Date(),
    })
    const res = await req(
      caissier.cookie,
      "GET",
      `/api/v1/pos/catalogue?storeId=${storeId}`
    )
    expect(res.status).toBe(200)
    const { articles } = await res.json<{
      articles: Array<{ variantId: string }>
    }>()
    const ids = articles.map((a) => a.variantId)
    expect(ids).toContain(variantId)
    expect(ids).not.toContain(varianteInactiveId)
  })
})

describe("CMP destination — batch transfer_in multi-lignes (différé P6)", () => {
  async function lireNiveau(warehouseId: string, variantId: string) {
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

  it("pose le CMP de CHAQUE variante à destination dans UN batch", async () => {
    const { organizationId, ownerId } = await bootstrapOwner()
    const destination = await creerEntrepot(organizationId, "Destination M")
    const p1 = await creerProduitSimple(organizationId, { nom: "Var M1" })
    const p2 = await creerProduitSimple(organizationId, { nom: "Var M2" })
    const db = drizzle(env.DB, { schema })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId: destination,
          variantId: p1.variantId,
          delta: 10,
          type: "transfer_in",
          unitCost: 120,
        },
        {
          warehouseId: destination,
          variantId: p2.variantId,
          delta: 4,
          type: "transfer_in",
          unitCost: 350,
        },
      ],
    })
    expect(await lireNiveau(destination, p1.variantId)).toEqual({
      quantity: 10,
      avgCost: 120,
    })
    expect(await lireNiveau(destination, p2.variantId)).toEqual({
      quantity: 4,
      avgCost: 350,
    })
  })

  it("absorbe un transfer_in dans un CMP destination PRÉEXISTANT", async () => {
    const { organizationId, ownerId } = await bootstrapOwner()
    const destination = await creerEntrepot(organizationId, "Destination A")
    const { variantId } = await creerProduitSimple(organizationId, {
      nom: "Var A",
    })
    const db = drizzle(env.DB, { schema })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId: destination,
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
          warehouseId: destination,
          variantId,
          delta: 10,
          type: "transfer_in",
          unitCost: 300,
        },
      ],
    })
    // (10×100 + 10×300) / 20 = 200
    expect(await lireNiveau(destination, variantId)).toEqual({
      quantity: 20,
      avgCost: 200,
    })
  })
})
