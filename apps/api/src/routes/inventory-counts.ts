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
  // Pré-check UX uniquement (évite d'ouvrir un document vide) : ce n'est PAS
  // la source du contenu figé, juste une lecture indicative. Le contenu
  // RÉEL provient de l'INSERT…SELECT ci-dessous, exécuté DANS le même batch
  // que le document — jamais de cette lecture, qui peut être périmée au
  // moment du batch si un mouvement de stock survient entre les deux.
  const presenceNiveaux = await db
    .select({ id: schema.stockLevels.id })
    .from(schema.stockLevels)
    .where(
      and(
        eq(schema.stockLevels.organizationId, organizationId),
        eq(schema.stockLevels.warehouseId, corps.data.warehouseId)
      )
    )
    .limit(1)
  if (presenceNiveaux.length === 0) {
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
  // `mode: "timestamp"` (integer, secondes) : même conversion que
  // SQLiteTimestamp.mapToDriverValue côté drizzle, appliquée ici à la main
  // car la colonne `created_at` du SELECT ci-dessous est une expression
  // `sql` brute (pas de `.values()` typé pour un INSERT…SELECT).
  const maintenantEpoch = Math.floor(maintenant.getTime() / 1000)
  const insertionDoc = db.insert(schema.inventoryCounts).values({
    id,
    organizationId,
    warehouseId: corps.data.warehouseId,
    openedBy: c.get("user").id,
    openedAt: maintenant,
    createdAt: maintenant,
    updatedAt: maintenant,
  })
  // Figeage RÉEL des quantités attendues : INSERT…SELECT exécuté dans le
  // MÊME batch que le document ci-dessus, donc sur l'état de stock_levels
  // au moment exact où le batch s'exécute — jamais une lecture JS
  // antérieure, qui raterait ou figerait périmé un mouvement de stock
  // survenu entre la lecture et l'écriture (même principe que le gel du
  // CMP à l'expédition dans transfers.ts et la réconciliation dans
  // services/stock.ts). `db.insert(...).select(...)` — et non un `db.run(sql
  // brut)` — car le batch D1 de drizzle 0.44 exige un query builder
  // préparable (`.stmt` interne) : un `SQLiteRaw` issu de `db.run()` n'en a
  // pas et fait planter `batch()` (vérifié empiriquement). Les clés/ordre du
  // `.select({...})` doivent correspondre EXACTEMENT aux colonnes de la
  // table cible (contrôlé par drizzle à la construction de la requête).
  // `lower(hex(randomblob(16)))` : générateur d'ID texte standard en SQL
  // pur — SQLite ne peut pas appeler crypto.randomUUID() côté moteur. Le
  // format (32 hex minuscules, sans tirets) diffère des UUID générés côté
  // JS ailleurs dans le dépôt, mais aucune contrainte de format n'existe
  // sur les colonnes `id` (texte, clé primaire uniquement) : un
  // identifiant texte unique convient.
  const insertionLignes = db.insert(schema.inventoryCountItems).select(
    db
      .select({
        // Expressions `sql` brutes : drizzle exige un alias explicite
        // (`.as(...)`) pour les référencer comme colonnes de résultat.
        id: sql<string>`lower(hex(randomblob(16)))`.as("id"),
        organizationId: schema.stockLevels.organizationId,
        countId: sql<string>`${id}`.as("count_id"),
        variantId: schema.stockLevels.variantId,
        expectedQuantity: schema.stockLevels.quantity,
        countedQuantity: sql<number | null>`NULL`.as("counted_quantity"),
        createdAt: sql<number>`${maintenantEpoch}`.as("created_at"),
      })
      .from(schema.stockLevels)
      .where(
        and(
          eq(schema.stockLevels.organizationId, organizationId),
          eq(schema.stockLevels.warehouseId, corps.data.warehouseId)
        )
      )
  )
  try {
    // Document + photographie des quantités dans UN batch atomique.
    await db.batch([insertionDoc, insertionLignes])
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
