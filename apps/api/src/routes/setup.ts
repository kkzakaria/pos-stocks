import { Hono } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
import { setupSchema } from "shared"
import { APIError } from "better-auth/api"
import { createAuth } from "../lib/auth"
import { safeTokenEqual } from "../lib/timing-safe"
import { estViolationUnicite } from "../lib/db-errors"
import { validerCorps } from "../lib/validation"
import * as schema from "../db/schema"
import type { Env } from "../env"

export const setupRoute = new Hono<{ Bindings: Env }>()

setupRoute.post("/", async (c) => {
  if (!safeTokenEqual(c.req.header("x-setup-token"), c.env.SETUP_TOKEN)) {
    return c.json({ code: "INTERDIT", message: "Jeton de setup invalide" }, 403)
  }

  const corps = await validerCorps(c, setupSchema)
  if (!corps.ok) return corps.reponse

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

  // Vérification explicite en amont : depuis `autoSignIn: false`, Better Auth
  // renvoie une réponse "synthétique" (anti-énumération, cf. sign-up.mjs) pour
  // un email déjà pris au lieu de lever une APIError — l'id retourné n'existe
  // pas en base, ce qui ferait échouer l'insertion du membre plus bas par une
  // violation de clé étrangère opaque (500) plutôt que l'erreur métier propre.
  const emailExistant = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, corps.data.email))
    .limit(1)
  if (emailExistant.length > 0) {
    return c.json(
      {
        code: "CREATION_UTILISATEUR",
        message: "Impossible de créer le compte utilisateur",
      },
      409
    )
  }

  const auth = createAuth(c.env)

  let signUp: Awaited<ReturnType<typeof auth.api.signUpEmail>>
  try {
    signUp = await auth.api.signUpEmail({
      body: {
        email: corps.data.email,
        password: corps.data.password,
        name: corps.data.name,
      },
      headers: new Headers({ "x-setup-token": c.env.SETUP_TOKEN }),
    })
  } catch (err) {
    if (err instanceof APIError) {
      const status = err.statusCode as ContentfulStatusCode
      return c.json(
        {
          code: "CREATION_UTILISATEUR",
          message: "Impossible de créer le compte utilisateur",
          details: err.message,
        },
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
        name: corps.data.organizationName,
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
    // Nettoyage best-effort de l'utilisateur Better Auth orphelin (account/session
    // cascadent via FK) : ne doit jamais masquer l'erreur d'origine ci-dessous.
    try {
      await db.delete(schema.user).where(eq(schema.user.id, signUp.user.id))
    } catch (cleanupErr) {
      console.error("Échec du nettoyage de l'utilisateur orphelin", cleanupErr)
    }
    if (estViolationUnicite(err)) {
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
