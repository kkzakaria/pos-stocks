import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, asc, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import * as schema from "../db/schema"
import { likeEchappe } from "../lib/recherche"
import { porteeLectureStock } from "../lib/stock-acces"
import { requireAuth } from "../middleware/require-auth"
import { requireMembership } from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import type { Env } from "../env"

export const stockRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

stockRoute.use(requireAuth, requireMembership)

const MOTIF_JOUR = /^\d{4}-\d{2}-\d{2}$/

// Seuil effectif d'une ligne de niveau : surcharge entrepôt sinon défaut produit
const seuilEffectif = sql<
  number | null
>`COALESCE(${schema.stockLevels.minStock}, ${schema.products.defaultMinStock})`

stockRoute.get("/levels", async (c) => {
  const { organizationId, role } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const warehouseId = c.req.query("warehouseId")
  if (!warehouseId) {
    return c.json(
      { code: "VALIDATION", message: "Le paramètre warehouseId est requis" },
      400
    )
  }
  const portee = await porteeLectureStock(
    db,
    organizationId,
    c.get("user").id,
    role
  )
  if (!portee.tous && !portee.warehouseIds.includes(warehouseId)) {
    return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
  }
  const entrepots = await db
    .select({ id: schema.warehouses.id })
    .from(schema.warehouses)
    .where(
      and(
        eq(schema.warehouses.id, warehouseId),
        eq(schema.warehouses.organizationId, organizationId)
      )
    )
    .limit(1)
  if (entrepots.length === 0) {
    return c.json({ code: "INTROUVABLE", message: "Entrepôt introuvable" }, 404)
  }

  const recherche = c.req.query("recherche")
  const alertes = c.req.query("alertes")
  const conditions: SQL[] = [
    eq(schema.stockLevels.organizationId, organizationId),
    eq(schema.stockLevels.warehouseId, warehouseId),
  ]
  if (recherche) {
    const filtre = or(
      likeEchappe(schema.products.name, recherche),
      likeEchappe(schema.productVariants.name, recherche),
      likeEchappe(schema.productVariants.sku, recherche),
      likeEchappe(schema.productVariants.barcode, recherche)
    )
    if (filtre) {
      conditions.push(filtre)
    }
  }
  if (alertes === "true") {
    conditions.push(
      sql`${seuilEffectif} IS NOT NULL AND ${schema.stockLevels.quantity} <= ${seuilEffectif}`
    )
  }

  const rows = await db
    .select({
      variantId: schema.stockLevels.variantId,
      productId: schema.products.id,
      productName: schema.products.name,
      variantName: schema.productVariants.name,
      sku: schema.productVariants.sku,
      quantity: schema.stockLevels.quantity,
      avgCost: schema.stockLevels.avgCost,
      minStock: schema.stockLevels.minStock,
      seuilEffectif,
    })
    .from(schema.stockLevels)
    .innerJoin(
      schema.productVariants,
      eq(schema.stockLevels.variantId, schema.productVariants.id)
    )
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id)
    )
    .where(and(...conditions))
    .orderBy(asc(schema.products.name), asc(schema.productVariants.name))
  const levels = rows.map((r) => ({
    ...r,
    enAlerte: r.seuilEffectif !== null && r.quantity <= r.seuilEffectif,
  }))
  return c.json({ levels })
})

stockRoute.get("/movements", async (c) => {
  const { organizationId, role } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const portee = await porteeLectureStock(
    db,
    organizationId,
    c.get("user").id,
    role
  )

  const warehouseId = c.req.query("warehouseId")
  const type = c.req.query("type")
  const variantId = c.req.query("variantId")
  const recherche = c.req.query("recherche")
  const du = c.req.query("du")
  const au = c.req.query("au")
  const page = Math.max(1, Number(c.req.query("page") ?? "1") || 1)
  const limite = Math.min(
    200,
    Math.max(1, Number(c.req.query("limite") ?? "50") || 50)
  )

  if (type && !(schema.MOVEMENT_TYPES as readonly string[]).includes(type)) {
    return c.json(
      { code: "VALIDATION", message: "Type de mouvement invalide" },
      400
    )
  }
  if ((du && !MOTIF_JOUR.test(du)) || (au && !MOTIF_JOUR.test(au))) {
    return c.json(
      { code: "VALIDATION", message: "Dates invalides (AAAA-MM-JJ)" },
      400
    )
  }

  const conditions: SQL[] = [
    eq(schema.stockMovements.organizationId, organizationId),
  ]
  if (warehouseId) {
    if (!portee.tous && !portee.warehouseIds.includes(warehouseId)) {
      return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
    }
    conditions.push(eq(schema.stockMovements.warehouseId, warehouseId))
  } else if (!portee.tous) {
    if (portee.warehouseIds.length === 0) {
      return c.json({ movements: [], total: 0, page, limite })
    }
    conditions.push(
      inArray(schema.stockMovements.warehouseId, portee.warehouseIds)
    )
  }
  if (type) {
    conditions.push(
      eq(
        schema.stockMovements.type,
        type as (typeof schema.MOVEMENT_TYPES)[number]
      )
    )
  }
  if (variantId) {
    conditions.push(eq(schema.stockMovements.variantId, variantId))
  }
  if (du) {
    conditions.push(
      gte(schema.stockMovements.createdAt, new Date(`${du}T00:00:00.000Z`))
    )
  }
  if (au) {
    // borne haute inclusive : < lendemain 00:00 UTC
    conditions.push(
      lt(
        schema.stockMovements.createdAt,
        new Date(new Date(`${au}T00:00:00.000Z`).getTime() + 86_400_000)
      )
    )
  }
  if (recherche) {
    const filtre = or(
      likeEchappe(schema.products.name, recherche),
      likeEchappe(schema.productVariants.sku, recherche)
    )
    if (filtre) {
      conditions.push(filtre)
    }
  }
  const critere = and(...conditions)

  const totaux = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(schema.stockMovements)
    .innerJoin(
      schema.productVariants,
      eq(schema.stockMovements.variantId, schema.productVariants.id)
    )
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id)
    )
    .where(critere)
  const total = totaux[0]?.total ?? 0

  const movements = await db
    .select({
      id: schema.stockMovements.id,
      createdAt: schema.stockMovements.createdAt,
      warehouseId: schema.stockMovements.warehouseId,
      warehouseName: schema.warehouses.name,
      variantId: schema.stockMovements.variantId,
      productName: schema.products.name,
      variantName: schema.productVariants.name,
      sku: schema.productVariants.sku,
      delta: schema.stockMovements.delta,
      type: schema.stockMovements.type,
      reason: schema.stockMovements.reason,
      refType: schema.stockMovements.refType,
      refId: schema.stockMovements.refId,
      userName: schema.user.name,
      lotNumber: schema.lots.lotNumber,
    })
    .from(schema.stockMovements)
    .innerJoin(
      schema.productVariants,
      eq(schema.stockMovements.variantId, schema.productVariants.id)
    )
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id)
    )
    .innerJoin(
      schema.warehouses,
      eq(schema.stockMovements.warehouseId, schema.warehouses.id)
    )
    .innerJoin(schema.user, eq(schema.stockMovements.userId, schema.user.id))
    .leftJoin(schema.lots, eq(schema.stockMovements.lotId, schema.lots.id))
    .where(critere)
    // createdAt est stocké en secondes (mode "timestamp" par défaut) : deux
    // mouvements du même batch (ex. seed de test) peuvent partager la même
    // seconde. Tiebreak par rowid (ordre d'insertion SQLite, monotone sur
    // cette table append-only) pour garantir le tri anté-chronologique.
    .orderBy(
      desc(schema.stockMovements.createdAt),
      desc(sql`"stock_movements"."rowid"`)
    )
    .limit(limite)
    .offset((page - 1) * limite)

  return c.json({ movements, total, page, limite })
})

stockRoute.get("/alerts", async (c) => {
  const { organizationId, role } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const portee = await porteeLectureStock(
    db,
    organizationId,
    c.get("user").id,
    role
  )
  const conditions: SQL[] = [
    eq(schema.stockLevels.organizationId, organizationId),
    sql`${seuilEffectif} IS NOT NULL AND ${schema.stockLevels.quantity} <= ${seuilEffectif}`,
    eq(schema.products.isActive, true),
    eq(schema.productVariants.isActive, true),
    eq(schema.warehouses.isActive, true),
  ]
  if (!portee.tous) {
    if (portee.warehouseIds.length === 0) {
      return c.json({ alerts: [], total: 0 })
    }
    conditions.push(
      inArray(schema.stockLevels.warehouseId, portee.warehouseIds)
    )
  }
  const alerts = await db
    .select({
      warehouseId: schema.stockLevels.warehouseId,
      warehouseName: schema.warehouses.name,
      variantId: schema.stockLevels.variantId,
      productId: schema.products.id,
      productName: schema.products.name,
      variantName: schema.productVariants.name,
      sku: schema.productVariants.sku,
      quantity: schema.stockLevels.quantity,
      seuilEffectif,
    })
    .from(schema.stockLevels)
    .innerJoin(
      schema.productVariants,
      eq(schema.stockLevels.variantId, schema.productVariants.id)
    )
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id)
    )
    .innerJoin(
      schema.warehouses,
      eq(schema.stockLevels.warehouseId, schema.warehouses.id)
    )
    .where(and(...conditions))
    .orderBy(asc(schema.warehouses.name), asc(schema.products.name))
  return c.json({ alerts, total: alerts.length })
})
