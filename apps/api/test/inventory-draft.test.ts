import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
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

type LigneInventaire = {
  id: string
  variantId: string
  expectedQuantity: number
  countedQuantity: number | null
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

describe("inventaires — ouverture et saisie", () => {
  it("l'ouverture fige TOUT l'entrepôt : une ligne par niveau, quantités attendues photographiées", async () => {
    const s = await seed()
    const creation = await req(
      s.ownerCookie,
      "POST",
      "/api/v1/inventory-counts",
      {
        warehouseId: s.entrepotId,
      }
    )
    expect(creation.status).toBe(201)
    const { id } = await creation.json<{ id: string }>()

    // Un mouvement APRÈS ouverture ne change pas les quantités figées
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

    const detail = await req(
      s.ownerCookie,
      "GET",
      `/api/v1/inventory-counts/${id}`
    )
    expect(detail.status).toBe(200)
    const { count } = await detail.json<{
      count: { status: string; items: LigneInventaire[] }
    }>()
    expect(count.status).toBe("open")
    expect(count.items).toHaveLength(2)
    expect(count.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variantId: s.variantA,
          expectedQuantity: 10,
          countedQuantity: null,
        }),
        expect.objectContaining({
          variantId: s.variantB,
          expectedQuantity: 5,
          countedQuantity: null,
        }),
      ])
    )
  })

  it("un seul inventaire ouvert par entrepôt ; un entrepôt sans stock est refusé", async () => {
    const s = await seed()
    expect(
      (
        await req(s.ownerCookie, "POST", "/api/v1/inventory-counts", {
          warehouseId: s.entrepotId,
        })
      ).status
    ).toBe(201)
    const doublon = await req(
      s.ownerCookie,
      "POST",
      "/api/v1/inventory-counts",
      {
        warehouseId: s.entrepotId,
      }
    )
    expect(doublon.status).toBe(409)
    expect((await doublon.json<{ code: string }>()).code).toBe(
      "INVENTAIRE_OUVERT"
    )

    const vide = await creerEntrepot(s.organizationId, "Vide")
    const sansStock = await req(
      s.ownerCookie,
      "POST",
      "/api/v1/inventory-counts",
      {
        warehouseId: vide,
      }
    )
    expect(sansStock.status).toBe(400)
    expect((await sansStock.json<{ code: string }>()).code).toBe("VALIDATION")
  })

  it("saisie de comptage : plusieurs sessions, correction, effacement à null", async () => {
    const s = await seed()
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
      count: { items: LigneInventaire[] }
    }>()
    const ligneA = count.items.find((i) => i.variantId === s.variantA)

    // Première session de comptage
    expect(
      (
        await req(
          s.ownerCookie,
          "PATCH",
          `/api/v1/inventory-counts/${id}/items/${ligneA?.id ?? ""}`,
          { countedQuantity: 9 }
        )
      ).status
    ).toBe(200)
    // Seconde session : correction
    expect(
      (
        await req(
          s.ownerCookie,
          "PATCH",
          `/api/v1/inventory-counts/${id}/items/${ligneA?.id ?? ""}`,
          { countedQuantity: 8 }
        )
      ).status
    ).toBe(200)
    // Effacement
    expect(
      (
        await req(
          s.ownerCookie,
          "PATCH",
          `/api/v1/inventory-counts/${id}/items/${ligneA?.id ?? ""}`,
          { countedQuantity: null }
        )
      ).status
    ).toBe(200)
    // Ligne étrangère → 404
    expect(
      (
        await req(
          s.ownerCookie,
          "PATCH",
          `/api/v1/inventory-counts/${id}/items/${crypto.randomUUID()}`,
          { countedQuantity: 1 }
        )
      ).status
    ).toBe(404)
    // Négatif → 400 (Zod)
    expect(
      (
        await req(
          s.ownerCookie,
          "PATCH",
          `/api/v1/inventory-counts/${id}/items/${ligneA?.id ?? ""}`,
          { countedQuantity: -1 }
        )
      ).status
    ).toBe(400)
  })

  it("un inventaire clos refuse la saisie (409 INVENTAIRE_CLOS) et libère l'entrepôt pour une réouverture", async () => {
    const s = await seed()
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
      count: { items: LigneInventaire[] }
    }>()
    // Clôture hors route (la route close arrive en Task 10)
    const db = drizzle(env.DB, { schema })
    await db
      .update(schema.inventoryCounts)
      .set({ status: "closed" })
      .where(eq(schema.inventoryCounts.id, id))

    const refus = await req(
      s.ownerCookie,
      "PATCH",
      `/api/v1/inventory-counts/${id}/items/${count.items[0]?.id ?? ""}`,
      { countedQuantity: 1 }
    )
    expect(refus.status).toBe(409)
    expect((await refus.json<{ code: string }>()).code).toBe("INVENTAIRE_CLOS")

    expect(
      (
        await req(s.ownerCookie, "POST", "/api/v1/inventory-counts", {
          warehouseId: s.entrepotId,
        })
      ).status
    ).toBe(201)
  })

  it("matrice : manager de l'entrepôt ouvre et compte, manager d'un autre entrepôt 403, auditeur d'entrepôt lecture seule", async () => {
    const s = await seed()
    const autreEntrepot = await creerEntrepot(s.organizationId, "Autre")
    const manager = await createUserWithRole(s.organizationId, "staff")
    await affecterEntrepot(
      s.organizationId,
      manager.userId,
      s.entrepotId,
      "manager"
    )
    const managerAilleurs = await createUserWithRole(s.organizationId, "staff")
    await affecterEntrepot(
      s.organizationId,
      managerAilleurs.userId,
      autreEntrepot,
      "manager"
    )
    const auditeurLocal = await createUserWithRole(s.organizationId, "staff")
    await affecterEntrepot(
      s.organizationId,
      auditeurLocal.userId,
      s.entrepotId,
      "auditor"
    )

    expect(
      (
        await req(managerAilleurs.cookie, "POST", "/api/v1/inventory-counts", {
          warehouseId: s.entrepotId,
        })
      ).status
    ).toBe(403)
    expect(
      (
        await req(auditeurLocal.cookie, "POST", "/api/v1/inventory-counts", {
          warehouseId: s.entrepotId,
        })
      ).status
    ).toBe(403)

    const creation = await req(
      manager.cookie,
      "POST",
      "/api/v1/inventory-counts",
      {
        warehouseId: s.entrepotId,
      }
    )
    expect(creation.status).toBe(201)
    const { id } = await creation.json<{ id: string }>()

    // Lecture : l'auditeur local voit, le manager d'ailleurs ne voit pas
    expect(
      (await req(auditeurLocal.cookie, "GET", `/api/v1/inventory-counts/${id}`))
        .status
    ).toBe(200)
    expect(
      (
        await req(
          managerAilleurs.cookie,
          "GET",
          `/api/v1/inventory-counts/${id}`
        )
      ).status
    ).toBe(403)
    // Liste filtrée par portée
    const liste = await req(
      managerAilleurs.cookie,
      "GET",
      "/api/v1/inventory-counts"
    )
    expect((await liste.json<{ counts: unknown[] }>()).counts).toEqual([])
    // Cross-org → 404
    expect(
      (
        await req(
          s.ownerCookie,
          "GET",
          `/api/v1/inventory-counts/${crypto.randomUUID()}`
        )
      ).status
    ).toBe(404)
  })

  it("liste : statut, agrégats itemCount/countedCount", async () => {
    const s = await seed()
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
      count: { items: LigneInventaire[] }
    }>()
    await req(
      s.ownerCookie,
      "PATCH",
      `/api/v1/inventory-counts/${id}/items/${count.items[0]?.id ?? ""}`,
      { countedQuantity: 4 }
    )
    const liste = await req(
      s.ownerCookie,
      "GET",
      "/api/v1/inventory-counts?statut=open"
    )
    const { counts } = await liste.json<{
      counts: Array<{ id: string; itemCount: number; countedCount: number }>
    }>()
    expect(counts).toEqual([
      expect.objectContaining({ id, itemCount: 2, countedCount: 1 }),
    ])
    expect(
      (await req(s.ownerCookie, "GET", "/api/v1/inventory-counts?statut=zzz"))
        .status
    ).toBe(400)
  })
})
