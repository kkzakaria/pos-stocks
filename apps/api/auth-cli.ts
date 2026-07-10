// Configuration utilisée UNIQUEMENT par `@better-auth/cli generate`.
// Les plugins déclarés ici doivent rester synchronisés avec ceux de src/lib/auth.ts ;
// re-générer le schéma (src/db/schema/auth.ts) après tout ajout ou changement de plugin.

import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { organization } from "better-auth/plugins/organization"
import { drizzle } from "drizzle-orm/d1"

export const auth = betterAuth({
  database: drizzleAdapter(drizzle({} as D1Database), { provider: "sqlite" }),
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
  plugins: [organization({ allowUserToCreateOrganization: false })],
})
