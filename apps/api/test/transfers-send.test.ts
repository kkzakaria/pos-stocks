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
  // Stock valorisé à l'origine : 20 unités à CMP 100
  const db = drizzle(env.DB, { schema })
  await applyMovements(db, {
    organizationId,
    userId: ownerId,
    mouvements: [
      {
        warehouseId: origineId,
        variantId,
        delta: 20,
        type: "purchase",
        unitCost: 100,
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

async function creerBrouillon(
  ownerCookie: string,
  origineId: string,
  destinationId: string,
  items: Array<Record<string, unknown>>
): Promise<string> {
  const creation = await req(ownerCookie, "POST", "/api/v1/transfers", {
    fromWarehouseId: origineId,
    toWarehouseId: destinationId,
  })
  const { id } = await creation.json<{ id: string }>()
  for (const item of items) {
    const ajout = await req(
      ownerCookie,
      "POST",
      `/api/v1/transfers/${id}/items`,
      item
    )
    expect(ajout.status).toBe(201)
  }
  return id
}

describe("transferts — expédition", () => {
  it("expédie : statut sent, stock origine décrémenté, transfer_out journalisés, CMP origine figé sur les lignes", async () => {
    const { ownerCookie, origineId, destinationId, variantId } = await seed()
    const id = await creerBrouillon(ownerCookie, origineId, destinationId, [
      { variantId, quantity: 8 },
    ])
    const res = await req(ownerCookie, "POST", `/api/v1/transfers/${id}/send`)
    expect(res.status).toBe(200)

    expect(await lireNiveau(origineId, variantId)).toEqual({
      quantity: 12,
      avgCost: 100,
    })

    const detail = await req(ownerCookie, "GET", `/api/v1/transfers/${id}`)
    const { transfer } = await detail.json<{
      transfer: {
        status: string
        sentAt: string | null
        items: Array<{ unitCost: number | null }>
      }
    }>()
    expect(transfer.status).toBe("sent")
    expect(transfer.sentAt).not.toBeNull()
    // CMP origine (100) figé sur la ligne au moment de l'expédition
    expect(transfer.items[0]?.unitCost).toBe(100)

    const db = drizzle(env.DB, { schema })
    const mouvements = await db
      .select()
      .from(schema.stockMovements)
      .where(
        and(
          eq(schema.stockMovements.refType, "transfer"),
          eq(schema.stockMovements.refId, id)
        )
      )
    expect(mouvements).toEqual([
      expect.objectContaining({
        warehouseId: origineId,
        variantId,
        delta: -8,
        type: "transfer_out",
      }),
    ])
  })

  it("variante jamais valorisée (stock entré par ajustement) : CMP figé à 0", async () => {
    const { organizationId, ownerId, ownerCookie, origineId, destinationId } =
      await seed()
    const { variantId } = await creerProduitSimple(organizationId, {
      nom: "Sans valorisation",
    })
    // Stock présent mais jamais valorisé (les ajustements ne touchent pas le CMP)
    const db = drizzle(env.DB, { schema })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId: origineId,
          variantId,
          delta: 10,
          type: "adjustment",
          reason: "seed sans valorisation",
        },
      ],
    })
    const id = await creerBrouillon(ownerCookie, origineId, destinationId, [
      { variantId, quantity: 2 },
    ])
    expect(
      (await req(ownerCookie, "POST", `/api/v1/transfers/${id}/send`)).status
    ).toBe(200)
    const lignes = await db
      .select({ unitCost: schema.transferItems.unitCost })
      .from(schema.transferItems)
      .where(eq(schema.transferItems.transferId, id))
    expect(lignes).toEqual([{ unitCost: 0 }])
  })

  it("stock insuffisant : 409 avec détail, RIEN n'est écrit (statut, unit_cost, journal, niveaux)", async () => {
    const { ownerCookie, origineId, destinationId, variantId } = await seed()
    const id = await creerBrouillon(ownerCookie, origineId, destinationId, [
      { variantId, quantity: 25 },
    ])
    const res = await req(ownerCookie, "POST", `/api/v1/transfers/${id}/send`)
    expect(res.status).toBe(409)
    const corps = await res.json<{
      code: string
      details: Array<{ disponible: number; demande: number }>
    }>()
    expect(corps.code).toBe("STOCK_INSUFFISANT")
    expect(corps.details).toEqual([
      expect.objectContaining({ disponible: 20, demande: 25 }),
    ])
    // Atomicité vérifiée en lecture DB directe
    const db = drizzle(env.DB, { schema })
    const transferts = await db
      .select()
      .from(schema.transfers)
      .where(eq(schema.transfers.id, id))
    expect(transferts[0]?.status).toBe("pending")
    expect(transferts[0]?.sentAt).toBeNull()
    const lignes = await db
      .select()
      .from(schema.transferItems)
      .where(eq(schema.transferItems.transferId, id))
    expect(lignes[0]?.unitCost).toBeNull()
    const mouvements = await db
      .select()
      .from(schema.stockMovements)
      .where(eq(schema.stockMovements.refId, id))
    expect(mouvements).toEqual([])
    expect(await lireNiveau(origineId, variantId)).toEqual({
      quantity: 20,
      avgCost: 100,
    })
  })

  it("LOT_REQUIS : une ligne trackLots sans lot bloque l'expédition, rien n'est écrit", async () => {
    const { organizationId, ownerId, ownerCookie, origineId, destinationId } =
      await seed()
    const suivie = await creerProduitSimple(organizationId, {
      trackLots: true,
    })
    // Stock pour la variante suivie
    const db = drizzle(env.DB, { schema })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId: origineId,
          variantId: suivie.variantId,
          delta: 10,
          type: "purchase",
          unitCost: 50,
        },
      ],
    })
    const id = await creerBrouillon(ownerCookie, origineId, destinationId, [
      { variantId: suivie.variantId, quantity: 2 },
    ])
    const res = await req(ownerCookie, "POST", `/api/v1/transfers/${id}/send`)
    expect(res.status).toBe(400)
    expect((await res.json<{ code: string }>()).code).toBe("LOT_REQUIS")
    const transferts = await db
      .select()
      .from(schema.transfers)
      .where(eq(schema.transfers.id, id))
    expect(transferts[0]?.status).toBe("pending")
  })

  it("transfert sans ligne → 400 VALIDATION ; double expédition → 409 STATUT_INVALIDE et stock décrémenté une seule fois", async () => {
    const { ownerCookie, origineId, destinationId, variantId } = await seed()
    const vide = await creerBrouillon(ownerCookie, origineId, destinationId, [])
    expect(
      (await req(ownerCookie, "POST", `/api/v1/transfers/${vide}/send`)).status
    ).toBe(400)

    const id = await creerBrouillon(ownerCookie, origineId, destinationId, [
      { variantId, quantity: 5 },
    ])
    expect(
      (await req(ownerCookie, "POST", `/api/v1/transfers/${id}/send`)).status
    ).toBe(200)
    const rejoue = await req(
      ownerCookie,
      "POST",
      `/api/v1/transfers/${id}/send`
    )
    expect(rejoue.status).toBe(409)
    expect((await rejoue.json<{ code: string }>()).code).toBe("STATUT_INVALIDE")
    expect(await lireNiveau(origineId, variantId)).toEqual({
      quantity: 15,
      avgCost: 100,
    })
    // Annulation après expédition → 409 aussi
    expect(
      (await req(ownerCookie, "POST", `/api/v1/transfers/${id}/cancel`)).status
    ).toBe(409)
  })

  it("matrice : manager ORIGINE expédie, manager destination 403, cashier origine 403", async () => {
    const { organizationId, ownerCookie, origineId, destinationId, variantId } =
      await seed()
    const id = await creerBrouillon(ownerCookie, origineId, destinationId, [
      { variantId, quantity: 1 },
    ])
    const managerDestination = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      managerDestination.userId,
      destinationId,
      "manager"
    )
    const caissier = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      caissier.userId,
      origineId,
      "cashier"
    )
    const managerOrigine = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      managerOrigine.userId,
      origineId,
      "manager"
    )
    expect(
      (
        await req(
          managerDestination.cookie,
          "POST",
          `/api/v1/transfers/${id}/send`
        )
      ).status
    ).toBe(403)
    expect(
      (await req(caissier.cookie, "POST", `/api/v1/transfers/${id}/send`))
        .status
    ).toBe(403)
    expect(
      (await req(managerOrigine.cookie, "POST", `/api/v1/transfers/${id}/send`))
        .status
    ).toBe(200)
  })
})
