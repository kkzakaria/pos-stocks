import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
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

type LigneTransit = {
  transferId: string
  fromWarehouseName: string
  variantId: string
  sku: string
  quantity: number
}

async function seed() {
  const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
  const origineId = await creerEntrepot(organizationId, "Origine")
  const destinationId = await creerEntrepot(organizationId, "Destination")
  const { variantId } = await creerProduitSimple(organizationId)
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
  return { organizationId, ownerCookie, origineId, destinationId, variantId }
}

async function creerTransfert(
  s: Awaited<ReturnType<typeof seed>>,
  quantity: number
): Promise<string> {
  const creation = await req(s.ownerCookie, "POST", "/api/v1/transfers", {
    fromWarehouseId: s.origineId,
    toWarehouseId: s.destinationId,
  })
  const { id } = await creation.json<{ id: string }>()
  await req(s.ownerCookie, "POST", `/api/v1/transfers/${id}/items`, {
    variantId: s.variantId,
    quantity,
  })
  return id
}

describe("stock en transit — dérivé des transferts sent", () => {
  it("un transfert apparaît en transit entrant après send et disparaît après receive (pending invisible)", async () => {
    const s = await seed()
    const id = await creerTransfert(s, 6)

    const url = `/api/v1/stock/transit?warehouseId=${s.destinationId}`
    // pending : rien
    let transit = await (
      await req(s.ownerCookie, "GET", url)
    ).json<{ transit: LigneTransit[] }>()
    expect(transit.transit).toEqual([])

    await req(s.ownerCookie, "POST", `/api/v1/transfers/${id}/send`)
    transit = await (
      await req(s.ownerCookie, "GET", url)
    ).json<{ transit: LigneTransit[] }>()
    expect(transit.transit).toEqual([
      expect.objectContaining({
        transferId: id,
        fromWarehouseName: "Origine",
        variantId: s.variantId,
        quantity: 6,
      }),
    ])
    // Le transit est ENTRANT : rien côté origine
    const transitOrigine = await (
      await req(
        s.ownerCookie,
        "GET",
        `/api/v1/stock/transit?warehouseId=${s.origineId}`
      )
    ).json<{ transit: LigneTransit[] }>()
    expect(transitOrigine.transit).toEqual([])

    await req(s.ownerCookie, "POST", `/api/v1/transfers/${id}/receive`)
    transit = await (
      await req(s.ownerCookie, "GET", url)
    ).json<{ transit: LigneTransit[] }>()
    expect(transit.transit).toEqual([])
  })

  it("contrat de lecture : warehouseId requis 400, hors portée 403, cross-org 404", async () => {
    const s = await seed()
    expect(
      (await req(s.ownerCookie, "GET", "/api/v1/stock/transit")).status
    ).toBe(400)

    const sansLien = await createUserWithRole(s.organizationId, "staff")
    expect(
      (
        await req(
          sansLien.cookie,
          "GET",
          `/api/v1/stock/transit?warehouseId=${s.destinationId}`
        )
      ).status
    ).toBe(403)

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
          managerDestination.cookie,
          "GET",
          `/api/v1/stock/transit?warehouseId=${s.destinationId}`
        )
      ).status
    ).toBe(200)

    expect(
      (
        await req(
          s.ownerCookie,
          "GET",
          `/api/v1/stock/transit?warehouseId=${crypto.randomUUID()}`
        )
      ).status
    ).toBe(404)
  })
})
