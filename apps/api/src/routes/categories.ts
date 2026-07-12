import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, asc, eq } from "drizzle-orm"
import { categoryCreateSchema, categoryUpdateSchema } from "shared"
import * as schema from "../db/schema"
import { validerCorps } from "../lib/validation"
import { estViolationUnicite } from "../lib/db-errors"
import { categorieExiste } from "../lib/org-scope"
import { requireAuth } from "../middleware/require-auth"
import { requireMembership, requireRole } from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import type { Env } from "../env"

export const categoriesRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

categoriesRoute.use(requireAuth, requireMembership)

const PROFONDEUR_MAX_ANCETRES = 20

// Détecte un cycle indirect (ex. A → B → A) en remontant la chaîne de
// parents du parent proposé. Le cas trivial « parentId === id » est déjà
// filtré avant l'appel ; ici on couvre les cycles à 2 niveaux et plus,
// bornés en profondeur pour éviter une boucle infinie sur des données
// corrompues.
async function parentCreeraitUnCycle(
  env: Env,
  organizationId: string,
  id: string,
  parentId: string
): Promise<boolean> {
  const db = drizzle(env.DB, { schema })
  let curseur: string | null = parentId
  for (
    let profondeur = 0;
    profondeur < PROFONDEUR_MAX_ANCETRES && curseur !== null;
    profondeur++
  ) {
    if (curseur === id) return true
    const rows = await db
      .select({ parentId: schema.categories.parentId })
      .from(schema.categories)
      .where(
        and(
          eq(schema.categories.id, curseur),
          eq(schema.categories.organizationId, organizationId)
        )
      )
      .limit(1)
    curseur = rows[0]?.parentId ?? null
  }
  return false
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
    const db = drizzle(c.env.DB, { schema })
    if (
      corps.data.parentId &&
      !(await categorieExiste(db, organizationId, corps.data.parentId))
    ) {
      return c.json(
        { code: "INTROUVABLE", message: "Catégorie parente introuvable" },
        404
      )
    }
    const id = crypto.randomUUID()
    try {
      await db.insert(schema.categories).values({
        id,
        organizationId,
        name: corps.data.name,
        parentId: corps.data.parentId ?? null,
        createdAt: new Date(),
      })
    } catch (err) {
      if (estViolationUnicite(err, "categories.name")) {
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

categoriesRoute.patch(
  "/:id",
  requireRole("owner", "admin", "stock_manager"),
  async (c) => {
    const corps = await validerCorps(c, categoryUpdateSchema)
    if (!corps.ok) return corps.reponse
    const id = c.req.param("id")
    const { organizationId } = c.get("membership")
    const db = drizzle(c.env.DB, { schema })
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
      !(await categorieExiste(db, organizationId, corps.data.parentId))
    ) {
      return c.json(
        { code: "INTROUVABLE", message: "Catégorie parente introuvable" },
        404
      )
    }
    if (
      typeof corps.data.parentId === "string" &&
      (await parentCreeraitUnCycle(
        c.env,
        organizationId,
        id,
        corps.data.parentId
      ))
    ) {
      return c.json(
        {
          code: "CYCLE_CATEGORIE",
          message: "Ce parent créerait un cycle dans la hiérarchie",
        },
        400
      )
    }
    let result: Array<{ id: string }>
    try {
      result = await db
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
    } catch (err) {
      if (estViolationUnicite(err, "categories.name")) {
        return c.json(
          { code: "NOM_EXISTANT", message: "Ce nom est déjà utilisé" },
          409
        )
      }
      throw err
    }
    if (result.length === 0) {
      return c.json(
        { code: "INTROUVABLE", message: "Catégorie introuvable" },
        404
      )
    }
    return c.json({ ok: true })
  }
)
