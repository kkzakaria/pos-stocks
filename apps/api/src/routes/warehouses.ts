import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, asc, eq } from "drizzle-orm"
import { warehouseCreateSchema, warehouseUpdateSchema } from "shared"
import * as schema from "../db/schema"
import { requireAuth } from "../middleware/require-auth"
import { requireMembership, requireRole } from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import { validerCorps } from "../lib/validation"
import { estViolationUnicite } from "../lib/db-errors"
import type { Env } from "../env"

export const warehousesRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

warehousesRoute.use(requireAuth, requireMembership)

// Liste légère pour les sélecteurs (ex. destination d'un transfert) :
// accessible à tout membre de l'organisation, y compris un staff sans
// affectation — contrairement à GET /warehouses (réservé aux rôles
// d'administration), le nom des entrepôts n'est pas une donnée sensible
// pour un membre qui les voit déjà apparaître dans ses transferts.
// Déclarée avant "/:id" pour éviter tout conflit de routage Hono.
warehousesRoute.get("/destinations", async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const warehouses = await db
    .select({
      id: schema.warehouses.id,
      name: schema.warehouses.name,
      type: schema.warehouses.type,
    })
    .from(schema.warehouses)
    .where(
      and(
        eq(
          schema.warehouses.organizationId,
          c.get("membership").organizationId
        ),
        eq(schema.warehouses.isActive, true)
      )
    )
    .orderBy(asc(schema.warehouses.name))
  return c.json({ warehouses })
})

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
  try {
    await db.insert(schema.warehouses).values({
      id,
      organizationId: c.get("membership").organizationId,
      name: corps.data.name,
      type: corps.data.type,
      address: corps.data.address ?? null,
      createdAt: now,
      updatedAt: now,
    })
  } catch (err) {
    if (estViolationUnicite(err, "warehouses.name")) {
      return c.json(
        { code: "NOM_EXISTANT", message: "Ce nom est déjà utilisé" },
        409
      )
    }
    throw err
  }
  return c.json({ id }, 201)
})

warehousesRoute.patch("/:id", requireRole("owner", "admin"), async (c) => {
  const corps = await validerCorps(c, warehouseUpdateSchema)
  if (!corps.ok) return corps.reponse
  const db = drizzle(c.env.DB, { schema })
  let result: Array<{ id: string }>
  try {
    result = await db
      .update(schema.warehouses)
      .set({ ...corps.data, updatedAt: new Date() })
      .where(
        and(
          eq(schema.warehouses.id, c.req.param("id")),
          eq(
            schema.warehouses.organizationId,
            c.get("membership").organizationId
          )
        )
      )
      .returning({ id: schema.warehouses.id })
  } catch (err) {
    if (estViolationUnicite(err, "warehouses.name")) {
      return c.json(
        { code: "NOM_EXISTANT", message: "Ce nom est déjà utilisé" },
        409
      )
    }
    throw err
  }
  if (result.length === 0) {
    return c.json({ code: "INTROUVABLE", message: "Entrepôt introuvable" }, 404)
  }
  return c.json({ ok: true })
})
