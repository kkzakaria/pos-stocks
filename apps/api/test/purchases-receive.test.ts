import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { and, eq } from "drizzle-orm"
import app from "../src/index"
import * as schema from "../src/db/schema"
import {
  bootstrapOwner,
  createUserWithRole,
  creerEntrepot,
  creerProduitSimple,
  affecterEntrepot,
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

async function seed() {
  const { organizationId, ownerCookie } = await bootstrapOwner()
  const warehouseId = await creerEntrepot(organizationId)
  const fournisseur = await req(ownerCookie, "POST", "/api/v1/suppliers", {
    name: "Sodeci",
  })
  const supplierId = (await fournisseur.json<{ id: string }>()).id
  return { organizationId, ownerCookie, warehouseId, supplierId }
}

async function creerBrouillon(
  ownerCookie: string,
  warehouseId: string,
  supplierId: string,
  items: Array<Record<string, unknown>>
) {
  const creation = await req(ownerCookie, "POST", "/api/v1/purchases", {
    warehouseId,
    supplierId,
  })
  const { id } = await creation.json<{ id: string }>()
  for (const item of items) {
    const ajout = await req(
      ownerCookie,
      "POST",
      `/api/v1/purchases/${id}/items`,
      item
    )
    expect(ajout.status).toBe(201)
  }
  return id
}

// Retour annoté `| null` (piège eslint no-unnecessary-condition : sans
// annotation, `rows[0] ?? null` s'infère non nullable).
async function lireNiveau(
  warehouseId: string,
  variantId: string
): Promise<typeof schema.stockLevels.$inferSelect | null> {
  const db = drizzle(env.DB, { schema })
  const rows = await db
    .select()
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

describe("POST /api/v1/purchases/:id/receive", () => {
  it("valide : mouvements purchase référencés, niveau créé, CMP pondéré sur deux réceptions", async () => {
    const { organizationId, ownerCookie, warehouseId, supplierId } =
      await seed()
    const { variantId } = await creerProduitSimple(organizationId)

    const premier = await creerBrouillon(ownerCookie, warehouseId, supplierId, [
      { variantId, quantity: 10, unitCost: 100 },
    ])
    expect(
      (await req(ownerCookie, "POST", `/api/v1/purchases/${premier}/receive`))
        .status
    ).toBe(200)

    let niveau = await lireNiveau(warehouseId, variantId)
    expect(niveau?.quantity).toBe(10)
    expect(niveau?.avgCost).toBe(100)

    const db = drizzle(env.DB, { schema })
    const mouvements = await db
      .select()
      .from(schema.stockMovements)
      .where(eq(schema.stockMovements.refId, premier))
    expect(mouvements).toHaveLength(1)
    expect(mouvements[0]?.type).toBe("purchase")
    expect(mouvements[0]?.refType).toBe("purchase")
    expect(mouvements[0]?.delta).toBe(10)

    // Deuxième réception 5 à 160 → CMP round((10×100 + 5×160)/15) = 120
    const second = await creerBrouillon(ownerCookie, warehouseId, supplierId, [
      { variantId, quantity: 5, unitCost: 160 },
    ])
    await req(ownerCookie, "POST", `/api/v1/purchases/${second}/receive`)
    niveau = await lireNiveau(warehouseId, variantId)
    expect(niveau?.quantity).toBe(15)
    expect(niveau?.avgCost).toBe(120)

    // Le document est passé received, horodaté et attribué
    const detail = await req(ownerCookie, "GET", `/api/v1/purchases/${premier}`)
    const { purchase } = await detail.json<{
      purchase: { status: string; receivedAt: string | null }
    }>()
    expect(purchase.status).toBe("received")
    expect(purchase.receivedAt).not.toBeNull()
  })

  it("lots : créés à la validation pour trackLots, réutilisés si même numéro", async () => {
    const { organizationId, ownerCookie, warehouseId, supplierId } =
      await seed()
    const { variantId } = await creerProduitSimple(organizationId, {
      nom: "Yaourt",
      trackLots: true,
    })

    const premier = await creerBrouillon(ownerCookie, warehouseId, supplierId, [
      {
        variantId,
        quantity: 6,
        unitCost: 200,
        lotNumber: "LOT-A",
        expiryDate: "2026-12-31",
      },
    ])
    await req(ownerCookie, "POST", `/api/v1/purchases/${premier}/receive`)

    const db = drizzle(env.DB, { schema })
    let lots = await db
      .select()
      .from(schema.lots)
      .where(eq(schema.lots.variantId, variantId))
    expect(lots).toHaveLength(1)
    expect(lots[0]?.lotNumber).toBe("LOT-A")

    // Deuxième réception, même numéro de lot → PAS de doublon
    const second = await creerBrouillon(ownerCookie, warehouseId, supplierId, [
      { variantId, quantity: 4, unitCost: 200, lotNumber: "LOT-A" },
    ])
    await req(ownerCookie, "POST", `/api/v1/purchases/${second}/receive`)
    lots = await db
      .select()
      .from(schema.lots)
      .where(eq(schema.lots.variantId, variantId))
    expect(lots).toHaveLength(1)

    // Les mouvements pointent le lot
    const mouvements = await db
      .select()
      .from(schema.stockMovements)
      .where(eq(schema.stockMovements.variantId, variantId))
    expect(mouvements.every((m) => m.lotId === lots[0]?.id)).toBe(true)
  })

  it("immuabilité : re-valider → 409 STATUT_INVALIDE sans double stock ; modifier/supprimer → 409 RECEPTION_VALIDEE", async () => {
    const { organizationId, ownerCookie, warehouseId, supplierId } =
      await seed()
    const { variantId } = await creerProduitSimple(organizationId)
    const id = await creerBrouillon(ownerCookie, warehouseId, supplierId, [
      { variantId, quantity: 10, unitCost: 100 },
    ])
    await req(ownerCookie, "POST", `/api/v1/purchases/${id}/receive`)

    const revalidation = await req(
      ownerCookie,
      "POST",
      `/api/v1/purchases/${id}/receive`
    )
    expect(revalidation.status).toBe(409)
    expect((await revalidation.json<{ code: string }>()).code).toBe(
      "STATUT_INVALIDE"
    )
    // pas de double application
    expect((await lireNiveau(warehouseId, variantId))?.quantity).toBe(10)

    const ajout = await req(
      ownerCookie,
      "POST",
      `/api/v1/purchases/${id}/items`,
      {
        variantId,
        quantity: 1,
        unitCost: 100,
      }
    )
    expect(ajout.status).toBe(409)
    expect((await ajout.json<{ code: string }>()).code).toBe(
      "RECEPTION_VALIDEE"
    )

    const suppression = await req(
      ownerCookie,
      "DELETE",
      `/api/v1/purchases/${id}`
    )
    expect(suppression.status).toBe(409)
    expect((await suppression.json<{ code: string }>()).code).toBe(
      "RECEPTION_VALIDEE"
    )
  })

  it("sans ligne → 400 ; auditeur d'entrepôt → 403 ; manager de l'entrepôt → 200", async () => {
    const { organizationId, ownerCookie, warehouseId, supplierId } =
      await seed()
    const { variantId } = await creerProduitSimple(organizationId)

    const vide = await creerBrouillon(ownerCookie, warehouseId, supplierId, [])
    const validationVide = await req(
      ownerCookie,
      "POST",
      `/api/v1/purchases/${vide}/receive`
    )
    expect(validationVide.status).toBe(400)

    const id = await creerBrouillon(ownerCookie, warehouseId, supplierId, [
      { variantId, quantity: 2, unitCost: 50 },
    ])
    const auditeur = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      auditeur.userId,
      warehouseId,
      "auditor"
    )
    expect(
      (await req(auditeur.cookie, "POST", `/api/v1/purchases/${id}/receive`))
        .status
    ).toBe(403)

    const manager = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      manager.userId,
      warehouseId,
      "manager"
    )
    expect(
      (await req(manager.cookie, "POST", `/api/v1/purchases/${id}/receive`))
        .status
    ).toBe(200)
  })
})
