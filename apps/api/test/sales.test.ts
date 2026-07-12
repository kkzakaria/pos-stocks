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

type VenteDetail = {
  id: string
  ticketNumber: number
  total: number
  currency: string
  items: Array<{
    variantId: string
    quantity: number
    unitPrice: number
    catalogPrice: number
    sourceWarehouseId: string
    lotNumber: string | null
  }>
  payments: Array<{
    method: string
    amount: number
    receivedAmount: number | null
    changeGiven: number | null
  }>
}
type ReponseVente = { sale: VenteDetail; dejaEnregistree: boolean }
type Erreur = { code: string; details?: unknown }

async function quantite(warehouseId: string, variantId: string) {
  const db = drizzle(env.DB, { schema })
  const rows = await db
    .select({ quantity: schema.stockLevels.quantity })
    .from(schema.stockLevels)
    .where(
      and(
        eq(schema.stockLevels.warehouseId, warehouseId),
        eq(schema.stockLevels.variantId, variantId)
      )
    )
    .limit(1)
  return rows[0]?.quantity ?? 0
}

async function seedVente() {
  const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
  const storeId = await creerEntrepot(organizationId, "Boutique V", "store")
  const reserveId = await creerEntrepot(organizationId, "Réserve V")
  const caissier = await createUserWithRole(organizationId, "staff")
  await affecterEntrepot(organizationId, caissier.userId, storeId, "cashier")
  const { productId, variantId } = await creerProduitSimple(organizationId, {
    nom: "Coca V",
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
        delta: 10,
        type: "purchase",
        unitCost: 200,
      },
      {
        warehouseId: reserveId,
        variantId,
        delta: 20,
        type: "purchase",
        unitCost: 200,
      },
    ],
  })
  const ouverture = await req(
    caissier.cookie,
    "POST",
    "/api/v1/register-sessions",
    { storeId, openingFloat: 5000 }
  )
  const { id: sessionId } = await ouverture.json<{ id: string }>()
  return {
    organizationId,
    ownerId,
    ownerCookie,
    storeId,
    reserveId,
    caissier,
    productId,
    variantId,
    sessionId,
    db,
  }
}

function corpsVente(
  storeId: string,
  variantId: string,
  surcharge: Partial<{
    quantity: number
    unitPrice: number
    sourceWarehouseId: string
    payments: unknown[]
    clientRequestId: string
  }> = {}
) {
  const quantity = surcharge.quantity ?? 2
  const unitPrice = surcharge.unitPrice ?? 500
  return {
    storeId,
    clientRequestId: surcharge.clientRequestId ?? crypto.randomUUID(),
    items: [
      {
        variantId,
        quantity,
        unitPrice,
        ...(surcharge.sourceWarehouseId
          ? { sourceWarehouseId: surcharge.sourceWarehouseId }
          : {}),
      },
    ],
    payments: surcharge.payments ?? [
      {
        method: "cash",
        amount: quantity * unitPrice,
        receivedAmount: quantity * unitPrice + 500,
      },
    ],
  }
}

describe("POST /api/v1/sales — vente atomique", () => {
  it("vente cash nominale : ticket n°1, stock décrémenté, monnaie calculée", async () => {
    const { storeId, caissier, variantId } = await seedVente()
    const res = await req(
      caissier.cookie,
      "POST",
      "/api/v1/sales",
      corpsVente(storeId, variantId)
    )
    expect(res.status).toBe(201)
    const corps = await res.json<ReponseVente>()
    expect(corps.dejaEnregistree).toBe(false)
    expect(corps.sale.ticketNumber).toBe(1)
    expect(corps.sale.total).toBe(1000)
    expect(corps.sale.currency).toBe("XOF")
    expect(corps.sale.items[0].catalogPrice).toBe(500)
    expect(corps.sale.payments[0].changeGiven).toBe(500)
    expect(await quantite(storeId, variantId)).toBe(8)
    // Journal : un mouvement sale référencé sur la vente
    const db = drizzle(env.DB, { schema })
    const mouvements = await db
      .select({
        type: schema.stockMovements.type,
        delta: schema.stockMovements.delta,
        refId: schema.stockMovements.refId,
      })
      .from(schema.stockMovements)
      .where(
        and(
          eq(schema.stockMovements.warehouseId, storeId),
          eq(schema.stockMovements.type, "sale")
        )
      )
    expect(mouvements).toEqual([
      { type: "sale", delta: -2, refId: corps.sale.id },
    ])
  })

  it("numéros de ticket séquentiels PAR boutique", async () => {
    const { organizationId, ownerCookie, storeId, caissier, variantId } =
      await seedVente()
    const v1 = await req(
      caissier.cookie,
      "POST",
      "/api/v1/sales",
      corpsVente(storeId, variantId)
    )
    const v2 = await req(
      caissier.cookie,
      "POST",
      "/api/v1/sales",
      corpsVente(storeId, variantId)
    )
    expect((await v1.json<ReponseVente>()).sale.ticketNumber).toBe(1)
    expect((await v2.json<ReponseVente>()).sale.ticketNumber).toBe(2)
    // Autre boutique : la séquence repart à 1
    const boutique2 = await creerEntrepot(
      organizationId,
      "Boutique V2",
      "store"
    )
    const db = drizzle(env.DB, { schema })
    await applyMovements(db, {
      organizationId,
      userId: caissier.userId,
      mouvements: [
        {
          warehouseId: boutique2,
          variantId,
          delta: 5,
          type: "purchase",
          unitCost: 200,
        },
      ],
    })
    await req(ownerCookie, "POST", "/api/v1/register-sessions", {
      storeId: boutique2,
      openingFloat: 0,
    })
    const v3 = await req(
      ownerCookie,
      "POST",
      "/api/v1/sales",
      corpsVente(boutique2, variantId)
    )
    expect(v3.status).toBe(201)
    expect((await v3.json<ReponseVente>()).sale.ticketNumber).toBe(1)
  })

  it("idempotence : le même clientRequestId renvoie la vente EXISTANTE (200), sans double décrément", async () => {
    const { storeId, caissier, variantId } = await seedVente()
    const clientRequestId = crypto.randomUUID()
    const corps = corpsVente(storeId, variantId, { clientRequestId })
    const premiere = await req(caissier.cookie, "POST", "/api/v1/sales", corps)
    expect(premiere.status).toBe(201)
    const retry = await req(caissier.cookie, "POST", "/api/v1/sales", corps)
    expect(retry.status).toBe(200)
    const corpsRetry = await retry.json<ReponseVente>()
    expect(corpsRetry.dejaEnregistree).toBe(true)
    expect(corpsRetry.sale.ticketNumber).toBe(1)
    // Pas de doublon, pas de second décrément
    const db = drizzle(env.DB, { schema })
    const ventes = await db
      .select({ id: schema.sales.id })
      .from(schema.sales)
      .where(eq(schema.sales.storeId, storeId))
    expect(ventes.length).toBe(1)
    expect(await quantite(storeId, variantId)).toBe(8)
  })

  it("stock insuffisant : 409 détaillé, RIEN n'est écrit", async () => {
    const { storeId, caissier, variantId } = await seedVente()
    const res = await req(
      caissier.cookie,
      "POST",
      "/api/v1/sales",
      corpsVente(storeId, variantId, { quantity: 11, unitPrice: 500 })
    )
    expect(res.status).toBe(409)
    const corps = await res.json<{
      code: string
      details: Array<{ variantId: string; disponible: number; demande: number }>
    }>()
    expect(corps.code).toBe("STOCK_INSUFFISANT")
    expect(corps.details[0]).toMatchObject({
      variantId,
      disponible: 10,
      demande: 11,
    })
    expect(await quantite(storeId, variantId)).toBe(10)
    const db = drizzle(env.DB, { schema })
    const ventes = await db
      .select({ id: schema.sales.id })
      .from(schema.sales)
      .where(eq(schema.sales.storeId, storeId))
    expect(ventes.length).toBe(0)
  })

  it("prix : sous le plancher refusé avec minimum ; sans plancher, prix catalogue obligatoire ; négocié ≥ plancher accepté", async () => {
    const { storeId, caissier, variantId, productId, db } = await seedVente()
    // Sans plancher : prix modifié refusé
    const libre = await req(
      caissier.cookie,
      "POST",
      "/api/v1/sales",
      corpsVente(storeId, variantId, { unitPrice: 450, quantity: 1 })
    )
    expect(libre.status).toBe(400)
    expect((await libre.json<Erreur>()).code).toBe("PRIX_NON_MODIFIABLE")
    // Plancher à 400
    await db
      .update(schema.products)
      .set({ minPrice: 400 })
      .where(eq(schema.products.id, productId))
    const sous = await req(
      caissier.cookie,
      "POST",
      "/api/v1/sales",
      corpsVente(storeId, variantId, { unitPrice: 350, quantity: 1 })
    )
    expect(sous.status).toBe(400)
    const corpsSous = await sous.json<{
      code: string
      details: Array<{ variantId: string; minimum: number }>
    }>()
    expect(corpsSous.code).toBe("PRIX_SOUS_PLANCHER")
    expect(corpsSous.details[0].minimum).toBe(400)
    // Négocié à 450 (≥ 400) : accepté, catalogue figé à 500
    const ok = await req(
      caissier.cookie,
      "POST",
      "/api/v1/sales",
      corpsVente(storeId, variantId, { unitPrice: 450, quantity: 1 })
    )
    expect(ok.status).toBe(201)
    const corpsOk = await ok.json<ReponseVente>()
    expect(corpsOk.sale.items[0].unitPrice).toBe(450)
    expect(corpsOk.sale.items[0].catalogPrice).toBe(500)
  })

  it("session de caisse requise pour vendre", async () => {
    const { ownerCookie, storeId, variantId } = await seedVente()
    // Le owner n'a PAS de session ouverte (celle du seed est au caissier)
    const res = await req(
      ownerCookie,
      "POST",
      "/api/v1/sales",
      corpsVente(storeId, variantId)
    )
    expect(res.status).toBe(409)
    expect((await res.json<Erreur>()).code).toBe("SESSION_CAISSE_REQUISE")
  })

  it("paiements : mixte accepté ; mobile money sans référence et somme ≠ total refusés par Zod", async () => {
    const { storeId, caissier, variantId } = await seedVente()
    const mixte = await req(
      caissier.cookie,
      "POST",
      "/api/v1/sales",
      corpsVente(storeId, variantId, {
        quantity: 2,
        unitPrice: 500,
        payments: [
          { method: "cash", amount: 600, receivedAmount: 600 },
          { method: "mobile_money", amount: 400, reference: "OM-12345" },
        ],
      })
    )
    expect(mixte.status).toBe(201)
    expect((await mixte.json<ReponseVente>()).sale.payments.length).toBe(2)
    const sansRef = await req(
      caissier.cookie,
      "POST",
      "/api/v1/sales",
      corpsVente(storeId, variantId, {
        payments: [{ method: "mobile_money", amount: 1000 }],
      })
    )
    expect(sansRef.status).toBe(400)
    const incomplet = await req(
      caissier.cookie,
      "POST",
      "/api/v1/sales",
      corpsVente(storeId, variantId, {
        payments: [{ method: "cash", amount: 999 }],
      })
    )
    expect(incomplet.status).toBe(400)
  })

  it("FEFO : déduit du lot qui expire le premier, répartit, et fige le lot sur la ligne quand il est unique", async () => {
    const { organizationId, ownerId, storeId, caissier, db } = await seedVente()
    const { variantId } = await creerProduitSimple(organizationId, {
      nom: "Yaourt V",
      prix: 300,
      trackLots: true,
    })
    const maintenant = new Date()
    const lotTot = crypto.randomUUID()
    const lotTard = crypto.randomUUID()
    await db.insert(schema.lots).values([
      {
        id: lotTot,
        organizationId,
        variantId,
        lotNumber: "TOT",
        expiryDate: new Date("2026-08-01"),
        createdAt: maintenant,
      },
      {
        id: lotTard,
        organizationId,
        variantId,
        lotNumber: "TARD",
        expiryDate: new Date("2027-06-01"),
        createdAt: maintenant,
      },
    ])
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId: storeId,
          variantId,
          lotId: lotTot,
          delta: 2,
          type: "purchase",
          unitCost: 100,
        },
        {
          warehouseId: storeId,
          variantId,
          lotId: lotTard,
          delta: 10,
          type: "purchase",
          unitCost: 100,
        },
      ],
    })
    // Vente de 5 : 2 sur TOT + 3 sur TARD → deux mouvements, ligne sans lot
    const repartie = await req(
      caissier.cookie,
      "POST",
      "/api/v1/sales",
      corpsVente(storeId, variantId, { quantity: 5, unitPrice: 300 })
    )
    expect(repartie.status).toBe(201)
    const corpsRepartie = await repartie.json<ReponseVente>()
    expect(corpsRepartie.sale.items[0].lotNumber).toBeNull()
    const mouvements = await db
      .select({
        lotId: schema.stockMovements.lotId,
        delta: schema.stockMovements.delta,
      })
      .from(schema.stockMovements)
      .where(
        and(
          eq(schema.stockMovements.variantId, variantId),
          eq(schema.stockMovements.type, "sale")
        )
      )
    expect(mouvements.sort((a, b) => a.delta - b.delta)).toEqual([
      { lotId: lotTard, delta: -3 },
      { lotId: lotTot, delta: -2 },
    ])
    // Vente de 4 : TOT épuisé → tout sur TARD, lot figé sur la ligne
    const unique = await req(
      caissier.cookie,
      "POST",
      "/api/v1/sales",
      corpsVente(storeId, variantId, { quantity: 4, unitPrice: 300 })
    )
    expect(unique.status).toBe(201)
    expect((await unique.json<ReponseVente>()).sale.items[0].lotNumber).toBe(
      "TARD"
    )
    expect(await quantite(storeId, variantId)).toBe(3)
  })

  it("dépannage : la ligne sort de la RÉSERVE, le stock boutique est intact", async () => {
    const { storeId, reserveId, caissier, variantId } = await seedVente()
    const res = await req(
      caissier.cookie,
      "POST",
      "/api/v1/sales",
      corpsVente(storeId, variantId, {
        quantity: 3,
        sourceWarehouseId: reserveId,
        unitPrice: 500,
      })
    )
    expect(res.status).toBe(201)
    const corps = await res.json<ReponseVente>()
    expect(corps.sale.items[0].sourceWarehouseId).toBe(reserveId)
    expect(await quantite(storeId, variantId)).toBe(10)
    expect(await quantite(reserveId, variantId)).toBe(17)
  })

  it("matrice : stock_manager et auditor ne vendent pas", async () => {
    const { organizationId, storeId, variantId } = await seedVente()
    const gestionnaire = await createUserWithRole(
      organizationId,
      "stock_manager"
    )
    const auditeur = await createUserWithRole(organizationId, "auditor")
    for (const cookie of [gestionnaire.cookie, auditeur.cookie]) {
      const res = await req(
        cookie,
        "POST",
        "/api/v1/sales",
        corpsVente(storeId, variantId)
      )
      expect(res.status).toBe(403)
    }
  })

  it("l'écart de fermeture compte les encaissements cash NETS de la session", async () => {
    const { storeId, caissier, variantId, sessionId } = await seedVente()
    await req(
      caissier.cookie,
      "POST",
      "/api/v1/sales",
      corpsVente(storeId, variantId, {
        quantity: 2,
        unitPrice: 500,
        payments: [
          { method: "cash", amount: 600, receivedAmount: 1000 },
          { method: "mobile_money", amount: 400, reference: "OM-1" },
        ],
      })
    )
    // Attendu cash = fond 5000 + 600 (le mobile money ne compte pas, la
    // monnaie est déjà nette : amount = part du total)
    const fermeture = await req(
      caissier.cookie,
      "POST",
      `/api/v1/register-sessions/${sessionId}/close`,
      { countedAmount: 5600 }
    )
    expect(fermeture.status).toBe(200)
    const { session } = await fermeture.json<{
      session: { expectedCash: number; difference: number }
    }>()
    expect(session.expectedCash).toBe(5600)
    expect(session.difference).toBe(0)
  })
})
