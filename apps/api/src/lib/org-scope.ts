import { and, eq } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import * as schema from "../db/schema"

// Helpers de lecture scoppés organisation : tout lookup d'une ressource
// catalogue passe par ici pour garantir le 404 cross-tenant systématique.
// Retours explicitement annotés `| null` : sans l'annotation, TS élide le
// null (indexation de tableau) et eslint no-unnecessary-condition se
// déclenche chez les appelants (même piège que membershipCible dans users.ts).

type Db = DrizzleD1Database<typeof schema>

export async function produitScope(
  db: Db,
  organizationId: string,
  id: string
): Promise<typeof schema.products.$inferSelect | null> {
  const rows = await db
    .select()
    .from(schema.products)
    .where(
      and(
        eq(schema.products.id, id),
        eq(schema.products.organizationId, organizationId)
      )
    )
    .limit(1)
  return rows[0] ?? null
}

export async function varianteScope(
  db: Db,
  organizationId: string,
  id: string
): Promise<typeof schema.productVariants.$inferSelect | null> {
  const rows = await db
    .select()
    .from(schema.productVariants)
    .where(
      and(
        eq(schema.productVariants.id, id),
        eq(schema.productVariants.organizationId, organizationId)
      )
    )
    .limit(1)
  return rows[0] ?? null
}

export async function categorieExiste(
  db: Db,
  organizationId: string,
  id: string
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.categories.id })
    .from(schema.categories)
    .where(
      and(
        eq(schema.categories.id, id),
        eq(schema.categories.organizationId, organizationId)
      )
    )
    .limit(1)
  return rows.length > 0
}

export async function fournisseurExiste(
  db: Db,
  organizationId: string,
  id: string
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.suppliers.id })
    .from(schema.suppliers)
    .where(
      and(
        eq(schema.suppliers.id, id),
        eq(schema.suppliers.organizationId, organizationId)
      )
    )
    .limit(1)
  return rows.length > 0
}
