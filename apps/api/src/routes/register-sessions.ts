import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, desc, eq, sql } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import { registerSessionOpenSchema, registerSessionCloseSchema } from "shared"
import * as schema from "../db/schema"
import { validerCorps } from "../lib/validation"
import { estErreurDeclencheur, estViolationUnicite } from "../lib/db-errors"
import {
  boutiqueScope,
  REPONSE_NON_BOUTIQUE,
  verifierAccesVente,
} from "../lib/pos-acces"
import { requireAuth } from "../middleware/require-auth"
import {
  requireMembership,
  verifierAccesEntrepot,
} from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import type { Env } from "../env"

export const registerSessionsRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

registerSessionsRoute.use(requireAuth, requireMembership)

type Db = DrizzleD1Database<typeof schema>

// Retour annoté `| null` (piège eslint no-unnecessary-condition)
async function sessionScope(
  db: Db,
  organizationId: string,
  id: string
): Promise<typeof schema.registerSessions.$inferSelect | null> {
  const rows = await db
    .select()
    .from(schema.registerSessions)
    .where(
      and(
        eq(schema.registerSessions.id, id),
        eq(schema.registerSessions.organizationId, organizationId)
      )
    )
    .limit(1)
  return rows[0] ?? null
}

const REPONSE_SESSION_FERMEE = {
  code: "SESSION_FERMEE",
  message: "Cette session de caisse est déjà fermée",
} as const

// Session ouverte du CAISSIER COURANT sur la boutique — la garde d'entrée du
// POS. Déclarée avant "/:id" (aucun conflit ici, mais convention du dépôt).
registerSessionsRoute.get("/current", async (c) => {
  const storeId = c.req.query("storeId")
  if (!storeId) {
    return c.json(
      { code: "VALIDATION", message: "Le paramètre storeId est requis" },
      400
    )
  }
  const refus = await verifierAccesVente(c, storeId)
  if (refus) return refus
  const db = drizzle(c.env.DB, { schema })
  const rows = await db
    .select({
      id: schema.registerSessions.id,
      openingFloat: schema.registerSessions.openingFloat,
      openedAt: schema.registerSessions.openedAt,
    })
    .from(schema.registerSessions)
    .where(
      and(
        eq(schema.registerSessions.storeId, storeId),
        eq(schema.registerSessions.cashierId, c.get("user").id),
        eq(schema.registerSessions.status, "open")
      )
    )
    .limit(1)
  return c.json({ session: rows[0] ?? null })
})

registerSessionsRoute.get("/", async (c) => {
  const { organizationId, role } = c.get("membership")
  const storeId = c.req.query("storeId")
  const statut = c.req.query("statut")
  if (!storeId) {
    return c.json(
      { code: "VALIDATION", message: "Le paramètre storeId est requis" },
      400
    )
  }
  if (
    statut &&
    !(schema.REGISTER_SESSION_STATUSES as readonly string[]).includes(statut)
  ) {
    return c.json({ code: "VALIDATION", message: "Statut invalide" }, 400)
  }
  const db = drizzle(c.env.DB, { schema })
  const boutique = await boutiqueScope(db, organizationId, storeId)
  if (!boutique) {
    return c.json({ code: "INTROUVABLE", message: "Boutique introuvable" }, 404)
  }
  // Lecture (spec §4, « Sessions de caisse ») : owner/admin/auditor voient
  // tout ; sinon rôle LOCAL requis — manager/auditor voient la boutique, un
  // caissier ne voit que LES SIENNES (décision 10 : la lecture des VENTES
  // est plus large, pas celle des sessions des collègues).
  const bypassLecture =
    role === "owner" || role === "admin" || role === "auditor"
  let seulementLesSiennes = false
  if (!bypassLecture) {
    const affectations = await db
      .select({ role: schema.warehouseMembers.role })
      .from(schema.warehouseMembers)
      .where(
        and(
          eq(schema.warehouseMembers.warehouseId, storeId),
          eq(schema.warehouseMembers.userId, c.get("user").id)
        )
      )
      .limit(1)
    if (!affectations[0]) {
      return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
    }
    seulementLesSiennes = affectations[0].role === "cashier"
  }
  const conditions: SQL[] = [
    eq(schema.registerSessions.organizationId, organizationId),
    eq(schema.registerSessions.storeId, storeId),
  ]
  if (statut) {
    conditions.push(
      eq(
        schema.registerSessions.status,
        statut as (typeof schema.REGISTER_SESSION_STATUSES)[number]
      )
    )
  }
  if (seulementLesSiennes) {
    conditions.push(eq(schema.registerSessions.cashierId, c.get("user").id))
  }
  const sessions = await db
    .select({
      id: schema.registerSessions.id,
      status: schema.registerSessions.status,
      cashierId: schema.registerSessions.cashierId,
      cashierName: schema.user.name,
      openingFloat: schema.registerSessions.openingFloat,
      countedAmount: schema.registerSessions.countedAmount,
      expectedCash: schema.registerSessions.expectedCash,
      difference: schema.registerSessions.difference,
      openedAt: schema.registerSessions.openedAt,
      closedAt: schema.registerSessions.closedAt,
    })
    .from(schema.registerSessions)
    .innerJoin(
      schema.user,
      eq(schema.registerSessions.cashierId, schema.user.id)
    )
    .where(and(...conditions))
    .orderBy(desc(schema.registerSessions.openedAt))
  return c.json({ sessions })
})

registerSessionsRoute.post("/", async (c) => {
  const corps = await validerCorps(c, registerSessionOpenSchema)
  if (!corps.ok) return corps.reponse
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const refus = await verifierAccesVente(c, corps.data.storeId)
  if (refus) return refus
  const boutique = await boutiqueScope(db, organizationId, corps.data.storeId)
  // verifierAccesVente a déjà garanti l'appartenance à l'organisation ;
  // reste le TYPE et l'activité.
  if (!boutique || boutique.type !== "store") {
    return c.json(REPONSE_NON_BOUTIQUE, 400)
  }
  if (!boutique.isActive) {
    return c.json(
      { code: "VALIDATION", message: "Cette boutique est désactivée" },
      400
    )
  }
  const id = crypto.randomUUID()
  const maintenant = new Date()
  try {
    await db.insert(schema.registerSessions).values({
      id,
      organizationId,
      storeId: corps.data.storeId,
      cashierId: c.get("user").id,
      openingFloat: corps.data.openingFloat,
      openedAt: maintenant,
      createdAt: maintenant,
      updatedAt: maintenant,
    })
  } catch (err) {
    // Course double-ouverture : l'index unique partiel
    // register_sessions_open_uidx (0014) tue la seconde. SQLite rapporte les
    // COLONNES de l'index.
    if (estViolationUnicite(err, "register_sessions.store_id")) {
      return c.json(
        {
          code: "SESSION_DEJA_OUVERTE",
          message:
            "Une session de caisse est déjà ouverte pour ce caissier dans cette boutique",
        },
        409
      )
    }
    throw err
  }
  return c.json({ id }, 201)
})

registerSessionsRoute.post("/:id/close", async (c) => {
  const corps = await validerCorps(c, registerSessionCloseSchema)
  if (!corps.ok) return corps.reponse
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const session = await sessionScope(db, organizationId, c.req.param("id"))
  if (!session) {
    return c.json({ code: "INTROUVABLE", message: "Session introuvable" }, 404)
  }
  // Le caissier ferme LA SIENNE ; sinon owner/admin ou manager local de la
  // boutique (spec §4) — un collègue caissier est refusé.
  if (session.cashierId !== c.get("user").id) {
    const refus = await verifierAccesEntrepot(
      c,
      session.storeId,
      ["manager"],
      ["owner", "admin"]
    )
    if (refus) return refus
  }
  if (session.status !== "open") {
    return c.json(REPONSE_SESSION_FERMEE, 409)
  }
  const maintenant = new Date()
  // Attendu figé PAR SOUS-REQUÊTE SQL au moment exact de la transaction
  // (jamais une somme lue en JS — pas de course avec une vente qui commite
  // entre la lecture et l'écriture ; le trigger sales_session_ouverte
  // interdit de toute façon toute vente APRÈS ce commit). UPDATE SANS filtre
  // de statut : une double fermeture concurrente meurt sur le trigger
  // register_sessions_fermee_immuable (0014), motif P4/P5.
  const attenduCash = sql`${schema.registerSessions.openingFloat} + (
    SELECT COALESCE(SUM(p.amount), 0)
    FROM payments p
    INNER JOIN sales s ON p.sale_id = s.id
    WHERE s.register_session_id = ${session.id} AND p.method = 'cash')`
  try {
    await db
      .update(schema.registerSessions)
      .set({
        status: "closed",
        countedAmount: corps.data.countedAmount,
        expectedCash: attenduCash,
        difference: sql`${corps.data.countedAmount} - (${attenduCash})`,
        closedBy: c.get("user").id,
        closedAt: maintenant,
        updatedAt: maintenant,
      })
      .where(eq(schema.registerSessions.id, session.id))
  } catch (err) {
    if (estErreurDeclencheur(err, "SESSION_FERMEE")) {
      return c.json(REPONSE_SESSION_FERMEE, 409)
    }
    throw err
  }
  const fermee = await sessionScope(db, organizationId, session.id)
  return c.json({
    session: {
      id: session.id,
      status: fermee?.status ?? "closed",
      openingFloat: session.openingFloat,
      countedAmount: fermee?.countedAmount ?? corps.data.countedAmount,
      expectedCash: fermee?.expectedCash ?? null,
      difference: fermee?.difference ?? null,
      openedAt: session.openedAt,
      closedAt: fermee?.closedAt ?? maintenant,
    },
  })
})
