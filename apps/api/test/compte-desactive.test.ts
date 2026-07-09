import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
import app from "../src/index"
import * as schema from "../src/db/schema"

const owner = {
  organizationName: "Ma Société",
  name: "Propriétaire",
  email: "owner@exemple.com",
  password: "MotDePasseTresSolide1",
}

async function bootstrap() {
  const res = await app.request(
    "/api/v1/setup",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-setup-token": env.SETUP_TOKEN,
      },
      body: JSON.stringify(owner),
    },
    env
  )
  return res.json<{ userId: string }>()
}

function signIn() {
  return app.request(
    "/api/auth/sign-in/email",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: owner.email, password: owner.password }),
    },
    env
  )
}

describe("compte désactivé", () => {
  it("refuse la connexion d'un compte désactivé", async () => {
    const { userId } = await bootstrap()
    const db = drizzle(env.DB, { schema })
    await db
      .update(schema.user)
      .set({ isActive: false })
      .where(eq(schema.user.id, userId))

    const res = await signIn()
    expect(res.status).toBe(403)
  })

  it("rejette une session existante après désactivation", async () => {
    const { userId } = await bootstrap()
    const cookie = (await signIn()).headers.get("set-cookie") ?? ""
    const db = drizzle(env.DB, { schema })
    await db
      .update(schema.user)
      .set({ isActive: false })
      .where(eq(schema.user.id, userId))

    const res = await app.request("/api/v1/me", { headers: { cookie } }, env)
    expect(res.status).toBe(403)
    expect((await res.json<{ code: string }>()).code).toBe("COMPTE_DESACTIVE")
  })
})
