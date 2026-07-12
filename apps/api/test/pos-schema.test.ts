import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { and, eq } from "drizzle-orm"
import * as schema from "../src/db/schema"
import { estErreurDeclencheur, estViolationUnicite } from "../src/lib/db-errors"
import { applyMovements } from "../src/services/stock"
import { bootstrapOwner, creerEntrepot, creerProduitSimple } from "./helpers"

async function erreurDe(promesse: Promise<unknown>): Promise<unknown> {
  try {
    await promesse
  } catch (err) {
    return err
  }
  throw new Error("l'instruction aurait dû échouer")
}

async function seedSession(status: "open" | "closed" = "open") {
  const { organizationId, ownerId } = await bootstrapOwner()
  const storeId = await creerEntrepot(organizationId, "Boutique S5", "store")
  const db = drizzle(env.DB, { schema })
  const sessionId = crypto.randomUUID()
  const maintenant = new Date()
  await db.insert(schema.registerSessions).values({
    id: sessionId,
    organizationId,
    storeId,
    cashierId: ownerId,
    status,
    openingFloat: 5000,
    openedAt: maintenant,
    ...(status === "closed"
      ? {
          closedAt: maintenant,
          countedAmount: 5000,
          expectedCash: 5000,
          difference: 0,
        }
      : {}),
    createdAt: maintenant,
    updatedAt: maintenant,
  })
  return { organizationId, ownerId, storeId, sessionId, db, maintenant }
}

async function seedVente() {
  const seeded = await seedSession("open")
  const saleId = crypto.randomUUID()
  await seeded.db.insert(schema.sales).values({
    id: saleId,
    organizationId: seeded.organizationId,
    storeId: seeded.storeId,
    registerSessionId: seeded.sessionId,
    cashierId: seeded.ownerId,
    ticketNumber: 1,
    total: 1000,
    currency: "XOF",
    clientRequestId: crypto.randomUUID(),
    createdAt: seeded.maintenant,
  })
  return { ...seeded, saleId }
}

describe("invariants du schéma POS", () => {
  it("une vente ne modifie JAMAIS le CMP (sale hors apports valorisés)", async () => {
    const { organizationId, ownerId } = await bootstrapOwner()
    const warehouseId = await creerEntrepot(organizationId, "CMP vente")
    const { variantId } = await creerProduitSimple(organizationId)
    const db = drizzle(env.DB, { schema })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId, variantId, delta: 10, type: "purchase", unitCost: 100 },
      ],
    })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [{ warehouseId, variantId, delta: -3, type: "sale" }],
    })
    const niveaux = await db
      .select({
        quantity: schema.stockLevels.quantity,
        avgCost: schema.stockLevels.avgCost,
      })
      .from(schema.stockLevels)
      .where(
        and(
          eq(schema.stockLevels.warehouseId, warehouseId),
          eq(schema.stockLevels.variantId, variantId)
        )
      )
    expect(niveaux[0]).toEqual({ quantity: 7, avgCost: 100 })
  })

  it("LOT_INSUFFISANT : un mouvement négatif ne peut pas rendre un lot négatif — rollback complet", async () => {
    const { organizationId, ownerId } = await bootstrapOwner()
    const warehouseId = await creerEntrepot(organizationId, "FEFO garde")
    const { variantId } = await creerProduitSimple(organizationId, {
      trackLots: true,
    })
    const db = drizzle(env.DB, { schema })
    const lotId = crypto.randomUUID()
    await db.insert(schema.lots).values({
      id: lotId,
      organizationId,
      variantId,
      lotNumber: "LOT-A",
      expiryDate: new Date("2026-12-31"),
      createdAt: new Date(),
    })
    // 3 en lot A + 5 SANS lot : total 8
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId,
          variantId,
          lotId,
          delta: 3,
          type: "purchase",
          unitCost: 100,
        },
        { warehouseId, variantId, delta: 5, type: "purchase", unitCost: 100 },
      ],
    })
    // Vendre 5 SUR LE LOT A (3 disponibles) : le total (8) passerait, mais
    // le trigger par lot doit tuer le batch ENTIER.
    const err = await erreurDe(
      applyMovements(db, {
        organizationId,
        userId: ownerId,
        mouvements: [
          { warehouseId, variantId, lotId, delta: -5, type: "sale" },
        ],
      })
    )
    expect(estErreurDeclencheur(err, "LOT_INSUFFISANT")).toBe(true)
    // Rollback complet : le niveau n'a pas bougé
    const niveaux = await db
      .select({ quantity: schema.stockLevels.quantity })
      .from(schema.stockLevels)
      .where(
        and(
          eq(schema.stockLevels.warehouseId, warehouseId),
          eq(schema.stockLevels.variantId, variantId)
        )
      )
    expect(niveaux[0].quantity).toBe(8)
  })

  it("une vente est immuable (UPDATE et DELETE interdits, lignes et paiements compris)", async () => {
    const { db, saleId, organizationId, maintenant } = await seedVente()
    const errUpdate = await erreurDe(
      db
        .update(schema.sales)
        .set({ total: 999 })
        .where(eq(schema.sales.id, saleId))
    )
    expect(estErreurDeclencheur(errUpdate, "VENTE_IMMUABLE")).toBe(true)
    const errDelete = await erreurDe(
      db.delete(schema.sales).where(eq(schema.sales.id, saleId))
    )
    expect(estErreurDeclencheur(errDelete, "VENTE_IMMUABLE")).toBe(true)
    // Paiement inséré (l'INSERT est permis : il arrive dans le batch de
    // création), puis UPDATE/DELETE interdits
    const paymentId = crypto.randomUUID()
    await db.insert(schema.payments).values({
      id: paymentId,
      organizationId,
      saleId,
      method: "cash",
      amount: 1000,
      createdAt: maintenant,
    })
    const errPaiement = await erreurDe(
      db
        .update(schema.payments)
        .set({ amount: 1 })
        .where(eq(schema.payments.id, paymentId))
    )
    expect(estErreurDeclencheur(errPaiement, "VENTE_IMMUABLE")).toBe(true)
  })

  it("une session fermée est immuable (double fermeture tuée en base)", async () => {
    const { db, sessionId } = await seedSession("closed")
    const err = await erreurDe(
      db
        .update(schema.registerSessions)
        .set({ countedAmount: 1 })
        .where(eq(schema.registerSessions.id, sessionId))
    )
    expect(estErreurDeclencheur(err, "SESSION_FERMEE")).toBe(true)
  })

  it("une vente ne peut pas référencer une session non ouverte", async () => {
    const { db, sessionId, organizationId, storeId, ownerId, maintenant } =
      await seedSession("closed")
    const err = await erreurDe(
      db.insert(schema.sales).values({
        id: crypto.randomUUID(),
        organizationId,
        storeId,
        registerSessionId: sessionId,
        cashierId: ownerId,
        ticketNumber: 1,
        total: 100,
        currency: "XOF",
        clientRequestId: crypto.randomUUID(),
        createdAt: maintenant,
      })
    )
    expect(estErreurDeclencheur(err, "SESSION_FERMEE")).toBe(true)
  })

  it("une seule session ouverte par (boutique, caissier) — index partiel", async () => {
    const { db, organizationId, storeId, ownerId, maintenant } =
      await seedSession("open")
    const err = await erreurDe(
      db.insert(schema.registerSessions).values({
        id: crypto.randomUUID(),
        organizationId,
        storeId,
        cashierId: ownerId,
        openingFloat: 0,
        openedAt: maintenant,
        createdAt: maintenant,
        updatedAt: maintenant,
      })
    )
    expect(estViolationUnicite(err, "register_sessions.store_id")).toBe(true)
  })

  it("client_request_id unique par organisation — idempotence en base", async () => {
    const { db, organizationId, storeId, sessionId, ownerId, maintenant } =
      await seedSession("open")
    const clientRequestId = crypto.randomUUID()
    const valeurs = {
      organizationId,
      storeId,
      registerSessionId: sessionId,
      cashierId: ownerId,
      total: 100,
      currency: "XOF",
      clientRequestId,
      createdAt: maintenant,
    }
    await db.insert(schema.sales).values({
      id: crypto.randomUUID(),
      ticketNumber: 1,
      ...valeurs,
    })
    const err = await erreurDe(
      db.insert(schema.sales).values({
        id: crypto.randomUUID(),
        ticketNumber: 2,
        ...valeurs,
      })
    )
    expect(estViolationUnicite(err, "sales.client_request_id")).toBe(true)
  })
})
