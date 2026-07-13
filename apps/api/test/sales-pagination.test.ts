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

type Page = {
  sales: Array<{ ticketNumber: number }>
  total: number
  page: number
  parPage: number
}

const JOUR = new Date().toISOString().slice(0, 10)

async function seedTrois() {
  const { organizationId, ownerId } = await bootstrapOwner()
  const storeId = await creerEntrepot(organizationId, "Boutique Pg", "store")
  const caissier = await createUserWithRole(organizationId, "staff")
  await affecterEntrepot(organizationId, caissier.userId, storeId, "cashier")
  const { variantId } = await creerProduitSimple(organizationId, {
    nom: "Produit Pg",
    prix: 500,
  })
  const db = drizzle(env.DB, { schema })
  await applyMovements(db, {
    organizationId,
    userId: ownerId,
    mouvements: [
      {
        warehouseId: storeId,
        variantId,
        delta: 30,
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
  expect(ouverture.status).toBe(201)
  for (let i = 0; i < 3; i += 1) {
    const res = await req(caissier.cookie, "POST", "/api/v1/sales", {
      storeId,
      clientRequestId: crypto.randomUUID(),
      items: [{ variantId, quantity: 1, unitPrice: 500 }],
      payments: [{ method: "cash", amount: 500 }],
    })
    expect(res.status).toBe(201)
  }
  return { storeId, caissier }
}

describe("GET /api/v1/sales — période et pagination", () => {
  it("pagine avec total (parPage=2 : page 1 → 2 ventes, page 2 → 1)", async () => {
    const { storeId, caissier } = await seedTrois()
    const page1 = await req(
      caissier.cookie,
      "GET",
      `/api/v1/sales?storeId=${storeId}&jour=${JOUR}&page=1&parPage=2`
    )
    expect(page1.status).toBe(200)
    const corps1 = await page1.json<Page>()
    expect(corps1.total).toBe(3)
    expect(corps1.page).toBe(1)
    expect(corps1.parPage).toBe(2)
    expect(corps1.sales).toHaveLength(2)
    // Tri desc conservé : tickets 3 puis 2
    expect(corps1.sales[0].ticketNumber).toBe(3)
    const page2 = await req(
      caissier.cookie,
      "GET",
      `/api/v1/sales?storeId=${storeId}&jour=${JOUR}&page=2&parPage=2`
    )
    const corps2 = await page2.json<Page>()
    expect(corps2.sales).toHaveLength(1)
    expect(corps2.sales[0].ticketNumber).toBe(1)
  })

  it("filtre par période du/au (bornes UTC, fin incluse)", async () => {
    const { storeId, caissier } = await seedTrois()
    const dansPeriode = await req(
      caissier.cookie,
      "GET",
      `/api/v1/sales?storeId=${storeId}&du=${JOUR}&au=${JOUR}`
    )
    expect((await dansPeriode.json<Page>()).total).toBe(3)
    const horsPeriode = await req(
      caissier.cookie,
      "GET",
      `/api/v1/sales?storeId=${storeId}&du=2000-01-01&au=2000-01-02`
    )
    const corpsHors = await horsPeriode.json<Page>()
    expect(corpsHors.total).toBe(0)
    expect(corpsHors.sales).toEqual([])
  })

  it("valide du/au ensemble, dates calendaires, pagination bornée", async () => {
    const { storeId, caissier } = await seedTrois()
    const duSeul = await req(
      caissier.cookie,
      "GET",
      `/api/v1/sales?storeId=${storeId}&du=${JOUR}`
    )
    expect(duSeul.status).toBe(400)
    const dateImpossible = await req(
      caissier.cookie,
      "GET",
      `/api/v1/sales?storeId=${storeId}&du=2026-02-30&au=2026-03-01`
    )
    expect(dateImpossible.status).toBe(400)
    const pageZero = await req(
      caissier.cookie,
      "GET",
      `/api/v1/sales?storeId=${storeId}&jour=${JOUR}&page=0`
    )
    expect(pageZero.status).toBe(400)
    const parPageTrop = await req(
      caissier.cookie,
      "GET",
      `/api/v1/sales?storeId=${storeId}&jour=${JOUR}&parPage=500`
    )
    expect(parPageTrop.status).toBe(400)
  })

  it("rétrocompatible : sans pagination explicite, défauts page=1/parPage=50", async () => {
    const { storeId, caissier } = await seedTrois()
    const res = await req(
      caissier.cookie,
      "GET",
      `/api/v1/sales?storeId=${storeId}&jour=${JOUR}`
    )
    const corps = await res.json<Page>()
    expect(corps.sales).toHaveLength(3)
    expect(corps.total).toBe(3)
    expect(corps.page).toBe(1)
    expect(corps.parPage).toBe(50)
  })
})
