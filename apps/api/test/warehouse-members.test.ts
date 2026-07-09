import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import app from "../src/index"
import { bootstrapOwner, createUserWithRole } from "./helpers"

async function creerEntrepot(ownerCookie: string) {
  const res = await app.request(
    "/api/v1/warehouses",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ name: "Boutique", type: "store" }),
    },
    env
  )
  return (await res.json<{ id: string }>()).id
}

function affecter(cookie: string, body: unknown) {
  return app.request(
    "/api/v1/warehouse-members",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

describe("API affectations", () => {
  it("affecte un caissier, refuse le doublon, supprime", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const warehouseId = await creerEntrepot(ownerCookie)
    const staff = await createUserWithRole(organizationId, "staff")

    const ok = await affecter(ownerCookie, {
      userId: staff.userId,
      warehouseId,
      role: "cashier",
    })
    expect(ok.status).toBe(201)
    const { id } = await ok.json<{ id: string }>()

    const doublon = await affecter(ownerCookie, {
      userId: staff.userId,
      warehouseId,
      role: "manager",
    })
    expect(doublon.status).toBe(409)
    expect((await doublon.json<{ code: string }>()).code).toBe("DEJA_AFFECTE")

    const del = await app.request(
      `/api/v1/warehouse-members/${id}`,
      { method: "DELETE", headers: { cookie: ownerCookie } },
      env
    )
    expect(del.status).toBe(200)
  })

  it("404 si user ou entrepôt inconnu ; staff refusé", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const warehouseId = await creerEntrepot(ownerCookie)
    const staff = await createUserWithRole(organizationId, "staff")

    expect(
      (
        await affecter(ownerCookie, {
          userId: crypto.randomUUID(),
          warehouseId,
          role: "cashier",
        })
      ).status
    ).toBe(404)
    expect(
      (
        await affecter(ownerCookie, {
          userId: staff.userId,
          warehouseId: crypto.randomUUID(),
          role: "cashier",
        })
      ).status
    ).toBe(404)
    expect(
      (
        await affecter(staff.cookie, {
          userId: staff.userId,
          warehouseId,
          role: "cashier",
        })
      ).status
    ).toBe(403)
  })
})
