import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
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

function req(cookie: string, url: string) {
  return app.request(url, { headers: { cookie } }, env)
}

type LigneStock = {
  warehouseId: string
  warehouseName: string
  variantId: string
  variantName: string
  quantity: number
  avgCost: number
}
type Reponse = { stock: LigneStock[] }
type Erreur = { code: string }

// Seed: product P in Dépôt (10 @ 200) and Boutique (4 @ 300); a third-party
// product in Dépôt proves the response is filtered to the requested product.
async function seed() {
  const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
  const depotId = await creerEntrepot(organizationId, "Dépôt Central")
  const boutiqueId = await creerEntrepot(organizationId, "Boutique S", "store")
  const p = await creerProduitSimple(organizationId, { nom: "Article Stock" })
  const autre = await creerProduitSimple(organizationId, { nom: "Autre" })
  const db = drizzle(env.DB, { schema })
  await applyMovements(db, {
    organizationId,
    userId: ownerId,
    mouvements: [
      {
        warehouseId: depotId,
        variantId: p.variantId,
        delta: 10,
        type: "purchase",
        unitCost: 200,
      },
      {
        warehouseId: boutiqueId,
        variantId: p.variantId,
        delta: 4,
        type: "purchase",
        unitCost: 300,
      },
      {
        warehouseId: depotId,
        variantId: autre.variantId,
        delta: 7,
        type: "purchase",
        unitCost: 100,
      },
    ],
  })
  return { organizationId, ownerCookie, depotId, boutiqueId, p }
}

describe("GET /api/v1/products/:id/stock", () => {
  it("owner : toutes les lignes du produit, triées, CMP recalculable", async () => {
    const { ownerCookie, depotId, boutiqueId, p } = await seed()
    const res = await req(ownerCookie, `/api/v1/products/${p.productId}/stock`)
    expect(res.status).toBe(200)
    const body = await res.json<Reponse>()
    // Boutique S before Dépôt Central (sorted by warehouse name)
    expect(body.stock).toEqual([
      {
        warehouseId: boutiqueId,
        warehouseName: "Boutique S",
        variantId: p.variantId,
        variantName: "Standard",
        quantity: 4,
        avgCost: 300,
      },
      {
        warehouseId: depotId,
        warehouseName: "Dépôt Central",
        variantId: p.variantId,
        variantName: "Standard",
        quantity: 10,
        avgCost: 200,
      },
    ])
  })

  it("manager local : ne voit que SON entrepôt ; staff sans affectation : liste vide", async () => {
    const { organizationId, depotId, boutiqueId, p } = await seed()
    const manager = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      manager.userId,
      boutiqueId,
      "manager"
    )
    const resManager = await req(
      manager.cookie,
      `/api/v1/products/${p.productId}/stock`
    )
    expect(resManager.status).toBe(200)
    const stockManager = (await resManager.json<Reponse>()).stock
    expect(stockManager).toHaveLength(1)
    expect(stockManager[0]?.warehouseId).toBe(boutiqueId)
    expect(stockManager.some((l) => l.warehouseId === depotId)).toBe(false)

    const sansAffectation = await createUserWithRole(organizationId, "staff")
    const resVide = await req(
      sansAffectation.cookie,
      `/api/v1/products/${p.productId}/stock`
    )
    expect(resVide.status).toBe(200)
    expect((await resVide.json<Reponse>()).stock).toEqual([])
  })

  it("cross-org : produit d'une autre organisation → 404 INTROUVABLE", async () => {
    const { p } = await seed()
    // bootstrapOwner() is single-use (public setup): the second organization
    // is inserted directly in the database, same pattern as categories.test.ts
    // and phase5-prep.test.ts.
    const db = drizzle(env.DB, { schema })
    const autreOrgId = crypto.randomUUID()
    await db.insert(schema.organization).values({
      id: autreOrgId,
      name: "Autre Société",
      slug: `autre-${autreOrgId.slice(0, 8)}`,
      createdAt: new Date(),
    })
    const autreOwner = await createUserWithRole(autreOrgId, "owner")
    const res = await req(
      autreOwner.cookie,
      `/api/v1/products/${p.productId}/stock`
    )
    expect(res.status).toBe(404)
    expect((await res.json<Erreur>()).code).toBe("INTROUVABLE")
  })
})
