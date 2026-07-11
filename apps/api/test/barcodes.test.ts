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

async function creerProduit(cookie: string, body: Record<string, unknown>) {
  const res = await postJson(cookie, "/api/v1/products", {
    price: 1000,
    ...body,
  })
  expect(res.status).toBe(201)
  return res.json<{ id: string; sku: string }>()
}

describe("unicité des codes-barres par organisation", () => {
  it("produit vs produit : 409 BARCODE_EXISTANT", async () => {
    const { ownerCookie } = await bootstrapOwner()
    await creerProduit(ownerCookie, { name: "Coca 50cl", barcode: "123456" })
    const doublon = await postJson(ownerCookie, "/api/v1/products", {
      name: "Fanta 50cl",
      price: 1000,
      barcode: "123456",
    })
    expect(doublon.status).toBe(409)
    expect((await doublon.json<{ code: string }>()).code).toBe(
      "BARCODE_EXISTANT"
    )
  })

  it("croisé : une variante ne peut pas prendre le code-barres d'un produit, ni l'inverse", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const produitA = await creerProduit(ownerCookie, {
      name: "Coca 50cl",
      barcode: "111111",
    })
    const produitB = await creerProduit(ownerCookie, { name: "Chemise" })

    // variante qui vise le barcode du produit A → refus
    const varianteDoublon = await postJson(
      ownerCookie,
      `/api/v1/products/${produitB.id}/variants`,
      { name: "Taille M", attributes: { taille: "M" }, barcode: "111111" }
    )
    expect(varianteDoublon.status).toBe(409)
    expect((await varianteDoublon.json<{ code: string }>()).code).toBe(
      "BARCODE_EXISTANT"
    )

    // variante avec son propre barcode → OK
    const variante = await postJson(
      ownerCookie,
      `/api/v1/products/${produitB.id}/variants`,
      { name: "Taille L", attributes: { taille: "L" }, barcode: "222222" }
    )
    expect(variante.status).toBe(201)

    // produit qui vise le barcode de la variante → refus
    const produitDoublon = await postJson(ownerCookie, "/api/v1/products", {
      name: "Sprite",
      price: 500,
      barcode: "222222",
    })
    expect(produitDoublon.status).toBe(409)
    expect((await produitDoublon.json<{ code: string }>()).code).toBe(
      "BARCODE_EXISTANT"
    )
  })

  it("PATCH : reposter son PROPRE code-barres passe, prendre celui d'un autre échoue", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const produitA = await creerProduit(ownerCookie, {
      name: "Coca",
      barcode: "333333",
    })
    await creerProduit(ownerCookie, { name: "Fanta", barcode: "444444" })

    expect(
      (
        await patchJson(ownerCookie, `/api/v1/products/${produitA.id}`, {
          barcode: "333333",
        })
      ).status
    ).toBe(200)

    const vol = await patchJson(
      ownerCookie,
      `/api/v1/products/${produitA.id}`,
      {
        barcode: "444444",
      }
    )
    expect(vol.status).toBe(409)
    expect((await vol.json<{ code: string }>()).code).toBe("BARCODE_EXISTANT")
  })

  it("PATCH variante : même règle", async () => {
    const { ownerCookie } = await bootstrapOwner()
    await creerProduit(ownerCookie, { name: "Coca", barcode: "555555" })
    const produit = await creerProduit(ownerCookie, { name: "Chemise" })
    const creation = await postJson(
      ownerCookie,
      `/api/v1/products/${produit.id}/variants`,
      { name: "Taille M", attributes: { taille: "M" } }
    )
    const { id: varianteId } = await creation.json<{ id: string }>()

    const vol = await patchJson(ownerCookie, `/api/v1/variants/${varianteId}`, {
      barcode: "555555",
    })
    expect(vol.status).toBe(409)
    expect((await vol.json<{ code: string }>()).code).toBe("BARCODE_EXISTANT")

    expect(
      (
        await patchJson(ownerCookie, `/api/v1/variants/${varianteId}`, {
          barcode: "666666",
        })
      ).status
    ).toBe(200)
  })
})
