import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
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

function req(cookie: string, method: string, url: string) {
  return app.request(
    url,
    { method, headers: { "content-type": "application/json", cookie } },
    env
  )
}

type Article = {
  variantId: string
  nom: string
  sku: string
  barcode: string | null
  price: number
  minPrice: number | null
  quantity: number
  trackLots: boolean
}

async function seedPos() {
  const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
  const storeId = await creerEntrepot(organizationId, "Boutique POS", "store")
  const reserveId = await creerEntrepot(organizationId, "Réserve POS")
  const caissier = await createUserWithRole(organizationId, "staff")
  await affecterEntrepot(organizationId, caissier.userId, storeId, "cashier")
  const { variantId } = await creerProduitSimple(organizationId, {
    nom: "Coca 50cl",
    prix: 500,
    barcode: "3057640100000",
  })
  const db = drizzle(env.DB, { schema })
  await applyMovements(db, {
    organizationId,
    userId: ownerId,
    mouvements: [
      {
        warehouseId: storeId,
        variantId,
        delta: 4,
        type: "purchase",
        unitCost: 200,
      },
      {
        warehouseId: reserveId,
        variantId,
        delta: 9,
        type: "purchase",
        unitCost: 200,
      },
    ],
  })
  return {
    organizationId,
    ownerCookie,
    storeId,
    reserveId,
    caissier,
    variantId,
  }
}

describe("GET /api/v1/pos/catalogue", () => {
  it("le caissier de la boutique lit le catalogue vendable avec le stock boutique", async () => {
    const { storeId, caissier, variantId } = await seedPos()
    const res = await req(
      caissier.cookie,
      "GET",
      `/api/v1/pos/catalogue?storeId=${storeId}`
    )
    expect(res.status).toBe(200)
    const corps = await res.json<{ articles: Article[] }>()
    const article = corps.articles.find((a) => a.variantId === variantId)
    expect(article).toBeDefined()
    expect(article?.nom).toBe("Coca 50cl")
    expect(article?.price).toBe(500)
    expect(article?.quantity).toBe(4)
    // La variante implicite hérite du code-barres PRODUIT
    expect(article?.barcode).toBe("3057640100000")
  })

  it("matrice : caissier d'une autre boutique, stock_manager et auditor → 403", async () => {
    const { organizationId, storeId } = await seedPos()
    const autreBoutique = await creerEntrepot(
      organizationId,
      "Autre POS",
      "store"
    )
    const autreCaissier = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      autreCaissier.userId,
      autreBoutique,
      "cashier"
    )
    const gestionnaire = await createUserWithRole(
      organizationId,
      "stock_manager"
    )
    const auditeur = await createUserWithRole(organizationId, "auditor")
    for (const cookie of [
      autreCaissier.cookie,
      gestionnaire.cookie,
      auditeur.cookie,
    ]) {
      const res = await req(
        cookie,
        "GET",
        `/api/v1/pos/catalogue?storeId=${storeId}`
      )
      expect(res.status).toBe(403)
    }
  })

  it("refuse un entrepôt qui n'est pas une boutique", async () => {
    const { ownerCookie, reserveId } = await seedPos()
    const res = await req(
      ownerCookie,
      "GET",
      `/api/v1/pos/catalogue?storeId=${reserveId}`
    )
    expect(res.status).toBe(400)
    expect((await res.json<{ code: string }>()).code).toBe(
      "ENTREPOT_NON_BOUTIQUE"
    )
  })

  it("exclut les produits inactifs", async () => {
    const { ownerCookie, storeId, organizationId } = await seedPos()
    const inactif = await creerProduitSimple(organizationId, {
      nom: "Produit retiré",
    })
    const db = drizzle(env.DB, { schema })
    await db
      .update(schema.products)
      .set({ isActive: false })
      .where(eq(schema.products.id, inactif.productId))
    const res = await req(
      ownerCookie,
      "GET",
      `/api/v1/pos/catalogue?storeId=${storeId}`
    )
    const corps = await res.json<{ articles: Article[] }>()
    expect(
      corps.articles.find((a) => a.variantId === inactif.variantId)
    ).toBeUndefined()
  })
})

describe("GET /api/v1/pos/disponibilites", () => {
  it("liste les AUTRES entrepôts où l'article est disponible (dépannage)", async () => {
    const { caissier, storeId, reserveId, variantId } = await seedPos()
    const res = await req(
      caissier.cookie,
      "GET",
      `/api/v1/pos/disponibilites?storeId=${storeId}&variantId=${variantId}`
    )
    expect(res.status).toBe(200)
    const corps = await res.json<{
      disponibilites: Array<{ warehouseId: string; quantity: number }>
    }>()
    expect(corps.disponibilites.length).toBe(1)
    expect(corps.disponibilites[0].warehouseId).toBe(reserveId)
    expect(corps.disponibilites[0].quantity).toBe(9)
  })
})
