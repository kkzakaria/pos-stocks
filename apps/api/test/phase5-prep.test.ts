import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import app from "../src/index"
import * as schema from "../src/db/schema"
import {
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

// Seconde organisation insérée directement en base (le setup public est
// mono-organisation) — même motif que permissions.test.ts.
async function creerAutreOrgAvecEntrepot(): Promise<string> {
  const db = drizzle(env.DB, { schema })
  const autreOrgId = crypto.randomUUID()
  await db.insert(schema.organization).values({
    id: autreOrgId,
    name: "Autre Société",
    slug: `autre-${autreOrgId.slice(0, 8)}`,
    createdAt: new Date(),
  })
  return creerEntrepot(autreOrgId, "Entrepôt étranger")
}

describe("prep Phase 5 — harmonisation du contrat de lecture stock", () => {
  it("GET /stock/movements?warehouseId cross-org ou inconnu → 404 (aligné sur /levels)", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const entrepotEtranger = await creerAutreOrgAvecEntrepot()
    const cross = await req(
      ownerCookie,
      "GET",
      `/api/v1/stock/movements?warehouseId=${entrepotEtranger}`
    )
    expect(cross.status).toBe(404)
    expect((await cross.json<{ code: string }>()).code).toBe("INTROUVABLE")
    const inconnu = await req(
      ownerCookie,
      "GET",
      `/api/v1/stock/movements?warehouseId=${crypto.randomUUID()}`
    )
    expect(inconnu.status).toBe(404)
  })

  it("GET /stock/alerts?warehouseId : 404 cross-org, filtre par entrepôt sinon", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const entrepotEtranger = await creerAutreOrgAvecEntrepot()
    expect(
      (
        await req(
          ownerCookie,
          "GET",
          `/api/v1/stock/alerts?warehouseId=${entrepotEtranger}`
        )
      ).status
    ).toBe(404)

    // Une alerte dans w1 (stock 1 <= seuil 5), rien dans w2 (stock 100)
    const w1 = await creerEntrepot(organizationId, "Alerte")
    const w2 = await creerEntrepot(organizationId, "Calme")
    const { variantId } = await creerProduitSimple(organizationId, {
      defaultMinStock: 5,
    })
    expect(
      (
        await req(
          ownerCookie,
          "POST",
          `/api/v1/stock/warehouses/${w1}/adjustments`,
          { variantId, delta: 1, reason: "seed" }
        )
      ).status
    ).toBe(201)
    expect(
      (
        await req(
          ownerCookie,
          "POST",
          `/api/v1/stock/warehouses/${w2}/adjustments`,
          { variantId, delta: 100, reason: "seed" }
        )
      ).status
    ).toBe(201)

    const alertesW1 = await req(
      ownerCookie,
      "GET",
      `/api/v1/stock/alerts?warehouseId=${w1}`
    )
    expect(alertesW1.status).toBe(200)
    expect((await alertesW1.json<{ total: number }>()).total).toBe(1)
    const alertesW2 = await req(
      ownerCookie,
      "GET",
      `/api/v1/stock/alerts?warehouseId=${w2}`
    )
    expect((await alertesW2.json<{ total: number }>()).total).toBe(0)
  })

  it("un staff hors portée reçoit 403 (et non 404) sur un warehouseId qu'il ne lit pas", async () => {
    const { organizationId } = await bootstrapOwner()
    const w1 = await creerEntrepot(organizationId)
    const staff = await createUserWithRole(organizationId, "staff")
    const res = await req(
      staff.cookie,
      "GET",
      `/api/v1/stock/movements?warehouseId=${w1}`
    )
    expect(res.status).toBe(403)
  })
})

describe("prep Phase 5 — expiryDate divergent à la validation de réception", () => {
  async function brouillonAvecDeuxLignes(
    peremption1: string,
    peremption2: string
  ) {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const warehouseId = await creerEntrepot(organizationId)
    const fournisseur = await req(ownerCookie, "POST", "/api/v1/suppliers", {
      name: "Sodeci",
    })
    const { id: supplierId } = await fournisseur.json<{ id: string }>()
    const { variantId } = await creerProduitSimple(organizationId, {
      trackLots: true,
    })
    const creation = await req(ownerCookie, "POST", "/api/v1/purchases", {
      warehouseId,
      supplierId,
    })
    const { id } = await creation.json<{ id: string }>()
    for (const expiryDate of [peremption1, peremption2]) {
      const ajout = await req(
        ownerCookie,
        "POST",
        `/api/v1/purchases/${id}/items`,
        {
          variantId,
          quantity: 5,
          unitCost: 100,
          lotNumber: "LOT-A",
          expiryDate,
        }
      )
      expect(ajout.status).toBe(201)
    }
    return { ownerCookie, purchaseId: id }
  }

  it("deux lignes du même lot avec des dates différentes → 400 VALIDATION, rien n'est écrit", async () => {
    const { ownerCookie, purchaseId } = await brouillonAvecDeuxLignes(
      "2027-01-01",
      "2027-06-30"
    )
    const res = await req(
      ownerCookie,
      "POST",
      `/api/v1/purchases/${purchaseId}/receive`
    )
    expect(res.status).toBe(400)
    const corps = await res.json<{ code: string; message: string }>()
    expect(corps.code).toBe("VALIDATION")
    expect(corps.message).toContain("LOT-A")
    // Le document est resté brouillon
    const detail = await req(
      ownerCookie,
      "GET",
      `/api/v1/purchases/${purchaseId}`
    )
    expect(
      (await detail.json<{ purchase: { status: string } }>()).purchase.status
    ).toBe("draft")
  })

  it("deux lignes du même lot avec la même date → validation acceptée", async () => {
    const { ownerCookie, purchaseId } = await brouillonAvecDeuxLignes(
      "2027-01-01",
      "2027-01-01"
    )
    expect(
      (
        await req(
          ownerCookie,
          "POST",
          `/api/v1/purchases/${purchaseId}/receive`
        )
      ).status
    ).toBe(200)
  })
})

describe("prep Phase 5 — matrice de /stock/reconcile pinnée", () => {
  it("admin 200 (dry-run), auditor 403, stock_manager 403", async () => {
    const { organizationId } = await bootstrapOwner()
    const admin = await createUserWithRole(organizationId, "admin")
    const auditor = await createUserWithRole(organizationId, "auditor")
    const gestionnaire = await createUserWithRole(
      organizationId,
      "stock_manager"
    )
    const resAdmin = await req(admin.cookie, "POST", "/api/v1/stock/reconcile")
    expect(resAdmin.status).toBe(200)
    expect(
      await resAdmin.json<{ ecarts: unknown[]; applique: boolean }>()
    ).toEqual({ ecarts: [], applique: false })
    expect(
      (await req(auditor.cookie, "POST", "/api/v1/stock/reconcile")).status
    ).toBe(403)
    expect(
      (await req(gestionnaire.cookie, "POST", "/api/v1/stock/reconcile")).status
    ).toBe(403)
  })
})

describe("prep Phase 5 — GET /users expose l'id des affectations", () => {
  it("chaque affectation porte l'id de warehouse_members (pour le retrait côté web)", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const warehouseId = await creerEntrepot(organizationId)
    const staff = await createUserWithRole(organizationId, "staff")
    const creation = await req(
      ownerCookie,
      "POST",
      "/api/v1/warehouse-members",
      {
        userId: staff.userId,
        warehouseId,
        role: "manager",
      }
    )
    expect(creation.status).toBe(201)
    const { id: assignmentId } = await creation.json<{ id: string }>()

    const liste = await req(ownerCookie, "GET", "/api/v1/users")
    const { users } = await liste.json<{
      users: Array<{
        id: string
        assignments: Array<{ id: string; warehouseId: string }>
      }>
    }>()
    const utilisateur = users.find((u) => u.id === staff.userId)
    expect(utilisateur?.assignments).toEqual([
      expect.objectContaining({ id: assignmentId, warehouseId }),
    ])
  })
})
