import { and, eq, inArray } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import type { CompanyRole } from "shared"
import * as schema from "../db/schema"

type Db = DrizzleD1Database<typeof schema>

export type PorteeLectureStock =
  { tous: true } | { tous: false; warehouseIds: string[] }

// Matrice spec §4, lecture stock (niveaux, journal, alertes, réceptions) :
// owner/admin/auditor/stock_manager voient TOUT ; un membre `staff` voit les
// entrepôts où il est manager ou auditor. Le rôle local `cashier` n'ouvre
// PAS la lecture back-office — le POS (Phase 6) exposera le stock de sa
// boutique par ses propres routes.
export async function porteeLectureStock(
  db: Db,
  organizationId: string,
  userId: string,
  role: CompanyRole
): Promise<PorteeLectureStock> {
  if (
    role === "owner" ||
    role === "admin" ||
    role === "auditor" ||
    role === "stock_manager"
  ) {
    return { tous: true }
  }
  const rows = await db
    .select({ warehouseId: schema.warehouseMembers.warehouseId })
    .from(schema.warehouseMembers)
    .where(
      and(
        eq(schema.warehouseMembers.userId, userId),
        eq(schema.warehouseMembers.organizationId, organizationId),
        inArray(schema.warehouseMembers.role, ["manager", "auditor"])
      )
    )
  return { tous: false, warehouseIds: rows.map((r) => r.warehouseId) }
}
