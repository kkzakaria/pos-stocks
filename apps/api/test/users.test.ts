import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import app from "../src/index"
import { bootstrapOwner, createUserWithRole } from "./helpers"

function createUser(cookie: string, body: unknown) {
  return app.request(
    "/api/v1/users",
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

describe("API utilisateurs", () => {
  it("owner crée un caissier : mot de passe provisoire retourné, connexion possible, mustChangePassword vrai", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const res = await createUser(ownerCookie, {
      name: "Caissier Un",
      email: "caissier@exemple.com",
      role: "staff",
    })
    expect(res.status).toBe(201)
    const { userId, provisionalPassword } = await res.json<{
      userId: string
      provisionalPassword: string
    }>()
    expect(userId).toBeTruthy()
    expect(provisionalPassword).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)

    const signIn = await app.request(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "caissier@exemple.com",
          password: provisionalPassword,
        }),
      },
      env
    )
    expect(signIn.status).toBe(200)
    const cookie = signIn.headers.get("set-cookie") ?? ""
    const me = await app.request("/api/v1/me", { headers: { cookie } }, env)
    const body = await me.json<{
      user: { mustChangePassword: boolean }
      membership: { role: string }
    }>()
    expect(body.user.mustChangePassword).toBe(true)
    expect(body.membership.role).toBe("staff")
  })

  it("email déjà pris → 409 EMAIL_EXISTANT ; admin ne peut pas créer un admin", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    await createUser(ownerCookie, {
      name: "A",
      email: "double@exemple.com",
      role: "staff",
    })
    const dbl = await createUser(ownerCookie, {
      name: "B",
      email: "double@exemple.com",
      role: "staff",
    })
    expect(dbl.status).toBe(409)
    expect((await dbl.json<{ code: string }>()).code).toBe("EMAIL_EXISTANT")

    // Normalisation de la casse : même email avec majuscules → même conflit
    const dblCasse = await createUser(ownerCookie, {
      name: "B2",
      email: "Double@Exemple.com",
      role: "staff",
    })
    expect(dblCasse.status).toBe(409)
    expect((await dblCasse.json<{ code: string }>()).code).toBe(
      "EMAIL_EXISTANT"
    )

    const admin = await createUserWithRole(organizationId, "admin")
    const ko = await createUser(admin.cookie, {
      name: "C",
      email: "c@exemple.com",
      role: "admin",
    })
    expect(ko.status).toBe(403)
  })

  it("liste avec rôles ; auditor lit, staff refusé", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    await createUser(ownerCookie, {
      name: "X",
      email: "x@exemple.com",
      role: "stock_manager",
    })
    const auditor = await createUserWithRole(organizationId, "auditor")
    const staff = await createUserWithRole(organizationId, "staff")

    const res = await app.request(
      "/api/v1/users",
      { headers: { cookie: auditor.cookie } },
      env
    )
    expect(res.status).toBe(200)
    const { users } = await res.json<{
      users: Array<{ email: string; role: string }>
    }>()
    expect(users.length).toBeGreaterThanOrEqual(2)

    expect(
      (
        await app.request(
          "/api/v1/users",
          { headers: { cookie: staff.cookie } },
          env
        )
      ).status
    ).toBe(403)
  })

  it("changement de rôle : owner OK ; dernier owner protégé ; admin limité", async () => {
    const { organizationId, ownerCookie, ownerId } = await bootstrapOwner()
    const staff = await createUserWithRole(organizationId, "staff")
    const admin = await createUserWithRole(organizationId, "admin")

    expect(
      (
        await patchJson(ownerCookie, `/api/v1/users/${staff.userId}/role`, {
          role: "stock_manager",
        })
      ).status
    ).toBe(200)

    const dernier = await patchJson(
      ownerCookie,
      `/api/v1/users/${ownerId}/role`,
      { role: "staff" }
    )
    expect(dernier.status).toBe(409)
    expect((await dernier.json<{ code: string }>()).code).toBe("DERNIER_OWNER")

    // admin ne peut pas toucher un admin ni promouvoir owner
    expect(
      (
        await patchJson(admin.cookie, `/api/v1/users/${admin.userId}/role`, {
          role: "staff",
        })
      ).status
    ).toBe(403)
    expect(
      (
        await patchJson(admin.cookie, `/api/v1/users/${staff.userId}/role`, {
          role: "owner",
        })
      ).status
    ).toBe(403)
  })

  it("désactivation : sessions révoquées ; auto-désactivation interdite", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const staff = await createUserWithRole(organizationId, "staff")

    const off = await patchJson(
      ownerCookie,
      `/api/v1/users/${staff.userId}/statut`,
      { isActive: false }
    )
    expect(off.status).toBe(200)
    // la session existante du staff est révoquée → 401 (session supprimée)
    const me = await app.request(
      "/api/v1/me",
      { headers: { cookie: staff.cookie } },
      env
    )
    expect([401, 403]).toContain(me.status)

    const self = await patchJson(
      ownerCookie,
      `/api/v1/users/${await bootstrapOwnerId(ownerCookie)}/statut`,
      {
        isActive: false,
      }
    )
    expect(self.status).toBe(400)
    expect((await self.json<{ code: string }>()).code).toBe(
      "AUTO_DESACTIVATION"
    )
  })

  it("admin ne peut pas désactiver le owner", async () => {
    const { organizationId, ownerId } = await bootstrapOwner()
    const admin = await createUserWithRole(organizationId, "admin")

    const res = await patchJson(
      admin.cookie,
      `/api/v1/users/${ownerId}/statut`,
      { isActive: false }
    )
    expect(res.status).toBe(403)
    expect((await res.json<{ code: string }>()).code).toBe("ACCES_REFUSE")
  })
})

async function bootstrapOwnerId(ownerCookie: string): Promise<string> {
  const me = await app.request(
    "/api/v1/me",
    { headers: { cookie: ownerCookie } },
    env
  )
  return (await me.json<{ user: { id: string } }>()).user.id
}
