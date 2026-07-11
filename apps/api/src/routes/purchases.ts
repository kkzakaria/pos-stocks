import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import {
  purchaseCreateSchema,
  purchaseItemCreateSchema,
  purchaseItemUpdateSchema,
} from "shared"
import * as schema from "../db/schema"
import { validerCorps } from "../lib/validation"
import { estErreurDeclencheur, estViolationUnicite } from "../lib/db-errors"
import { fournisseurExiste, varianteScope } from "../lib/org-scope"
import { applyMovements } from "../services/stock"
import type { InstructionBatch, MouvementStock } from "../services/stock"
import { porteeLectureStock } from "../lib/stock-acces"
import { requireAuth } from "../middleware/require-auth"
import {
  requireMembership,
  verifierAccesEntrepot,
} from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import type { Env } from "../env"

export const purchasesRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

purchasesRoute.use(requireAuth, requireMembership)

type Db = DrizzleD1Database<typeof schema>

// Retour annoté `| null` (piège eslint no-unnecessary-condition)
async function achatScope(
  db: Db,
  organizationId: string,
  id: string
): Promise<typeof schema.purchases.$inferSelect | null> {
  const rows = await db
    .select()
    .from(schema.purchases)
    .where(
      and(
        eq(schema.purchases.id, id),
        eq(schema.purchases.organizationId, organizationId)
      )
    )
    .limit(1)
  return rows[0] ?? null
}

const REPONSE_RECEPTION_VALIDEE = {
  code: "RECEPTION_VALIDEE",
  message: "Cette réception est validée et ne peut plus être modifiée",
} as const

// Règles de lot d'une ligne : lot exigé pour un produit trackLots,
// interdit sinon. Renvoie la réponse d'erreur à retourner, ou null si OK.
async function verifierReglesLot(
  db: Db,
  variantProductId: string,
  lotNumber: string | null,
  expiryDate: string | Date | null
): Promise<{ code: string; message: string; statut: 400 } | null> {
  const produits = await db
    .select({ trackLots: schema.products.trackLots })
    .from(schema.products)
    .where(eq(schema.products.id, variantProductId))
    .limit(1)
  const suitLots = produits[0]?.trackLots === true
  if (suitLots && !lotNumber) {
    return {
      code: "LOT_REQUIS",
      message: "Le numéro de lot est requis pour un produit suivi par lots",
      statut: 400,
    }
  }
  if (!suitLots && (lotNumber || expiryDate)) {
    return {
      code: "LOTS_NON_SUIVIS",
      message: "Le suivi par lots n'est pas activé pour ce produit",
      statut: 400,
    }
  }
  return null
}

purchasesRoute.get("/", async (c) => {
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
    !(schema.PURCHASE_STATUSES as readonly string[]).includes(statut)
  ) {
    return c.json({ code: "VALIDATION", message: "Statut invalide" }, 400)
  }
  const conditions: SQL[] = [
    eq(schema.purchases.organizationId, organizationId),
  ]
  if (statut) {
    conditions.push(
      eq(
        schema.purchases.status,
        statut as (typeof schema.PURCHASE_STATUSES)[number]
      )
    )
  }
  if (warehouseId) {
    if (!portee.tous && !portee.warehouseIds.includes(warehouseId)) {
      return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
    }
    conditions.push(eq(schema.purchases.warehouseId, warehouseId))
  } else if (!portee.tous) {
    if (portee.warehouseIds.length === 0) {
      return c.json({ purchases: [] })
    }
    conditions.push(inArray(schema.purchases.warehouseId, portee.warehouseIds))
  }

  const rows = await db
    .select({
      id: schema.purchases.id,
      warehouseId: schema.purchases.warehouseId,
      warehouseName: schema.warehouses.name,
      supplierId: schema.purchases.supplierId,
      supplierName: schema.suppliers.name,
      reference: schema.purchases.reference,
      status: schema.purchases.status,
      createdAt: schema.purchases.createdAt,
      receivedAt: schema.purchases.receivedAt,
    })
    .from(schema.purchases)
    .innerJoin(
      schema.warehouses,
      eq(schema.purchases.warehouseId, schema.warehouses.id)
    )
    .innerJoin(
      schema.suppliers,
      eq(schema.purchases.supplierId, schema.suppliers.id)
    )
    .where(and(...conditions))
    .orderBy(desc(schema.purchases.createdAt))

  const ids = rows.map((r) => r.id)
  const agregats =
    ids.length > 0
      ? await db
          .select({
            purchaseId: schema.purchaseItems.purchaseId,
            itemCount: sql<number>`COUNT(*)`,
            totalCost: sql<number>`COALESCE(SUM(${schema.purchaseItems.quantity} * ${schema.purchaseItems.unitCost}), 0)`,
          })
          .from(schema.purchaseItems)
          .where(inArray(schema.purchaseItems.purchaseId, ids))
          .groupBy(schema.purchaseItems.purchaseId)
      : []
  const purchases = rows.map((r) => {
    const agregat = agregats.find((a) => a.purchaseId === r.id)
    return {
      ...r,
      itemCount: agregat?.itemCount ?? 0,
      totalCost: agregat?.totalCost ?? 0,
    }
  })
  return c.json({ purchases })
})

purchasesRoute.post("/", async (c) => {
  const corps = await validerCorps(c, purchaseCreateSchema)
  if (!corps.ok) return corps.reponse
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  // Écriture : owner/admin/stock_manager (bypass) ou manager de l'entrepôt.
  // L'entrepôt vient du corps, pas du chemin → verifierAccesEntrepot direct
  // (couvre aussi le cross-tenant : 403).
  const refus = await verifierAccesEntrepot(c, corps.data.warehouseId, [
    "manager",
  ])
  if (refus) return refus
  if (!(await fournisseurExiste(db, organizationId, corps.data.supplierId))) {
    return c.json(
      { code: "INTROUVABLE", message: "Fournisseur introuvable" },
      404
    )
  }
  const id = crypto.randomUUID()
  const maintenant = new Date()
  await db.insert(schema.purchases).values({
    id,
    organizationId,
    warehouseId: corps.data.warehouseId,
    supplierId: corps.data.supplierId,
    reference: corps.data.reference ?? null,
    createdBy: c.get("user").id,
    createdAt: maintenant,
    updatedAt: maintenant,
  })
  return c.json({ id }, 201)
})

purchasesRoute.get("/:id", async (c) => {
  const { organizationId, role } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const achat = await achatScope(db, organizationId, c.req.param("id"))
  if (!achat) {
    return c.json(
      { code: "INTROUVABLE", message: "Réception introuvable" },
      404
    )
  }
  const portee = await porteeLectureStock(
    db,
    organizationId,
    c.get("user").id,
    role
  )
  if (!portee.tous && !portee.warehouseIds.includes(achat.warehouseId)) {
    return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
  }
  const entetes = await db
    .select({
      warehouseName: schema.warehouses.name,
      supplierName: schema.suppliers.name,
    })
    .from(schema.purchases)
    .innerJoin(
      schema.warehouses,
      eq(schema.purchases.warehouseId, schema.warehouses.id)
    )
    .innerJoin(
      schema.suppliers,
      eq(schema.purchases.supplierId, schema.suppliers.id)
    )
    .where(eq(schema.purchases.id, achat.id))
    .limit(1)
  const items = await db
    .select({
      id: schema.purchaseItems.id,
      variantId: schema.purchaseItems.variantId,
      productName: schema.products.name,
      variantName: schema.productVariants.name,
      sku: schema.productVariants.sku,
      trackLots: schema.products.trackLots,
      quantity: schema.purchaseItems.quantity,
      unitCost: schema.purchaseItems.unitCost,
      lotNumber: schema.purchaseItems.lotNumber,
      expiryDate: schema.purchaseItems.expiryDate,
    })
    .from(schema.purchaseItems)
    .innerJoin(
      schema.productVariants,
      eq(schema.purchaseItems.variantId, schema.productVariants.id)
    )
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id)
    )
    .where(eq(schema.purchaseItems.purchaseId, achat.id))
    .orderBy(asc(schema.products.name), asc(schema.productVariants.name))
  return c.json({
    purchase: {
      id: achat.id,
      warehouseId: achat.warehouseId,
      warehouseName: entetes[0]?.warehouseName ?? "",
      supplierId: achat.supplierId,
      supplierName: entetes[0]?.supplierName ?? "",
      reference: achat.reference,
      status: achat.status,
      createdAt: achat.createdAt,
      receivedAt: achat.receivedAt,
      items,
    },
  })
})

purchasesRoute.post("/:id/items", async (c) => {
  const corps = await validerCorps(c, purchaseItemCreateSchema)
  if (!corps.ok) return corps.reponse
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const achat = await achatScope(db, organizationId, c.req.param("id"))
  if (!achat) {
    return c.json(
      { code: "INTROUVABLE", message: "Réception introuvable" },
      404
    )
  }
  const refus = await verifierAccesEntrepot(c, achat.warehouseId, ["manager"])
  if (refus) return refus
  if (achat.status !== "draft") {
    return c.json(REPONSE_RECEPTION_VALIDEE, 409)
  }
  const variante = await varianteScope(db, organizationId, corps.data.variantId)
  if (!variante) {
    return c.json({ code: "INTROUVABLE", message: "Variante introuvable" }, 404)
  }
  const erreurLot = await verifierReglesLot(
    db,
    variante.productId,
    corps.data.lotNumber ?? null,
    corps.data.expiryDate ?? null
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
    // Ligne + updatedAt du document, atomiquement. Si une validation
    // concurrente vient de passer, le trigger purchase_items_recu_insert
    // fait échouer le batch → 409 propre au lieu d'une ligne fantôme.
    await db.batch([
      db.insert(schema.purchaseItems).values({
        id,
        organizationId,
        purchaseId: achat.id,
        variantId: variante.id,
        quantity: corps.data.quantity,
        unitCost: corps.data.unitCost,
        lotNumber: corps.data.lotNumber ?? null,
        expiryDate: corps.data.expiryDate
          ? new Date(corps.data.expiryDate)
          : null,
        createdAt: maintenant,
      }),
      db
        .update(schema.purchases)
        .set({ updatedAt: maintenant })
        .where(eq(schema.purchases.id, achat.id)),
    ])
  } catch (err) {
    if (estErreurDeclencheur(err, "RECEPTION_VALIDEE")) {
      return c.json(REPONSE_RECEPTION_VALIDEE, 409)
    }
    throw err
  }
  return c.json({ id }, 201)
})

purchasesRoute.patch("/:id/items/:itemId", async (c) => {
  const corps = await validerCorps(c, purchaseItemUpdateSchema)
  if (!corps.ok) return corps.reponse
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const achat = await achatScope(db, organizationId, c.req.param("id"))
  if (!achat) {
    return c.json(
      { code: "INTROUVABLE", message: "Réception introuvable" },
      404
    )
  }
  const refus = await verifierAccesEntrepot(c, achat.warehouseId, ["manager"])
  if (refus) return refus
  if (achat.status !== "draft") {
    return c.json(REPONSE_RECEPTION_VALIDEE, 409)
  }
  const items = await db
    .select()
    .from(schema.purchaseItems)
    .where(
      and(
        eq(schema.purchaseItems.id, c.req.param("itemId")),
        eq(schema.purchaseItems.purchaseId, achat.id)
      )
    )
    .limit(1)
  if (items.length === 0) {
    return c.json({ code: "INTROUVABLE", message: "Ligne introuvable" }, 404)
  }
  const item = items[0]
  const variantes = await db
    .select({ productId: schema.productVariants.productId })
    .from(schema.productVariants)
    .where(eq(schema.productVariants.id, item.variantId))
    .limit(1)
  // Valeurs effectives après fusion : les règles de lot s'appliquent au
  // résultat, pas au seul payload.
  const lotEffectif =
    corps.data.lotNumber !== undefined ? corps.data.lotNumber : item.lotNumber
  const peremptionEffective =
    corps.data.expiryDate !== undefined
      ? corps.data.expiryDate
      : item.expiryDate
  const erreurLot = await verifierReglesLot(
    db,
    variantes[0]?.productId ?? "",
    lotEffectif,
    peremptionEffective
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
        .update(schema.purchaseItems)
        .set({
          ...(corps.data.quantity !== undefined
            ? { quantity: corps.data.quantity }
            : {}),
          ...(corps.data.unitCost !== undefined
            ? { unitCost: corps.data.unitCost }
            : {}),
          ...(corps.data.lotNumber !== undefined
            ? { lotNumber: corps.data.lotNumber }
            : {}),
          ...(corps.data.expiryDate !== undefined
            ? {
                expiryDate: corps.data.expiryDate
                  ? new Date(corps.data.expiryDate)
                  : null,
              }
            : {}),
        })
        .where(eq(schema.purchaseItems.id, item.id)),
      db
        .update(schema.purchases)
        .set({ updatedAt: maintenant })
        .where(eq(schema.purchases.id, achat.id)),
    ])
  } catch (err) {
    if (estErreurDeclencheur(err, "RECEPTION_VALIDEE")) {
      return c.json(REPONSE_RECEPTION_VALIDEE, 409)
    }
    throw err
  }
  return c.json({ ok: true })
})

purchasesRoute.delete("/:id/items/:itemId", async (c) => {
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const achat = await achatScope(db, organizationId, c.req.param("id"))
  if (!achat) {
    return c.json(
      { code: "INTROUVABLE", message: "Réception introuvable" },
      404
    )
  }
  const refus = await verifierAccesEntrepot(c, achat.warehouseId, ["manager"])
  if (refus) return refus
  if (achat.status !== "draft") {
    return c.json(REPONSE_RECEPTION_VALIDEE, 409)
  }
  // Vérifier que la ligne existe avant de la supprimer
  const items = await db
    .select()
    .from(schema.purchaseItems)
    .where(
      and(
        eq(schema.purchaseItems.id, c.req.param("itemId")),
        eq(schema.purchaseItems.purchaseId, achat.id)
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
        .delete(schema.purchaseItems)
        .where(
          and(
            eq(schema.purchaseItems.id, c.req.param("itemId")),
            eq(schema.purchaseItems.purchaseId, achat.id)
          )
        )
        .returning({ id: schema.purchaseItems.id }),
      db
        .update(schema.purchases)
        .set({ updatedAt: maintenant })
        .where(eq(schema.purchases.id, achat.id)),
    ])
  } catch (err) {
    if (estErreurDeclencheur(err, "RECEPTION_VALIDEE")) {
      return c.json(REPONSE_RECEPTION_VALIDEE, 409)
    }
    throw err
  }
  return c.json({ ok: true })
})

purchasesRoute.post("/:id/receive", async (c) => {
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const achat = await achatScope(db, organizationId, c.req.param("id"))
  if (!achat) {
    return c.json(
      { code: "INTROUVABLE", message: "Réception introuvable" },
      404
    )
  }
  const refus = await verifierAccesEntrepot(c, achat.warehouseId, ["manager"])
  if (refus) return refus
  if (achat.status !== "draft") {
    return c.json(
      {
        code: "STATUT_INVALIDE",
        message: "Cette réception a déjà été validée",
      },
      409
    )
  }
  const items = await db
    .select()
    .from(schema.purchaseItems)
    .where(eq(schema.purchaseItems.purchaseId, achat.id))
  if (items.length === 0) {
    return c.json(
      {
        code: "VALIDATION",
        message: "Impossible de valider une réception sans ligne",
      },
      400
    )
  }

  const maintenant = new Date()

  // Lots : réutiliser le lot existant (variantId, lotNumber), sinon en créer
  // un DANS le même batch. Clé de map `${variantId} ${lotNumber}` : sans
  // ambiguïté, un variantId est un UUID qui ne contient jamais d'espace.
  type LotResolu = {
    id: string
    nouveau: boolean
    variantId: string
    lotNumber: string
    expiryDate: Date | null
  }
  const itemsAvecLot = items.filter((i) => i.lotNumber !== null)
  const variantIdsLots = [...new Set(itemsAvecLot.map((i) => i.variantId))]
  const lotsExistants =
    variantIdsLots.length > 0
      ? await db
          .select()
          .from(schema.lots)
          .where(inArray(schema.lots.variantId, variantIdsLots))
      : []
  const lotParCle = new Map<string, LotResolu>()
  for (const item of itemsAvecLot) {
    const lotNumber = item.lotNumber
    if (lotNumber === null) continue
    const cle = `${item.variantId} ${lotNumber}`
    if (lotParCle.has(cle)) continue
    const existant = lotsExistants.find(
      (l) => l.variantId === item.variantId && l.lotNumber === lotNumber
    )
    lotParCle.set(
      cle,
      existant
        ? {
            id: existant.id,
            nouveau: false,
            variantId: existant.variantId,
            lotNumber: existant.lotNumber,
            expiryDate: existant.expiryDate,
          }
        : {
            id: crypto.randomUUID(),
            nouveau: true,
            variantId: item.variantId,
            lotNumber,
            expiryDate: item.expiryDate,
          }
    )
  }
  const insertionsLots = [...lotParCle.values()]
    .filter((lot) => lot.nouveau)
    .map((lot) =>
      db.insert(schema.lots).values({
        id: lot.id,
        organizationId,
        variantId: lot.variantId,
        lotNumber: lot.lotNumber,
        expiryDate: lot.expiryDate,
        createdAt: maintenant,
      })
    )

  // Passage received SANS filtre de statut dans le WHERE : si une validation
  // concurrente est passée entre notre pré-contrôle et le batch, le trigger
  // purchases_recu_immuable (old.status = 'received') fait échouer CE batch
  // ENTIER — au lieu d'un UPDATE « 0 ligne » silencieux qui laisserait les
  // mouvements s'appliquer une seconde fois.
  const majStatut = db
    .update(schema.purchases)
    .set({
      status: "received",
      receivedAt: maintenant,
      receivedBy: c.get("user").id,
      updatedAt: maintenant,
    })
    .where(eq(schema.purchases.id, achat.id))

  const mouvements: MouvementStock[] = items.map((item) => ({
    warehouseId: achat.warehouseId,
    variantId: item.variantId,
    lotId:
      item.lotNumber !== null
        ? (lotParCle.get(`${item.variantId} ${item.lotNumber}`)?.id ?? null)
        : null,
    delta: item.quantity,
    type: "purchase",
    refType: "purchase",
    refId: achat.id,
    unitCost: item.unitCost,
  }))

  // Batch hétérogène construit directement (spread, pas de push + cast)
  const instructionsAvant: InstructionBatch[] = [majStatut, ...insertionsLots]
  try {
    await applyMovements(db, {
      organizationId,
      userId: c.get("user").id,
      mouvements,
      instructionsAvant,
      date: maintenant,
    })
  } catch (err) {
    if (estErreurDeclencheur(err, "RECEPTION_VALIDEE")) {
      return c.json(
        {
          code: "STATUT_INVALIDE",
          message: "Cette réception a déjà été validée",
        },
        409
      )
    }
    if (estViolationUnicite(err, "lots_variant_lot_uidx")) {
      // Course rarissime : un lot de même numéro créé entre notre lecture et
      // le batch. Rejouable sans risque : au retry, le lot sera réutilisé.
      return c.json(
        {
          code: "LOT_EXISTANT",
          message: "Conflit sur un numéro de lot, veuillez réessayer",
        },
        409
      )
    }
    throw err
  }
  return c.json({ ok: true })
})

purchasesRoute.delete("/:id", async (c) => {
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const achat = await achatScope(db, organizationId, c.req.param("id"))
  if (!achat) {
    return c.json(
      { code: "INTROUVABLE", message: "Réception introuvable" },
      404
    )
  }
  const refus = await verifierAccesEntrepot(c, achat.warehouseId, ["manager"])
  if (refus) return refus
  if (achat.status !== "draft") {
    return c.json(REPONSE_RECEPTION_VALIDEE, 409)
  }
  // Les lignes suivent par FK ON DELETE CASCADE
  await db.delete(schema.purchases).where(eq(schema.purchases.id, achat.id))
  return c.json({ ok: true })
})
