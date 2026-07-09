import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import app from "../src/index"
import { bootstrapOwner, createUserWithRole } from "./helpers"

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
})
