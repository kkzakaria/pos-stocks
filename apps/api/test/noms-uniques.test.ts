import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import app from "../src/index"
import * as schema from "../src/db/schema"
import { bootstrapOwner, creerEntrepot } from "./helpers"

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

type Erreur = { code: string; message: string }

describe("unicité des noms par organisation (issue #7)", () => {
  it("refuse un doublon de nom d'entrepôt, insensible à la casse", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const res1 = await req(ownerCookie, "POST", "/api/v1/warehouses", {
      name: "Central",
      type: "warehouse",
    })
    expect(res1.status).toBe(201)
    const res2 = await req(ownerCookie, "POST", "/api/v1/warehouses", {
      name: "CENTRAL",
      type: "store",
    })
    expect(res2.status).toBe(409)
    const corps = await res2.json<Erreur>()
    expect(corps.code).toBe("NOM_EXISTANT")
    expect(corps.message).toBe("Ce nom est déjà utilisé")
  })

  it("refuse le RENOMMAGE d'un entrepôt vers un nom existant", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    await creerEntrepot(organizationId, "Dépôt A")
    const cibleId = await creerEntrepot(organizationId, "Dépôt B")
    const res = await req(
      ownerCookie,
      "PATCH",
      `/api/v1/warehouses/${cibleId}`,
      { name: "Dépôt A" }
    )
    expect(res.status).toBe(409)
    expect((await res.json<Erreur>()).code).toBe("NOM_EXISTANT")
  })

  it("autorise le MÊME nom dans une AUTRE organisation (index org-scopé)", async () => {
    const { organizationId } = await bootstrapOwner()
    await creerEntrepot(organizationId, "Boutique unique")
    // Seconde organisation insérée directement (une seule org via l'API v1)
    const db = drizzle(env.DB, { schema })
    const autreOrgId = crypto.randomUUID()
    await db.insert(schema.organization).values({
      id: autreOrgId,
      name: "Autre société",
      slug: `autre-${autreOrgId.slice(0, 8)}`,
      createdAt: new Date(),
    })
    // Ne doit PAS lever : l'unicité est par organisation
    await creerEntrepot(autreOrgId, "Boutique unique")
  })

  it("refuse les doublons de nom produit / catégorie / fournisseur", async () => {
    const { ownerCookie } = await bootstrapOwner()
    // Produit
    const p1 = await req(ownerCookie, "POST", "/api/v1/products", {
      name: "Coca 50cl",
      price: 500,
    })
    expect(p1.status).toBe(201)
    const p2 = await req(ownerCookie, "POST", "/api/v1/products", {
      name: "coca 50CL",
      price: 600,
    })
    expect(p2.status).toBe(409)
    expect((await p2.json<Erreur>()).code).toBe("NOM_EXISTANT")
    // Catégorie
    const c1 = await req(ownerCookie, "POST", "/api/v1/categories", {
      name: "Boissons",
    })
    expect(c1.status).toBe(201)
    const c2 = await req(ownerCookie, "POST", "/api/v1/categories", {
      name: "BOISSONS",
    })
    expect(c2.status).toBe(409)
    expect((await c2.json<Erreur>()).code).toBe("NOM_EXISTANT")
    // Fournisseur
    const f1 = await req(ownerCookie, "POST", "/api/v1/suppliers", {
      name: "SODIBRA",
    })
    expect(f1.status).toBe(201)
    const f2 = await req(ownerCookie, "POST", "/api/v1/suppliers", {
      name: "Sodibra",
    })
    expect(f2.status).toBe(409)
    expect((await f2.json<Erreur>()).code).toBe("NOM_EXISTANT")
  })

  it("un doublon de nom produit n'est PAS maquillé en SKU_EXISTANT", async () => {
    const { ownerCookie } = await bootstrapOwner()
    await req(ownerCookie, "POST", "/api/v1/products", {
      name: "Fanta",
      price: 500,
      sku: "FAN-1",
    })
    const res = await req(ownerCookie, "POST", "/api/v1/products", {
      name: "Fanta",
      price: 500,
      sku: "FAN-2",
    })
    expect(res.status).toBe(409)
    expect((await res.json<Erreur>()).code).toBe("NOM_EXISTANT")
  })
})
