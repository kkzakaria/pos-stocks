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

type LigneMarge = {
  productName: string
  quantite: number
  ca: number
  cout: number
  marge: number
  estime: boolean
}
type Rapport = {
  total: { ca: number; cout: number; marge: number; estime: boolean }
  lignes: LigneMarge[]
}
type DetailVente = {
  sale: { id: string }
  marge: { cout: number; marge: number; estime: boolean } | null
}

const JOUR = new Date().toISOString().slice(0, 10)

// Boutique CMP 200, produit 500, caissier avec session ouverte ; une vente
// nominale 2 × 500 (coût gelé 2 × 200).
async function seedMarges() {
  const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
  const storeId = await creerEntrepot(organizationId, "Boutique M", "store")
  const caissier = await createUserWithRole(organizationId, "staff")
  await affecterEntrepot(organizationId, caissier.userId, storeId, "cashier")
  const { variantId } = await creerProduitSimple(organizationId, {
    nom: "Produit M",
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
    { storeId, openingFloat: 0 }
  )
  const { id: sessionId } = await ouverture.json<{ id: string }>()
  const vente = await req(caissier.cookie, "POST", "/api/v1/sales", {
    storeId,
    clientRequestId: crypto.randomUUID(),
    items: [{ variantId, quantity: 2, unitPrice: 500 }],
    payments: [{ method: "cash", amount: 1000 }],
  })
  expect(vente.status).toBe(201)
  const { sale } = await vente.json<{ sale: { id: string } }>()
  return {
    organizationId,
    ownerId,
    ownerCookie,
    storeId,
    caissier,
    variantId,
    sessionId,
    saleId: sale.id,
    db,
  }
}

// Vente « historique » (antérieure à la colonne unit_cost) : INSERT direct
// en base avec unit_cost NULL — les triggers 0014 ne bloquent que
// UPDATE/DELETE, et la session du seed est ouverte (sales_session_ouverte).
async function insererVenteHistorique(
  seed: Awaited<ReturnType<typeof seedMarges>>
) {
  const saleId = crypto.randomUUID()
  const maintenant = new Date()
  await seed.db.insert(schema.sales).values({
    id: saleId,
    organizationId: seed.organizationId,
    storeId: seed.storeId,
    registerSessionId: seed.sessionId,
    cashierId: seed.caissier.userId,
    ticketNumber: 9999,
    total: 500,
    currency: "XOF",
    clientRequestId: crypto.randomUUID(),
    createdAt: maintenant,
  })
  await seed.db.insert(schema.saleItems).values({
    id: crypto.randomUUID(),
    organizationId: seed.organizationId,
    saleId,
    variantId: seed.variantId,
    sourceWarehouseId: seed.storeId,
    quantity: 1,
    unitPrice: 500,
    catalogPrice: 500,
    createdAt: maintenant,
  })
  return saleId
}

describe("GET /api/v1/reports/margins", () => {
  it("marge au unitCost FIGÉ, insensible aux réceptions ultérieures", async () => {
    const seed = await seedMarges()
    const avant = await req(
      seed.ownerCookie,
      "GET",
      `/api/v1/reports/margins?du=${JOUR}&au=${JOUR}`
    )
    expect(avant.status).toBe(200)
    const rapportAvant = await avant.json<Rapport>()
    expect(rapportAvant.total).toEqual({
      ca: 1000,
      cout: 400,
      marge: 600,
      estime: false,
    })
    expect(rapportAvant.lignes).toHaveLength(1)
    expect(rapportAvant.lignes[0].quantite).toBe(2)
    // Réception qui change le CMP : la marge de la vente passée NE BOUGE PAS
    await applyMovements(seed.db, {
      organizationId: seed.organizationId,
      userId: seed.ownerId,
      mouvements: [
        {
          warehouseId: seed.storeId,
          variantId: seed.variantId,
          delta: 10,
          type: "purchase",
          unitCost: 800,
        },
      ],
    })
    const apres = await req(
      seed.ownerCookie,
      "GET",
      `/api/v1/reports/margins?du=${JOUR}&au=${JOUR}`
    )
    expect((await apres.json<Rapport>()).total.cout).toBe(400)
  })

  it("ligne historique unit_cost NULL : valorisée au CMP COURANT, marquée estimée", async () => {
    const seed = await seedMarges()
    await insererVenteHistorique(seed)
    const res = await req(
      seed.ownerCookie,
      "GET",
      `/api/v1/reports/margins?du=${JOUR}&au=${JOUR}`
    )
    const rapport = await res.json<Rapport>()
    // 2 × 200 gelés + 1 × 200 (CMP courant, estimé)
    expect(rapport.total).toEqual({
      ca: 1500,
      cout: 600,
      marge: 900,
      estime: true,
    })
    expect(rapport.lignes[0].estime).toBe(true)
  })

  it("portée : stock_manager 403 ; manager local 200 ; caissier 403", async () => {
    const seed = await seedMarges()
    const gestionnaire = await createUserWithRole(
      seed.organizationId,
      "stock_manager"
    )
    expect(
      (
        await req(
          gestionnaire.cookie,
          "GET",
          `/api/v1/reports/margins?du=${JOUR}&au=${JOUR}`
        )
      ).status
    ).toBe(403)
    const manager = await createUserWithRole(seed.organizationId, "staff")
    await affecterEntrepot(
      seed.organizationId,
      manager.userId,
      seed.storeId,
      "manager"
    )
    const vueManager = await req(
      manager.cookie,
      "GET",
      `/api/v1/reports/margins?du=${JOUR}&au=${JOUR}`
    )
    expect(vueManager.status).toBe(200)
    expect((await vueManager.json<Rapport>()).total.marge).toBe(600)
    expect(
      (
        await req(
          seed.caissier.cookie,
          "GET",
          `/api/v1/reports/margins?du=${JOUR}&au=${JOUR}`
        )
      ).status
    ).toBe(403)
  })

  it("format=csv : en-têtes français, colonne Estimé oui/vide", async () => {
    const seed = await seedMarges()
    await insererVenteHistorique(seed)
    const res = await req(
      seed.ownerCookie,
      "GET",
      `/api/v1/reports/margins?du=${JOUR}&au=${JOUR}&format=csv`
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="rapport-marges_${JOUR}_${JOUR}.csv"`
    )
    // Response.text() décode en UTF-8 et — conformément au WHATWG Encoding
    // Standard (algorithme « UTF-8 decode ») — retire silencieusement un
    // BOM de tête : impossible à observer après décodage, y compris dans
    // un vrai navigateur. On vérifie donc le BOM sur les OCTETS bruts
    // (EF BB BF), puis on décode le corps pour le reste des assertions
    // (motif reports-sales.test.ts / reports-valuation.test.ts).
    const octets = new Uint8Array(await res.arrayBuffer())
    expect(Array.from(octets.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    const lignes = new TextDecoder("utf-8").decode(octets).split("\r\n")
    expect(lignes[0]).toBe("Produit;Variante;SKU;Quantité;CA;Coût;Marge;Estimé")
    expect(
      lignes.some(
        (l) => l.startsWith("Produit M;Standard;") && l.endsWith(";oui")
      )
    ).toBe(true)
  })
})

describe("GET /api/v1/sales/:id — marge du détail", () => {
  it("owner : marge présente ; caissier : marge null (le détail reste lisible)", async () => {
    const seed = await seedMarges()
    const vueOwner = await req(
      seed.ownerCookie,
      "GET",
      `/api/v1/sales/${seed.saleId}`
    )
    expect(vueOwner.status).toBe(200)
    const detailOwner = await vueOwner.json<DetailVente>()
    expect(detailOwner.marge).toEqual({ cout: 400, marge: 600, estime: false })
    const vueCaissier = await req(
      seed.caissier.cookie,
      "GET",
      `/api/v1/sales/${seed.saleId}`
    )
    expect(vueCaissier.status).toBe(200)
    const detailCaissier = await vueCaissier.json<DetailVente>()
    expect(detailCaissier.sale.id).toBe(seed.saleId)
    expect(detailCaissier.marge).toBeNull()
  })

  it("manager local : marge présente", async () => {
    const seed = await seedMarges()
    const manager = await createUserWithRole(seed.organizationId, "staff")
    await affecterEntrepot(
      seed.organizationId,
      manager.userId,
      seed.storeId,
      "manager"
    )
    const res = await req(manager.cookie, "GET", `/api/v1/sales/${seed.saleId}`)
    expect(res.status).toBe(200)
    expect((await res.json<DetailVente>()).marge?.marge).toBe(600)
  })
})
