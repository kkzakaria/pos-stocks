import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, eq, ne } from "drizzle-orm"
import { variantUpdateSchema, lotCreateSchema } from "shared"
import * as schema from "../db/schema"
import { validerCorps } from "../lib/validation"
import { estViolationUnicite } from "../lib/db-errors"
import { requireAuth } from "../middleware/require-auth"
import { requireMembership, requireRole } from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import type { Env } from "../env"

export const variantsRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

variantsRoute.use(
  requireAuth,
  requireMembership,
  requireRole("owner", "admin", "stock_manager")
)

// Retour explicitement nullable : sans l'annotation, TS élide `| null`
// (indexation de tableau) et eslint no-unnecessary-condition se déclenche
// chez les appelants (même piège que membershipCible dans users.ts).
async function varianteScopee(
  env: Env,
  organizationId: string,
  id: string
): Promise<typeof schema.productVariants.$inferSelect | null> {
  const db = drizzle(env.DB, { schema })
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

variantsRoute.patch("/:id", async (c) => {
  const corps = await validerCorps(c, variantUpdateSchema)
  if (!corps.ok) return corps.reponse
  const { organizationId } = c.get("membership")
  const variante = await varianteScopee(
    c.env,
    organizationId,
    c.req.param("id")
  )
  if (!variante) {
    return c.json({ code: "INTROUVABLE", message: "Variante introuvable" }, 404)
  }
  const db = drizzle(c.env.DB, { schema })
  const produits = await db
    .select({
      price: schema.products.price,
      isActive: schema.products.isActive,
    })
    .from(schema.products)
    .where(eq(schema.products.id, variante.productId))
    .limit(1)
  if (produits.length === 0) {
    return c.json({ code: "INTROUVABLE", message: "Produit introuvable" }, 404)
  }
  const produit = produits[0]

  const prixEffectif =
    (corps.data.priceOverride !== undefined
      ? corps.data.priceOverride
      : variante.priceOverride) ?? produit.price
  const plancher =
    corps.data.minPriceOverride !== undefined
      ? corps.data.minPriceOverride
      : variante.minPriceOverride
  if (plancher !== null && plancher > prixEffectif) {
    return c.json(
      {
        code: "VALIDATION",
        message:
          "Le prix plancher doit être inférieur ou égal au prix de vente",
      },
      400
    )
  }

  if (corps.data.isActive === false && variante.isActive && produit.isActive) {
    const autresActives = await db
      .select({ id: schema.productVariants.id })
      .from(schema.productVariants)
      .where(
        and(
          eq(schema.productVariants.productId, variante.productId),
          eq(schema.productVariants.isActive, true),
          ne(schema.productVariants.id, variante.id)
        )
      )
    if (autresActives.length === 0) {
      return c.json(
        {
          code: "DERNIERE_VARIANTE",
          message:
            "Impossible de désactiver la dernière variante active d'un produit actif",
        },
        409
      )
    }
  }

  await db
    .update(schema.productVariants)
    .set(corps.data)
    .where(eq(schema.productVariants.id, variante.id))
  return c.json({ ok: true })
})

variantsRoute.post("/:id/lots", async (c) => {
  const corps = await validerCorps(c, lotCreateSchema)
  if (!corps.ok) return corps.reponse
  const { organizationId } = c.get("membership")
  const variante = await varianteScopee(
    c.env,
    organizationId,
    c.req.param("id")
  )
  if (!variante) {
    return c.json({ code: "INTROUVABLE", message: "Variante introuvable" }, 404)
  }
  const db = drizzle(c.env.DB, { schema })
  const produits = await db
    .select({ trackLots: schema.products.trackLots })
    .from(schema.products)
    .where(eq(schema.products.id, variante.productId))
    .limit(1)
  if (produits[0]?.trackLots !== true) {
    return c.json(
      {
        code: "LOTS_NON_SUIVIS",
        message: "Le suivi par lots n'est pas activé pour ce produit",
      },
      400
    )
  }
  const id = crypto.randomUUID()
  try {
    await db.insert(schema.lots).values({
      id,
      organizationId,
      variantId: variante.id,
      lotNumber: corps.data.lotNumber,
      expiryDate: corps.data.expiryDate
        ? new Date(corps.data.expiryDate)
        : null,
      createdAt: new Date(),
    })
  } catch (err) {
    if (estViolationUnicite(err)) {
      return c.json(
        {
          code: "LOT_EXISTANT",
          message: "Ce numéro de lot existe déjà pour cette variante",
        },
        409
      )
    }
    throw err
  }
  return c.json({ id }, 201)
})
