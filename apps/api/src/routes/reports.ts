import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, asc, eq, gte, lt, sql } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import * as schema from "../db/schema"
import { bornesPeriode } from "../lib/dates"
import { porteeRapport } from "../lib/reports-acces"
import { estDansPortee, filtrePortee } from "../lib/stock-acces"
import type { PorteeLectureStock } from "../lib/stock-acces"
import { genererCsv } from "../lib/csv"
import { requireAuth } from "../middleware/require-auth"
import { requireMembership } from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import type { Env } from "../env"

export const reportsRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

reportsRoute.use(requireAuth, requireMembership)

type Db = DrizzleD1Database<typeof schema>

const REPONSE_ACCES_REFUSE = {
  code: "ACCES_REFUSE",
  message: "Accès refusé",
} as const

const REPONSE_PERIODE_INVALIDE = {
  code: "VALIDATION",
  message:
    "Période invalide : paramètres du et au requis (AAAA-MM-JJ, du ≤ au)",
} as const

const ENTETES_CSV = {
  "content-type": "text/csv; charset=utf-8",
} as const

// Entrepôt explicitement demandé : doit exister dans l'organisation —
// contrat 404 cross-org (motif routes/stock.ts), appliqué APRÈS le contrôle
// de portée (403 prioritaire).
async function entrepotDansOrganisation(
  db: Db,
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

// Conditions communes des rapports assis sur les VENTES (sales, margins) :
// organisation + statut completed + bornes de période + portée/storeId.
async function conditionsVentes(
  db: Db,
  organizationId: string,
  portee: PorteeLectureStock,
  bornes: { debut: Date; finExclue: Date },
  storeId: string | undefined
): Promise<{ ok: true; conditions: SQL[] } | { ok: false; statut: 403 | 404 }> {
  const conditions: SQL[] = [
    eq(schema.sales.organizationId, organizationId),
    eq(schema.sales.status, "completed"),
    gte(schema.sales.createdAt, bornes.debut),
    lt(schema.sales.createdAt, bornes.finExclue),
  ]
  if (storeId) {
    if (!estDansPortee(portee, storeId)) {
      return { ok: false, statut: 403 }
    }
    if (!(await entrepotDansOrganisation(db, organizationId, storeId))) {
      return { ok: false, statut: 404 }
    }
    conditions.push(eq(schema.sales.storeId, storeId))
  } else {
    const filtre = filtrePortee(portee, schema.sales.storeId)
    // filtre.vide est impossible ici : porteeRapport rend null (403 amont)
    // quand la portée staff est vide.
    if (filtre.condition) {
      conditions.push(filtre.condition)
    }
  }
  return { ok: true, conditions }
}

function panierMoyen(ca: number, tickets: number): number {
  return tickets > 0 ? Math.round(ca / tickets) : 0
}

reportsRoute.get("/sales", async (c) => {
  const { organizationId, role } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const portee = await porteeRapport(
    db,
    organizationId,
    c.get("user").id,
    role,
    "ventes"
  )
  if (!portee) {
    return c.json(REPONSE_ACCES_REFUSE, 403)
  }
  const du = c.req.query("du")
  const au = c.req.query("au")
  const bornes = du && au ? bornesPeriode(du, au) : null
  if (!du || !au || !bornes) {
    return c.json(REPONSE_PERIODE_INVALIDE, 400)
  }
  const groupe = c.req.query("groupe") ?? "boutique"
  if (groupe !== "boutique" && groupe !== "produit") {
    return c.json(
      {
        code: "VALIDATION",
        message: "Le paramètre groupe doit être boutique ou produit",
      },
      400
    )
  }
  const resolution = await conditionsVentes(
    db,
    organizationId,
    portee,
    bornes,
    c.req.query("storeId")
  )
  if (!resolution.ok) {
    return resolution.statut === 403
      ? c.json(REPONSE_ACCES_REFUSE, 403)
      : c.json({ code: "INTROUVABLE", message: "Boutique introuvable" }, 404)
  }
  const { conditions } = resolution

  // Totaux globaux + répartition par méthode (toujours renvoyés — la
  // répartition n'existe qu'au niveau VENTE, table payments : elle n'a pas
  // de sens par produit).
  const totauxRows = await db
    .select({
      ca: sql<number>`COALESCE(SUM(${schema.sales.total}), 0)`,
      tickets: sql<number>`COUNT(*)`,
    })
    .from(schema.sales)
    .where(and(...conditions))
  const totaux = totauxRows[0] ?? { ca: 0, tickets: 0 }
  const parMethode = await db
    .select({
      method: schema.payments.method,
      montant: sql<number>`COALESCE(SUM(${schema.payments.amount}), 0)`,
    })
    .from(schema.payments)
    .innerJoin(schema.sales, eq(schema.payments.saleId, schema.sales.id))
    .where(and(...conditions))
    .groupBy(schema.payments.method)
  const montantMethode = (methode: "cash" | "mobile_money"): number =>
    parMethode.find((m) => m.method === methode)?.montant ?? 0
  const total = {
    ca: totaux.ca,
    tickets: totaux.tickets,
    panierMoyen: panierMoyen(totaux.ca, totaux.tickets),
    cash: montantMethode("cash"),
    mobileMoney: montantMethode("mobile_money"),
  }

  if (groupe === "produit") {
    const lignes = await db
      .select({
        productId: schema.products.id,
        productName: schema.products.name,
        variantId: schema.saleItems.variantId,
        variantName: schema.productVariants.name,
        sku: schema.productVariants.sku,
        quantite: sql<number>`COALESCE(SUM(${schema.saleItems.quantity}), 0)`,
        ca: sql<number>`COALESCE(SUM(${schema.saleItems.quantity} * ${schema.saleItems.unitPrice}), 0)`,
        remise: sql<number>`COALESCE(SUM(${schema.saleItems.quantity} * (${schema.saleItems.catalogPrice} - ${schema.saleItems.unitPrice})), 0)`,
        tickets: sql<number>`COUNT(DISTINCT ${schema.saleItems.saleId})`,
      })
      .from(schema.saleItems)
      .innerJoin(schema.sales, eq(schema.saleItems.saleId, schema.sales.id))
      .innerJoin(
        schema.productVariants,
        eq(schema.saleItems.variantId, schema.productVariants.id)
      )
      .innerJoin(
        schema.products,
        eq(schema.productVariants.productId, schema.products.id)
      )
      .where(and(...conditions))
      .groupBy(schema.saleItems.variantId)
      .orderBy(asc(schema.products.name), asc(schema.productVariants.name))
    if (c.req.query("format") === "csv") {
      const contenu = genererCsv(
        ["Produit", "Variante", "SKU", "Quantité", "CA", "Remises", "Tickets"],
        lignes.map((l) => [
          l.productName,
          l.variantName,
          l.sku,
          l.quantite,
          l.ca,
          l.remise,
          l.tickets,
        ])
      )
      return c.body(contenu, 200, {
        ...ENTETES_CSV,
        "content-disposition": `attachment; filename="rapport-ventes-produits_${du}_${au}.csv"`,
      })
    }
    return c.json({ periode: { du, au }, groupe, total, lignes })
  }

  const boutiques = await db
    .select({
      storeId: schema.sales.storeId,
      storeName: schema.warehouses.name,
      ca: sql<number>`COALESCE(SUM(${schema.sales.total}), 0)`,
      tickets: sql<number>`COUNT(*)`,
    })
    .from(schema.sales)
    .innerJoin(
      schema.warehouses,
      eq(schema.sales.storeId, schema.warehouses.id)
    )
    .where(and(...conditions))
    .groupBy(schema.sales.storeId)
    .orderBy(asc(schema.warehouses.name))
  const paiementsBoutique = await db
    .select({
      storeId: schema.sales.storeId,
      method: schema.payments.method,
      montant: sql<number>`COALESCE(SUM(${schema.payments.amount}), 0)`,
    })
    .from(schema.payments)
    .innerJoin(schema.sales, eq(schema.payments.saleId, schema.sales.id))
    .where(and(...conditions))
    .groupBy(schema.sales.storeId, schema.payments.method)
  const methodeBoutique = (id: string, methode: string): number =>
    paiementsBoutique.find((p) => p.storeId === id && p.method === methode)
      ?.montant ?? 0
  const lignes = boutiques.map((b) => ({
    ...b,
    panierMoyen: panierMoyen(b.ca, b.tickets),
    cash: methodeBoutique(b.storeId, "cash"),
    mobileMoney: methodeBoutique(b.storeId, "mobile_money"),
  }))
  if (c.req.query("format") === "csv") {
    const contenu = genererCsv(
      ["Boutique", "CA", "Tickets", "Panier moyen", "Espèces", "Mobile money"],
      lignes.map((l) => [
        l.storeName,
        l.ca,
        l.tickets,
        l.panierMoyen,
        l.cash,
        l.mobileMoney,
      ])
    )
    return c.body(contenu, 200, {
      ...ENTETES_CSV,
      "content-disposition": `attachment; filename="rapport-ventes-boutiques_${du}_${au}.csv"`,
    })
  }
  return c.json({ periode: { du, au }, groupe, total, lignes })
})
