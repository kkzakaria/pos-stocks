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

type Erreur = { code: string }
type TotalVentes = {
  ca: number
  tickets: number
  panierMoyen: number
  cash: number
  mobileMoney: number
}
type LigneBoutique = TotalVentes & { storeId: string; storeName: string }
type RapportBoutiques = { total: TotalVentes; lignes: LigneBoutique[] }
type LigneProduit = {
  productName: string
  quantite: number
  ca: number
  remise: number
  tickets: number
}
type RapportProduits = { total: TotalVentes; lignes: LigneProduit[] }
type Paiement = {
  method: "cash" | "mobile_money"
  amount: number
  reference?: string
}

// Jour UTC courant : les ventes de test sont créées « maintenant » côté
// serveur, la période [aujourd'hui, aujourd'hui] les couvre.
const JOUR = new Date().toISOString().slice(0, 10)

async function vendre(
  cookie: string,
  storeId: string,
  variantId: string,
  quantity: number,
  unitPrice: number,
  payments: Paiement[]
) {
  const res = await req(cookie, "POST", "/api/v1/sales", {
    storeId,
    clientRequestId: crypto.randomUUID(),
    items: [{ variantId, quantity, unitPrice }],
    payments,
  })
  expect(res.status).toBe(201)
}

// Deux boutiques, un produit négociable (plancher 400), trois ventes :
// Alpha : 2 × 450 cash (remise 100) ; Alpha : 1 × 500 mixte (200 cash +
// 300 mobile) ; Beta : 4 × 500 cash. L'owner vend (bypass) : une session
// par boutique (l'index unique 0014 est par (boutique, caissier)).
async function seedRapport() {
  const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
  const alphaId = await creerEntrepot(organizationId, "Boutique Alpha", "store")
  const betaId = await creerEntrepot(organizationId, "Boutique Beta", "store")
  const { productId, variantId } = await creerProduitSimple(organizationId, {
    nom: "Cola",
    prix: 500,
  })
  const db = drizzle(env.DB, { schema })
  await db
    .update(schema.products)
    .set({ minPrice: 400 })
    .where(eq(schema.products.id, productId))
  await applyMovements(db, {
    organizationId,
    userId: ownerId,
    mouvements: [
      {
        warehouseId: alphaId,
        variantId,
        delta: 50,
        type: "purchase",
        unitCost: 200,
      },
      {
        warehouseId: betaId,
        variantId,
        delta: 50,
        type: "purchase",
        unitCost: 200,
      },
    ],
  })
  for (const storeId of [alphaId, betaId]) {
    const ouverture = await req(
      ownerCookie,
      "POST",
      "/api/v1/register-sessions",
      { storeId, openingFloat: 0 }
    )
    expect(ouverture.status).toBe(201)
  }
  await vendre(ownerCookie, alphaId, variantId, 2, 450, [
    { method: "cash", amount: 900 },
  ])
  await vendre(ownerCookie, alphaId, variantId, 1, 500, [
    { method: "cash", amount: 200 },
    { method: "mobile_money", amount: 300, reference: "MM-1" },
  ])
  await vendre(ownerCookie, betaId, variantId, 4, 500, [
    { method: "cash", amount: 2000 },
  ])
  return { organizationId, ownerCookie, alphaId, betaId, variantId }
}

describe("GET /api/v1/reports/sales", () => {
  it("groupe par boutique : CA, tickets, panier moyen, répartition par méthode", async () => {
    const { ownerCookie, alphaId, betaId } = await seedRapport()
    const res = await req(
      ownerCookie,
      "GET",
      `/api/v1/reports/sales?du=${JOUR}&au=${JOUR}`
    )
    expect(res.status).toBe(200)
    const { total, lignes } = await res.json<RapportBoutiques>()
    expect(total).toEqual({
      ca: 3400,
      tickets: 3,
      panierMoyen: 1133,
      cash: 3100,
      mobileMoney: 300,
    })
    expect(lignes).toHaveLength(2)
    const alpha = lignes.find((l) => l.storeId === alphaId)
    expect(alpha).toEqual({
      storeId: alphaId,
      storeName: "Boutique Alpha",
      ca: 1400,
      tickets: 2,
      panierMoyen: 700,
      cash: 1100,
      mobileMoney: 300,
    })
    const beta = lignes.find((l) => l.storeId === betaId)
    expect(beta?.ca).toBe(2000)
    expect(beta?.tickets).toBe(1)
    expect(beta?.cash).toBe(2000)
    expect(beta?.mobileMoney).toBe(0)
  })

  it("groupe par produit : quantités, CA, remises consenties, tickets", async () => {
    const { ownerCookie } = await seedRapport()
    const res = await req(
      ownerCookie,
      "GET",
      `/api/v1/reports/sales?du=${JOUR}&au=${JOUR}&groupe=produit`
    )
    expect(res.status).toBe(200)
    const { lignes } = await res.json<RapportProduits>()
    expect(lignes).toHaveLength(1)
    expect(lignes[0].productName).toBe("Cola")
    expect(lignes[0].quantite).toBe(7)
    expect(lignes[0].ca).toBe(3400)
    // 2 unités vendues 450 au lieu de 500 catalogue
    expect(lignes[0].remise).toBe(100)
    expect(lignes[0].tickets).toBe(3)
  })

  it("période sans vente : lignes vides, totaux à zéro", async () => {
    const { ownerCookie } = await seedRapport()
    const res = await req(
      ownerCookie,
      "GET",
      "/api/v1/reports/sales?du=2000-01-01&au=2000-01-02"
    )
    expect(res.status).toBe(200)
    const { total, lignes } = await res.json<RapportBoutiques>()
    expect(lignes).toEqual([])
    expect(total.ca).toBe(0)
    expect(total.tickets).toBe(0)
    expect(total.panierMoyen).toBe(0)
  })

  it("valide la période et le groupe", async () => {
    const { ownerCookie } = await seedRapport()
    const sansAu = await req(
      ownerCookie,
      "GET",
      `/api/v1/reports/sales?du=${JOUR}`
    )
    expect(sansAu.status).toBe(400)
    const dateImpossible = await req(
      ownerCookie,
      "GET",
      "/api/v1/reports/sales?du=2026-02-30&au=2026-03-01"
    )
    expect(dateImpossible.status).toBe(400)
    const groupeInvalide = await req(
      ownerCookie,
      "GET",
      `/api/v1/reports/sales?du=${JOUR}&au=${JOUR}&groupe=caissier`
    )
    expect(groupeInvalide.status).toBe(400)
    expect((await groupeInvalide.json<Erreur>()).code).toBe("VALIDATION")
  })

  it("portée : manager local ne voit que SA boutique ; stock_manager et caissier 403 ; auditor org voit tout", async () => {
    const { organizationId, alphaId, betaId } = await seedRapport()
    const manager = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, manager.userId, alphaId, "manager")
    const vueManager = await req(
      manager.cookie,
      "GET",
      `/api/v1/reports/sales?du=${JOUR}&au=${JOUR}`
    )
    expect(vueManager.status).toBe(200)
    const rapportManager = await vueManager.json<RapportBoutiques>()
    expect(rapportManager.lignes).toHaveLength(1)
    expect(rapportManager.lignes[0].storeId).toBe(alphaId)
    expect(rapportManager.total.ca).toBe(1400)
    const horsPortee = await req(
      manager.cookie,
      "GET",
      `/api/v1/reports/sales?du=${JOUR}&au=${JOUR}&storeId=${betaId}`
    )
    expect(horsPortee.status).toBe(403)

    const gestionnaire = await createUserWithRole(
      organizationId,
      "stock_manager"
    )
    const refusGestionnaire = await req(
      gestionnaire.cookie,
      "GET",
      `/api/v1/reports/sales?du=${JOUR}&au=${JOUR}`
    )
    expect(refusGestionnaire.status).toBe(403)

    const caissier = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, caissier.userId, alphaId, "cashier")
    const refusCaissier = await req(
      caissier.cookie,
      "GET",
      `/api/v1/reports/sales?du=${JOUR}&au=${JOUR}`
    )
    expect(refusCaissier.status).toBe(403)

    const auditor = await createUserWithRole(organizationId, "auditor")
    const vueAuditor = await req(
      auditor.cookie,
      "GET",
      `/api/v1/reports/sales?du=${JOUR}&au=${JOUR}`
    )
    expect(vueAuditor.status).toBe(200)
    expect((await vueAuditor.json<RapportBoutiques>()).lignes).toHaveLength(2)
  })

  it("storeId inexistant → 404 INTROUVABLE", async () => {
    const { ownerCookie } = await seedRapport()
    const res = await req(
      ownerCookie,
      "GET",
      `/api/v1/reports/sales?du=${JOUR}&au=${JOUR}&storeId=${crypto.randomUUID()}`
    )
    expect(res.status).toBe(404)
    expect((await res.json<Erreur>()).code).toBe("INTROUVABLE")
  })

  it("format=csv : BOM, point-virgule, en-têtes français, nom de fichier daté", async () => {
    const { ownerCookie } = await seedRapport()
    const res = await req(
      ownerCookie,
      "GET",
      `/api/v1/reports/sales?du=${JOUR}&au=${JOUR}&format=csv`
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/csv")
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="rapport-ventes-boutiques_${JOUR}_${JOUR}.csv"`
    )
    // Response.text() décode en UTF-8 et — conformément au WHATWG Encoding
    // Standard (algorithme « UTF-8 decode ») — retire silencieusement un
    // BOM de tête : impossible à observer après décodage, y compris dans
    // un vrai navigateur. On vérifie donc le BOM sur les OCTETS bruts
    // (EF BB BF), puis on décode le corps pour le reste des assertions.
    const octets = new Uint8Array(await res.arrayBuffer())
    expect(Array.from(octets.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    const corps = new TextDecoder("utf-8").decode(octets)
    const lignes = corps.split("\r\n")
    expect(lignes[0]).toBe(
      "Boutique;CA;Tickets;Panier moyen;Espèces;Mobile money"
    )
    expect(lignes).toContain("Boutique Alpha;1400;2;700;1100;300")
    expect(lignes).toContain("Boutique Beta;2000;1;2000;2000;0")
  })
})
