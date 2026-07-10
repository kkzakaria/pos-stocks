import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import app from "../src/index"
import * as schema from "../src/db/schema"
import { bootstrapOwner, createUserWithRole } from "./helpers"

function post(cookie: string, body: unknown) {
  return app.request(
    "/api/v1/suppliers",
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
    `/api/v1/suppliers/${id}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

describe("API fournisseurs", () => {
  it("owner crée, la liste est triée, staff lit mais n'écrit pas", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const staff = await createUserWithRole(organizationId, "staff")

    expect(
      (
        await post(ownerCookie, {
          name: "Sodeci Distribution",
          contact: "M. Kouassi",
          phone: "+225 07 00 00 00 01",
        })
      ).status
    ).toBe(201)
    expect((await post(ownerCookie, { name: "Abidjan Boissons" })).status).toBe(
      201
    )
    expect((await post(staff.cookie, { name: "Interdit" })).status).toBe(403)

    const liste = await app.request(
      "/api/v1/suppliers",
      { headers: { cookie: staff.cookie } },
      env
    )
    expect(liste.status).toBe(200)
    const { suppliers } = await liste.json<{
      suppliers: Array<{ name: string; isActive: boolean }>
    }>()
    expect(suppliers.map((s) => s.name)).toEqual([
      "Abidjan Boissons",
      "Sodeci Distribution",
    ])
    expect(suppliers[0]?.isActive).toBe(true)
  })

  it("PATCH modifie le contact et bascule isActive ; 404 sur id inconnu", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const { id } = await (
      await post(ownerCookie, { name: "Sodeci Distribution" })
    ).json<{ id: string }>()

    expect(
      (
        await patch(ownerCookie, id, {
          contact: "Mme Traoré",
          isActive: false,
        })
      ).status
    ).toBe(200)

    const liste = await app.request(
      "/api/v1/suppliers",
      { headers: { cookie: ownerCookie } },
      env
    )
    const { suppliers } = await liste.json<{
      suppliers: Array<{ contact: string | null; isActive: boolean }>
    }>()
    expect(suppliers[0]?.contact).toBe("Mme Traoré")
    expect(suppliers[0]?.isActive).toBe(false)

    expect(
      (await patch(ownerCookie, crypto.randomUUID(), { name: "X" })).status
    ).toBe(404)
  })

  it("auditor ne peut pas créer un fournisseur (403)", async () => {
    const { organizationId } = await bootstrapOwner()
    const auditeur = await createUserWithRole(organizationId, "auditor")
    expect((await post(auditeur.cookie, { name: "Interdit" })).status).toBe(403)
  })

  it("cross-org : un fournisseur d'une autre organisation est introuvable (404)", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const db = drizzle(env.DB, { schema })
    const autreOrgId = crypto.randomUUID()
    await db.insert(schema.organization).values({
      id: autreOrgId,
      name: "Autre Société",
      slug: "autre-fournisseurs",
      createdAt: new Date(),
    })
    const supplierId = crypto.randomUUID()
    await db.insert(schema.suppliers).values({
      id: supplierId,
      organizationId: autreOrgId,
      name: "Fournisseur caché",
      createdAt: new Date(),
    })
    expect(
      (await patch(ownerCookie, supplierId, { name: "Piraté" })).status
    ).toBe(404)
  })
})
