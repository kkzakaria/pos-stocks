import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"
import type { SQL } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import {
  transferCreateSchema,
  transferItemCreateSchema,
  transferItemUpdateSchema,
} from "shared"
import * as schema from "../db/schema"
import { validerCorps } from "../lib/validation"
import { estErreurDeclencheur } from "../lib/db-errors"
import { entrepotExiste, varianteScope } from "../lib/org-scope"
import { porteeLectureStock } from "../lib/stock-acces"
import { requireAuth } from "../middleware/require-auth"
import {
  requireMembership,
  verifierAccesEntrepot,
} from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import type { Env } from "../env"

export const transfersRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

transfersRoute.use(requireAuth, requireMembership)

type Db = DrizzleD1Database<typeof schema>

// Retour annoté `| null` (piège eslint no-unnecessary-condition)
async function transfertScope(
  db: Db,
  organizationId: string,
  id: string
): Promise<typeof schema.transfers.$inferSelect | null> {
  const rows = await db
    .select()
    .from(schema.transfers)
    .where(
      and(
        eq(schema.transfers.id, id),
        eq(schema.transfers.organizationId, organizationId)
      )
    )
    .limit(1)
  return rows[0] ?? null
}

const REPONSE_TRANSFERT_EXPEDIE = {
  code: "TRANSFERT_EXPEDIE",
  message: "Ce transfert n'est plus en brouillon et ne peut plus être modifié",
} as const

// Règles de lot d'une ligne de transfert : le lot est OPTIONNEL en brouillon
// (LOT_REQUIS n'est vérifié qu'à l'expédition, Task 6) mais, s'il est fourni,
// il doit appartenir à la variante ; il est interdit si le produit ne suit
// pas les lots. Renvoie la réponse d'erreur à retourner, ou null si OK.
async function verifierReglesLot(
  db: Db,
  variantProductId: string,
  variantId: string,
  lotId: string | null
): Promise<{ code: string; message: string; statut: 400 | 404 } | null> {
  const produits = await db
    .select({ trackLots: schema.products.trackLots })
    .from(schema.products)
    .where(eq(schema.products.id, variantProductId))
    .limit(1)
  const suitLots = produits[0]?.trackLots === true
  if (!suitLots && lotId) {
    return {
      code: "LOTS_NON_SUIVIS",
      message: "Le suivi par lots n'est pas activé pour ce produit",
      statut: 400,
    }
  }
  if (lotId) {
    const lot = await db
      .select({ id: schema.lots.id })
      .from(schema.lots)
      .where(
        and(eq(schema.lots.id, lotId), eq(schema.lots.variantId, variantId))
      )
      .limit(1)
    if (lot.length === 0) {
      return { code: "INTROUVABLE", message: "Lot introuvable", statut: 404 }
    }
  }
  return null
}

// Un transfert est LISIBLE si l'un de ses deux entrepôts est dans la portée.
function transfertLisible(
  portee: Awaited<ReturnType<typeof porteeLectureStock>>,
  transfert: { fromWarehouseId: string; toWarehouseId: string }
): boolean {
  return (
    portee.tous ||
    portee.warehouseIds.includes(transfert.fromWarehouseId) ||
    portee.warehouseIds.includes(transfert.toWarehouseId)
  )
}

transfersRoute.get("/", async (c) => {
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
    !(schema.TRANSFER_STATUSES as readonly string[]).includes(statut)
  ) {
    return c.json({ code: "VALIDATION", message: "Statut invalide" }, 400)
  }
  const conditions: SQL[] = [
    eq(schema.transfers.organizationId, organizationId),
  ]
  if (statut) {
    conditions.push(
      eq(
        schema.transfers.status,
        statut as (typeof schema.TRANSFER_STATUSES)[number]
      )
    )
  }
  if (warehouseId) {
    if (!portee.tous && !portee.warehouseIds.includes(warehouseId)) {
      return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
    }
    const filtre = or(
      eq(schema.transfers.fromWarehouseId, warehouseId),
      eq(schema.transfers.toWarehouseId, warehouseId)
    )
    if (filtre) {
      conditions.push(filtre)
    }
  } else if (!portee.tous) {
    if (portee.warehouseIds.length === 0) {
      return c.json({ transfers: [] })
    }
    const filtre = or(
      inArray(schema.transfers.fromWarehouseId, portee.warehouseIds),
      inArray(schema.transfers.toWarehouseId, portee.warehouseIds)
    )
    if (filtre) {
      conditions.push(filtre)
    }
  }

  const origine = alias(schema.warehouses, "origine")
  const destination = alias(schema.warehouses, "destination")
  const rows = await db
    .select({
      id: schema.transfers.id,
      fromWarehouseId: schema.transfers.fromWarehouseId,
      fromWarehouseName: origine.name,
      toWarehouseId: schema.transfers.toWarehouseId,
      toWarehouseName: destination.name,
      reference: schema.transfers.reference,
      status: schema.transfers.status,
      createdAt: schema.transfers.createdAt,
      sentAt: schema.transfers.sentAt,
      receivedAt: schema.transfers.receivedAt,
    })
    .from(schema.transfers)
    .innerJoin(origine, eq(schema.transfers.fromWarehouseId, origine.id))
    .innerJoin(destination, eq(schema.transfers.toWarehouseId, destination.id))
    .where(and(...conditions))
    .orderBy(desc(schema.transfers.createdAt))

  const ids = rows.map((r) => r.id)
  const agregats =
    ids.length > 0
      ? await db
          .select({
            transferId: schema.transferItems.transferId,
            itemCount: sql<number>`COUNT(*)`,
            totalQuantity: sql<number>`COALESCE(SUM(${schema.transferItems.quantity}), 0)`,
          })
          .from(schema.transferItems)
          .where(inArray(schema.transferItems.transferId, ids))
          .groupBy(schema.transferItems.transferId)
      : []
  const transfers = rows.map((r) => {
    const agregat = agregats.find((a) => a.transferId === r.id)
    return {
      ...r,
      itemCount: agregat?.itemCount ?? 0,
      totalQuantity: agregat?.totalQuantity ?? 0,
    }
  })
  return c.json({ transfers })
})

transfersRoute.post("/", async (c) => {
  const corps = await validerCorps(c, transferCreateSchema)
  if (!corps.ok) return corps.reponse
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  if (corps.data.fromWarehouseId === corps.data.toWarehouseId) {
    return c.json(
      {
        code: "TRANSFERT_MEME_ENTREPOT",
        message: "L'origine et la destination doivent être différentes",
      },
      400
    )
  }
  // Écriture = rôle sur l'ORIGINE (décision de phase) : owner/admin/
  // stock_manager (bypass) ou manager local de l'entrepôt d'origine.
  // Couvre aussi le cross-tenant sur l'origine : 403.
  const refus = await verifierAccesEntrepot(c, corps.data.fromWarehouseId, [
    "manager",
  ])
  if (refus) return refus
  // La destination est un CHAMP DE DOCUMENT (aucun rôle exigé) : simple
  // existence dans l'organisation, sinon 404 — même motif que le
  // fournisseur d'une réception.
  if (!(await entrepotExiste(db, organizationId, corps.data.toWarehouseId))) {
    return c.json(
      { code: "INTROUVABLE", message: "Entrepôt de destination introuvable" },
      404
    )
  }
  const id = crypto.randomUUID()
  const maintenant = new Date()
  await db.insert(schema.transfers).values({
    id,
    organizationId,
    fromWarehouseId: corps.data.fromWarehouseId,
    toWarehouseId: corps.data.toWarehouseId,
    reference: corps.data.reference ?? null,
    createdBy: c.get("user").id,
    createdAt: maintenant,
    updatedAt: maintenant,
  })
  return c.json({ id }, 201)
})

transfersRoute.get("/:id", async (c) => {
  const { organizationId, role } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const transfert = await transfertScope(db, organizationId, c.req.param("id"))
  if (!transfert) {
    return c.json(
      { code: "INTROUVABLE", message: "Transfert introuvable" },
      404
    )
  }
  const portee = await porteeLectureStock(
    db,
    organizationId,
    c.get("user").id,
    role
  )
  if (!transfertLisible(portee, transfert)) {
    return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
  }
  const origine = alias(schema.warehouses, "origine")
  const destination = alias(schema.warehouses, "destination")
  const entetes = await db
    .select({
      fromWarehouseName: origine.name,
      toWarehouseName: destination.name,
    })
    .from(schema.transfers)
    .innerJoin(origine, eq(schema.transfers.fromWarehouseId, origine.id))
    .innerJoin(destination, eq(schema.transfers.toWarehouseId, destination.id))
    .where(eq(schema.transfers.id, transfert.id))
    .limit(1)
  const items = await db
    .select({
      id: schema.transferItems.id,
      variantId: schema.transferItems.variantId,
      productId: schema.products.id,
      productName: schema.products.name,
      variantName: schema.productVariants.name,
      sku: schema.productVariants.sku,
      trackLots: schema.products.trackLots,
      lotId: schema.transferItems.lotId,
      lotNumber: schema.lots.lotNumber,
      quantity: schema.transferItems.quantity,
      unitCost: schema.transferItems.unitCost,
      receivedQuantity: schema.transferItems.receivedQuantity,
    })
    .from(schema.transferItems)
    .innerJoin(
      schema.productVariants,
      eq(schema.transferItems.variantId, schema.productVariants.id)
    )
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id)
    )
    .leftJoin(schema.lots, eq(schema.transferItems.lotId, schema.lots.id))
    .where(eq(schema.transferItems.transferId, transfert.id))
    .orderBy(asc(schema.products.name), asc(schema.productVariants.name))
  return c.json({
    transfer: {
      id: transfert.id,
      fromWarehouseId: transfert.fromWarehouseId,
      fromWarehouseName: entetes[0]?.fromWarehouseName ?? "",
      toWarehouseId: transfert.toWarehouseId,
      toWarehouseName: entetes[0]?.toWarehouseName ?? "",
      reference: transfert.reference,
      status: transfert.status,
      createdAt: transfert.createdAt,
      sentAt: transfert.sentAt,
      receivedAt: transfert.receivedAt,
      cancelledAt: transfert.cancelledAt,
      items,
    },
  })
})

transfersRoute.post("/:id/items", async (c) => {
  const corps = await validerCorps(c, transferItemCreateSchema)
  if (!corps.ok) return corps.reponse
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const transfert = await transfertScope(db, organizationId, c.req.param("id"))
  if (!transfert) {
    return c.json(
      { code: "INTROUVABLE", message: "Transfert introuvable" },
      404
    )
  }
  const refus = await verifierAccesEntrepot(c, transfert.fromWarehouseId, [
    "manager",
  ])
  if (refus) return refus
  if (transfert.status !== "pending") {
    return c.json(REPONSE_TRANSFERT_EXPEDIE, 409)
  }
  const variante = await varianteScope(db, organizationId, corps.data.variantId)
  if (!variante) {
    return c.json({ code: "INTROUVABLE", message: "Variante introuvable" }, 404)
  }
  const erreurLot = await verifierReglesLot(
    db,
    variante.productId,
    variante.id,
    corps.data.lotId ?? null
  )
  if (erreurLot) {
    return c.json(
      { code: erreurLot.code, message: erreurLot.message },
      erreurLot.statut
    )
  }
  const id = crypto.randomUUID()
  const maintenant = new Date()
  try {
    // Ligne + updatedAt du document, atomiquement. Si une expédition
    // concurrente vient de passer, le trigger transfer_items_expedie_insert
    // fait échouer le batch → 409 propre au lieu d'une ligne fantôme.
    await db.batch([
      db.insert(schema.transferItems).values({
        id,
        organizationId,
        transferId: transfert.id,
        variantId: variante.id,
        lotId: corps.data.lotId ?? null,
        quantity: corps.data.quantity,
        createdAt: maintenant,
      }),
      db
        .update(schema.transfers)
        .set({ updatedAt: maintenant })
        .where(eq(schema.transfers.id, transfert.id)),
    ])
  } catch (err) {
    if (
      estErreurDeclencheur(err, "TRANSFERT_EXPEDIE") ||
      estErreurDeclencheur(err, "TRANSFERT_TERMINE")
    ) {
      return c.json(REPONSE_TRANSFERT_EXPEDIE, 409)
    }
    throw err
  }
  return c.json({ id }, 201)
})

transfersRoute.patch("/:id/items/:itemId", async (c) => {
  const corps = await validerCorps(c, transferItemUpdateSchema)
  if (!corps.ok) return corps.reponse
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const transfert = await transfertScope(db, organizationId, c.req.param("id"))
  if (!transfert) {
    return c.json(
      { code: "INTROUVABLE", message: "Transfert introuvable" },
      404
    )
  }
  const refus = await verifierAccesEntrepot(c, transfert.fromWarehouseId, [
    "manager",
  ])
  if (refus) return refus
  if (transfert.status !== "pending") {
    return c.json(REPONSE_TRANSFERT_EXPEDIE, 409)
  }
  const items = await db
    .select()
    .from(schema.transferItems)
    .where(
      and(
        eq(schema.transferItems.id, c.req.param("itemId")),
        eq(schema.transferItems.transferId, transfert.id)
      )
    )
    .limit(1)
  if (items.length === 0) {
    return c.json({ code: "INTROUVABLE", message: "Ligne introuvable" }, 404)
  }
  const item = items[0]
  // Règles de lot évaluées sur la valeur EFFECTIVE après fusion
  const lotEffectif =
    corps.data.lotId !== undefined ? corps.data.lotId : item.lotId
  const variantes = await db
    .select({ productId: schema.productVariants.productId })
    .from(schema.productVariants)
    .where(eq(schema.productVariants.id, item.variantId))
    .limit(1)
  const erreurLot = await verifierReglesLot(
    db,
    variantes[0]?.productId ?? "",
    item.variantId,
    lotEffectif
  )
  if (erreurLot) {
    return c.json(
      { code: erreurLot.code, message: erreurLot.message },
      erreurLot.statut
    )
  }
  const maintenant = new Date()
  try {
    await db.batch([
      db
        .update(schema.transferItems)
        .set({
          ...(corps.data.quantity !== undefined
            ? { quantity: corps.data.quantity }
            : {}),
          ...(corps.data.lotId !== undefined
            ? { lotId: corps.data.lotId }
            : {}),
        })
        .where(eq(schema.transferItems.id, item.id)),
      db
        .update(schema.transfers)
        .set({ updatedAt: maintenant })
        .where(eq(schema.transfers.id, transfert.id)),
    ])
  } catch (err) {
    if (
      estErreurDeclencheur(err, "TRANSFERT_EXPEDIE") ||
      estErreurDeclencheur(err, "TRANSFERT_TERMINE")
    ) {
      return c.json(REPONSE_TRANSFERT_EXPEDIE, 409)
    }
    throw err
  }
  return c.json({ ok: true })
})

transfersRoute.delete("/:id/items/:itemId", async (c) => {
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const transfert = await transfertScope(db, organizationId, c.req.param("id"))
  if (!transfert) {
    return c.json(
      { code: "INTROUVABLE", message: "Transfert introuvable" },
      404
    )
  }
  const refus = await verifierAccesEntrepot(c, transfert.fromWarehouseId, [
    "manager",
  ])
  if (refus) return refus
  if (transfert.status !== "pending") {
    return c.json(REPONSE_TRANSFERT_EXPEDIE, 409)
  }
  // Pré-lecture : un 404 ne doit pas bumper updatedAt (leçon P4 Task 8)
  const items = await db
    .select({ id: schema.transferItems.id })
    .from(schema.transferItems)
    .where(
      and(
        eq(schema.transferItems.id, c.req.param("itemId")),
        eq(schema.transferItems.transferId, transfert.id)
      )
    )
    .limit(1)
  if (items.length === 0) {
    return c.json({ code: "INTROUVABLE", message: "Ligne introuvable" }, 404)
  }
  const maintenant = new Date()
  try {
    await db.batch([
      db
        .delete(schema.transferItems)
        .where(eq(schema.transferItems.id, c.req.param("itemId"))),
      db
        .update(schema.transfers)
        .set({ updatedAt: maintenant })
        .where(eq(schema.transfers.id, transfert.id)),
    ])
  } catch (err) {
    if (
      estErreurDeclencheur(err, "TRANSFERT_EXPEDIE") ||
      estErreurDeclencheur(err, "TRANSFERT_TERMINE")
    ) {
      return c.json(REPONSE_TRANSFERT_EXPEDIE, 409)
    }
    throw err
  }
  return c.json({ ok: true })
})

transfersRoute.post("/:id/cancel", async (c) => {
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const transfert = await transfertScope(db, organizationId, c.req.param("id"))
  if (!transfert) {
    return c.json(
      { code: "INTROUVABLE", message: "Transfert introuvable" },
      404
    )
  }
  const refus = await verifierAccesEntrepot(c, transfert.fromWarehouseId, [
    "manager",
  ])
  if (refus) return refus
  if (transfert.status !== "pending") {
    return c.json(
      {
        code: "STATUT_INVALIDE",
        message: "Seul un transfert en attente peut être annulé",
      },
      409
    )
  }
  const maintenant = new Date()
  try {
    // UPDATE SANS filtre de statut : si une expédition concurrente vient de
    // passer, transfers_expedie_fige (sent -> cancelled) tue la transition.
    await db
      .update(schema.transfers)
      .set({
        status: "cancelled",
        cancelledBy: c.get("user").id,
        cancelledAt: maintenant,
        updatedAt: maintenant,
      })
      .where(eq(schema.transfers.id, transfert.id))
  } catch (err) {
    if (
      estErreurDeclencheur(err, "TRANSFERT_EXPEDIE") ||
      estErreurDeclencheur(err, "TRANSFERT_TERMINE")
    ) {
      return c.json(
        {
          code: "STATUT_INVALIDE",
          message: "Seul un transfert en attente peut être annulé",
        },
        409
      )
    }
    throw err
  }
  return c.json({ ok: true })
})
