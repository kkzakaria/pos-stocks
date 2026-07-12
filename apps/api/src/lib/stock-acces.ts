import { and, eq, inArray, or } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core"
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

// SOURCE UNIQUE de la décision « cet/ces entrepôt(s) est-il lisible ? » —
// miroir TS des conditions SQL de filtrePortee (différé P5 : la portée SQL
// des listes et les gardes TS des détails étaient synchronisées à la main).
// Plusieurs entrepôts = OU logique (cas des transferts : origine OU
// destination dans la portée).
export function estDansPortee(
  portee: PorteeLectureStock,
  ...warehouseIds: string[]
): boolean {
  return (
    portee.tous || warehouseIds.some((id) => portee.warehouseIds.includes(id))
  )
}

// Restriction SQL d'une requête de liste à la portée. `vide: true` = aucun
// entrepôt lisible : l'appelant court-circuite (liste vide, AUCUNE requête).
// `condition: null` avec `vide: false` = portée totale, aucune restriction.
// Plusieurs colonnes = OU logique (transfers.from/to).
export function filtrePortee(
  portee: PorteeLectureStock,
  ...colonnes: [AnySQLiteColumn, ...AnySQLiteColumn[]]
): { vide: boolean; condition: SQL | null } {
  if (portee.tous) {
    return { vide: false, condition: null }
  }
  if (portee.warehouseIds.length === 0) {
    return { vide: true, condition: null }
  }
  const conditions = colonnes.map((colonne) =>
    inArray(colonne, portee.warehouseIds)
  )
  return { vide: false, condition: or(...conditions) ?? null }
}
