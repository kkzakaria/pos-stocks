import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
import * as schema from "../db/schema"
import type { AuthVariables } from "../middleware/require-auth"
import { requireAuth } from "../middleware/require-auth"
import type { Env } from "../env"

export const meRoute = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

meRoute.get("/", requireAuth, async (c) => {
  const user = c.get("user")
  const db = drizzle(c.env.DB, { schema })
  const rows = await db
    .select({
      organizationId: schema.member.organizationId,
      organizationName: schema.organization.name,
      role: schema.member.role,
    })
    .from(schema.member)
    .innerJoin(
      schema.organization,
      eq(schema.member.organizationId, schema.organization.id)
    )
    .where(eq(schema.member.userId, user.id))
    .limit(1)

  const assignments = await db
    .select({
      warehouseId: schema.warehouseMembers.warehouseId,
      warehouseName: schema.warehouses.name,
      role: schema.warehouseMembers.role,
    })
    .from(schema.warehouseMembers)
    .innerJoin(
      schema.warehouses,
      eq(schema.warehouseMembers.warehouseId, schema.warehouses.id)
    )
    .where(eq(schema.warehouseMembers.userId, user.id))

  return c.json({ user, membership: rows[0] ?? null, assignments })
})
