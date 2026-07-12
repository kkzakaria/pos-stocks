import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { and, eq } from "drizzle-orm"
import app from "../src/index"
import * as schema from "../src/db/schema"
import { estErreurDeclencheur } from "../src/lib/db-errors"
import { applyMovements } from "../src/services/stock"
import {
  bootstrapOwner,
  creerEntrepot,
  creerProduitSimple,
  affecterEntrepot,
  createUserWithRole,
} from "./helpers"

function req(cookie: string, method: string, url: string, body?: unknown) {
  return app.request(
    url,
    {
      method,
      headers: { "content-type": "application/json", cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env
  )
}

async function seedBrouillon() {
  const { organizationId, ownerCookie } = await bootstrapOwner()
  const warehouseId = await creerEntrepot(organizationId)
  const { variantId } = await creerProduitSimple(organizationId)
  const fournisseur = await req(ownerCookie, "POST", "/api/v1/suppliers", {
    name: `Fournisseur ${crypto.randomUUID().slice(0, 8)}`,
  })
  const { id: supplierId } = await fournisseur.json<{ id: string }>()
  const creation = await req(ownerCookie, "POST", "/api/v1/purchases", {
    warehouseId,
    supplierId,
  })
  const { id: purchaseId } = await creation.json<{ id: string }>()
  await req(ownerCookie, "POST", `/api/v1/purchases/${purchaseId}/items`, {
    variantId,
    quantity: 10,
    unitCost: 100,
  })
  return { organizationId, ownerCookie, warehouseId, variantId, purchaseId }
}

describe("TOCTOU réceptions — gel des lignes à la validation", () => {
  it("la validation nominale gèle toutes les lignes (frozen_at posé)", async () => {
    const { ownerCookie, purchaseId } = await seedBrouillon()
    const res = await req(
      ownerCookie,
      "POST",
      `/api/v1/purchases/${purchaseId}/receive`
    )
    expect(res.status).toBe(200)
    const db = drizzle(env.DB, { schema })
    const lignes = await db
      .select({ frozenAt: schema.purchaseItems.frozenAt })
      .from(schema.purchaseItems)
      .where(eq(schema.purchaseItems.purchaseId, purchaseId))
    expect(lignes.length).toBe(1)
    expect(lignes[0].frozenAt).not.toBeNull()
  })

  it("le trigger bloque draft -> received si une ligne n'est pas gelée", async () => {
    const { purchaseId } = await seedBrouillon()
    // Transition SQL directe SANS passer par la route (qui gèle) : la ligne
    // a frozen_at NULL — le trigger doit tuer la transition.
    const db = drizzle(env.DB, { schema })
    let erreur: unknown = null
    try {
      await db
        .update(schema.purchases)
        .set({ status: "received" })
        .where(eq(schema.purchases.id, purchaseId))
    } catch (err) {
      erreur = err
    }
    expect(estErreurDeclencheur(erreur, "LIGNE_NON_GELEE")).toBe(true)
    // Le document est resté draft
    const docs = await db
      .select({ status: schema.purchases.status })
      .from(schema.purchases)
      .where(eq(schema.purchases.id, purchaseId))
    expect(docs[0].status).toBe("draft")
  })

  it("une ligne insérée après le gel bloque aussi la transition", async () => {
    const { organizationId, variantId, purchaseId } = await seedBrouillon()
    const db = drizzle(env.DB, { schema })
    const maintenant = new Date()
    // Gèle la ligne existante à la main…
    await db
      .update(schema.purchaseItems)
      .set({ frozenAt: maintenant })
      .where(eq(schema.purchaseItems.purchaseId, purchaseId))
    // …puis simule la requête concurrente : une NOUVELLE ligne non gelée
    await db.insert(schema.purchaseItems).values({
      id: crypto.randomUUID(),
      organizationId,
      purchaseId,
      variantId,
      quantity: 5,
      unitCost: 50,
      createdAt: maintenant,
    })
    let erreur: unknown = null
    try {
      await db
        .update(schema.purchases)
        .set({ status: "received" })
        .where(eq(schema.purchases.id, purchaseId))
    } catch (err) {
      erreur = err
    }
    expect(estErreurDeclencheur(erreur, "LIGNE_NON_GELEE")).toBe(true)
  })
})

// Retour annoté `| null` (piège eslint no-unnecessary-condition)
async function lireNiveau(
  warehouseId: string,
  variantId: string
): Promise<{ quantity: number; avgCost: number } | null> {
  const db = drizzle(env.DB, { schema })
  const rows = await db
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
    .limit(1)
  return rows[0] ?? null
}

describe("tests différés P5", () => {
  it("biais CMP assumé : réception partielle vers une destination valorisée", async () => {
    const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
    const origineId = await creerEntrepot(organizationId, "Origine P6")
    const destinationId = await creerEntrepot(organizationId, "Destination P6")
    const { variantId } = await creerProduitSimple(organizationId)
    const db = drizzle(env.DB, { schema })
    // Destination déjà valorisée : 10 @ 100 ; origine : 10 @ 200
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId: destinationId,
          variantId,
          delta: 10,
          type: "purchase",
          unitCost: 100,
        },
        {
          warehouseId: origineId,
          variantId,
          delta: 10,
          type: "purchase",
          unitCost: 200,
        },
      ],
    })
    // Transfert de 4, expédié, reçu 3 (écart 1)
    const creation = await req(ownerCookie, "POST", "/api/v1/transfers", {
      fromWarehouseId: origineId,
      toWarehouseId: destinationId,
    })
    const { id: transferId } = await creation.json<{ id: string }>()
    const ligne = await req(
      ownerCookie,
      "POST",
      `/api/v1/transfers/${transferId}/items`,
      { variantId, quantity: 4 }
    )
    const { id: itemId } = await ligne.json<{ id: string }>()
    expect(
      (await req(ownerCookie, "POST", `/api/v1/transfers/${transferId}/send`))
        .status
    ).toBe(200)
    const reception = await req(
      ownerCookie,
      "POST",
      `/api/v1/transfers/${transferId}/receive`,
      { items: [{ itemId, receivedQuantity: 3 }] }
    )
    expect(reception.status).toBe(200)
    // transfer_in +4 @ 200 absorbé : CMP = round((10×100 + 4×200) / 14) = 129
    // adjustment −1 : quantité 13, CMP INCHANGÉ (biais assumé : la perte
    // absorbe sa part de valeur — décision P5, ici pinnée par test)
    const destination = await lireNiveau(destinationId, variantId)
    expect(destination).toEqual({ quantity: 13, avgCost: 129 })
  })

  it("un caissier n'a pas accès au back-office /stock/transit", async () => {
    const { organizationId } = await bootstrapOwner()
    const boutiqueId = await creerEntrepot(
      organizationId,
      "Boutique T4",
      "store"
    )
    const caissier = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      caissier.userId,
      boutiqueId,
      "cashier"
    )
    const res = await req(
      caissier.cookie,
      "GET",
      `/api/v1/stock/transit?warehouseId=${boutiqueId}`
    )
    expect(res.status).toBe(403)
    expect((await res.json<{ code: string }>()).code).toBe("ACCES_REFUSE")
  })

  it("purchase + transfer_in dans le MÊME batch : CMP combiné", async () => {
    const { organizationId, ownerId } = await bootstrapOwner()
    const warehouseId = await creerEntrepot(organizationId, "Mixte P6")
    const { variantId } = await creerProduitSimple(organizationId)
    const db = drizzle(env.DB, { schema })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId, variantId, delta: 10, type: "purchase", unitCost: 100 },
        {
          warehouseId,
          variantId,
          delta: 5,
          type: "transfer_in",
          unitCost: 160,
        },
      ],
    })
    // CMP = round((10×100 + 5×160) / 15) = round(1800/15) = 120
    expect(await lireNiveau(warehouseId, variantId)).toEqual({
      quantity: 15,
      avgCost: 120,
    })
  })

  it("réception multi-lignes à quantités mixtes (totale + partielle)", async () => {
    const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
    const origineId = await creerEntrepot(organizationId, "Origine mixte")
    const destinationId = await creerEntrepot(organizationId, "Dest mixte")
    const p1 = await creerProduitSimple(organizationId)
    const p2 = await creerProduitSimple(organizationId)
    const db = drizzle(env.DB, { schema })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId: origineId,
          variantId: p1.variantId,
          delta: 10,
          type: "purchase",
          unitCost: 100,
        },
        {
          warehouseId: origineId,
          variantId: p2.variantId,
          delta: 10,
          type: "purchase",
          unitCost: 50,
        },
      ],
    })
    const creation = await req(ownerCookie, "POST", "/api/v1/transfers", {
      fromWarehouseId: origineId,
      toWarehouseId: destinationId,
    })
    const { id: transferId } = await creation.json<{ id: string }>()
    const l1 = await req(
      ownerCookie,
      "POST",
      `/api/v1/transfers/${transferId}/items`,
      { variantId: p1.variantId, quantity: 6 }
    )
    const { id: item1 } = await l1.json<{ id: string }>()
    await req(ownerCookie, "POST", `/api/v1/transfers/${transferId}/items`, {
      variantId: p2.variantId,
      quantity: 4,
    })
    await req(ownerCookie, "POST", `/api/v1/transfers/${transferId}/send`)
    // Ligne 1 partielle (5/6), ligne 2 absente du corps = reçue en totalité
    const reception = await req(
      ownerCookie,
      "POST",
      `/api/v1/transfers/${transferId}/receive`,
      { items: [{ itemId: item1, receivedQuantity: 5 }] }
    )
    expect(reception.status).toBe(200)
    // p1 : +6 puis −1 = 5 ; p2 : +4
    expect((await lireNiveau(destinationId, p1.variantId))?.quantity).toBe(5)
    expect((await lireNiveau(destinationId, p2.variantId))?.quantity).toBe(4)
    // 3 mouvements à destination : transfer_in ×2 + adjustment ×1
    const mouvements = await db
      .select({ type: schema.stockMovements.type })
      .from(schema.stockMovements)
      .where(eq(schema.stockMovements.warehouseId, destinationId))
    expect(mouvements.map((m) => m.type).sort()).toEqual([
      "adjustment",
      "transfer_in",
      "transfer_in",
    ])
  })
})
