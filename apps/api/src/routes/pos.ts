import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, asc, eq, gt, ne, sql } from "drizzle-orm"
import * as schema from "../db/schema"
import { varianteScope } from "../lib/org-scope"
import {
  boutiqueScope,
  REPONSE_NON_BOUTIQUE,
  verifierAccesVente,
} from "../lib/pos-acces"
import { requireAuth } from "../middleware/require-auth"
import { requireMembership } from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import type { Env } from "../env"

export const posRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

posRoute.use(requireAuth, requireMembership)

// Catalogue vendable d'une boutique : le rôle local `cashier` n'a pas la
// lecture back-office (porteeLectureStock) — cette route est SA porte
// d'entrée, protégée par la permission « vendre » (spec §4).
posRoute.get("/catalogue", async (c) => {
  const storeId = c.req.query("storeId")
  if (!storeId) {
    return c.json(
      { code: "VALIDATION", message: "Le paramètre storeId est requis" },
      400
    )
  }
  const refus = await verifierAccesVente(c, storeId)
  if (refus) return refus
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const boutique = await boutiqueScope(db, organizationId, storeId)
  if (!boutique || boutique.type !== "store") {
    return c.json(REPONSE_NON_BOUTIQUE, 400)
  }
  const categories = await db
    .select({ id: schema.categories.id, name: schema.categories.name })
    .from(schema.categories)
    .where(eq(schema.categories.organizationId, organizationId))
    .orderBy(asc(schema.categories.name))
  const rows = await db
    .select({
      variantId: schema.productVariants.id,
      productId: schema.products.id,
      productName: schema.products.name,
      variantName: schema.productVariants.name,
      sku: schema.productVariants.sku,
      variantBarcode: schema.productVariants.barcode,
      productBarcode: schema.products.barcode,
      hasVariants: schema.products.hasVariants,
      categoryId: schema.products.categoryId,
      trackLots: schema.products.trackLots,
      imageKey: schema.products.imageKey,
      price: sql<number>`COALESCE(${schema.productVariants.priceOverride}, ${schema.products.price})`,
      minPrice: sql<
        number | null
      >`COALESCE(${schema.productVariants.minPriceOverride}, ${schema.products.minPrice})`,
      quantity: sql<number>`COALESCE(${schema.stockLevels.quantity}, 0)`,
    })
    .from(schema.productVariants)
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id)
    )
    .leftJoin(
      schema.stockLevels,
      and(
        eq(schema.stockLevels.variantId, schema.productVariants.id),
        eq(schema.stockLevels.warehouseId, storeId)
      )
    )
    .where(
      and(
        eq(schema.products.organizationId, organizationId),
        eq(schema.products.isActive, true),
        eq(schema.productVariants.isActive, true)
      )
    )
    .orderBy(asc(schema.products.name), asc(schema.productVariants.name))
  const articles = rows.map((r) => ({
    variantId: r.variantId,
    productId: r.productId,
    productName: r.productName,
    variantName: r.variantName,
    // Libellé de tuile : le produit seul pour la variante implicite, sinon
    // « Produit — Variante »
    nom:
      !r.hasVariants && r.variantName === "Standard"
        ? r.productName
        : `${r.productName} — ${r.variantName}`,
    sku: r.sku,
    // Un scan résout vers UN article (unicité P3/P4) : le code-barres
    // VARIANTE prime ; la variante implicite d'un produit sans variantes
    // hérite du code-barres PRODUIT. Un produit à variantes ne scanne que
    // par ses variantes.
    barcode: r.variantBarcode ?? (r.hasVariants ? null : r.productBarcode),
    categoryId: r.categoryId,
    trackLots: r.trackLots,
    imageKey: r.imageKey,
    price: r.price,
    minPrice: r.minPrice,
    quantity: r.quantity,
  }))
  return c.json({ categories, articles })
})

// Dépannage (spec §5) : où puiser quand la boutique est en rupture —
// disponibilités de la variante dans les AUTRES entrepôts actifs de
// l'organisation.
posRoute.get("/disponibilites", async (c) => {
  const storeId = c.req.query("storeId")
  const variantId = c.req.query("variantId")
  if (!storeId || !variantId) {
    return c.json(
      {
        code: "VALIDATION",
        message: "Les paramètres storeId et variantId sont requis",
      },
      400
    )
  }
  const refus = await verifierAccesVente(c, storeId)
  if (refus) return refus
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const variante = await varianteScope(db, organizationId, variantId)
  if (!variante) {
    return c.json({ code: "INTROUVABLE", message: "Article introuvable" }, 404)
  }
  const disponibilites = await db
    .select({
      warehouseId: schema.stockLevels.warehouseId,
      warehouseName: schema.warehouses.name,
      type: schema.warehouses.type,
      quantity: schema.stockLevels.quantity,
    })
    .from(schema.stockLevels)
    .innerJoin(
      schema.warehouses,
      eq(schema.stockLevels.warehouseId, schema.warehouses.id)
    )
    .where(
      and(
        eq(schema.stockLevels.organizationId, organizationId),
        eq(schema.stockLevels.variantId, variante.id),
        ne(schema.stockLevels.warehouseId, storeId),
        eq(schema.warehouses.isActive, true),
        gt(schema.stockLevels.quantity, 0)
      )
    )
    .orderBy(asc(schema.warehouses.name))
  return c.json({ disponibilites })
})
