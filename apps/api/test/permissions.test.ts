import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import * as schema from "../src/db/schema"
import { requireAuth } from "../src/middleware/require-auth"
import {
  requireMembership,
  requireRole,
  requireWarehouseRole,
} from "../src/middleware/permissions"
import type { PermissionVariables } from "../src/middleware/permissions"
import type { Env } from "../src/env"
import { bootstrapOwner, createUserWithRole } from "./helpers"

const testApp = new Hono<{ Bindings: Env; Variables: PermissionVariables }>()
testApp.get(
  "/t/admin-seulement",
  requireAuth,
  requireMembership,
  requireRole("owner", "admin"),
  (c) => c.json({ ok: true })
)
testApp.get(
  "/t/entrepot/:warehouseId/vente",
  requireAuth,
  requireMembership,
  requireWarehouseRole(["manager", "cashier"]),
  (c) => c.json({ ok: true })
)

async function creerEntrepot(organizationId: string) {
  const db = drizzle(env.DB, { schema })
  const id = crypto.randomUUID()
  await db.insert(schema.warehouses).values({
    id,
    organizationId,
    name: "Boutique Centre",
    type: "store",
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return id
}

describe("permissions", () => {
  it("requireRole : autorise owner, refuse staff avec ACCES_REFUSE", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const staff = await createUserWithRole(organizationId, "staff")

    const ok = await testApp.request(
      "/t/admin-seulement",
      { headers: { cookie: ownerCookie } },
      env
    )
    expect(ok.status).toBe(200)

    const ko = await testApp.request(
      "/t/admin-seulement",
      { headers: { cookie: staff.cookie } },
      env
    )
    expect(ko.status).toBe(403)
    expect((await ko.json<{ code: string }>()).code).toBe("ACCES_REFUSE")
  })

  it("requireWarehouseRole : caissier affecté OK, staff non affecté refusé, owner bypass", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const warehouseId = await creerEntrepot(organizationId)
    const caissier = await createUserWithRole(organizationId, "staff")
    const intrus = await createUserWithRole(organizationId, "staff")

    const db = drizzle(env.DB, { schema })
    await db.insert(schema.warehouseMembers).values({
      id: crypto.randomUUID(),
      organizationId,
      warehouseId,
      userId: caissier.userId,
      role: "cashier",
      createdAt: new Date(),
    })

    const url = `/t/entrepot/${warehouseId}/vente`
    expect(
      (
        await testApp.request(
          url,
          { headers: { cookie: caissier.cookie } },
          env
        )
      ).status
    ).toBe(200)
    expect(
      (await testApp.request(url, { headers: { cookie: intrus.cookie } }, env))
        .status
    ).toBe(403)
    expect(
      (await testApp.request(url, { headers: { cookie: ownerCookie } }, env))
        .status
    ).toBe(200)
  })

  it("requireMembership : 403 AUCUNE_ORGANISATION sans membership", async () => {
    await bootstrapOwner()
    // utilisateur créé SANS ligne member (directement via l'API auth, pas via helpers)
    const app = (await import("../src/index")).default
    await app.request(
      "/api/auth/sign-up/email",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-setup-token": env.SETUP_TOKEN,
        },
        body: JSON.stringify({
          email: "sansorg@exemple.com",
          password: "MotDePasseTresSolide1",
          name: "Sans Org",
        }),
      },
      env
    )
    const signIn = await app.request(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "sansorg@exemple.com",
          password: "MotDePasseTresSolide1",
        }),
      },
      env
    )
    const cookie = signIn.headers.get("set-cookie") ?? ""
    const res = await testApp.request(
      "/t/admin-seulement",
      { headers: { cookie } },
      env
    )
    expect(res.status).toBe(403)
    expect((await res.json<{ code: string }>()).code).toBe(
      "AUCUNE_ORGANISATION"
    )
  })
})
