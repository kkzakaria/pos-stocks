import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import app from "../src/index"
import { bootstrapOwner } from "./helpers"

async function creerProduit(cookie: string, body: Record<string, unknown>) {
  const res = await app.request(
    "/api/v1/products",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
  return res.json<{ id: string; sku: string }>()
}

function ajouterVariante(cookie: string, productId: string, body: unknown) {
  return app.request(
    `/api/v1/products/${productId}/variants`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

function patchVariante(cookie: string, id: string, body: unknown) {
  return app.request(
    `/api/v1/variants/${id}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

function ajouterLot(cookie: string, variantId: string, body: unknown) {
  return app.request(
    `/api/v1/variants/${variantId}/lots`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

async function fiche(cookie: string, id: string) {
  const res = await app.request(
    `/api/v1/products/${id}`,
    { headers: { cookie } },
    env
  )
  return res.json<{
    product: {
      hasVariants: boolean
      variants: Array<{
        id: string
        name: string
        sku: string
        isActive: boolean
        lots: Array<{ lotNumber: string }>
      }>
    }
  }>()
}

describe("API variantes & lots", () => {
  it("première variante explicite : désactive l'implicite, bascule hasVariants, SKU auto", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const { id } = await creerProduit(ownerCookie, {
      name: "T-shirt",
      price: 5000,
    })

    const res = await ajouterVariante(ownerCookie, id, {
      name: "M / Rouge",
      attributes: { taille: "M", couleur: "Rouge" },
    })
    expect(res.status).toBe(201)
    const corps = await res.json<{ id: string; sku: string }>()
    expect(corps.sku).toBe("PRD-0001-M-ROUGE")

    const detail = await fiche(ownerCookie, id)
    expect(detail.product.hasVariants).toBe(true)
    const implicite = detail.product.variants.find((v) => v.name === "Standard")
    expect(implicite?.isActive).toBe(false)
    const explicite = detail.product.variants.find(
      (v) => v.name === "M / Rouge"
    )
    expect(explicite?.isActive).toBe(true)
  })

  it("refuse un plancher de variante supérieur au prix effectif (400 VALIDATION)", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const { id } = await creerProduit(ownerCookie, {
      name: "T-shirt",
      price: 5000,
    })
    const res = await ajouterVariante(ownerCookie, id, {
      name: "L",
      attributes: { taille: "L" },
      minPriceOverride: 6000,
    })
    expect(res.status).toBe(400)
    expect((await res.json<{ code: string }>()).code).toBe("VALIDATION")
  })

  it("refuse de désactiver la dernière variante active d'un produit actif (409 DERNIERE_VARIANTE)", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const { id } = await creerProduit(ownerCookie, {
      name: "Coca 33cl",
      price: 500,
    })
    const detail = await fiche(ownerCookie, id)
    const implicite = detail.product.variants[0]
    expect(implicite).toBeDefined()

    const res = await patchVariante(ownerCookie, implicite.id, {
      isActive: false,
    })
    expect(res.status).toBe(409)
    expect((await res.json<{ code: string }>()).code).toBe("DERNIERE_VARIANTE")
  })

  it("lots : création puis doublon → 409 LOT_EXISTANT", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const { id } = await creerProduit(ownerCookie, {
      name: "Yaourt nature",
      price: 300,
      trackLots: true,
    })
    const detail = await fiche(ownerCookie, id)
    const variante = detail.product.variants[0]

    const ok = await ajouterLot(ownerCookie, variante.id, {
      lotNumber: "LOT-2026-01",
      expiryDate: "2026-12-31",
    })
    expect(ok.status).toBe(201)

    const doublon = await ajouterLot(ownerCookie, variante.id, {
      lotNumber: "LOT-2026-01",
    })
    expect(doublon.status).toBe(409)
    expect((await doublon.json<{ code: string }>()).code).toBe("LOT_EXISTANT")

    const apres = await fiche(ownerCookie, id)
    expect(apres.product.variants[0]?.lots).toHaveLength(1)
  })

  it("lots refusés si le produit ne suit pas les lots (400 LOTS_NON_SUIVIS)", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const { id } = await creerProduit(ownerCookie, {
      name: "Coca 33cl",
      price: 500,
    })
    const detail = await fiche(ownerCookie, id)
    const variante = detail.product.variants[0]

    const res = await ajouterLot(ownerCookie, variante.id, {
      lotNumber: "LOT-X",
    })
    expect(res.status).toBe(400)
    expect((await res.json<{ code: string }>()).code).toBe("LOTS_NON_SUIVIS")
  })
})
