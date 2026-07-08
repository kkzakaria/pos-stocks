import { Hono } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { drizzle } from "drizzle-orm/d1"
import { setupSchema } from "shared"
import { APIError } from "better-auth/api"
import { createAuth } from "../lib/auth"
import * as schema from "../db/schema"
import type { Env } from "../env"

export const setupRoute = new Hono<{ Bindings: Env }>()

setupRoute.post("/", async (c) => {
  if (
    !c.env.SETUP_TOKEN ||
    c.req.header("x-setup-token") !== c.env.SETUP_TOKEN
  ) {
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

  let signUp: Awaited<ReturnType<typeof auth.api.signUpEmail>>
  try {
    signUp = await auth.api.signUpEmail({
      body: {
        email: parsed.data.email,
        password: parsed.data.password,
        name: parsed.data.name,
      },
      headers: new Headers({ "x-setup-token": c.env.SETUP_TOKEN }),
    })
  } catch (err) {
    if (err instanceof APIError) {
      const status = err.statusCode as ContentfulStatusCode
      return c.json(
        { code: "CREATION_UTILISATEUR", message: err.message },
        status
      )
    }
    throw err
  }

  const now = new Date()
  const organizationId = crypto.randomUUID()
  try {
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // D1 n'expose pas de code d'erreur structuré : la détection par texte est le seul moyen fiable.
    if (message.includes("UNIQUE constraint failed")) {
      return c.json(
        {
          code: "DEJA_INITIALISE",
          message: "L'application est déjà initialisée",
        },
        409
      )
    }
    throw err
  }

  return c.json({ organizationId, userId: signUp.user.id }, 201)
})
