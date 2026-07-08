import { createMiddleware } from "hono/factory"
import { createAuth } from "../lib/auth"
import type { Env } from "../env"

export type AuthUser = { id: string; email: string; name: string }

export type AuthVariables = { user: AuthUser }

export const requireAuth = createMiddleware<{
  Bindings: Env
  Variables: AuthVariables
}>(async (c, next) => {
  const auth = createAuth(c.env)
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) {
    return c.json(
      { code: "NON_AUTHENTIFIE", message: "Authentification requise" },
      401
    )
  }
  c.set("user", {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  })
  await next()
})
