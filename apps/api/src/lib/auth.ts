import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { organization } from "better-auth/plugins/organization"
import { createAuthMiddleware, APIError } from "better-auth/api"
import { drizzle } from "drizzle-orm/d1"
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
      }),
    },
    advanced: env.COOKIE_DOMAIN
      ? {
          crossSubDomainCookies: { enabled: true, domain: env.COOKIE_DOMAIN },
          useSecureCookies: true,
        }
      : {},
    plugins: [organization()],
  })
}

export type Auth = ReturnType<typeof createAuth>
