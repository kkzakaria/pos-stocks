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

type ReponseCloture = {
  ok: boolean
  ecarts: Array<{
    variantId: string
    attendu: number
    compte: number
    quantiteAvantCloture: number
    delta: number
  }>
  nonComptes: number
  mouvements: number
}

async function seed() {
  const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
  const entrepotId = await creerEntrepot(organizationId, "Principal")
  const produitA = await creerProduitSimple(organizationId, { nom: "A" })
  const produitB = await creerProduitSimple(organizationId, { nom: "B" })
  const db = drizzle(env.DB, { schema })
  await applyMovements(db, {
    organizationId,
    userId: ownerId,
    mouvements: [
      {
        warehouseId: entrepotId,
        variantId: produitA.variantId,
        delta: 10,
        type: "purchase",
        unitCost: 100,
      },
      {
        warehouseId: entrepotId,
        variantId: produitB.variantId,
        delta: 5,
        type: "purchase",
        unitCost: 200,
      },
    ],
  })
  return {
    organizationId,
    ownerId,
    ownerCookie,
    entrepotId,
    variantA: produitA.variantId,
    variantB: produitB.variantId,
  }
}

async function ouvrir(
  s: Awaited<ReturnType<typeof seed>>
): Promise<{ id: string; lignes: Map<string, string> }> {
  const creation = await req(
    s.ownerCookie,
    "POST",
    "/api/v1/inventory-counts",
    {
      warehouseId: s.entrepotId,
    }
  )
  const { id } = await creation.json<{ id: string }>()
  const detail = await req(
    s.ownerCookie,
    "GET",
    `/api/v1/inventory-counts/${id}`
  )
  const { count } = await detail.json<{
    count: { items: Array<{ id: string; variantId: string }> }
  }>()
  return {
    id,
    lignes: new Map(count.items.map((i) => [i.variantId, i.id])),
  }
}

async function compter(
  s: Awaited<ReturnType<typeof seed>>,
  countId: string,
  itemId: string,
  countedQuantity: number
): Promise<void> {
  const res = await req(
    s.ownerCookie,
    "PATCH",
    `/api/v1/inventory-counts/${countId}/items/${itemId}`,
    { countedQuantity }
  )
  expect(res.status).toBe(200)
}

describe("inventaires — clôture", () => {
  it("écart simple : compté 8 pour 10 → mouvement count -2, niveau 8, récapitulatif", async () => {
    const s = await seed()
    const { id, lignes } = await ouvrir(s)
    await compter(s, id, lignes.get(s.variantA) ?? "", 8)

    const res = await req(
      s.ownerCookie,
      "POST",
      `/api/v1/inventory-counts/${id}/close`
    )
    expect(res.status).toBe(200)
    const corps = await res.json<ReponseCloture>()
    expect(corps.ecarts).toEqual([
      expect.objectContaining({
        variantId: s.variantA,
        attendu: 10,
        compte: 8,
        quantiteAvantCloture: 10,
        delta: -2,
      }),
    ])
    expect(corps.nonComptes).toBe(1)
    expect(corps.mouvements).toBe(1)

    expect(await lireNiveau(s.entrepotId, s.variantA)).toEqual({
      quantity: 8,
      avgCost: 100,
    })
    // La ligne non comptée (variantB) n'a pas bougé
    expect(await lireNiveau(s.entrepotId, s.variantB)).toEqual({
      quantity: 5,
      avgCost: 200,
    })

    const db = drizzle(env.DB, { schema })
    const mouvements = await db
      .select()
      .from(schema.stockMovements)
      .where(
        and(
          eq(schema.stockMovements.refType, "inventory_count"),
          eq(schema.stockMovements.refId, id)
        )
      )
    expect(mouvements).toEqual([
      expect.objectContaining({
        type: "count",
        delta: -2,
        variantId: s.variantA,
        warehouseId: s.entrepotId,
        reason: "Clôture d'inventaire",
      }),
    ])

    const detail = await req(
      s.ownerCookie,
      "GET",
      `/api/v1/inventory-counts/${id}`
    )
    const { count } = await detail.json<{
      count: { status: string; closedAt: string | null }
    }>()
    expect(count.status).toBe("closed")
    expect(count.closedAt).not.toBeNull()
  })

  it("pas de faux écart : une vente pendant l'inventaire, compté = stock réel → aucun mouvement", async () => {
    const s = await seed()
    const { id, lignes } = await ouvrir(s)
    // « Vente » pendant l'inventaire : -3 sur A (10 → 7)
    const db = drizzle(env.DB, { schema })
    await applyMovements(db, {
      organizationId: s.organizationId,
      userId: s.ownerId,
      mouvements: [
        {
          warehouseId: s.entrepotId,
          variantId: s.variantA,
          delta: -3,
          type: "adjustment",
          reason: "vente pendant inventaire",
        },
      ],
    })
    // Le magasinier compte 7 : c'est exact, malgré l'attendu figé à 10
    await compter(s, id, lignes.get(s.variantA) ?? "", 7)

    const res = await req(
      s.ownerCookie,
      "POST",
      `/api/v1/inventory-counts/${id}/close`
    )
    const corps = await res.json<ReponseCloture>()
    expect(corps.ecarts).toEqual([])
    expect(corps.mouvements).toBe(0)
    expect(await lireNiveau(s.entrepotId, s.variantA)).toEqual({
      quantity: 7,
      avgCost: 100,
    })
  })

  it("écart sur mouvement net : vente -3 pendant l'inventaire, compté 6 → delta -1 (pas -4)", async () => {
    const s = await seed()
    const { id, lignes } = await ouvrir(s)
    const db = drizzle(env.DB, { schema })
    await applyMovements(db, {
      organizationId: s.organizationId,
      userId: s.ownerId,
      mouvements: [
        {
          warehouseId: s.entrepotId,
          variantId: s.variantA,
          delta: -3,
          type: "adjustment",
          reason: "vente pendant inventaire",
        },
      ],
    })
    await compter(s, id, lignes.get(s.variantA) ?? "", 6)
    const res = await req(
      s.ownerCookie,
      "POST",
      `/api/v1/inventory-counts/${id}/close`
    )
    const corps = await res.json<ReponseCloture>()
    expect(corps.ecarts).toEqual([
      expect.objectContaining({
        attendu: 10,
        compte: 6,
        quantiteAvantCloture: 7,
        delta: -1,
      }),
    ])
    expect(await lireNiveau(s.entrepotId, s.variantA)).toEqual({
      quantity: 6,
      avgCost: 100,
    })
  })

  it("surplus : compté 12 pour 10 → delta +2, le CMP ne bouge pas", async () => {
    const s = await seed()
    const { id, lignes } = await ouvrir(s)
    await compter(s, id, lignes.get(s.variantA) ?? "", 12)
    const res = await req(
      s.ownerCookie,
      "POST",
      `/api/v1/inventory-counts/${id}/close`
    )
    const corps = await res.json<ReponseCloture>()
    expect(corps.ecarts).toEqual([expect.objectContaining({ delta: 2 })])
    expect(await lireNiveau(s.entrepotId, s.variantA)).toEqual({
      quantity: 12,
      avgCost: 100,
    })
  })

  it("clôture sans aucun écart ni comptage : document clos, zéro mouvement", async () => {
    const s = await seed()
    const { id } = await ouvrir(s)
    const res = await req(
      s.ownerCookie,
      "POST",
      `/api/v1/inventory-counts/${id}/close`
    )
    expect(res.status).toBe(200)
    const corps = await res.json<ReponseCloture>()
    expect(corps).toEqual(
      expect.objectContaining({ ecarts: [], nonComptes: 2, mouvements: 0 })
    )
  })

  it("double clôture → 409 INVENTAIRE_CLOS, et les mouvements ne sont pas rejoués", async () => {
    const s = await seed()
    const { id, lignes } = await ouvrir(s)
    await compter(s, id, lignes.get(s.variantA) ?? "", 8)
    expect(
      (await req(s.ownerCookie, "POST", `/api/v1/inventory-counts/${id}/close`))
        .status
    ).toBe(200)
    const rejoue = await req(
      s.ownerCookie,
      "POST",
      `/api/v1/inventory-counts/${id}/close`
    )
    expect(rejoue.status).toBe(409)
    expect((await rejoue.json<{ code: string }>()).code).toBe("INVENTAIRE_CLOS")
    expect(await lireNiveau(s.entrepotId, s.variantA)).toEqual({
      quantity: 8,
      avgCost: 100,
    })
  })

  it("matrice : manager de l'entrepôt clôt, manager d'un autre entrepôt 403", async () => {
    const s = await seed()
    const { id } = await ouvrir(s)
    const autreEntrepot = await creerEntrepot(s.organizationId, "Autre")
    const managerAilleurs = await createUserWithRole(s.organizationId, "staff")
    await affecterEntrepot(
      s.organizationId,
      managerAilleurs.userId,
      autreEntrepot,
      "manager"
    )
    const manager = await createUserWithRole(s.organizationId, "staff")
    await affecterEntrepot(
      s.organizationId,
      manager.userId,
      s.entrepotId,
      "manager"
    )
    expect(
      (
        await req(
          managerAilleurs.cookie,
          "POST",
          `/api/v1/inventory-counts/${id}/close`
        )
      ).status
    ).toBe(403)
    expect(
      (
        await req(
          manager.cookie,
          "POST",
          `/api/v1/inventory-counts/${id}/close`
        )
      ).status
    ).toBe(200)
  })
})
