import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, asc, eq } from "drizzle-orm"
import { warehouseCreateSchema, warehouseUpdateSchema } from "shared"
import * as schema from "../db/schema"
import { requireAuth } from "../middleware/require-auth"
import { requireMembership, requireRole } from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import { validerCorps } from "../lib/validation"
import type { Env } from "../env"

export const warehousesRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

warehousesRoute.use(requireAuth, requireMembership)

warehousesRoute.get(
  "/",
  requireRole("owner", "admin", "auditor", "stock_manager"),
  async (c) => {
    const db = drizzle(c.env.DB, { schema })
    const warehouses = await db
      .select()
      .from(schema.warehouses)
      .where(
        eq(schema.warehouses.organizationId, c.get("membership").organizationId)
      )
      .orderBy(asc(schema.warehouses.name))
    return c.json({ warehouses })
  }
)

warehousesRoute.post("/", requireRole("owner", "admin"), async (c) => {
  const corps = await validerCorps(c, warehouseCreateSchema)
  if (!corps.ok) return corps.reponse
  const db = drizzle(c.env.DB, { schema })
  const id = crypto.randomUUID()
  const now = new Date()
  await db.insert(schema.warehouses).values({
    id,
    organizationId: c.get("membership").organizationId,
    name: corps.data.name,
    type: corps.data.type,
    address: corps.data.address ?? null,
    createdAt: now,
    updatedAt: now,
  })
  return c.json({ id }, 201)
})

warehousesRoute.patch("/:id", requireRole("owner", "admin"), async (c) => {
  const corps = await validerCorps(c, warehouseUpdateSchema)
  if (!corps.ok) return corps.reponse
  const db = drizzle(c.env.DB, { schema })
  const result = await db
    .update(schema.warehouses)
    .set({ ...corps.data, updatedAt: new Date() })
    .where(
      and(
        eq(schema.warehouses.id, c.req.param("id")),
        eq(schema.warehouses.organizationId, c.get("membership").organizationId)
      )
    )
    .returning({ id: schema.warehouses.id })
  if (result.length === 0) {
    return c.json({ code: "INTROUVABLE", message: "Entrepôt introuvable" }, 404)
  }
  return c.json({ ok: true })
})
