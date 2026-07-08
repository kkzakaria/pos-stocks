import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { setupSchema } from "shared"
import { createAuth } from "../lib/auth"
import * as schema from "../db/schema"
import type { Env } from "../env"

export const setupRoute = new Hono<{ Bindings: Env }>()

setupRoute.post("/", async (c) => {
  if (c.req.header("x-setup-token") !== c.env.SETUP_TOKEN) {
    return c.json({ code: "INTERDIT", message: "Jeton de setup invalide" }, 403)
  }

  const parsed = setupSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json(
      {
        code: "VALIDATION",
        message: "Données invalides",
        details: parsed.error.flatten(),
      },
      400
    )
  }

  const db = drizzle(c.env.DB, { schema })
  const existing = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .limit(1)
  if (existing.length > 0) {
    return c.json(
      {
        code: "DEJA_INITIALISE",
        message: "L'application est déjà initialisée",
      },
      409
    )
  }

  const auth = createAuth(c.env)
  const signUp = await auth.api.signUpEmail({
    body: {
      email: parsed.data.email,
      password: parsed.data.password,
      name: parsed.data.name,
    },
    headers: new Headers({ "x-setup-token": c.env.SETUP_TOKEN }),
  })

  const now = new Date()
  const organizationId = crypto.randomUUID()
  await db.batch([
    db.insert(schema.organization).values({
      id: organizationId,
      name: parsed.data.organizationName,
      slug: "principale",
      createdAt: now,
      metadata: JSON.stringify({ currency: "XOF" }),
    }),
    db.insert(schema.member).values({
      id: crypto.randomUUID(),
      organizationId,
      userId: signUp.user.id,
      role: "owner",
      createdAt: now,
    }),
  ])

  return c.json({ organizationId, userId: signUp.user.id }, 201)
})
