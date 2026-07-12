import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import { saleCreateSchema } from "shared"
import * as schema from "../db/schema"
import { validerCorps } from "../lib/validation"
import { estErreurDeclencheur, estViolationUnicite } from "../lib/db-errors"
import {
  boutiqueScope,
  REPONSE_NON_BOUTIQUE,
  verifierAccesVente,
} from "../lib/pos-acces"
import { allouerFefo, lireLotsDisponibles } from "../services/fefo"
import { applyMovements, ErreurStockInsuffisant } from "../services/stock"
import type { InstructionBatch, MouvementStock } from "../services/stock"
import { reponseStockInsuffisant } from "../lib/stock-erreurs"
import { requireAuth } from "../middleware/require-auth"
import { requireMembership } from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import type { Env } from "../env"

export const salesRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

salesRoute.use(requireAuth, requireMembership)

type Db = DrizzleD1Database<typeof schema>

// Devise de l'organisation (metadata Better Auth), défaut XOF — figée sur la
// vente (décision 9).
async function lireDevise(db: Db, organizationId: string): Promise<string> {
  const rows = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1)
  try {
    const meta = rows[0]?.metadata
      ? (JSON.parse(rows[0].metadata) as { currency?: string })
      : {}
    return meta.currency ?? "XOF"
  } catch {
    return "XOF"
  }
}

// Session OUVERTE du caissier courant sur la boutique — motif
// boutiqueScope/sessionScope (retour annoté `| null`, cf. venteEnTete).
async function sessionCouranteDuCaissier(
  db: Db,
  storeId: string,
  userId: string
): Promise<{ id: string } | null> {
  const sessions = await db
    .select({ id: schema.registerSessions.id })
    .from(schema.registerSessions)
    .where(
      and(
        eq(schema.registerSessions.storeId, storeId),
        eq(schema.registerSessions.cashierId, userId),
        eq(schema.registerSessions.status, "open")
      )
    )
    .limit(1)
  return sessions[0] ?? null
}

export type VenteDetail = {
  id: string
  ticketNumber: number
  total: number
  currency: string
  status: string
  createdAt: Date
  storeId: string
  storeName: string
  cashierName: string
  items: Array<{
    id: string
    variantId: string
    productName: string
    variantName: string
    sku: string
    quantity: number
    unitPrice: number
    catalogPrice: number
    sourceWarehouseId: string
    sourceWarehouseName: string
    lotNumber: string | null
  }>
  payments: Array<{
    method: string
    amount: number
    reference: string | null
    receivedAmount: number | null
    changeGiven: number | null
  }>
}

// Retour annoté `| null` (piège eslint no-unnecessary-condition — motif
// boutiqueScope/sessionScope) : isolée dans sa propre fonction pour que le
// `if (!vente)` de l'appelant reste significatif (noUncheckedIndexedAccess
// est désactivé, `rows[0]` seul serait vu non-optionnel par TS).
async function venteEnTete(
  db: Db,
  organizationId: string,
  saleId: string
): Promise<{
  id: string
  ticketNumber: number
  total: number
  currency: string
  status: string
  createdAt: Date
  storeId: string
  storeName: string
  cashierName: string
} | null> {
  const ventes = await db
    .select({
      id: schema.sales.id,
      ticketNumber: schema.sales.ticketNumber,
      total: schema.sales.total,
      currency: schema.sales.currency,
      status: schema.sales.status,
      createdAt: schema.sales.createdAt,
      storeId: schema.sales.storeId,
      storeName: schema.warehouses.name,
      cashierName: schema.user.name,
    })
    .from(schema.sales)
    .innerJoin(
      schema.warehouses,
      eq(schema.sales.storeId, schema.warehouses.id)
    )
    .innerJoin(schema.user, eq(schema.sales.cashierId, schema.user.id))
    .where(
      and(
        eq(schema.sales.id, saleId),
        eq(schema.sales.organizationId, organizationId)
      )
    )
    .limit(1)
  return ventes[0] ?? null
}

// Vente complète pour le ticket (POST, GET /:id, réimpression).
export async function chargerVente(
  db: Db,
  organizationId: string,
  saleId: string
): Promise<VenteDetail | null> {
  const vente = await venteEnTete(db, organizationId, saleId)
  if (!vente) return null
  const source = alias(schema.warehouses, "source")
  const items = await db
    .select({
      id: schema.saleItems.id,
      variantId: schema.saleItems.variantId,
      productName: schema.products.name,
      variantName: schema.productVariants.name,
      sku: schema.productVariants.sku,
      quantity: schema.saleItems.quantity,
      unitPrice: schema.saleItems.unitPrice,
      catalogPrice: schema.saleItems.catalogPrice,
      sourceWarehouseId: schema.saleItems.sourceWarehouseId,
      sourceWarehouseName: source.name,
      lotNumber: schema.lots.lotNumber,
    })
    .from(schema.saleItems)
    .innerJoin(
      schema.productVariants,
      eq(schema.saleItems.variantId, schema.productVariants.id)
    )
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id)
    )
    .innerJoin(source, eq(schema.saleItems.sourceWarehouseId, source.id))
    .leftJoin(schema.lots, eq(schema.saleItems.lotId, schema.lots.id))
    .where(eq(schema.saleItems.saleId, vente.id))
    .orderBy(asc(schema.products.name), asc(schema.productVariants.name))
  const paiements = await db
    .select({
      method: schema.payments.method,
      amount: schema.payments.amount,
      reference: schema.payments.reference,
      receivedAmount: schema.payments.receivedAmount,
      changeGiven: schema.payments.changeGiven,
    })
    .from(schema.payments)
    .where(eq(schema.payments.saleId, vente.id))
  return { ...vente, items, payments: paiements }
}

salesRoute.post("/", async (c) => {
  const corps = await validerCorps(c, saleCreateSchema)
  if (!corps.ok) return corps.reponse
  const { storeId, clientRequestId, items, payments: paiements } = corps.data
  const { organizationId } = c.get("membership")
  const userId = c.get("user").id
  const db = drizzle(c.env.DB, { schema })

  const refus = await verifierAccesVente(c, storeId)
  if (refus) return refus
  const boutique = await boutiqueScope(db, organizationId, storeId)
  if (!boutique || boutique.type !== "store") {
    return c.json(REPONSE_NON_BOUTIQUE, 400)
  }
  if (!boutique.isActive) {
    return c.json(
      { code: "VALIDATION", message: "Cette boutique est désactivée" },
      400
    )
  }

  // Session du CAISSIER COURANT, résolue côté serveur (décision 6). Le
  // trigger sales_session_ouverte re-vérifie EN transaction (course
  // fermeture/vente).
  const session = await sessionCouranteDuCaissier(db, storeId, userId)
  if (!session) {
    return c.json(
      {
        code: "SESSION_CAISSE_REQUISE",
        message: "Ouvrez une session de caisse avant de vendre",
      },
      409
    )
  }

  // Articles : prix/plancher effectifs, suivi de lots, activité
  const variantIds = [...new Set(items.map((i) => i.variantId))]
  const articles = await db
    .select({
      variantId: schema.productVariants.id,
      variantActive: schema.productVariants.isActive,
      priceOverride: schema.productVariants.priceOverride,
      minPriceOverride: schema.productVariants.minPriceOverride,
      productActive: schema.products.isActive,
      price: schema.products.price,
      minPrice: schema.products.minPrice,
      trackLots: schema.products.trackLots,
    })
    .from(schema.productVariants)
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id)
    )
    .where(
      and(
        inArray(schema.productVariants.id, variantIds),
        eq(schema.productVariants.organizationId, organizationId)
      )
    )
  const parVariante = new Map(articles.map((a) => [a.variantId, a]))
  for (const item of items) {
    const article = parVariante.get(item.variantId)
    if (!article) {
      return c.json(
        { code: "INTROUVABLE", message: "Article introuvable" },
        404
      )
    }
    if (!article.variantActive || !article.productActive) {
      return c.json(
        {
          code: "ARTICLE_INACTIF",
          message: "Un article du panier n'est plus en vente",
          details: [{ variantId: item.variantId }],
        },
        400
      )
    }
  }

  // Dépannage (décision 7) : les entrepôts source hors boutique doivent
  // exister dans l'organisation et être actifs.
  const sourcesAutres = [
    ...new Set(items.map((i) => i.sourceWarehouseId ?? storeId)),
  ].filter((id) => id !== storeId)
  if (sourcesAutres.length > 0) {
    const entrepots = await db
      .select({
        id: schema.warehouses.id,
        isActive: schema.warehouses.isActive,
      })
      .from(schema.warehouses)
      .where(
        and(
          inArray(schema.warehouses.id, sourcesAutres),
          eq(schema.warehouses.organizationId, organizationId)
        )
      )
    for (const sourceId of sourcesAutres) {
      const entrepot = entrepots.find((e) => e.id === sourceId)
      if (!entrepot) {
        return c.json(
          { code: "INTROUVABLE", message: "Entrepôt source introuvable" },
          404
        )
      }
      if (!entrepot.isActive) {
        return c.json(
          { code: "VALIDATION", message: "Entrepôt source désactivé" },
          400
        )
      }
    }
  }

  // Prix bornés (décision 8) : plancher effectif = surcharge variante sinon
  // produit ; sans plancher, prix catalogue non modifiable.
  for (const item of items) {
    const article = parVariante.get(item.variantId)
    if (!article) continue
    const prixCatalogue = article.priceOverride ?? article.price
    const plancher = article.minPriceOverride ?? article.minPrice
    if (plancher !== null) {
      if (item.unitPrice < plancher) {
        return c.json(
          {
            code: "PRIX_SOUS_PLANCHER",
            message: `Le prix convenu est sous le prix plancher (minimum ${plancher})`,
            details: [{ variantId: item.variantId, minimum: plancher }],
          },
          400
        )
      }
    } else if (item.unitPrice !== prixCatalogue) {
      return c.json(
        {
          code: "PRIX_NON_MODIFIABLE",
          message: "Le prix de cet article n'est pas négociable",
          details: [{ variantId: item.variantId, prixCatalogue }],
        },
        400
      )
    }
  }

  const total = items.reduce((somme, i) => somme + i.quantity * i.unitPrice, 0)
  // Défense en profondeur : le refine Zod garantit déjà l'égalité — un
  // client contourné ne doit pas passer.
  if (paiements.reduce((somme, p) => somme + p.amount, 0) !== total) {
    return c.json(
      {
        code: "PAIEMENT_INCOMPLET",
        message: "La somme des paiements doit égaler le total de la vente",
      },
      400
    )
  }
  const devise = await lireDevise(db, organizationId)

  // Construit et exécute LE batch de vente. Rappelée UNE fois si le lot
  // choisi a été vidé par une caisse concurrente (LOT_INSUFFISANT) : la
  // réallocation FEFO relit le journal (décision 1).
  const tenterVente = async (): Promise<string> => {
    const saleId = crypto.randomUUID()
    const maintenant = new Date()
    const mouvements: MouvementStock[] = []
    const lignes: Array<typeof schema.saleItems.$inferInsert> = []
    for (const item of items) {
      const article = parVariante.get(item.variantId)
      if (!article) throw new Error("article non résolu")
      const sourceId = item.sourceWarehouseId ?? storeId
      const prixCatalogue = article.priceOverride ?? article.price
      let lotLigne: string | null = null
      if (article.trackLots) {
        // FEFO dans l'entrepôt SOURCE (dépannage compris)
        const lots = await lireLotsDisponibles(db, sourceId, item.variantId)
        const allocations = allouerFefo(lots, item.quantity)
        if (allocations.length === 1 && allocations[0].lotId !== null) {
          lotLigne = allocations[0].lotId
        }
        for (const allocation of allocations) {
          mouvements.push({
            warehouseId: sourceId,
            variantId: item.variantId,
            lotId: allocation.lotId,
            delta: -allocation.quantite,
            type: "sale",
            refType: "sale",
            refId: saleId,
          })
        }
      } else {
        mouvements.push({
          warehouseId: sourceId,
          variantId: item.variantId,
          delta: -item.quantity,
          type: "sale",
          refType: "sale",
          refId: saleId,
        })
      }
      lignes.push({
        id: crypto.randomUUID(),
        organizationId,
        saleId,
        variantId: item.variantId,
        lotId: lotLigne,
        sourceWarehouseId: sourceId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        catalogPrice: prixCatalogue,
        createdAt: maintenant,
      })
    }
    // Numéro de ticket séquentiel PAR BOUTIQUE : sous-requête MAX+1 évaluée
    // DANS la transaction du batch (mono-écrivain SQLite — décision 4).
    // JAMAIS de lecture JS puis écriture.
    const insertVente = db.insert(schema.sales).values({
      id: saleId,
      organizationId,
      storeId,
      registerSessionId: session.id,
      cashierId: userId,
      ticketNumber: sql`(SELECT COALESCE(MAX(ticket_number), 0) + 1
        FROM sales WHERE store_id = ${storeId})`,
      total,
      currency: devise,
      clientRequestId,
      createdAt: maintenant,
    })
    const insertLignes = lignes.map((ligne) =>
      db.insert(schema.saleItems).values(ligne)
    )
    const insertPaiements = paiements.map((p) =>
      db.insert(schema.payments).values({
        id: crypto.randomUUID(),
        organizationId,
        saleId,
        method: p.method,
        amount: p.amount,
        reference: p.reference ?? null,
        receivedAmount: p.method === "cash" ? (p.receivedAmount ?? null) : null,
        changeGiven:
          p.method === "cash" && p.receivedAmount !== undefined
            ? p.receivedAmount - p.amount
            : null,
        createdAt: maintenant,
      })
    )
    // Batch hétérogène construit directement (spread, pas de push + cast).
    // TOUT part dans UN db.batch via applyMovements : vente + lignes +
    // paiements + mouvements + niveaux réussissent ou échouent ENSEMBLE.
    const instructionsAvant: InstructionBatch[] = [
      insertVente,
      ...insertLignes,
      ...insertPaiements,
    ]
    await applyMovements(db, {
      organizationId,
      userId,
      mouvements,
      instructionsAvant,
      date: maintenant,
    })
    return saleId
  }

  // Idempotence (décision 5) : la violation de sales_org_request_uidx
  // signifie « cette vente est DÉJÀ enregistrée » — un retry réseau renvoie
  // la vente existante, jamais un doublon.
  const reponseIdempotente = async (): Promise<Response | null> => {
    const existantes = await db
      .select({ id: schema.sales.id })
      .from(schema.sales)
      .where(
        and(
          eq(schema.sales.organizationId, organizationId),
          eq(schema.sales.clientRequestId, clientRequestId)
        )
      )
      .limit(1)
    if (!existantes[0]) return null
    const sale = await chargerVente(db, organizationId, existantes[0].id)
    return c.json({ sale, dejaEnregistree: true }, 200)
  }
  const mapErreur = async (err: unknown): Promise<Response | null> => {
    if (estViolationUnicite(err, "sales.client_request_id")) {
      return reponseIdempotente()
    }
    if (err instanceof ErreurStockInsuffisant) {
      return reponseStockInsuffisant(c, db, err)
    }
    if (estErreurDeclencheur(err, "SESSION_FERMEE")) {
      return c.json(
        {
          code: "SESSION_CAISSE_REQUISE",
          message:
            "La session de caisse a été fermée, rouvrez la caisse avant de vendre",
        },
        409
      )
    }
    return null
  }
  const estConflitRejouable = (err: unknown): boolean =>
    estErreurDeclencheur(err, "LOT_INSUFFISANT") ||
    estViolationUnicite(err, "sales.ticket_number")

  let saleId: string
  try {
    saleId = await tenterVente()
  } catch (err) {
    const reponse = await mapErreur(err)
    if (reponse) return reponse
    if (!estConflitRejouable(err)) throw err
    try {
      saleId = await tenterVente()
    } catch (err2) {
      const reponse2 = await mapErreur(err2)
      if (reponse2) return reponse2
      if (estConflitRejouable(err2)) {
        return c.json(
          {
            code: "CONFLIT_CONCURRENT",
            message: "Vente simultanée détectée, veuillez réessayer",
          },
          409
        )
      }
      throw err2
    }
  }
  const sale = await chargerVente(db, organizationId, saleId)
  return c.json({ sale, dejaEnregistree: false }, 201)
})
