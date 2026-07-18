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

const JOUR = new Date().toISOString().slice(0, 10)

async function seedAvecVente() {
  const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
  const storeId = await creerEntrepot(organizationId, "Boutique H", "store")
  const caissier = await createUserWithRole(organizationId, "staff")
  await affecterEntrepot(organizationId, caissier.userId, storeId, "cashier")
  const { variantId } = await creerProduitSimple(organizationId, {
    nom: "Eau H",
    prix: 300,
  })
  const db = drizzle(env.DB, { schema })
  await applyMovements(db, {
    organizationId,
    userId: ownerId,
    mouvements: [
      {
        warehouseId: storeId,
        variantId,
        delta: 10,
        type: "purchase",
        unitCost: 100,
      },
    ],
  })
  const ouverture = await req(
    caissier.cookie,
    "POST",
    "/api/v1/register-sessions",
    { storeId, openingFloat: 0 }
  )
  const { id: sessionId } = await ouverture.json<{ id: string }>()
  const vente = await req(caissier.cookie, "POST", "/api/v1/sales", {
    storeId,
    clientRequestId: crypto.randomUUID(),
    items: [{ variantId, quantity: 2, unitPrice: 300 }],
    payments: [{ method: "cash", amount: 600, receivedAmount: 1000 }],
  })
  const { sale } = await vente.json<{ sale: { id: string } }>()
  return {
    organizationId,
    ownerCookie,
    storeId,
    caissier,
    sessionId,
    saleId: sale.id,
  }
}

describe("lecture des ventes", () => {
  it("tickets du jour d'une boutique, filtrables par session", async () => {
    const { caissier, storeId, sessionId } = await seedAvecVente()
    const res = await req(
      caissier.cookie,
      "GET",
      `/api/v1/sales?storeId=${storeId}&jour=${JOUR}`
    )
    expect(res.status).toBe(200)
    const corps = await res.json<{
      sales: Array<{ ticketNumber: number; total: number; itemCount: number }>
    }>()
    expect(corps.sales.length).toBe(1)
    expect(corps.sales[0]).toMatchObject({
      ticketNumber: 1,
      total: 600,
      itemCount: 1,
    })
    const parSession = await req(
      caissier.cookie,
      "GET",
      `/api/v1/sales?storeId=${storeId}&sessionId=${sessionId}`
    )
    expect((await parSession.json<{ sales: unknown[] }>()).sales.length).toBe(1)
    const autreJour = await req(
      caissier.cookie,
      "GET",
      `/api/v1/sales?storeId=${storeId}&jour=2020-01-01`
    )
    expect((await autreJour.json<{ sales: unknown[] }>()).sales.length).toBe(0)
  })

  it("jour calendaire invalide → 400", async () => {
    const { caissier, storeId } = await seedAvecVente()
    const res = await req(
      caissier.cookie,
      "GET",
      `/api/v1/sales?storeId=${storeId}&jour=2026-02-30`
    )
    expect(res.status).toBe(400)
  })

  it("jour combiné à du/au → 400 (mutuellement exclusifs)", async () => {
    const { caissier, storeId } = await seedAvecVente()
    const res = await req(
      caissier.cookie,
      "GET",
      `/api/v1/sales?storeId=${storeId}&jour=${JOUR}&du=${JOUR}&au=${JOUR}`
    )
    expect(res.status).toBe(400)
    expect((await res.json<{ code: string }>()).code).toBe("VALIDATION")
  })

  it("jour combiné au seul du → 400 (pas d'intersection silencieuse)", async () => {
    const { caissier, storeId } = await seedAvecVente()
    const res = await req(
      caissier.cookie,
      "GET",
      `/api/v1/sales?storeId=${storeId}&jour=${JOUR}&du=${JOUR}`
    )
    expect(res.status).toBe(400)
  })

  it("store hors organisation + paramètres exclusifs → 403 (accès avant validation)", async () => {
    const { ownerCookie } = await seedAvecVente()
    // Out-of-org storeId combined with jour+du/au: the cross-tenant guard
    // (invariant #7) must win. verifierAccesEntrepot returns 403 ACCES_REFUSE
    // for a warehouse outside the org (without revealing its existence), never
    // the 400 exclusivity validation that, without the access check at the top
    // of the route, would leak first.
    const res = await req(
      ownerCookie,
      "GET",
      `/api/v1/sales?storeId=${crypto.randomUUID()}&jour=${JOUR}&du=${JOUR}&au=${JOUR}`
    )
    expect(res.status).toBe(403)
    expect((await res.json<{ code: string }>()).code).toBe("ACCES_REFUSE")
  })

  it("détail complet pour réimpression (lignes enrichies + paiements)", async () => {
    const { caissier, saleId } = await seedAvecVente()
    const res = await req(caissier.cookie, "GET", `/api/v1/sales/${saleId}`)
    expect(res.status).toBe(200)
    const { sale } = await res.json<{
      sale: {
        ticketNumber: number
        storeName: string
        cashierName: string
        items: Array<{ productName: string; sku: string; unitPrice: number }>
        payments: Array<{ method: string; changeGiven: number | null }>
      }
    }>()
    expect(sale.ticketNumber).toBe(1)
    expect(sale.storeName).toBe("Boutique H")
    expect(sale.items[0].productName).toBe("Eau H")
    expect(sale.payments[0]).toMatchObject({ method: "cash", changeGiven: 400 })
  })

  it("matrice lecture : auditor lit, caissier d'une autre boutique non", async () => {
    const { organizationId, storeId, saleId } = await seedAvecVente()
    const auditeur = await createUserWithRole(organizationId, "auditor")
    const lecture = await req(auditeur.cookie, "GET", `/api/v1/sales/${saleId}`)
    expect(lecture.status).toBe(200)
    const autreBoutique = await creerEntrepot(
      organizationId,
      "Autre H",
      "store"
    )
    const autreCaissier = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      autreCaissier.userId,
      autreBoutique,
      "cashier"
    )
    const refusListe = await req(
      autreCaissier.cookie,
      "GET",
      `/api/v1/sales?storeId=${storeId}`
    )
    expect(refusListe.status).toBe(403)
    const refusDetail = await req(
      autreCaissier.cookie,
      "GET",
      `/api/v1/sales/${saleId}`
    )
    expect(refusDetail.status).toBe(403)
  })

  it("vente inconnue → 404", async () => {
    const { caissier } = await seedAvecVente()
    const res = await req(
      caissier.cookie,
      "GET",
      `/api/v1/sales/${crypto.randomUUID()}`
    )
    expect(res.status).toBe(404)
  })
})
