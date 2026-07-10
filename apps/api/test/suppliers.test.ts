import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import app from "../src/index"
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
})
