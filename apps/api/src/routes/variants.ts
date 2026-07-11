import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, eq, sql } from "drizzle-orm"
import { variantUpdateSchema, lotCreateSchema } from "shared"
import * as schema from "../db/schema"
import { validerCorps } from "../lib/validation"
import { estViolationUnicite } from "../lib/db-errors"
import { barcodeDejaUtilise } from "../lib/barcode"
import { varianteScope } from "../lib/org-scope"
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

variantsRoute.patch("/:id", async (c) => {
  const corps = await validerCorps(c, variantUpdateSchema)
  if (!corps.ok) return corps.reponse
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const variante = await varianteScope(db, organizationId, c.req.param("id"))
  if (!variante) {
    return c.json({ code: "INTROUVABLE", message: "Variante introuvable" }, 404)
  }
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

  if (
    typeof corps.data.barcode === "string" &&
    corps.data.barcode !== variante.barcode &&
    (await barcodeDejaUtilise(db, organizationId, corps.data.barcode, {
      varianteId: variante.id,
    }))
  ) {
    return c.json(
      { code: "BARCODE_EXISTANT", message: "Ce code-barres est déjà utilisé" },
      409
    )
  }

  try {
    const desactivation =
      corps.data.isActive === false && variante.isActive && produit.isActive
    if (desactivation) {
      // Garde atomique anti-course : la condition « il reste au moins une autre
      // variante active » est vérifiée DANS le même UPDATE. Deux désactivations
      // concurrentes ne peuvent plus laisser un produit actif sans variante
      // (l'ancien pré-comptage séparé laissait une fenêtre).
      const result = await db
        .update(schema.productVariants)
        .set(corps.data)
        .where(
          and(
            eq(schema.productVariants.id, variante.id),
            sql`EXISTS (SELECT 1 FROM product_variants autre
              WHERE autre.product_id = ${variante.productId}
                AND autre.is_active = 1
                AND autre.id <> ${variante.id})`
          )
        )
        .returning({ id: schema.productVariants.id })
      if (result.length === 0) {
        return c.json(
          {
            code: "DERNIERE_VARIANTE",
            message:
              "Impossible de désactiver la dernière variante active d'un produit actif",
          },
          409
        )
      }
      return c.json({ ok: true })
    }

    await db
      .update(schema.productVariants)
      .set(corps.data)
      .where(eq(schema.productVariants.id, variante.id))
    return c.json({ ok: true })
  } catch (err) {
    if (estViolationUnicite(err, "barcode")) {
      return c.json(
        {
          code: "BARCODE_EXISTANT",
          message: "Ce code-barres est déjà utilisé",
        },
        409
      )
    }
    throw err
  }
})

variantsRoute.post("/:id/lots", async (c) => {
  const corps = await validerCorps(c, lotCreateSchema)
  if (!corps.ok) return corps.reponse
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const variante = await varianteScope(db, organizationId, c.req.param("id"))
  if (!variante) {
    return c.json({ code: "INTROUVABLE", message: "Variante introuvable" }, 404)
  }
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
