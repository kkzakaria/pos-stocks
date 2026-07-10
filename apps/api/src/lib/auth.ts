import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { organization } from "better-auth/plugins/organization"
import { createAuthMiddleware, APIError } from "better-auth/api"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
import * as schema from "../db/schema"
import { safeTokenEqual } from "./timing-safe"
import type { Env } from "../env"

export function createAuth(env: Env) {
  const db = drizzle(env.DB, { schema })
  return betterAuth({
    database: drizzleAdapter(db, { provider: "sqlite" }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.WEB_ORIGIN],
    emailAndPassword: { enabled: true },
    user: {
      additionalFields: {
        mustChangePassword: {
          type: "boolean",
          defaultValue: false,
          input: false,
        },
        isActive: { type: "boolean", defaultValue: true, input: false },
      },
    },
    hooks: {
      // Adaptation vs. la brief : dans better-auth@1.6.x, `hooks.before` est un
      // middleware unique (pas un tableau `{ matcher, handler }`) ; le filtrage
      // par chemin se fait donc à l'intérieur du handler via `ctx.path`.
      before: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path === "/sign-up/email" &&
          !safeTokenEqual(
            ctx.headers?.get("x-setup-token") ?? undefined,
            env.SETUP_TOKEN
          )
        ) {
          throw new APIError("FORBIDDEN", {
            message: "L'inscription publique est désactivée",
          })
        }
        if (ctx.path === "/sign-in/email") {
          const email = (
            ctx.body as { email?: string } | undefined
          )?.email?.toLowerCase()
          if (email) {
            const rows = await db
              .select({ isActive: schema.user.isActive })
              .from(schema.user)
              .where(eq(schema.user.email, email))
              .limit(1)
            if (rows[0] && rows[0].isActive === false) {
              throw new APIError("FORBIDDEN", { message: "Compte désactivé" })
            }
          }
        }
        // Surface HTTP du plugin organization bloquée : l'app gère les
        // organisations exclusivement via l'API d'administration /api/v1.
        if (ctx.path.startsWith("/organization")) {
          throw new APIError("FORBIDDEN", {
            message:
              "La gestion des organisations passe par l'API d'administration",
          })
        }
      }),
    },
    advanced: env.COOKIE_DOMAIN
      ? {
          crossSubDomainCookies: { enabled: true, domain: env.COOKIE_DOMAIN },
          useSecureCookies: true,
        }
      : {},
    plugins: [organization({ allowUserToCreateOrganization: false })],
  })
}

export type Auth = ReturnType<typeof createAuth>
