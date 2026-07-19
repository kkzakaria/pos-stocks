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
  transferReceiveSchema,
} from "shared"
import * as schema from "../db/schema"
import { lirePagination } from "../lib/pagination"
import { validerCorps } from "../lib/validation"
import { estErreurDeclencheur } from "../lib/db-errors"
import { entrepotExiste, varianteScope } from "../lib/org-scope"
import {
  estDansPortee,
  filtrePortee,
  porteeLectureStock,
} from "../lib/stock-acces"
import { applyMovements, ErreurStockInsuffisant } from "../services/stock"
import type { InstructionBatch, MouvementStock } from "../services/stock"
import { reponseStockInsuffisant } from "../lib/stock-erreurs"
import { requeterParLots } from "../lib/db-batch"
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
  const pagination = lirePagination(c)
  if (pagination instanceof Response) return pagination
  const { page, limite } = pagination
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
    if (!estDansPortee(portee, warehouseId)) {
      return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
    }
    const filtre = or(
      eq(schema.transfers.fromWarehouseId, warehouseId),
      eq(schema.transfers.toWarehouseId, warehouseId)
    )
    if (filtre) {
      conditions.push(filtre)
    }
  } else {
    const filtre = filtrePortee(
      portee,
      schema.transfers.fromWarehouseId,
      schema.transfers.toWarehouseId
    )
    if (filtre.vide) {
      return c.json({ transfers: [], total: 0, page, limite })
    }
    if (filtre.condition) {
      conditions.push(filtre.condition)
    }
  }

  const totalRows = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(schema.transfers)
    .where(and(...conditions))
  const total = totalRows[0]?.total ?? 0

  const origine = alias(schema.warehouses, "origine")
  const destination = alias(schema.warehouses, "destination")
  const requete = db
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
    .orderBy(desc(schema.transfers.createdAt), desc(schema.transfers.id))
    .limit(limite)
    .offset((page - 1) * limite)
  const rows = await requete

  const ids = rows.map((r) => r.id)
  const agregats = await requeterParLots(ids, (lot) =>
    db
      .select({
        transferId: schema.transferItems.transferId,
        itemCount: sql<number>`COUNT(*)`,
        totalQuantity: sql<number>`COALESCE(SUM(${schema.transferItems.quantity}), 0)`,
      })
      .from(schema.transferItems)
      .where(inArray(schema.transferItems.transferId, lot))
      .groupBy(schema.transferItems.transferId)
  )
  const transfers = rows.map((r) => {
    const agregat = agregats.find((a) => a.transferId === r.id)
    return {
      ...r,
      itemCount: agregat?.itemCount ?? 0,
      totalQuantity: agregat?.totalQuantity ?? 0,
    }
  })
  return c.json({ transfers, total, page, limite })
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
  if (
    !estDansPortee(portee, transfert.fromWarehouseId, transfert.toWarehouseId)
  ) {
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

transfersRoute.post("/:id/send", async (c) => {
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const transfert = await transfertScope(db, organizationId, c.req.param("id"))
  if (!transfert) {
    return c.json(
      { code: "INTROUVABLE", message: "Transfert introuvable" },
      404
    )
  }
  // Expédition = rôle sur l'ORIGINE (décision de phase)
  const refus = await verifierAccesEntrepot(c, transfert.fromWarehouseId, [
    "manager",
  ])
  if (refus) return refus
  if (transfert.status !== "pending") {
    return c.json(
      {
        code: "STATUT_INVALIDE",
        message: "Ce transfert a déjà été expédié ou annulé",
      },
      409
    )
  }
  const items = await db
    .select()
    .from(schema.transferItems)
    .where(eq(schema.transferItems.transferId, transfert.id))
  if (items.length === 0) {
    return c.json(
      {
        code: "VALIDATION",
        message: "Impossible d'expédier un transfert sans ligne",
      },
      400
    )
  }

  // LOT_REQUIS à l'expédition : chaque ligne d'un produit trackLots doit
  // porter son lot (choisi en brouillon) AVANT de sortir du stock — le lot
  // suit la ligne jusqu'au transfer_in de destination.
  const variantIds = [...new Set(items.map((i) => i.variantId))]
  const suivis = await db
    .select({
      variantId: schema.productVariants.id,
      trackLots: schema.products.trackLots,
    })
    .from(schema.productVariants)
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id)
    )
    .where(inArray(schema.productVariants.id, variantIds))
  const lignesSansLot = items.filter(
    (i) =>
      i.lotId === null &&
      suivis.find((s) => s.variantId === i.variantId)?.trackLots === true
  )
  if (lignesSansLot.length > 0) {
    return c.json(
      {
        code: "LOT_REQUIS",
        message:
          "Le numéro de lot est requis pour expédier un produit suivi par lots",
        details: lignesSansLot.map((i) => ({
          itemId: i.id,
          variantId: i.variantId,
        })),
      },
      400
    )
  }

  const maintenant = new Date()
  // CMP de l'origine FIGÉ sur chaque ligne PAR SOUS-REQUÊTE, dans le batch :
  // la valeur est photographiée au moment exact de la transaction (jamais la
  // valeur lue côté JS — même principe que la réconciliation P4). Ces UPDATE
  // passent AVANT le changement de statut : le trigger
  // transfer_items_expedie_update ne s'applique pas (parent encore pending) ;
  // en cas de double expédition concurrente, le premier statement du second
  // batch voit le parent 'sent' et échoue si le CMP a bougé — et de toute
  // façon la mise à jour de statut (sent -> sent) tue le batch entier.
  // `quantity` est en revanche GELÉE à la valeur lue en JS ci-dessus (et non
  // via une sous-requête) : une édition concurrente de la ligne entre cette
  // lecture et le commit du batch (fenêtre TOCTOU brouillon→expédition) est
  // ainsi écrasée — la quantité qui sort (mouvement transfer_out, calculé
  // plus bas depuis `items`) est garantie égale à la quantité gelée sur la
  // ligne. Les lignes insérées APRÈS cette lecture (donc absentes de
  // `gelsCmp`) restent avec unit_cost NULL au moment de la transition ;
  // le trigger transfers_send_lignes_gelees (0008) fait alors échouer le
  // batch entier plutôt que de laisser passer une ligne « ex nihilo ».
  const gelsCmp = items.map((item) =>
    db
      .update(schema.transferItems)
      .set({
        unitCost: sql`COALESCE((SELECT avg_cost FROM stock_levels
          WHERE warehouse_id = ${transfert.fromWarehouseId}
            AND variant_id = ${item.variantId}), 0)`,
        quantity: item.quantity,
      })
      .where(eq(schema.transferItems.id, item.id))
  )
  // Passage sent SANS filtre de statut : le trigger transfers_expedie_fige /
  // transfers_termine_immuable fait échouer CE batch ENTIER en cas de course.
  const majStatut = db
    .update(schema.transfers)
    .set({
      status: "sent",
      sentBy: c.get("user").id,
      sentAt: maintenant,
      updatedAt: maintenant,
    })
    .where(eq(schema.transfers.id, transfert.id))

  const mouvements: MouvementStock[] = items.map((item) => ({
    warehouseId: transfert.fromWarehouseId,
    variantId: item.variantId,
    lotId: item.lotId,
    delta: -item.quantity,
    type: "transfer_out",
    refType: "transfer",
    refId: transfert.id,
  }))

  // Batch hétérogène construit directement (spread, pas de push + cast)
  const instructionsAvant: InstructionBatch[] = [...gelsCmp, majStatut]
  try {
    await applyMovements(db, {
      organizationId,
      userId: c.get("user").id,
      mouvements,
      instructionsAvant,
      date: maintenant,
    })
  } catch (err) {
    if (err instanceof ErreurStockInsuffisant) {
      return reponseStockInsuffisant(c, db, err)
    }
    if (
      estErreurDeclencheur(err, "TRANSFERT_EXPEDIE") ||
      estErreurDeclencheur(err, "TRANSFERT_TERMINE")
    ) {
      return c.json(
        {
          code: "STATUT_INVALIDE",
          message: "Ce transfert a déjà été expédié ou annulé",
        },
        409
      )
    }
    throw err
  }
  return c.json({ ok: true })
})

transfersRoute.post("/:id/receive", async (c) => {
  // Corps OPTIONNEL (lignes absentes = tout est reçu) : validerCorps exige un
  // JSON, on parse donc tolérant ici — un POST sans corps vaut {}.
  const brut: unknown = await c.req.json().catch(() => ({}))
  const parsed = transferReceiveSchema.safeParse(brut)
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
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const transfert = await transfertScope(db, organizationId, c.req.param("id"))
  if (!transfert) {
    return c.json(
      { code: "INTROUVABLE", message: "Transfert introuvable" },
      404
    )
  }
  // Réception = rôle sur la DESTINATION (décision de phase)
  const refus = await verifierAccesEntrepot(c, transfert.toWarehouseId, [
    "manager",
  ])
  if (refus) return refus
  if (transfert.status !== "sent") {
    return c.json(
      {
        code: "STATUT_INVALIDE",
        message: "Seul un transfert expédié peut être réceptionné",
      },
      409
    )
  }
  const items = await db
    .select()
    .from(schema.transferItems)
    .where(eq(schema.transferItems.transferId, transfert.id))

  // Défensif : un transfert 'sent' ne devrait plus jamais porter de ligne à
  // unit_cost NULL — le trigger transfers_send_lignes_gelees (0008) garantit
  // ce gel à l'expédition. Si ça arrive quand même (anomalie de données),
  // on refuse plutôt que de valoriser silencieusement à 0 (`?? 0`), ce qui
  // créerait un transfer_in jamais sorti de l'origine.
  const ligneSansCout = items.find((i) => i.unitCost === null)
  if (ligneSansCout) {
    return c.json(
      {
        code: "ERREUR_INTERNE",
        message:
          "Une ligne de ce transfert n'a pas de coût figé ; la réception est bloquée pour éviter une valorisation incorrecte",
      },
      500
    )
  }

  const recus = new Map<string, number>()
  for (const saisie of parsed.data.items ?? []) {
    const item = items.find((i) => i.id === saisie.itemId)
    if (!item) {
      return c.json({ code: "INTROUVABLE", message: "Ligne introuvable" }, 404)
    }
    if (saisie.receivedQuantity > item.quantity) {
      return c.json(
        {
          code: "QUANTITE_RECUE_INVALIDE",
          message: `La quantité reçue (${saisie.receivedQuantity}) dépasse la quantité expédiée (${item.quantity})`,
        },
        400
      )
    }
    recus.set(saisie.itemId, saisie.receivedQuantity)
  }

  const maintenant = new Date()
  // Ordre du batch : lignes d'abord (le trigger transfer_items_expedie_update
  // n'autorise QUE received_quantity tant que le parent est 'sent'), puis le
  // passage received SANS filtre — une double réception concurrente échoue
  // sur l'une OU l'autre instruction et le batch entier est annulé.
  const majLignes = items.map((item) =>
    db
      .update(schema.transferItems)
      .set({ receivedQuantity: recus.get(item.id) ?? item.quantity })
      .where(eq(schema.transferItems.id, item.id))
  )
  const majStatut = db
    .update(schema.transfers)
    .set({
      status: "received",
      receivedBy: c.get("user").id,
      receivedAt: maintenant,
      updatedAt: maintenant,
    })
    .where(eq(schema.transfers.id, transfert.id))

  // Décision de phase (documentée en tête de plan) : l'entrée à destination
  // porte la quantité EXPÉDIÉE totale, valorisée au CMP d'origine figé
  // (unit_cost, non-null après expédition) ; l'écart éventuel ressort en
  // adjustment négatif dans le MÊME batch. Net = quantité reçue, la perte
  // est journalisée et valorisée au CMP de destination après absorption
  // (biais assumé : la perte absorbe sa part de valeur).
  const mouvements: MouvementStock[] = items.flatMap((item) => {
    const recu = recus.get(item.id) ?? item.quantity
    const entree: MouvementStock = {
      warehouseId: transfert.toWarehouseId,
      variantId: item.variantId,
      lotId: item.lotId,
      delta: item.quantity,
      type: "transfer_in",
      refType: "transfer",
      refId: transfert.id,
      // `?? 0` ici est purement pour le typage (`unitCost: number | null`) :
      // la garde ligneSansCout ci-dessus a déjà exclu tout NULL réel.
      unitCost: item.unitCost ?? 0,
    }
    if (recu === item.quantity) {
      return [entree]
    }
    const ecart: MouvementStock = {
      warehouseId: transfert.toWarehouseId,
      variantId: item.variantId,
      lotId: item.lotId,
      delta: recu - item.quantity,
      type: "adjustment",
      reason: `Écart de réception du transfert (${item.quantity} expédié, ${recu} reçu)`,
      refType: "transfer",
      refId: transfert.id,
    }
    return [entree, ecart]
  })

  const instructionsAvant: InstructionBatch[] = [...majLignes, majStatut]
  try {
    await applyMovements(db, {
      organizationId,
      userId: c.get("user").id,
      mouvements,
      instructionsAvant,
      date: maintenant,
    })
  } catch (err) {
    if (
      estErreurDeclencheur(err, "TRANSFERT_TERMINE") ||
      estErreurDeclencheur(err, "TRANSFERT_EXPEDIE")
    ) {
      return c.json(
        {
          code: "STATUT_INVALIDE",
          message: "Ce transfert a déjà été réceptionné ou annulé",
        },
        409
      )
    }
    throw err
  }
  return c.json({ ok: true })
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
