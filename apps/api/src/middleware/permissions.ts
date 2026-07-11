import { createMiddleware } from "hono/factory"
import { drizzle } from "drizzle-orm/d1"
import { and, eq } from "drizzle-orm"
import type { Context } from "hono"
import type { CompanyRole, WarehouseRole } from "shared"
import * as schema from "../db/schema"
import type { Env } from "../env"
import type { AuthVariables } from "./require-auth"

export type Membership = { organizationId: string; role: CompanyRole }
export type PermissionVariables = AuthVariables & { membership: Membership }

type Ctx = { Bindings: Env; Variables: PermissionVariables }

export const requireMembership = createMiddleware<Ctx>(async (c, next) => {
  const user = c.get("user")
  const db = drizzle(c.env.DB, { schema })
  // Un utilisateur n'appartient qu'à une seule organisation : invariant
  // garanti en base par l'index unique `member_user_uidx` sur member(user_id)
  // (migration 0002_member_user_unique), donc `.limit(1)` reflète bien
  // l'unique adhésion possible plutôt qu'un choix arbitraire parmi plusieurs.
  const rows = await db
    .select({
      organizationId: schema.member.organizationId,
      role: schema.member.role,
    })
    .from(schema.member)
    .where(eq(schema.member.userId, user.id))
    .limit(1)
  if (!rows[0]) {
    return c.json(
      {
        code: "AUCUNE_ORGANISATION",
        message: "Aucune organisation associée à ce compte",
      },
      403
    )
  }
  c.set("membership", {
    organizationId: rows[0].organizationId,
    role: rows[0].role as CompanyRole,
  })
  await next()
})

export function requireRole(...roles: CompanyRole[]) {
  return createMiddleware<Ctx>(async (c, next) => {
    if (!roles.includes(c.get("membership").role)) {
      return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
    }
    await next()
  })
}

// Cœur de la vérification d'accès entrepôt, appelable hors middleware quand
// le warehouseId vient d'un document (ex. purchases.warehouseId) plutôt que
// du chemin. Renvoie null si autorisé, sinon la réponse 403 à retourner.
export async function verifierAccesEntrepot(
  c: Context<{ Bindings: Env; Variables: PermissionVariables }>,
  warehouseId: string,
  roles: WarehouseRole[],
  bypass: CompanyRole[] = ["owner", "admin", "stock_manager"]
): Promise<Response | null> {
  const db = drizzle(c.env.DB, { schema })
  // Garde anti cross-tenant : l'entrepôt doit exister et appartenir à
  // l'organisation du membre, y compris sur le chemin bypass.
  const warehouse = await db
    .select({ organizationId: schema.warehouses.organizationId })
    .from(schema.warehouses)
    .where(eq(schema.warehouses.id, warehouseId))
    .limit(1)
  if (
    !warehouse[0] ||
    warehouse[0].organizationId !== c.get("membership").organizationId
  ) {
    return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
  }
  if (bypass.includes(c.get("membership").role)) {
    return null
  }
  const rows = await db
    .select({ role: schema.warehouseMembers.role })
    .from(schema.warehouseMembers)
    .where(
      and(
        eq(schema.warehouseMembers.warehouseId, warehouseId),
        eq(schema.warehouseMembers.userId, c.get("user").id),
        eq(
          schema.warehouseMembers.organizationId,
          c.get("membership").organizationId
        )
      )
    )
    .limit(1)
  if (!rows[0] || !roles.includes(rows[0].role)) {
    return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
  }
  return null
}

export function requireWarehouseRole(
  roles: WarehouseRole[],
  bypass: CompanyRole[] = ["owner", "admin", "stock_manager"]
) {
  return createMiddleware<Ctx>(async (c, next) => {
    const warehouseId = c.req.param("warehouseId")
    if (!warehouseId) {
      return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
    }
    const refus = await verifierAccesEntrepot(c, warehouseId, roles, bypass)
    if (refus) {
      return refus
    }
    await next()
  })
}
