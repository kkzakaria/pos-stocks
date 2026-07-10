import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
import { APIError } from "better-auth/api"
import { changePasswordSchema } from "shared"
import * as schema from "../db/schema"
import { createAuth } from "../lib/auth"
import { requireAuth } from "../middleware/require-auth"
import type { AuthVariables } from "../middleware/require-auth"
import type { Env } from "../env"

export const monCompteRoute = new Hono<{
  Bindings: Env
  Variables: AuthVariables
}>()

monCompteRoute.post("/mot-de-passe", requireAuth, async (c) => {
  const parsed = changePasswordSchema.safeParse(
    await c.req.json().catch(() => null)
  )
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
  const auth = createAuth(c.env)
  try {
    await auth.api.changePassword({
      body: {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        revokeOtherSessions: true,
      },
      headers: c.req.raw.headers,
    })
  } catch (err) {
    if (err instanceof APIError) {
      return c.json(
        {
          code: "MOT_DE_PASSE_INCORRECT",
          message: "Mot de passe actuel incorrect",
        },
        400
      )
    }
    throw err
  }
  const db = drizzle(c.env.DB, { schema })
  await db
    .update(schema.user)
    .set({ mustChangePassword: false })
    .where(eq(schema.user.id, c.get("user").id))
  return c.json({ ok: true })
})
