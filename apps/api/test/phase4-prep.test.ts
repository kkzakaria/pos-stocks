import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import app from "../src/index"
import { bootstrapOwner } from "./helpers"

function postJson(cookie: string, url: string, body: unknown) {
  return app.request(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

function patchJson(cookie: string, url: string, body: unknown) {
  return app.request(
    url,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

describe("prep Phase 4 — dette Phase 3 API", () => {
  it("la recherche produit traite % et _ comme des caractères littéraux", async () => {
    const { ownerCookie } = await bootstrapOwner()
    expect(
      (
        await postJson(ownerCookie, "/api/v1/products", {
          name: "Sirop 100%",
          price: 500,
        })
      ).status
    ).toBe(201)
    expect(
      (
        await postJson(ownerCookie, "/api/v1/products", {
          name: "Sirop 100L",
          price: 600,
        })
      ).status
    ).toBe(201)

    const params = new URLSearchParams({ recherche: "100%" })
    const res = await app.request(
      `/api/v1/products?${params.toString()}`,
      { headers: { cookie: ownerCookie } },
      env
    )
    const { products } = await res.json<{ products: Array<{ name: string }> }>()
    expect(products.map((p) => p.name)).toEqual(["Sirop 100%"])
  })

  it("le filtre actifs=false renvoie uniquement les produits inactifs", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const creation = await postJson(ownerCookie, "/api/v1/products", {
      name: "Produit retiré",
      price: 100,
    })
    const { id } = await creation.json<{ id: string }>()
    await patchJson(ownerCookie, `/api/v1/products/${id}`, { isActive: false })
    await postJson(ownerCookie, "/api/v1/products", {
      name: "Produit vivant",
      price: 100,
    })

    const res = await app.request(
      "/api/v1/products?actifs=false",
      { headers: { cookie: ownerCookie } },
      env
    )
    const { products } = await res.json<{ products: Array<{ name: string }> }>()
    expect(products.map((p) => p.name)).toEqual(["Produit retiré"])
  })

  it("baisser le prix produit sous le plancher d'une variante héritière est refusé", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const creation = await postJson(ownerCookie, "/api/v1/products", {
      name: "Chemise",
      price: 5000,
    })
    const { id } = await creation.json<{ id: string }>()
    // Variante sans priceOverride : elle hérite du prix produit,
    // mais avec un plancher propre de 4000.
    expect(
      (
        await postJson(ownerCookie, `/api/v1/products/${id}/variants`, {
          name: "Taille M",
          attributes: { taille: "M" },
          minPriceOverride: 4000,
        })
      ).status
    ).toBe(201)

    const baisse = await patchJson(ownerCookie, `/api/v1/products/${id}`, {
      price: 3000,
    })
    expect(baisse.status).toBe(400)
    expect((await baisse.json<{ code: string }>()).code).toBe("VALIDATION")

    // Une baisse qui reste au-dessus du plancher passe.
    expect(
      (await patchJson(ownerCookie, `/api/v1/products/${id}`, { price: 4500 }))
        .status
    ).toBe(200)
  })

  it("PATCH fournisseur accepte contact: null pour effacer le champ", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const creation = await postJson(ownerCookie, "/api/v1/suppliers", {
      name: "Sodeci",
      contact: "M. Kouassi",
      phone: "+225 07 00 00 00 01",
    })
    const { id } = await creation.json<{ id: string }>()

    expect(
      (
        await patchJson(ownerCookie, `/api/v1/suppliers/${id}`, {
          contact: null,
          phone: null,
        })
      ).status
    ).toBe(200)

    const liste = await app.request(
      "/api/v1/suppliers",
      { headers: { cookie: ownerCookie } },
      env
    )
    const { suppliers } = await liste.json<{
      suppliers: Array<{ contact: string | null; phone: string | null }>
    }>()
    expect(suppliers[0]?.contact).toBeNull()
    expect(suppliers[0]?.phone).toBeNull()
  })
})
