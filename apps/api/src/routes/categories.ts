import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, asc, eq } from "drizzle-orm"
import { categoryCreateSchema, categoryUpdateSchema } from "shared"
import * as schema from "../db/schema"
import { validerCorps } from "../lib/validation"
import { requireAuth } from "../middleware/require-auth"
import { requireMembership, requireRole } from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import type { Env } from "../env"

export const categoriesRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

categoriesRoute.use(requireAuth, requireMembership)

async function categorieExiste(
  env: Env,
  organizationId: string,
  id: string
): Promise<boolean> {
  const db = drizzle(env.DB, { schema })
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

// Lecture : TOUS les membres (le staff consulte le catalogue)
categoriesRoute.get("/", async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const categories = await db
    .select()
    .from(schema.categories)
    .where(
      eq(schema.categories.organizationId, c.get("membership").organizationId)
    )
    .orderBy(asc(schema.categories.name))
  return c.json({ categories })
})

categoriesRoute.post(
  "/",
  requireRole("owner", "admin", "stock_manager"),
  async (c) => {
    const corps = await validerCorps(c, categoryCreateSchema)
    if (!corps.ok) return corps.reponse
    const { organizationId } = c.get("membership")
    if (
      corps.data.parentId &&
      !(await categorieExiste(c.env, organizationId, corps.data.parentId))
    ) {
      return c.json(
        { code: "INTROUVABLE", message: "Catégorie parente introuvable" },
        404
      )
    }
    const db = drizzle(c.env.DB, { schema })
    const id = crypto.randomUUID()
    await db.insert(schema.categories).values({
      id,
      organizationId,
      name: corps.data.name,
      parentId: corps.data.parentId ?? null,
      createdAt: new Date(),
    })
    return c.json({ id }, 201)
  }
)

categoriesRoute.patch(
  "/:id",
  requireRole("owner", "admin", "stock_manager"),
  async (c) => {
    const corps = await validerCorps(c, categoryUpdateSchema)
    if (!corps.ok) return corps.reponse
    const id = c.req.param("id")
    const { organizationId } = c.get("membership")
    if (corps.data.parentId === id) {
      return c.json(
        {
          code: "VALIDATION",
          message: "Une catégorie ne peut pas être son propre parent",
        },
        400
      )
    }
    if (
      typeof corps.data.parentId === "string" &&
      !(await categorieExiste(c.env, organizationId, corps.data.parentId))
    ) {
      return c.json(
        { code: "INTROUVABLE", message: "Catégorie parente introuvable" },
        404
      )
    }
    const db = drizzle(c.env.DB, { schema })
    const result = await db
      .update(schema.categories)
      .set({
        ...(corps.data.name !== undefined ? { name: corps.data.name } : {}),
        ...(corps.data.parentId !== undefined
          ? { parentId: corps.data.parentId }
          : {}),
      })
      .where(
        and(
          eq(schema.categories.id, id),
          eq(schema.categories.organizationId, organizationId)
        )
      )
      .returning({ id: schema.categories.id })
    if (result.length === 0) {
      return c.json(
        { code: "INTROUVABLE", message: "Catégorie introuvable" },
        404
      )
    }
    return c.json({ ok: true })
  }
)
