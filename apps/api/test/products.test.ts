import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import app from "../src/index"
import * as schema from "../src/db/schema"
import {
  bootstrapOwner,
  createUserWithRole,
  creerProduitSimple,
} from "./helpers"

function post(cookie: string, body: unknown) {
  return app.request(
    "/api/v1/products",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

function patch(cookie: string, id: string, body: unknown) {
  return app.request(
    `/api/v1/products/${id}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

function fiche(cookie: string, id: string) {
  return app.request(`/api/v1/products/${id}`, { headers: { cookie } }, env)
}

type Fiche = {
  product: {
    sku: string
    isActive: boolean
    hasVariants: boolean
    variants: Array<{
      id: string
      name: string
      sku: string
      isActive: boolean
    }>
  }
}

describe("API produits", () => {
  it("crée avec SKU auto séquentiel et variante implicite -STD", async () => {
    const { ownerCookie } = await bootstrapOwner()

    const premier = await post(ownerCookie, { name: "Coca 33cl", price: 500 })
    expect(premier.status).toBe(201)
    const corps1 = await premier.json<{ id: string; sku: string }>()
    expect(corps1.sku).toBe("PRD-0001")

    const second = await post(ownerCookie, { name: "Fanta 33cl", price: 500 })
    const corps2 = await second.json<{ id: string; sku: string }>()
    expect(corps2.sku).toBe("PRD-0002")

    const detail = await (await fiche(ownerCookie, corps1.id)).json<Fiche>()
    expect(detail.product.hasVariants).toBe(false)
    expect(detail.product.variants).toHaveLength(1)
    expect(detail.product.variants[0]?.name).toBe("Standard")
    expect(detail.product.variants[0]?.sku).toBe("PRD-0001-STD")
  })

  it("refuse un prix plancher supérieur au prix (400 VALIDATION)", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const res = await post(ownerCookie, {
      name: "Coca 33cl",
      price: 500,
      minPrice: 600,
    })
    expect(res.status).toBe(400)
    expect((await res.json<{ code: string }>()).code).toBe("VALIDATION")
  })

  it("409 SKU_EXISTANT si le SKU fourni existe déjà", async () => {
    const { ownerCookie } = await bootstrapOwner()
    expect(
      (await post(ownerCookie, { name: "A", price: 100, sku: "REF-UNIQUE" }))
        .status
    ).toBe(201)
    const doublon = await post(ownerCookie, {
      name: "B",
      price: 100,
      sku: "REF-UNIQUE",
    })
    expect(doublon.status).toBe(409)
    expect((await doublon.json<{ code: string }>()).code).toBe("SKU_EXISTANT")
  })

  it("recherche par code-barres d'une variante", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const { id } = await (
      await post(ownerCookie, { name: "Coca 33cl", price: 500 })
    ).json<{ id: string }>()

    const db = drizzle(env.DB, { schema })
    await db.insert(schema.productVariants).values({
      id: crypto.randomUUID(),
      organizationId,
      productId: id,
      name: "Pack de 6",
      attributes: JSON.stringify({ format: "Pack de 6" }),
      sku: "PRD-0001-PACK-DE-6",
      barcode: "3057640257123",
      createdAt: new Date(),
    })

    const res = await app.request(
      "/api/v1/products?recherche=3057640257123",
      { headers: { cookie: ownerCookie } },
      env
    )
    expect(res.status).toBe(200)
    const { products } = await res.json<{
      products: Array<{ name: string; variants: Array<unknown> }>
    }>()
    expect(products).toHaveLength(1)
    expect(products[0]?.name).toBe("Coca 33cl")
    expect(products[0]?.variants).toHaveLength(2)
  })

  it("permissions : staff lit, staff n'écrit pas, stock_manager écrit", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    await post(ownerCookie, { name: "Coca 33cl", price: 500 })
    const gestionnaire = await createUserWithRole(
      organizationId,
      "stock_manager"
    )
    const staff = await createUserWithRole(organizationId, "staff")

    expect(
      (
        await app.request(
          "/api/v1/products",
          { headers: { cookie: staff.cookie } },
          env
        )
      ).status
    ).toBe(200)
    expect((await post(staff.cookie, { name: "X", price: 100 })).status).toBe(
      403
    )
    expect(
      (await post(gestionnaire.cookie, { name: "Y", price: 100 })).status
    ).toBe(201)
  })

  it("PATCH revalide le plancher quand le prix change, et bascule isActive", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const { id } = await (
      await post(ownerCookie, { name: "Coca 33cl", price: 1000, minPrice: 800 })
    ).json<{ id: string }>()

    const tropBas = await patch(ownerCookie, id, { price: 500 })
    expect(tropBas.status).toBe(400)
    expect((await tropBas.json<{ code: string }>()).code).toBe("VALIDATION")

    expect((await patch(ownerCookie, id, { price: 900 })).status).toBe(200)
    expect((await patch(ownerCookie, id, { isActive: false })).status).toBe(200)
    const detail = await (await fiche(ownerCookie, id)).json<Fiche>()
    expect(detail.product.isActive).toBe(false)
  })

  it("cross-org : un produit d'une autre organisation est introuvable (404 en GET et PATCH)", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const db = drizzle(env.DB, { schema })
    const autreOrgId = crypto.randomUUID()
    await db.insert(schema.organization).values({
      id: autreOrgId,
      name: "Autre Société",
      slug: "autre-produits",
      createdAt: new Date(),
    })
    const produitId = crypto.randomUUID()
    const maintenant = new Date()
    await db.insert(schema.products).values({
      id: produitId,
      organizationId: autreOrgId,
      name: "Produit caché",
      sku: "AUTRE-0001",
      price: 100,
      createdAt: maintenant,
      updatedAt: maintenant,
    })

    expect((await fiche(ownerCookie, produitId)).status).toBe(404)
    expect(
      (await patch(ownerCookie, produitId, { name: "Piraté" })).status
    ).toBe(404)
  })
})

describe("GET /api/v1/products — pagination", () => {
  it("borne la page et renvoie total/page/limite", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    for (let i = 0; i < 3; i++) {
      await creerProduitSimple(organizationId, {
        nom: `Produit ${String(i).padStart(2, "0")}`,
      })
    }
    const page1 = await app.request(
      "/api/v1/products?page=1&limite=2",
      { headers: { cookie: ownerCookie } },
      env
    )
    expect(page1.status).toBe(200)
    const c1 = await page1.json<{
      products: unknown[]
      total: number
      page: number
      limite: number
    }>()
    expect(c1.total).toBe(3)
    expect(c1.page).toBe(1)
    expect(c1.limite).toBe(2)
    expect(c1.products).toHaveLength(2)

    const page2 = await app.request(
      "/api/v1/products?page=2&limite=2",
      { headers: { cookie: ownerCookie } },
      env
    )
    const c2 = await page2.json<{ products: unknown[]; total: number }>()
    expect(c2.products).toHaveLength(1)
    expect(c2.total).toBe(3)

    const page3 = await app.request(
      "/api/v1/products?page=3&limite=2",
      { headers: { cookie: ownerCookie } },
      env
    )
    const c3 = await page3.json<{ products: unknown[]; total: number }>()
    expect(c3.products).toEqual([])
    expect(c3.total).toBe(3)

    const invalide = await app.request(
      "/api/v1/products?limite=0",
      { headers: { cookie: ownerCookie } },
      env
    )
    expect(invalide.status).toBe(400)
  })

  it("isolation : le total ne compte pas les produits d'une autre organisation", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    await creerProduitSimple(organizationId, { nom: "Mien" })
    // Seconde organisation avec son propre produit (insert direct, motif de
    // permissions.test.ts).
    const db = drizzle(env.DB, { schema })
    const autreOrgId = crypto.randomUUID()
    await db.insert(schema.organization).values({
      id: autreOrgId,
      name: "Autre Société",
      slug: "autre-org",
      createdAt: new Date(),
    })
    await creerProduitSimple(autreOrgId, { nom: "Autre" })
    const res = await app.request(
      "/api/v1/products",
      { headers: { cookie: ownerCookie } },
      env
    )
    const corps = await res.json<{ products: unknown[]; total: number }>()
    expect(corps.total).toBe(1)
    expect(corps.products).toHaveLength(1)
  })
})

describe("GET /api/v1/products — inArray non borné batché", () => {
  it("liste tous les produits et leurs variantes au-delà de la taille de lot", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    // N > TAILLE_LOT_MAX (90) → the variants inArray spans several batches
    // (90 + 60). The prod "too many SQL variables" crash came from this
    // un-batched query on a large catalog.
    const N = 150
    // Seeded one product at a time (each creerProduitSimple is a batch of two
    // single-row inserts): a grouped insert would itself exceed D1's bound-
    // variable cap, masking the behavior under test.
    for (let i = 0; i < N; i++) {
      await creerProduitSimple(organizationId, {
        nom: `Produit ${String(i).padStart(3, "0")}`,
      })
    }

    // limite=200 (max allowed): the default page size (50) would otherwise
    // truncate the list before the variant batching under test is exercised.
    const res = await app.request(
      "/api/v1/products?limite=200",
      { headers: { cookie: ownerCookie } },
      env
    )
    expect(res.status).toBe(200)
    const { products } = await res.json<{
      products: Array<{ id: string; variants: unknown[] }>
    }>()
    expect(products.length).toBe(N)
    // Each product gets its variant back: results are complete across the batch
    // boundary (nothing lost when concatenating).
    expect(products.every((p) => p.variants.length === 1)).toBe(true)
  })
})
