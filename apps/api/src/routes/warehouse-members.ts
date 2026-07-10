import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, eq } from "drizzle-orm"
import { assignmentCreateSchema } from "shared"
import * as schema from "../db/schema"
import { requireAuth } from "../middleware/require-auth"
import { requireMembership, requireRole } from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import { estViolationUnicite } from "../lib/db-errors"
import type { Env } from "../env"

export const warehouseMembersRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

warehouseMembersRoute.use(
  requireAuth,
  requireMembership,
  requireRole("owner", "admin")
)

warehouseMembersRoute.post("/", async (c) => {
  const parsed = assignmentCreateSchema.safeParse(
    await c.req.json().catch(() => null)
  )
  if (!parsed.success) {
    return c.json(
      {
        code: "VALIDATION",
        message: "Données invalides",
        details: parsed.error.flatten(),
      },
      400
    )
  }
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })

  const [membre, entrepot] = await Promise.all([
    db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.userId, parsed.data.userId),
          eq(schema.member.organizationId, organizationId)
        )
      )
      .limit(1),
    db
      .select({ id: schema.warehouses.id })
      .from(schema.warehouses)
      .where(
        and(
          eq(schema.warehouses.id, parsed.data.warehouseId),
          eq(schema.warehouses.organizationId, organizationId)
        )
      )
      .limit(1),
  ])
  if (membre.length === 0 || entrepot.length === 0) {
    return c.json(
      { code: "INTROUVABLE", message: "Utilisateur ou entrepôt introuvable" },
      404
    )
  }

  const id = crypto.randomUUID()
  try {
    await db.insert(schema.warehouseMembers).values({
      id,
      organizationId,
      warehouseId: parsed.data.warehouseId,
      userId: parsed.data.userId,
      role: parsed.data.role,
      createdAt: new Date(),
    })
  } catch (err) {
    if (estViolationUnicite(err)) {
      return c.json(
        {
          code: "DEJA_AFFECTE",
          message: "Cet utilisateur est déjà affecté à cet entrepôt",
        },
        409
      )
    }
    throw err
  }
  return c.json({ id }, 201)
})

warehouseMembersRoute.delete("/:id", async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const result = await db
    .delete(schema.warehouseMembers)
    .where(
      and(
        eq(schema.warehouseMembers.id, c.req.param("id")),
        eq(
          schema.warehouseMembers.organizationId,
          c.get("membership").organizationId
        )
      )
    )
    .returning({ id: schema.warehouseMembers.id })
  if (result.length === 0) {
    return c.json(
      { code: "INTROUVABLE", message: "Affectation introuvable" },
      404
    )
  }
  return c.json({ ok: true })
})
