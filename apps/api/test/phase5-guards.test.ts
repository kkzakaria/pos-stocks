import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
import * as schema from "../src/db/schema"
import { estErreurDeclencheur, estViolationUnicite } from "../src/lib/db-errors"
import { bootstrapOwner, creerEntrepot, creerProduitSimple } from "./helpers"

async function erreurDe(promesse: Promise<unknown>): Promise<unknown> {
  try {
    await promesse
  } catch (err) {
    return err
  }
  throw new Error("l'instruction aurait dû échouer")
}

type Seed = {
  organizationId: string
  ownerId: string
  origineId: string
  destinationId: string
  variantId: string
}

async function seed(): Promise<Seed> {
  const { organizationId, ownerId } = await bootstrapOwner()
  const origineId = await creerEntrepot(organizationId, "Origine")
  const destinationId = await creerEntrepot(organizationId, "Destination")
  const { variantId } = await creerProduitSimple(organizationId)
  return { organizationId, ownerId, origineId, destinationId, variantId }
}

// Insère un transfert + une ligne en 'pending' puis force le statut voulu
// (les triggers n'entravent jamais la sortie de 'pending').
async function insererTransfert(
  s: Seed,
  status: (typeof schema.TRANSFER_STATUSES)[number]
): Promise<{ transferId: string; itemId: string }> {
  const db = drizzle(env.DB, { schema })
  const transferId = crypto.randomUUID()
  const itemId = crypto.randomUUID()
  const maintenant = new Date()
  await db.insert(schema.transfers).values({
    id: transferId,
    organizationId: s.organizationId,
    fromWarehouseId: s.origineId,
    toWarehouseId: s.destinationId,
    createdBy: s.ownerId,
    createdAt: maintenant,
    updatedAt: maintenant,
  })
  await db.insert(schema.transferItems).values({
    id: itemId,
    organizationId: s.organizationId,
    transferId,
    variantId: s.variantId,
    quantity: 5,
    createdAt: maintenant,
  })
  if (status !== "pending") {
    await db
      .update(schema.transfers)
      .set({ status })
      .where(eq(schema.transfers.id, transferId))
  }
  return { transferId, itemId }
}

async function insererInventaire(
  s: Seed,
  warehouseId: string,
  status: (typeof schema.INVENTORY_COUNT_STATUSES)[number]
): Promise<{ countId: string; itemId: string }> {
  const db = drizzle(env.DB, { schema })
  const countId = crypto.randomUUID()
  const itemId = crypto.randomUUID()
  const maintenant = new Date()
  await db.insert(schema.inventoryCounts).values({
    id: countId,
    organizationId: s.organizationId,
    warehouseId,
    openedBy: s.ownerId,
    openedAt: maintenant,
    createdAt: maintenant,
    updatedAt: maintenant,
  })
  await db.insert(schema.inventoryCountItems).values({
    id: itemId,
    organizationId: s.organizationId,
    countId,
    variantId: s.variantId,
    expectedQuantity: 10,
    createdAt: maintenant,
  })
  if (status === "closed") {
    await db
      .update(schema.inventoryCounts)
      .set({ status: "closed" })
      .where(eq(schema.inventoryCounts.id, countId))
  }
  return { countId, itemId }
}

describe("verrous 0007 — transferts", () => {
  it("un transfert terminé est immuable, document et lignes", async () => {
    const s = await seed()
    const db = drizzle(env.DB, { schema })
    for (const statut of ["received", "cancelled"] as const) {
      const { transferId, itemId } = await insererTransfert(s, statut)
      expect(
        estErreurDeclencheur(
          await erreurDe(
            db
              .update(schema.transfers)
              .set({ reference: "X" })
              .where(eq(schema.transfers.id, transferId))
          ),
          "TRANSFERT_TERMINE"
        )
      ).toBe(true)
      expect(
        estErreurDeclencheur(
          await erreurDe(
            db
              .update(schema.transferItems)
              .set({ quantity: 9 })
              .where(eq(schema.transferItems.id, itemId))
          ),
          "TRANSFERT_TERMINE"
        )
      ).toBe(true)
      expect(
        estErreurDeclencheur(
          await erreurDe(
            db
              .delete(schema.transferItems)
              .where(eq(schema.transferItems.id, itemId))
          ),
          "TRANSFERT_TERMINE"
        )
      ).toBe(true)
      expect(
        estErreurDeclencheur(
          await erreurDe(
            db.insert(schema.transferItems).values({
              id: crypto.randomUUID(),
              organizationId: s.organizationId,
              transferId,
              variantId: s.variantId,
              quantity: 1,
              createdAt: new Date(),
            })
          ),
          "TRANSFERT_TERMINE"
        )
      ).toBe(true)
    }
  })

  it("expédié : document et lignes figés, sauf received_quantity et la transition received", async () => {
    const s = await seed()
    const db = drizzle(env.DB, { schema })
    const { transferId, itemId } = await insererTransfert(s, "sent")
    // Édition du document (sans changer le statut) → refus
    expect(
      estErreurDeclencheur(
        await erreurDe(
          db
            .update(schema.transfers)
            .set({ reference: "X" })
            .where(eq(schema.transfers.id, transferId))
        ),
        "TRANSFERT_EXPEDIE"
      )
    ).toBe(true)
    // Double expédition (sent -> sent) → refus
    expect(
      estErreurDeclencheur(
        await erreurDe(
          db
            .update(schema.transfers)
            .set({ status: "sent" })
            .where(eq(schema.transfers.id, transferId))
        ),
        "TRANSFERT_EXPEDIE"
      )
    ).toBe(true)
    // Annulation après expédition → refus
    expect(
      estErreurDeclencheur(
        await erreurDe(
          db
            .update(schema.transfers)
            .set({ status: "cancelled" })
            .where(eq(schema.transfers.id, transferId))
        ),
        "TRANSFERT_EXPEDIE"
      )
    ).toBe(true)
    // Lignes : quantité figée, ajout/retrait interdits
    expect(
      estErreurDeclencheur(
        await erreurDe(
          db
            .update(schema.transferItems)
            .set({ quantity: 9 })
            .where(eq(schema.transferItems.id, itemId))
        ),
        "TRANSFERT_EXPEDIE"
      )
    ).toBe(true)
    expect(
      estErreurDeclencheur(
        await erreurDe(
          db
            .delete(schema.transferItems)
            .where(eq(schema.transferItems.id, itemId))
        ),
        "TRANSFERT_EXPEDIE"
      )
    ).toBe(true)
    // …mais la saisie de réception passe
    await db
      .update(schema.transferItems)
      .set({ receivedQuantity: 4 })
      .where(eq(schema.transferItems.id, itemId))
    // …et la transition received passe
    await db
      .update(schema.transfers)
      .set({ status: "received" })
      .where(eq(schema.transfers.id, transferId))
  })
})

describe("verrous 0007 — inventaires", () => {
  it("un seul inventaire ouvert par entrepôt (index partiel)", async () => {
    const s = await seed()
    const db = drizzle(env.DB, { schema })
    await insererInventaire(s, s.origineId, "open")
    const err = await erreurDe(
      db.insert(schema.inventoryCounts).values({
        id: crypto.randomUUID(),
        organizationId: s.organizationId,
        warehouseId: s.origineId,
        openedBy: s.ownerId,
        openedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    )
    expect(estViolationUnicite(err, "inventory_counts.warehouse_id")).toBe(true)
    // Un autre entrepôt reste libre, et un doc clos libère le sien
    await insererInventaire(s, s.destinationId, "open")
  })

  it("un inventaire clos est immuable, document et lignes", async () => {
    const s = await seed()
    const db = drizzle(env.DB, { schema })
    const { countId, itemId } = await insererInventaire(
      s,
      s.origineId,
      "closed"
    )
    expect(
      estErreurDeclencheur(
        await erreurDe(
          db
            .update(schema.inventoryCounts)
            .set({ status: "open" })
            .where(eq(schema.inventoryCounts.id, countId))
        ),
        "INVENTAIRE_CLOS"
      )
    ).toBe(true)
    expect(
      estErreurDeclencheur(
        await erreurDe(
          db
            .update(schema.inventoryCountItems)
            .set({ countedQuantity: 3 })
            .where(eq(schema.inventoryCountItems.id, itemId))
        ),
        "INVENTAIRE_CLOS"
      )
    ).toBe(true)
    expect(
      estErreurDeclencheur(
        await erreurDe(
          db
            .delete(schema.inventoryCountItems)
            .where(eq(schema.inventoryCountItems.id, itemId))
        ),
        "INVENTAIRE_CLOS"
      )
    ).toBe(true)
    // Un inventaire clos n'empêche pas d'en rouvrir un sur l'entrepôt
    await insererInventaire(s, s.origineId, "open")
  })
})
