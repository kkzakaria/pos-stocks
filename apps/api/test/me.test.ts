import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import app from "../src/index"

async function bootstrapAndSignIn() {
  await app.request(
    "/api/v1/setup",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-setup-token": env.SETUP_TOKEN,
      },
      body: JSON.stringify({
        organizationName: "Ma Société",
        name: "Propriétaire",
        email: "owner@exemple.com",
        password: "MotDePasseTresSolide1",
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
        email: "owner@exemple.com",
        password: "MotDePasseTresSolide1",
      }),
    },
    env
  )
  return signIn.headers.get("set-cookie") ?? ""
}

describe("GET /api/v1/me", () => {
  it("renvoie 401 sans session", async () => {
    const res = await app.request("/api/v1/me", {}, env)
    expect(res.status).toBe(401)
    const body = await res.json<{ code: string }>()
    expect(body.code).toBe("NON_AUTHENTIFIE")
  })

  it("renvoie l'utilisateur et son rôle owner avec session", async () => {
    const cookie = await bootstrapAndSignIn()
    const res = await app.request("/api/v1/me", { headers: { cookie } }, env)
    expect(res.status).toBe(200)
    const body = await res.json<{
      user: { email: string }
      membership: { role: string; organizationName: string }
    }>()
    expect(body.user.email).toBe("owner@exemple.com")
    expect(body.membership.role).toBe("owner")
    expect(body.membership.organizationName).toBe("Ma Société")
  })

  it("renvoie mustChangePassword et les affectations", async () => {
    const cookie = await bootstrapAndSignIn()
    const res = await app.request("/api/v1/me", { headers: { cookie } }, env)
    const body = await res.json<{
      user: { mustChangePassword: boolean }
      assignments: Array<unknown>
    }>()
    expect(body.user.mustChangePassword).toBe(false)
    expect(body.assignments).toEqual([])
  })
})
