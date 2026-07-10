import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import app from "../src/index"
import * as schema from "../src/db/schema"
import { bootstrapOwner, createUserWithRole } from "./helpers"

function post(cookie: string, body: unknown) {
  return app.request(
    "/api/v1/categories",
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
    `/api/v1/categories/${id}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

describe("API catégories", () => {
  it("owner et stock_manager écrivent, tous les membres lisent, staff n'écrit pas", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const gestionnaire = await createUserWithRole(
      organizationId,
      "stock_manager"
    )
    const staff = await createUserWithRole(organizationId, "staff")

    expect((await post(ownerCookie, { name: "Boissons" })).status).toBe(201)
    expect((await post(gestionnaire.cookie, { name: "Snacks" })).status).toBe(
      201
    )
    expect((await post(staff.cookie, { name: "Interdit" })).status).toBe(403)

    const liste = await app.request(
      "/api/v1/categories",
      { headers: { cookie: staff.cookie } },
      env
    )
    expect(liste.status).toBe(200)
    const { categories } = await liste.json<{
      categories: Array<{ name: string }>
    }>()
    expect(categories.map((cat) => cat.name)).toEqual(["Boissons", "Snacks"])
  })

  it("PATCH : renomme et reparente ; refuse le parent auto-référent et le parent inconnu", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const { id: parentId } = await (
      await post(ownerCookie, { name: "Boissons" })
    ).json<{ id: string }>()
    const { id } = await (
      await post(ownerCookie, { name: "Sodas" })
    ).json<{ id: string }>()

    expect(
      (await patch(ownerCookie, id, { name: "Sodas & jus", parentId })).status
    ).toBe(200)

    const auto = await patch(ownerCookie, id, { parentId: id })
    expect(auto.status).toBe(400)
    const corpsAuto = await auto.json<{ code: string; message: string }>()
    expect(corpsAuto.code).toBe("VALIDATION")
    expect(corpsAuto.message).toBe(
      "Une catégorie ne peut pas être son propre parent"
    )

    expect(
      (await patch(ownerCookie, id, { parentId: crypto.randomUUID() })).status
    ).toBe(404)
  })

  it("cross-org : une catégorie d'une autre organisation est introuvable (404)", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const db = drizzle(env.DB, { schema })
    const autreOrgId = crypto.randomUUID()
    await db.insert(schema.organization).values({
      id: autreOrgId,
      name: "Autre Société",
      slug: "autre",
      createdAt: new Date(),
    })
    const categorieId = crypto.randomUUID()
    await db.insert(schema.categories).values({
      id: categorieId,
      organizationId: autreOrgId,
      name: "Cachée",
      createdAt: new Date(),
    })
    expect(
      (await patch(ownerCookie, categorieId, { name: "Piratée" })).status
    ).toBe(404)
  })
})
