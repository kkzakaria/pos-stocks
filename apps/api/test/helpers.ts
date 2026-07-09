import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import app from "../src/index"
import * as schema from "../src/db/schema"
import type { CompanyRole } from "shared"

export const MDP = "MotDePasseTresSolide1"

async function signInCookie(email: string): Promise<string> {
  const res = await app.request(
    "/api/auth/sign-in/email",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: MDP }),
    },
    env
  )
  return res.headers.get("set-cookie") ?? ""
}

export async function bootstrapOwner() {
  const res = await app.request(
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
        password: MDP,
      }),
    },
    env
  )
  const body = await res.json<{ organizationId: string; userId: string }>()
  return {
    organizationId: body.organizationId,
    ownerId: body.userId,
    ownerCookie: await signInCookie("owner@exemple.com"),
  }
}

export async function createUserWithRole(
  organizationId: string,
  role: CompanyRole,
  email = `${role}-${crypto.randomUUID().slice(0, 8)}@exemple.com`
) {
  const res = await app.request(
    "/api/auth/sign-up/email",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-setup-token": env.SETUP_TOKEN,
      },
      body: JSON.stringify({ email, password: MDP, name: `Test ${role}` }),
    },
    env
  )
  const { user } = await res.json<{ user: { id: string } }>()
  const db = drizzle(env.DB, { schema })
  await db.insert(schema.member).values({
    id: crypto.randomUUID(),
    organizationId,
    userId: user.id,
    role,
    createdAt: new Date(),
  })
  return { userId: user.id, email, cookie: await signInCookie(email) }
}
