import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, asc, eq } from "drizzle-orm"
import { supplierCreateSchema, supplierUpdateSchema } from "shared"
import * as schema from "../db/schema"
import { validerCorps } from "../lib/validation"
import { estViolationUnicite } from "../lib/db-errors"
import { requireAuth } from "../middleware/require-auth"
import { requireMembership, requireRole } from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import type { Env } from "../env"

export const suppliersRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

suppliersRoute.use(requireAuth, requireMembership)

// Lecture : TOUS les membres
suppliersRoute.get("/", async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const suppliers = await db
    .select()
    .from(schema.suppliers)
    .where(
      eq(schema.suppliers.organizationId, c.get("membership").organizationId)
    )
    .orderBy(asc(schema.suppliers.name))
  return c.json({ suppliers })
})

suppliersRoute.post(
  "/",
  requireRole("owner", "admin", "stock_manager"),
  async (c) => {
    const corps = await validerCorps(c, supplierCreateSchema)
    if (!corps.ok) return corps.reponse
    const db = drizzle(c.env.DB, { schema })
    const id = crypto.randomUUID()
    try {
      await db.insert(schema.suppliers).values({
        id,
        organizationId: c.get("membership").organizationId,
        name: corps.data.name,
        contact: corps.data.contact ?? null,
        phone: corps.data.phone ?? null,
        createdAt: new Date(),
      })
    } catch (err) {
      if (estViolationUnicite(err, "suppliers.name")) {
        return c.json(
          { code: "NOM_EXISTANT", message: "Ce nom est déjà utilisé" },
          409
        )
      }
      throw err
    }
    return c.json({ id }, 201)
  }
)

suppliersRoute.patch(
  "/:id",
  requireRole("owner", "admin", "stock_manager"),
  async (c) => {
    const corps = await validerCorps(c, supplierUpdateSchema)
    if (!corps.ok) return corps.reponse
    const db = drizzle(c.env.DB, { schema })
    let result: Array<{ id: string }>
    try {
      result = await db
        .update(schema.suppliers)
        .set(corps.data)
        .where(
          and(
            eq(schema.suppliers.id, c.req.param("id")),
            eq(
              schema.suppliers.organizationId,
              c.get("membership").organizationId
            )
          )
        )
        .returning({ id: schema.suppliers.id })
    } catch (err) {
      if (estViolationUnicite(err, "suppliers.name")) {
        return c.json(
          { code: "NOM_EXISTANT", message: "Ce nom est déjà utilisé" },
          409
        )
      }
      throw err
    }
    if (result.length === 0) {
      return c.json(
        { code: "INTROUVABLE", message: "Fournisseur introuvable" },
        404
      )
    }
    return c.json({ ok: true })
  }
)
