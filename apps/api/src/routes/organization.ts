import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
import { organizationSettingsSchema } from "shared"
import * as schema from "../db/schema"
import { requireAuth } from "../middleware/require-auth"
import {
  requireMembership,
  requireRole
  
} from "../middleware/permissions"
import type {PermissionVariables} from "../middleware/permissions";
import type { Env } from "../env"

export const organizationRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

organizationRoute.use(requireAuth, requireMembership)

type Meta = {
  currency?: string
  receiptHeader?: string
  receiptFooter?: string
}

function lireMeta(raw: string | null): Meta {
  try {
    return raw ? (JSON.parse(raw) as Meta) : {}
  } catch {
    return {}
  }
}

organizationRoute.get("/", async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const rows = await db
    .select({
      name: schema.organization.name,
      metadata: schema.organization.metadata,
    })
    .from(schema.organization)
    .where(eq(schema.organization.id, c.get("membership").organizationId))
    .limit(1)
  const meta = lireMeta(rows[0]?.metadata ?? null)
  return c.json({
    name: rows[0]?.name ?? "",
    currency: meta.currency ?? "XOF",
    receiptHeader: meta.receiptHeader ?? "",
    receiptFooter: meta.receiptFooter ?? "",
  })
})

organizationRoute.patch("/", requireRole("owner", "admin"), async (c) => {
  const parsed = organizationSettingsSchema.safeParse(
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
  const organizationId = c.get("membership").organizationId
  const db = drizzle(c.env.DB, { schema })
  const rows = await db
    .select({
      name: schema.organization.name,
      metadata: schema.organization.metadata,
    })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1)
  const meta = lireMeta(rows[0]?.metadata ?? null)
  const { name, ...metaPatch } = parsed.data
  await db
    .update(schema.organization)
    .set({
      ...(name ? { name } : {}),
      metadata: JSON.stringify({ currency: "XOF", ...meta, ...metaPatch }),
    })
    .where(eq(schema.organization.id, organizationId))
  return c.json({ ok: true })
})
