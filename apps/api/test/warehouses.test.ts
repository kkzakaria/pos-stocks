import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import app from "../src/index"
import * as schema from "../src/db/schema"
import { bootstrapOwner, createUserWithRole, creerEntrepot } from "./helpers"

function post(cookie: string, body: unknown) {
  return app.request(
    "/api/v1/warehouses",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

describe("API entrepôts", () => {
  it("owner crée puis liste ; staff refusé en écriture ET en lecture", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const staff = await createUserWithRole(organizationId, "staff")

    const created = await post(ownerCookie, {
      name: "Dépôt Nord",
      type: "warehouse",
    })
    expect(created.status).toBe(201)
    const { id } = await created.json<{ id: string }>()
    expect(id).toBeTruthy()

    const liste = await app.request(
      "/api/v1/warehouses",
      { headers: { cookie: ownerCookie } },
      env
    )
    expect(liste.status).toBe(200)
    const body = await liste.json<{
      warehouses: Array<{ name: string; type: string }>
    }>()
    expect(body.warehouses).toHaveLength(1)
    expect(body.warehouses[0].name).toBe("Dépôt Nord")

    expect(
      (await post(staff.cookie, { name: "X", type: "store" })).status
    ).toBe(403)
    expect(
      (
        await app.request(
          "/api/v1/warehouses",
          { headers: { cookie: staff.cookie } },
          env
        )
      ).status
    ).toBe(403)
  })

  it("stock_manager lit mais n'écrit pas", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    await post(ownerCookie, { name: "Dépôt", type: "warehouse" })
    const gest = await createUserWithRole(organizationId, "stock_manager")

    expect(
      (
        await app.request(
          "/api/v1/warehouses",
          { headers: { cookie: gest.cookie } },
          env
        )
      ).status
    ).toBe(200)
    expect((await post(gest.cookie, { name: "Y", type: "store" })).status).toBe(
      403
    )
  })

  it("PATCH modifie et 404 sur id inconnu ; 400 sur payload vide", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const { id } = await (
      await post(ownerCookie, { name: "Boutique", type: "store" })
    ).json<{ id: string }>()

    const patch = await app.request(
      `/api/v1/warehouses/${id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ isActive: false, name: "Boutique Sud" }),
      },
      env
    )
    expect(patch.status).toBe(200)

    const inconnu = await app.request(
      `/api/v1/warehouses/${crypto.randomUUID()}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ name: "Z" }),
      },
      env
    )
    expect(inconnu.status).toBe(404)

    const vide = await app.request(
      `/api/v1/warehouses/${id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({}),
      },
      env
    )
    expect(vide.status).toBe(400)
  })

  it("GET /destinations : accessible à un staff sans affectation, exclut les entrepôts inactifs et invisible cross-org", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const staff = await createUserWithRole(organizationId, "staff")
    const actifId = await creerEntrepot(organizationId, "Dépôt Actif")
    const inactifId = await creerEntrepot(organizationId, "Dépôt Inactif")
    const desactivation = await app.request(
      `/api/v1/warehouses/${inactifId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ isActive: false }),
      },
      env
    )
    expect(desactivation.status).toBe(200)

    const dest = await app.request(
      "/api/v1/warehouses/destinations",
      { headers: { cookie: staff.cookie } },
      env
    )
    expect(dest.status).toBe(200)
    const body = await dest.json<{
      warehouses: Array<{ id: string; name: string; type: string }>
    }>()
    expect(body.warehouses.map((w) => w.id)).toEqual([actifId])

    // Seconde organisation avec son propre entrepôt, insérée directement en
    // base (cf. permissions.test.ts) : le propriétaire de la première
    // organisation ne doit jamais la voir.
    const db = drizzle(env.DB, { schema })
    const autreOrgId = crypto.randomUUID()
    await db.insert(schema.organization).values({
      id: autreOrgId,
      name: "Autre Société",
      slug: "autre-societe",
      createdAt: new Date(),
    })
    await creerEntrepot(autreOrgId, "Dépôt Autre Org")

    const destProprietaire = await app.request(
      "/api/v1/warehouses/destinations",
      { headers: { cookie: ownerCookie } },
      env
    )
    expect(destProprietaire.status).toBe(200)
    const bodyProprietaire = await destProprietaire.json<{
      warehouses: Array<{ id: string; name: string }>
    }>()
    expect(bodyProprietaire.warehouses.map((w) => w.id)).toEqual([actifId])
    expect(
      bodyProprietaire.warehouses.some((w) => w.name === "Dépôt Autre Org")
    ).toBe(false)

    const nonAuthentifie = await app.request(
      "/api/v1/warehouses/destinations",
      {},
      env
    )
    expect(nonAuthentifie.status).toBe(401)
  })
})
