import { createMiddleware } from "hono/factory"
import { createAuth } from "../lib/auth"
import type { Env } from "../env"

export type AuthUser = {
  id: string
  email: string
  name: string
  mustChangePassword: boolean
}

export type AuthVariables = { user: AuthUser }

const CHEMINS_AUTORISES_MDP = ["/api/v1/me", "/api/v1/mon-compte/mot-de-passe"]

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
  const u = session.user
  if (u.isActive === false) {
    return c.json(
      { code: "COMPTE_DESACTIVE", message: "Compte désactivé" },
      403
    )
  }
  c.set("user", {
    id: u.id,
    email: u.email,
    name: u.name,
    mustChangePassword: u.mustChangePassword === true,
  })
  if (
    c.get("user").mustChangePassword &&
    !CHEMINS_AUTORISES_MDP.includes(new URL(c.req.url).pathname)
  ) {
    return c.json(
      {
        code: "MOT_DE_PASSE_A_CHANGER",
        message: "Vous devez changer votre mot de passe avant de continuer",
      },
      403
    )
  }
  await next()
})
