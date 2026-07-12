import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
import app from "../src/index"
import * as schema from "../src/db/schema"
import { estErreurDeclencheur } from "../src/lib/db-errors"
import { bootstrapOwner, creerEntrepot, creerProduitSimple } from "./helpers"

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
