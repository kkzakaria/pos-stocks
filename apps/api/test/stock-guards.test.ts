import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
import * as schema from "../src/db/schema"
import {
  estViolationCheck,
  estViolationUnicite,
  estErreurDeclencheur,
} from "../src/lib/db-errors"
import { bootstrapOwner, creerEntrepot, creerProduitSimple } from "./helpers"

describe("gardes du moteur de stock (migrations 0004/0005)", () => {
  it("CHECK : un niveau de stock négatif est rejeté", async () => {
    const { organizationId } = await bootstrapOwner()
    const warehouseId = await creerEntrepot(organizationId)
    const { variantId } = await creerProduitSimple(organizationId)
    const db = drizzle(env.DB, { schema })
    let erreur: unknown = null
    try {
      await db.insert(schema.stockLevels).values({
        id: crypto.randomUUID(),
        organizationId,
        warehouseId,
        variantId,
        quantity: -1,
        avgCost: 0,
        updatedAt: new Date(),
      })
    } catch (err) {
      erreur = err
    }
    expect(estViolationCheck(erreur)).toBe(true)
    // Fragment discriminant : la vraie violation matche son propre nom de
    // contrainte, mais pas le nom d'une contrainte différente — c'est ce qui
    // permet à stockService.applyMovements de ne classer en
    // ErreurStockInsuffisant QUE stock_levels_quantity_positive, même si
    // instructionsAvant fait échouer un autre CHECK dans le même batch.
    expect(estViolationCheck(erreur, "stock_levels_quantity_positive")).toBe(
      true
    )
    expect(estViolationCheck(erreur, "une_autre_contrainte")).toBe(false)
  })

  it("triggers : le journal refuse UPDATE et DELETE", async () => {
    const { organizationId, ownerId } = await bootstrapOwner()
    const warehouseId = await creerEntrepot(organizationId)
    const { variantId } = await creerProduitSimple(organizationId)
    const db = drizzle(env.DB, { schema })
    const movementId = crypto.randomUUID()
    await db.insert(schema.stockMovements).values({
      id: movementId,
      organizationId,
      warehouseId,
      variantId,
      delta: 5,
      type: "adjustment",
      reason: "seed",
      userId: ownerId,
      createdAt: new Date(),
    })

    let erreurUpdate: unknown = null
    try {
      await db
        .update(schema.stockMovements)
        .set({ delta: 999 })
        .where(eq(schema.stockMovements.id, movementId))
    } catch (err) {
      erreurUpdate = err
    }
    expect(estErreurDeclencheur(erreurUpdate, "JOURNAL_IMMUABLE")).toBe(true)

    let erreurDelete: unknown = null
    try {
      await db
        .delete(schema.stockMovements)
        .where(eq(schema.stockMovements.id, movementId))
    } catch (err) {
      erreurDelete = err
    }
    expect(estErreurDeclencheur(erreurDelete, "JOURNAL_IMMUABLE")).toBe(true)
  })

  it("index partiels : le même code-barres est refusé dans products, accepté après NULL", async () => {
    const { organizationId } = await bootstrapOwner()
    await creerProduitSimple(organizationId, { barcode: "6111000000001" })
    let erreur: unknown = null
    try {
      await creerProduitSimple(organizationId, { barcode: "6111000000001" })
    } catch (err) {
      erreur = err
    }
    expect(estViolationUnicite(erreur, "barcode")).toBe(true)
    // Plusieurs barcode NULL cohabitent (index partiel)
    await creerProduitSimple(organizationId, { barcode: null })
    await creerProduitSimple(organizationId, { barcode: null })
  })

  it("index unique lots_variant_lot_uidx : SQLite rapporte les COLONNES, pas le nom de l'index", async () => {
    const { organizationId } = await bootstrapOwner()
    const { variantId } = await creerProduitSimple(organizationId)
    const db = drizzle(env.DB, { schema })
    await db.insert(schema.lots).values({
      id: crypto.randomUUID(),
      organizationId,
      variantId,
      lotNumber: "LOT-1",
      expiryDate: null,
      createdAt: new Date(),
    })
    let erreur: unknown = null
    try {
      await db.insert(schema.lots).values({
        id: crypto.randomUUID(),
        organizationId,
        variantId,
        lotNumber: "LOT-1",
        expiryDate: null,
        createdAt: new Date(),
      })
    } catch (err) {
      erreur = err
    }
    expect(estViolationUnicite(erreur)).toBe(true)
    // Format réel du message SQLite : "UNIQUE constraint failed:
    // lots.variant_id, lots.lot_number" — les noms de colonnes qualifiés,
    // jamais le nom de l'index déclaré en migration.
    expect(estViolationUnicite(erreur, "lots.variant_id")).toBe(true)
    expect(estViolationUnicite(erreur, "lots_variant_lot_uidx")).toBe(false)
  })
})
