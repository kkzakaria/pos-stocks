import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, asc, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import { adjustmentCreateSchema, minStockSchema } from "shared"
import * as schema from "../db/schema"
import { likeEchappe } from "../lib/recherche"
import { porteeLectureStock } from "../lib/stock-acces"
import { validerCorps } from "../lib/validation"
import { varianteScope } from "../lib/org-scope"
import { requireAuth } from "../middleware/require-auth"
import {
  requireMembership,
  requireRole,
  requireWarehouseRole,
} from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import {
  applyMovements,
  definirSeuil,
  ErreurStockInsuffisant,
  reconcilier,
} from "../services/stock"
import type { Env } from "../env"
import type { Context } from "hono"
import type { DrizzleD1Database } from "drizzle-orm/d1"

export const stockRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

stockRoute.use(requireAuth, requireMembership)

const MOTIF_JOUR = /^\d{4}-\d{2}-\d{2}$/

// Le format AAAA-MM-JJ ne suffit pas : "2024-02-30" passe MOTIF_JOUR mais
// n'existe pas — Date normalise silencieusement en débordant sur le mois
// suivant, ce qui décale les bornes du/au sans jamais échouer. Round-trip
// year/month/day pour rejeter les dates calendaires impossibles.
function dateCalendaireValide(chaine: string): boolean {
  if (!MOTIF_JOUR.test(chaine)) return false
  const [annee, mois, jour] = chaine.split("-").map(Number) as [
    number,
    number,
    number,
  ]
  const date = new Date(Date.UTC(annee, mois - 1, jour))
  return (
    date.getUTCFullYear() === annee &&
    date.getUTCMonth() === mois - 1 &&
    date.getUTCDate() === jour
  )
}

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
  if ((du && !dateCalendaireValide(du)) || (au && !dateCalendaireValide(au))) {
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

// Enrichit l'erreur du service avec le SKU et le nom de variante pour un
// message actionnable côté écran.
async function reponseStockInsuffisant(
  c: Context,
  db: DrizzleD1Database<typeof schema>,
  err: ErreurStockInsuffisant
) {
  const variantIds = err.details.map((d) => d.variantId)
  const variantes =
    variantIds.length > 0
      ? await db
          .select({
            id: schema.productVariants.id,
            sku: schema.productVariants.sku,
            name: schema.productVariants.name,
          })
          .from(schema.productVariants)
          .where(inArray(schema.productVariants.id, variantIds))
      : []
  return c.json(
    {
      code: "STOCK_INSUFFISANT",
      message: "Stock insuffisant pour valider l'opération",
      details: err.details.map((d) => {
        const variante = variantes.find((v) => v.id === d.variantId)
        return {
          ...d,
          sku: variante?.sku ?? null,
          variantName: variante?.name ?? null,
        }
      }),
    },
    409
  )
}

stockRoute.post(
  "/warehouses/:warehouseId/adjustments",
  requireWarehouseRole(["manager"]),
  async (c) => {
    const corps = await validerCorps(c, adjustmentCreateSchema)
    if (!corps.ok) return corps.reponse
    const { organizationId } = c.get("membership")
    const db = drizzle(c.env.DB, { schema })
    const variante = await varianteScope(
      db,
      organizationId,
      corps.data.variantId
    )
    if (!variante) {
      return c.json(
        { code: "INTROUVABLE", message: "Variante introuvable" },
        404
      )
    }
    if (corps.data.lotId) {
      const lot = await db
        .select({ id: schema.lots.id })
        .from(schema.lots)
        .where(
          and(
            eq(schema.lots.id, corps.data.lotId),
            eq(schema.lots.variantId, variante.id)
          )
        )
        .limit(1)
      if (lot.length === 0) {
        return c.json({ code: "INTROUVABLE", message: "Lot introuvable" }, 404)
      }
    }
    try {
      const { movementIds } = await applyMovements(db, {
        organizationId,
        userId: c.get("user").id,
        mouvements: [
          {
            warehouseId: c.req.param("warehouseId"),
            variantId: variante.id,
            lotId: corps.data.lotId ?? null,
            delta: corps.data.delta,
            type: "adjustment",
            reason: corps.data.reason,
          },
        ],
      })
      return c.json({ id: movementIds[0] }, 201)
    } catch (err) {
      if (err instanceof ErreurStockInsuffisant) {
        return reponseStockInsuffisant(c, db, err)
      }
      throw err
    }
  }
)

stockRoute.patch(
  "/warehouses/:warehouseId/levels/:variantId",
  requireWarehouseRole(["manager"]),
  async (c) => {
    const corps = await validerCorps(c, minStockSchema)
    if (!corps.ok) return corps.reponse
    const { organizationId } = c.get("membership")
    const db = drizzle(c.env.DB, { schema })
    const variante = await varianteScope(
      db,
      organizationId,
      c.req.param("variantId")
    )
    if (!variante) {
      return c.json(
        { code: "INTROUVABLE", message: "Variante introuvable" },
        404
      )
    }
    await definirSeuil(db, {
      organizationId,
      warehouseId: c.req.param("warehouseId"),
      variantId: variante.id,
      minStock: corps.data.minStock,
    })
    return c.json({ ok: true })
  }
)

// Commande d'exploitation : recalcul des quantités depuis le journal.
// Dry-run par défaut ; POST /reconcile?appliquer=true pour corriger.
stockRoute.post("/reconcile", requireRole("owner", "admin"), async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const resultat = await reconcilier(db, {
    organizationId: c.get("membership").organizationId,
    appliquer: c.req.query("appliquer") === "true",
  })
  return c.json(resultat)
})
