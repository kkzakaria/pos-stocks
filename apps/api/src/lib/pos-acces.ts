import { and, eq } from "drizzle-orm"
import type { Context } from "hono"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import * as schema from "../db/schema"
import { verifierAccesEntrepot } from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import type { Env } from "../env"

type Db = DrizzleD1Database<typeof schema>

// Matrice spec §4, ligne « Vendre (POS) » : owner/admin (bypass entreprise)
// + rôles locaux manager et cashier de la boutique. NI stock_manager NI les
// auditeurs — la vente est réservée à ceux qui tiennent la boutique.
// Partagé par register-sessions, pos (lecture caisse) et sales.
export function verifierAccesVente(
  c: Context<{ Bindings: Env; Variables: PermissionVariables }>,
  storeId: string
): Promise<Response | null> {
  return verifierAccesEntrepot(
    c,
    storeId,
    ["manager", "cashier"],
    ["owner", "admin"]
  )
}

// Lookup org-scopé d'une boutique. Retour annoté `| null` (piège eslint
// no-unnecessary-condition). L'appelant vérifie type === "store" / isActive.
export async function boutiqueScope(
  db: Db,
  organizationId: string,
  storeId: string
): Promise<typeof schema.warehouses.$inferSelect | null> {
  const rows = await db
    .select()
    .from(schema.warehouses)
    .where(
      and(
        eq(schema.warehouses.id, storeId),
        eq(schema.warehouses.organizationId, organizationId)
      )
    )
    .limit(1)
  return rows[0] ?? null
}

export const REPONSE_NON_BOUTIQUE = {
  code: "ENTREPOT_NON_BOUTIQUE",
  message: "Cet entrepôt n'est pas une boutique",
} as const
