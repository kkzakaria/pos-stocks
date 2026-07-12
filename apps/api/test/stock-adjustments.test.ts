import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
import app from "../src/index"
import * as schema from "../src/db/schema"
import {
  bootstrapOwner,
  createUserWithRole,
  creerEntrepot,
  creerProduitSimple,
  affecterEntrepot,
} from "./helpers"

function ajuster(cookie: string, warehouseId: string, body: unknown) {
  return app.request(
    `/api/v1/stock/warehouses/${warehouseId}/adjustments`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

function definirSeuilHttp(
  cookie: string,
  warehouseId: string,
  variantId: string,
  body: unknown
) {
  return app.request(
    `/api/v1/stock/warehouses/${warehouseId}/levels/${variantId}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

async function seed() {
  const { organizationId, ownerCookie } = await bootstrapOwner()
  const warehouseId = await creerEntrepot(organizationId)
  const { variantId } = await creerProduitSimple(organizationId)
  return { organizationId, ownerCookie, warehouseId, variantId }
}

describe("POST /api/v1/stock/warehouses/:warehouseId/adjustments", () => {
  it("owner ajuste (delta +), le mouvement est journalisé avec motif et auteur", async () => {
    const { ownerCookie, warehouseId, variantId } = await seed()
    const res = await ajuster(ownerCookie, warehouseId, {
      variantId,
      delta: 12,
      reason: "Inventaire de départ",
    })
    expect(res.status).toBe(201)
    const { id } = await res.json<{ id: string }>()

    const db = drizzle(env.DB, { schema })
    const mouvements = await db
      .select()
      .from(schema.stockMovements)
      .where(eq(schema.stockMovements.id, id))
    expect(mouvements[0]?.type).toBe("adjustment")
    expect(mouvements[0]?.delta).toBe(12)
    expect(mouvements[0]?.reason).toBe("Inventaire de départ")
  })

  it("motif manquant → 400 VALIDATION ; delta négatif > stock → 409 STOCK_INSUFFISANT détaillé", async () => {
    const { ownerCookie, warehouseId, variantId } = await seed()
    const sansMotif = await ajuster(ownerCookie, warehouseId, {
      variantId,
      delta: 5,
    })
    expect(sansMotif.status).toBe(400)
    expect((await sansMotif.json<{ code: string }>()).code).toBe("VALIDATION")

    await ajuster(ownerCookie, warehouseId, {
      variantId,
      delta: 5,
      reason: "init",
    })
    const trop = await ajuster(ownerCookie, warehouseId, {
      variantId,
      delta: -9,
      reason: "casse",
    })
    expect(trop.status).toBe(409)
    const corps = await trop.json<{
      code: string
      details: Array<{
        variantId: string
        disponible: number
        demande: number
        sku: string
      }>
    }>()
    expect(corps.code).toBe("STOCK_INSUFFISANT")
    expect(corps.details[0]?.disponible).toBe(5)
    expect(corps.details[0]?.demande).toBe(9)
    expect(corps.details[0]?.sku).toContain("TST-")
  })

  // retry : test en matrice multi-utilisateurs (nombreux hachages scrypt) — même
  // flake workerd « Network connection lost » que mon-compte sur les runners CI
  // partagés (PR #6) ; passe systématiquement en local. Le crash mi-test peut en
  // plus faire échouer en cascade le test suivant du fichier.
  it(
    "matrice : manager de l'entrepôt OK, manager d'un autre entrepôt/auditeur/caissier 403, stock_manager OK",
    { retry: 2 },
    async () => {
      const { organizationId, warehouseId, variantId } = await seed()
      const autreEntrepot = await creerEntrepot(organizationId, "Annexe")
      const manager = await createUserWithRole(organizationId, "staff")
      await affecterEntrepot(
        organizationId,
        manager.userId,
        warehouseId,
        "manager"
      )
      const managerAilleurs = await createUserWithRole(organizationId, "staff")
      await affecterEntrepot(
        organizationId,
        managerAilleurs.userId,
        autreEntrepot,
        "manager"
      )
      const auditeurEntrepot = await createUserWithRole(organizationId, "staff")
      await affecterEntrepot(
        organizationId,
        auditeurEntrepot.userId,
        warehouseId,
        "auditor"
      )
      const caissier = await createUserWithRole(organizationId, "staff")
      await affecterEntrepot(
        organizationId,
        caissier.userId,
        warehouseId,
        "cashier"
      )
      const gestStock = await createUserWithRole(
        organizationId,
        "stock_manager"
      )

      const corps = { variantId, delta: 1, reason: "test" }
      expect((await ajuster(manager.cookie, warehouseId, corps)).status).toBe(
        201
      )
      expect(
        (await ajuster(managerAilleurs.cookie, warehouseId, corps)).status
      ).toBe(403)
      expect(
        (await ajuster(auditeurEntrepot.cookie, warehouseId, corps)).status
      ).toBe(403)
      expect((await ajuster(caissier.cookie, warehouseId, corps)).status).toBe(
        403
      )
      expect((await ajuster(gestStock.cookie, warehouseId, corps)).status).toBe(
        201
      )
    }
  )

  it("cross-org : entrepôt d'une autre organisation → 403 ; variante d'une autre organisation → 404", async () => {
    const { ownerCookie, warehouseId } = await seed()
    const db = drizzle(env.DB, { schema })
    const autreOrgId = crypto.randomUUID()
    await db.insert(schema.organization).values({
      id: autreOrgId,
      name: "Autre",
      slug: "autre-ajustements",
      createdAt: new Date(),
    })
    const entrepotCache = await creerEntrepot(autreOrgId)
    const produitCache = await creerProduitSimple(autreOrgId)

    expect(
      (
        await ajuster(ownerCookie, entrepotCache, {
          variantId: produitCache.variantId,
          delta: 1,
          reason: "x",
        })
      ).status
    ).toBe(403)
    expect(
      (
        await ajuster(ownerCookie, warehouseId, {
          variantId: produitCache.variantId,
          delta: 1,
          reason: "x",
        })
      ).status
    ).toBe(404)
  })
})

describe("PATCH /api/v1/stock/warehouses/:warehouseId/levels/:variantId", () => {
  it("manager pose une surcharge de seuil, l'alerte suit, null la retire", async () => {
    const { organizationId, ownerCookie, warehouseId, variantId } = await seed()
    await ajuster(ownerCookie, warehouseId, {
      variantId,
      delta: 8,
      reason: "init",
    })
    const manager = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      manager.userId,
      warehouseId,
      "manager"
    )

    expect(
      (
        await definirSeuilHttp(manager.cookie, warehouseId, variantId, {
          minStock: 20,
        })
      ).status
    ).toBe(200)
    const alertes = await app.request(
      "/api/v1/stock/alerts",
      { headers: { cookie: ownerCookie } },
      env
    )
    expect((await alertes.json<{ total: number }>()).total).toBe(1)

    expect(
      (
        await definirSeuilHttp(manager.cookie, warehouseId, variantId, {
          minStock: null,
        })
      ).status
    ).toBe(200)
    const apres = await app.request(
      "/api/v1/stock/alerts",
      { headers: { cookie: ownerCookie } },
      env
    )
    expect((await apres.json<{ total: number }>()).total).toBe(0)
  })

  it("auditeur d'entrepôt → 403", async () => {
    const { organizationId, warehouseId, variantId } = await seed()
    const auditeur = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      auditeur.userId,
      warehouseId,
      "auditor"
    )
    expect(
      (
        await definirSeuilHttp(auditeur.cookie, warehouseId, variantId, {
          minStock: 5,
        })
      ).status
    ).toBe(403)
  })
})
