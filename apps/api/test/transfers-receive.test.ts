import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { and, eq } from "drizzle-orm"
import app from "../src/index"
import * as schema from "../src/db/schema"
import { applyMovements } from "../src/services/stock"
import {
  affecterEntrepot,
  bootstrapOwner,
  createUserWithRole,
  creerEntrepot,
  creerProduitSimple,
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

async function seed() {
  const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
  const origineId = await creerEntrepot(organizationId, "Origine")
  const destinationId = await creerEntrepot(organizationId, "Destination")
  const { variantId } = await creerProduitSimple(organizationId)
  const db = drizzle(env.DB, { schema })
  // Origine : 20 unités à CMP 150
  await applyMovements(db, {
    organizationId,
    userId: ownerId,
    mouvements: [
      {
        warehouseId: origineId,
        variantId,
        delta: 20,
        type: "purchase",
        unitCost: 150,
      },
    ],
  })
  return {
    organizationId,
    ownerId,
    ownerCookie,
    origineId,
    destinationId,
    variantId,
  }
}

// Crée + remplit + expédie un transfert, renvoie id et lignes
async function transfertExpedie(
  s: Awaited<ReturnType<typeof seed>>,
  quantity: number,
  lotId?: string
): Promise<{ id: string; itemId: string }> {
  const creation = await req(s.ownerCookie, "POST", "/api/v1/transfers", {
    fromWarehouseId: s.origineId,
    toWarehouseId: s.destinationId,
  })
  const { id } = await creation.json<{ id: string }>()
  const ajout = await req(
    s.ownerCookie,
    "POST",
    `/api/v1/transfers/${id}/items`,
    {
      variantId: s.variantId,
      quantity,
      ...(lotId ? { lotId } : {}),
    }
  )
  const { id: itemId } = await ajout.json<{ id: string }>()
  expect(
    (await req(s.ownerCookie, "POST", `/api/v1/transfers/${id}/send`)).status
  ).toBe(200)
  return { id, itemId }
}

describe("transferts — réception", () => {
  it("réception totale sans corps : stock destination +qty au CMP figé, receivedQuantity = quantity", async () => {
    const s = await seed()
    const { id, itemId } = await transfertExpedie(s, 8)
    const res = await req(
      s.ownerCookie,
      "POST",
      `/api/v1/transfers/${id}/receive`
    )
    expect(res.status).toBe(200)

    // Destination vierge : CMP initialisé au coût figé de l'origine (150)
    expect(await lireNiveau(s.destinationId, s.variantId)).toEqual({
      quantity: 8,
      avgCost: 150,
    })
    const detail = await req(s.ownerCookie, "GET", `/api/v1/transfers/${id}`)
    const { transfer } = await detail.json<{
      transfer: {
        status: string
        receivedAt: string | null
        items: Array<{ id: string; receivedQuantity: number | null }>
      }
    }>()
    expect(transfer.status).toBe("received")
    expect(transfer.receivedAt).not.toBeNull()
    expect(transfer.items).toEqual([
      expect.objectContaining({ id: itemId, receivedQuantity: 8 }),
    ])
  })

  it("le CMP de destination absorbe l'apport (destination déjà valorisée)", async () => {
    const s = await seed()
    const db = drizzle(env.DB, { schema })
    // Destination : 10 unités à CMP 50
    await applyMovements(db, {
      organizationId: s.organizationId,
      userId: s.ownerId,
      mouvements: [
        {
          warehouseId: s.destinationId,
          variantId: s.variantId,
          delta: 10,
          type: "purchase",
          unitCost: 50,
        },
      ],
    })
    const { id } = await transfertExpedie(s, 10)
    await req(s.ownerCookie, "POST", `/api/v1/transfers/${id}/receive`)
    // (10 × 50 + 10 × 150) / 20 = 100
    expect(await lireNiveau(s.destinationId, s.variantId)).toEqual({
      quantity: 20,
      avgCost: 100,
    })
  })

  it("réception partielle : niveau net +reçu, journal = transfer_in total + adjustment négatif documenté", async () => {
    const s = await seed()
    const { id, itemId } = await transfertExpedie(s, 10)
    const res = await req(
      s.ownerCookie,
      "POST",
      `/api/v1/transfers/${id}/receive`,
      { items: [{ itemId, receivedQuantity: 7 }] }
    )
    expect(res.status).toBe(200)
    expect(await lireNiveau(s.destinationId, s.variantId)).toEqual({
      quantity: 7,
      avgCost: 150,
    })
    const db = drizzle(env.DB, { schema })
    const mouvements = await db
      .select()
      .from(schema.stockMovements)
      .where(
        and(
          eq(schema.stockMovements.refId, id),
          eq(schema.stockMovements.warehouseId, s.destinationId)
        )
      )
    expect(mouvements).toHaveLength(2)
    expect(mouvements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "transfer_in", delta: 10 }),
        expect.objectContaining({
          type: "adjustment",
          delta: -3,
          reason: "Écart de réception du transfert (10 expédié, 7 reçu)",
        }),
      ])
    )
    const detail = await req(s.ownerCookie, "GET", `/api/v1/transfers/${id}`)
    const { transfer } = await detail.json<{
      transfer: { items: Array<{ receivedQuantity: number | null }> }
    }>()
    expect(transfer.items[0]?.receivedQuantity).toBe(7)
  })

  it("reçu > expédié → 400 QUANTITE_RECUE_INVALIDE, ligne étrangère → 404, rien n'est écrit", async () => {
    const s = await seed()
    const { id, itemId } = await transfertExpedie(s, 5)
    const trop = await req(
      s.ownerCookie,
      "POST",
      `/api/v1/transfers/${id}/receive`,
      { items: [{ itemId, receivedQuantity: 6 }] }
    )
    expect(trop.status).toBe(400)
    expect((await trop.json<{ code: string }>()).code).toBe(
      "QUANTITE_RECUE_INVALIDE"
    )
    const etrangere = await req(
      s.ownerCookie,
      "POST",
      `/api/v1/transfers/${id}/receive`,
      { items: [{ itemId: crypto.randomUUID(), receivedQuantity: 1 }] }
    )
    expect(etrangere.status).toBe(404)
    // Toujours sent, aucun mouvement à destination
    const db = drizzle(env.DB, { schema })
    const transferts = await db
      .select()
      .from(schema.transfers)
      .where(eq(schema.transfers.id, id))
    expect(transferts[0]?.status).toBe("sent")
    expect(await lireNiveau(s.destinationId, s.variantId)).toBeNull()
  })

  it("itemId dupliqué dans le corps → 400 VALIDATION, rien n'est écrit", async () => {
    const s = await seed()
    const { id, itemId } = await transfertExpedie(s, 5)
    const res = await req(
      s.ownerCookie,
      "POST",
      `/api/v1/transfers/${id}/receive`,
      {
        items: [
          { itemId, receivedQuantity: 2 },
          { itemId, receivedQuantity: 3 },
        ],
      }
    )
    expect(res.status).toBe(400)
    expect((await res.json<{ code: string }>()).code).toBe("VALIDATION")
    const db = drizzle(env.DB, { schema })
    const transferts = await db
      .select()
      .from(schema.transfers)
      .where(eq(schema.transfers.id, id))
    expect(transferts[0]?.status).toBe("sent")
  })

  it("transitions interdites : réception d'un pending 409, double réception 409 et stock crédité une seule fois", async () => {
    const s = await seed()
    // pending
    const creation = await req(s.ownerCookie, "POST", "/api/v1/transfers", {
      fromWarehouseId: s.origineId,
      toWarehouseId: s.destinationId,
    })
    const { id: enAttente } = await creation.json<{ id: string }>()
    const avantEnvoi = await req(
      s.ownerCookie,
      "POST",
      `/api/v1/transfers/${enAttente}/receive`
    )
    expect(avantEnvoi.status).toBe(409)
    expect((await avantEnvoi.json<{ code: string }>()).code).toBe(
      "STATUT_INVALIDE"
    )
    // double réception
    const { id } = await transfertExpedie(s, 4)
    expect(
      (await req(s.ownerCookie, "POST", `/api/v1/transfers/${id}/receive`))
        .status
    ).toBe(200)
    expect(
      (await req(s.ownerCookie, "POST", `/api/v1/transfers/${id}/receive`))
        .status
    ).toBe(409)
    expect(await lireNiveau(s.destinationId, s.variantId)).toEqual({
      quantity: 4,
      avgCost: 150,
    })
  })

  it("matrice : manager DESTINATION réceptionne, manager origine 403", async () => {
    const s = await seed()
    const { id } = await transfertExpedie(s, 3)
    const managerOrigine = await createUserWithRole(s.organizationId, "staff")
    await affecterEntrepot(
      s.organizationId,
      managerOrigine.userId,
      s.origineId,
      "manager"
    )
    const managerDestination = await createUserWithRole(
      s.organizationId,
      "staff"
    )
    await affecterEntrepot(
      s.organizationId,
      managerDestination.userId,
      s.destinationId,
      "manager"
    )
    expect(
      (
        await req(
          managerOrigine.cookie,
          "POST",
          `/api/v1/transfers/${id}/receive`
        )
      ).status
    ).toBe(403)
    expect(
      (
        await req(
          managerDestination.cookie,
          "POST",
          `/api/v1/transfers/${id}/receive`
        )
      ).status
    ).toBe(200)
  })

  it("le lot suit la ligne : le transfer_in de destination porte le lotId choisi à l'origine", async () => {
    const s = await seed()
    const db = drizzle(env.DB, { schema })
    const suivie = await creerProduitSimple(s.organizationId, {
      trackLots: true,
    })
    const lotId = crypto.randomUUID()
    await db.insert(schema.lots).values({
      id: lotId,
      organizationId: s.organizationId,
      variantId: suivie.variantId,
      lotNumber: "LOT-T",
      expiryDate: null,
      createdAt: new Date(),
    })
    await applyMovements(db, {
      organizationId: s.organizationId,
      userId: s.ownerId,
      mouvements: [
        {
          warehouseId: s.origineId,
          variantId: suivie.variantId,
          delta: 6,
          type: "purchase",
          unitCost: 80,
          lotId,
        },
      ],
    })
    const creation = await req(s.ownerCookie, "POST", "/api/v1/transfers", {
      fromWarehouseId: s.origineId,
      toWarehouseId: s.destinationId,
    })
    const { id } = await creation.json<{ id: string }>()
    await req(s.ownerCookie, "POST", `/api/v1/transfers/${id}/items`, {
      variantId: suivie.variantId,
      quantity: 6,
      lotId,
    })
    expect(
      (await req(s.ownerCookie, "POST", `/api/v1/transfers/${id}/send`)).status
    ).toBe(200)
    expect(
      (await req(s.ownerCookie, "POST", `/api/v1/transfers/${id}/receive`))
        .status
    ).toBe(200)
    const entrees = await db
      .select()
      .from(schema.stockMovements)
      .where(
        and(
          eq(schema.stockMovements.refId, id),
          eq(schema.stockMovements.type, "transfer_in")
        )
      )
    expect(entrees).toEqual([expect.objectContaining({ lotId })])
  })
})
