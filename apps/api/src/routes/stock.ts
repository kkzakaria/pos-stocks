import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, asc, desc, eq, gte, lt, or, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"
import type { SQL } from "drizzle-orm"
import { adjustmentCreateSchema, minStockSchema } from "shared"
import * as schema from "../db/schema"
import { dateCalendaireValide } from "../lib/dates"
import { lirePagination } from "../lib/pagination"
import { likeEchappe } from "../lib/recherche"
import {
  estDansPortee,
  filtrePortee,
  porteeLectureStock,
} from "../lib/stock-acces"
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
import { reponseStockInsuffisant } from "../lib/stock-erreurs"
import type { Env } from "../env"
import type { DrizzleD1Database } from "drizzle-orm/d1"

export const stockRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

stockRoute.use(requireAuth, requireMembership)

// Seuil effectif d'une ligne de niveau : surcharge entrepôt sinon défaut produit
const seuilEffectif = sql<
  number | null
>`COALESCE(${schema.stockLevels.minStock}, ${schema.products.defaultMinStock})`

// Garde partagée /levels, /movements, /alerts, /transit (Phase 5) : un
// warehouseId explicitement demandé doit exister dans l'organisation —
// contrat 404 cross-org identique aux autres ressources. S'applique APRÈS
// le contrôle de portée (403 prioritaire pour un staff hors portée).
async function entrepotDansOrganisation(
  db: DrizzleD1Database<typeof schema>,
  organizationId: string,
  warehouseId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.warehouses.id })
    .from(schema.warehouses)
    .where(
      and(
        eq(schema.warehouses.id, warehouseId),
        eq(schema.warehouses.organizationId, organizationId)
      )
    )
    .limit(1)
  return rows.length > 0
}

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
  if (!estDansPortee(portee, warehouseId)) {
    return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
  }
  if (!(await entrepotDansOrganisation(db, organizationId, warehouseId))) {
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

  const pagination = lirePagination(c)
  if (pagination instanceof Response) return pagination
  const { page, limite } = pagination

  const totalRows = await db
    .select({ total: sql<number>`COUNT(*)` })
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
  const total = totalRows[0]?.total ?? 0

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
    .limit(limite)
    .offset((page - 1) * limite)
  const levels = rows.map((r) => ({
    ...r,
    enAlerte: r.seuilEffectif !== null && r.quantity <= r.seuilEffectif,
  }))
  return c.json({ levels, total, page, limite })
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
  // Cross-tenant / access guard BEFORE any parameter validation (invariant #7):
  // an out-of-org warehouse must answer 404 INTROUVABLE / an out-of-scope one
  // 403 ACCES_REFUSE, even when pagination or another param is invalid.
  if (warehouseId) {
    if (!estDansPortee(portee, warehouseId)) {
      return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
    }
    if (!(await entrepotDansOrganisation(db, organizationId, warehouseId))) {
      return c.json(
        { code: "INTROUVABLE", message: "Entrepôt introuvable" },
        404
      )
    }
  }
  const pagination = lirePagination(c)
  if (pagination instanceof Response) return pagination
  const { page, limite } = pagination

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
    // Access already guarded above (invariant #7); here we only add the filter.
    conditions.push(eq(schema.stockMovements.warehouseId, warehouseId))
  } else {
    const filtre = filtrePortee(portee, schema.stockMovements.warehouseId)
    if (filtre.vide) {
      return c.json({ movements: [], total: 0, page, limite })
    }
    if (filtre.condition) {
      conditions.push(filtre.condition)
    }
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
  const warehouseId = c.req.query("warehouseId")
  if (warehouseId) {
    if (!estDansPortee(portee, warehouseId)) {
      return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
    }
    if (!(await entrepotDansOrganisation(db, organizationId, warehouseId))) {
      return c.json(
        { code: "INTROUVABLE", message: "Entrepôt introuvable" },
        404
      )
    }
    conditions.push(eq(schema.stockLevels.warehouseId, warehouseId))
  } else {
    const filtre = filtrePortee(portee, schema.stockLevels.warehouseId)
    if (filtre.vide) {
      return c.json({ alerts: [], total: 0 })
    }
    if (filtre.condition) {
      conditions.push(filtre.condition)
    }
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

// Stock en transit ENTRANT : dérivé des transferts `sent` non réceptionnés —
// aucune matérialisation (spec Phase 5). Même contrat de lecture que /levels.
stockRoute.get("/transit", async (c) => {
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
  if (!estDansPortee(portee, warehouseId)) {
    return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
  }
  if (!(await entrepotDansOrganisation(db, organizationId, warehouseId))) {
    return c.json({ code: "INTROUVABLE", message: "Entrepôt introuvable" }, 404)
  }
  const origine = alias(schema.warehouses, "origine")
  const transit = await db
    .select({
      transferId: schema.transfers.id,
      reference: schema.transfers.reference,
      fromWarehouseId: schema.transfers.fromWarehouseId,
      fromWarehouseName: origine.name,
      sentAt: schema.transfers.sentAt,
      variantId: schema.transferItems.variantId,
      productName: schema.products.name,
      variantName: schema.productVariants.name,
      sku: schema.productVariants.sku,
      lotNumber: schema.lots.lotNumber,
      quantity: schema.transferItems.quantity,
    })
    .from(schema.transferItems)
    .innerJoin(
      schema.transfers,
      eq(schema.transferItems.transferId, schema.transfers.id)
    )
    .innerJoin(origine, eq(schema.transfers.fromWarehouseId, origine.id))
    .innerJoin(
      schema.productVariants,
      eq(schema.transferItems.variantId, schema.productVariants.id)
    )
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id)
    )
    .leftJoin(schema.lots, eq(schema.transferItems.lotId, schema.lots.id))
    .where(
      and(
        eq(schema.transfers.organizationId, organizationId),
        eq(schema.transfers.status, "sent"),
        eq(schema.transfers.toWarehouseId, warehouseId)
      )
    )
    .orderBy(desc(schema.transfers.sentAt), asc(schema.products.name))
  return c.json({ transit })
})

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
