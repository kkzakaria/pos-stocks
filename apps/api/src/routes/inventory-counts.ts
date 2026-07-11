import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import {
  inventoryCountCreateSchema,
  inventoryCountItemUpdateSchema,
} from "shared"
import * as schema from "../db/schema"
import { validerCorps } from "../lib/validation"
import { estErreurDeclencheur, estViolationUnicite } from "../lib/db-errors"
import { porteeLectureStock } from "../lib/stock-acces"
import { requireAuth } from "../middleware/require-auth"
import {
  requireMembership,
  verifierAccesEntrepot,
} from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import type { Env } from "../env"

export const inventoryCountsRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

inventoryCountsRoute.use(requireAuth, requireMembership)

type Db = DrizzleD1Database<typeof schema>

// Retour annoté `| null` (piège eslint no-unnecessary-condition)
async function inventaireScope(
  db: Db,
  organizationId: string,
  id: string
): Promise<typeof schema.inventoryCounts.$inferSelect | null> {
  const rows = await db
    .select()
    .from(schema.inventoryCounts)
    .where(
      and(
        eq(schema.inventoryCounts.id, id),
        eq(schema.inventoryCounts.organizationId, organizationId)
      )
    )
    .limit(1)
  return rows[0] ?? null
}

const REPONSE_INVENTAIRE_CLOS = {
  code: "INVENTAIRE_CLOS",
  message: "Cet inventaire est clos et ne peut plus être modifié",
} as const

inventoryCountsRoute.get("/", async (c) => {
  const { organizationId, role } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const portee = await porteeLectureStock(
    db,
    organizationId,
    c.get("user").id,
    role
  )
  const statut = c.req.query("statut")
  const warehouseId = c.req.query("warehouseId")
  if (
    statut &&
    !(schema.INVENTORY_COUNT_STATUSES as readonly string[]).includes(statut)
  ) {
    return c.json({ code: "VALIDATION", message: "Statut invalide" }, 400)
  }
  const conditions: SQL[] = [
    eq(schema.inventoryCounts.organizationId, organizationId),
  ]
  if (statut) {
    conditions.push(
      eq(
        schema.inventoryCounts.status,
        statut as (typeof schema.INVENTORY_COUNT_STATUSES)[number]
      )
    )
  }
  if (warehouseId) {
    if (!portee.tous && !portee.warehouseIds.includes(warehouseId)) {
      return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
    }
    conditions.push(eq(schema.inventoryCounts.warehouseId, warehouseId))
  } else if (!portee.tous) {
    if (portee.warehouseIds.length === 0) {
      return c.json({ counts: [] })
    }
    conditions.push(
      inArray(schema.inventoryCounts.warehouseId, portee.warehouseIds)
    )
  }
  const rows = await db
    .select({
      id: schema.inventoryCounts.id,
      warehouseId: schema.inventoryCounts.warehouseId,
      warehouseName: schema.warehouses.name,
      status: schema.inventoryCounts.status,
      openedAt: schema.inventoryCounts.openedAt,
      closedAt: schema.inventoryCounts.closedAt,
    })
    .from(schema.inventoryCounts)
    .innerJoin(
      schema.warehouses,
      eq(schema.inventoryCounts.warehouseId, schema.warehouses.id)
    )
    .where(and(...conditions))
    .orderBy(desc(schema.inventoryCounts.openedAt))
  const ids = rows.map((r) => r.id)
  const agregats =
    ids.length > 0
      ? await db
          .select({
            countId: schema.inventoryCountItems.countId,
            itemCount: sql<number>`COUNT(*)`,
            countedCount: sql<number>`SUM(CASE WHEN ${schema.inventoryCountItems.countedQuantity} IS NOT NULL THEN 1 ELSE 0 END)`,
          })
          .from(schema.inventoryCountItems)
          .where(inArray(schema.inventoryCountItems.countId, ids))
          .groupBy(schema.inventoryCountItems.countId)
      : []
  const counts = rows.map((r) => {
    const agregat = agregats.find((a) => a.countId === r.id)
    return {
      ...r,
      itemCount: agregat?.itemCount ?? 0,
      countedCount: agregat?.countedCount ?? 0,
    }
  })
  return c.json({ counts })
})

inventoryCountsRoute.post("/", async (c) => {
  const corps = await validerCorps(c, inventoryCountCreateSchema)
  if (!corps.ok) return corps.reponse
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  // Écriture : owner/admin/stock_manager (bypass) ou manager de l'entrepôt.
  const refus = await verifierAccesEntrepot(c, corps.data.warehouseId, [
    "manager",
  ])
  if (refus) return refus
  const ouverts = await db
    .select({ id: schema.inventoryCounts.id })
    .from(schema.inventoryCounts)
    .where(
      and(
        eq(schema.inventoryCounts.warehouseId, corps.data.warehouseId),
        eq(schema.inventoryCounts.status, "open")
      )
    )
    .limit(1)
  if (ouverts.length > 0) {
    return c.json(
      {
        code: "INVENTAIRE_OUVERT",
        message: "Un inventaire est déjà ouvert pour cet entrepôt",
      },
      409
    )
  }
  // Inventaire COMPLET (v1, spec) : une ligne par niveau existant de
  // l'entrepôt — les variantes jamais stockées ici n'ont pas de ligne de
  // niveau, donc rien à compter.
  const niveaux = await db
    .select({
      variantId: schema.stockLevels.variantId,
      quantity: schema.stockLevels.quantity,
    })
    .from(schema.stockLevels)
    .where(
      and(
        eq(schema.stockLevels.organizationId, organizationId),
        eq(schema.stockLevels.warehouseId, corps.data.warehouseId)
      )
    )
  if (niveaux.length === 0) {
    return c.json(
      {
        code: "VALIDATION",
        message: "Aucun article en stock à inventorier pour cet entrepôt",
      },
      400
    )
  }
  const id = crypto.randomUUID()
  const maintenant = new Date()
  const insertionDoc = db.insert(schema.inventoryCounts).values({
    id,
    organizationId,
    warehouseId: corps.data.warehouseId,
    openedBy: c.get("user").id,
    openedAt: maintenant,
    createdAt: maintenant,
    updatedAt: maintenant,
  })
  const insertionsLignes = niveaux.map((n) =>
    db.insert(schema.inventoryCountItems).values({
      id: crypto.randomUUID(),
      organizationId,
      countId: id,
      variantId: n.variantId,
      expectedQuantity: n.quantity,
      createdAt: maintenant,
    })
  )
  try {
    // Document + photographie des quantités dans UN batch atomique.
    await db.batch([insertionDoc, ...insertionsLignes])
  } catch (err) {
    // Course : deux ouvertures simultanées — l'index unique partiel
    // inventory_counts_open_wh_uidx (0007) tue la seconde. SQLite rapporte
    // les COLONNES de l'index, jamais son nom.
    if (estViolationUnicite(err, "inventory_counts.warehouse_id")) {
      return c.json(
        {
          code: "INVENTAIRE_OUVERT",
          message: "Un inventaire est déjà ouvert pour cet entrepôt",
        },
        409
      )
    }
    throw err
  }
  return c.json({ id }, 201)
})

inventoryCountsRoute.get("/:id", async (c) => {
  const { organizationId, role } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const inventaire = await inventaireScope(
    db,
    organizationId,
    c.req.param("id")
  )
  if (!inventaire) {
    return c.json(
      { code: "INTROUVABLE", message: "Inventaire introuvable" },
      404
    )
  }
  const portee = await porteeLectureStock(
    db,
    organizationId,
    c.get("user").id,
    role
  )
  if (!portee.tous && !portee.warehouseIds.includes(inventaire.warehouseId)) {
    return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
  }
  const entetes = await db
    .select({ warehouseName: schema.warehouses.name })
    .from(schema.warehouses)
    .where(eq(schema.warehouses.id, inventaire.warehouseId))
    .limit(1)
  const items = await db
    .select({
      id: schema.inventoryCountItems.id,
      variantId: schema.inventoryCountItems.variantId,
      productName: schema.products.name,
      variantName: schema.productVariants.name,
      sku: schema.productVariants.sku,
      expectedQuantity: schema.inventoryCountItems.expectedQuantity,
      countedQuantity: schema.inventoryCountItems.countedQuantity,
    })
    .from(schema.inventoryCountItems)
    .innerJoin(
      schema.productVariants,
      eq(schema.inventoryCountItems.variantId, schema.productVariants.id)
    )
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id)
    )
    .where(eq(schema.inventoryCountItems.countId, inventaire.id))
    .orderBy(asc(schema.products.name), asc(schema.productVariants.name))
  return c.json({
    count: {
      id: inventaire.id,
      warehouseId: inventaire.warehouseId,
      warehouseName: entetes[0]?.warehouseName ?? "",
      status: inventaire.status,
      openedAt: inventaire.openedAt,
      closedAt: inventaire.closedAt,
      items,
    },
  })
})

inventoryCountsRoute.patch("/:id/items/:itemId", async (c) => {
  const corps = await validerCorps(c, inventoryCountItemUpdateSchema)
  if (!corps.ok) return corps.reponse
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const inventaire = await inventaireScope(
    db,
    organizationId,
    c.req.param("id")
  )
  if (!inventaire) {
    return c.json(
      { code: "INTROUVABLE", message: "Inventaire introuvable" },
      404
    )
  }
  const refus = await verifierAccesEntrepot(c, inventaire.warehouseId, [
    "manager",
  ])
  if (refus) return refus
  if (inventaire.status !== "open") {
    return c.json(REPONSE_INVENTAIRE_CLOS, 409)
  }
  const items = await db
    .select({ id: schema.inventoryCountItems.id })
    .from(schema.inventoryCountItems)
    .where(
      and(
        eq(schema.inventoryCountItems.id, c.req.param("itemId")),
        eq(schema.inventoryCountItems.countId, inventaire.id)
      )
    )
    .limit(1)
  if (items.length === 0) {
    return c.json({ code: "INTROUVABLE", message: "Ligne introuvable" }, 404)
  }
  const maintenant = new Date()
  try {
    // Saisie + updatedAt du document, atomiquement. Si une clôture
    // concurrente vient de passer, inventory_count_items_clos_update fait
    // échouer le batch → 409 propre.
    await db.batch([
      db
        .update(schema.inventoryCountItems)
        .set({ countedQuantity: corps.data.countedQuantity })
        .where(eq(schema.inventoryCountItems.id, c.req.param("itemId"))),
      db
        .update(schema.inventoryCounts)
        .set({ updatedAt: maintenant })
        .where(eq(schema.inventoryCounts.id, inventaire.id)),
    ])
  } catch (err) {
    if (estErreurDeclencheur(err, "INVENTAIRE_CLOS")) {
      return c.json(REPONSE_INVENTAIRE_CLOS, 409)
    }
    throw err
  }
  return c.json({ ok: true })
})
