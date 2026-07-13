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

function req(cookie: string, method: string, url: string) {
  return app.request(url, { method, headers: { cookie } }, env)
}

type LigneValo = {
  variantId: string
  productName: string
  quantity: number
  avgCost: number
  valeur: number
}
type EntrepotValo = {
  warehouseId: string
  warehouseName: string
  valeur: number
  lignes: LigneValo[]
}
type Rapport = { entrepots: EntrepotValo[]; total: number }
type Erreur = { code: string }

// Dépôt : v1 = 10 @ 200 (2000). Boutique : v2 = 5 @ 400 (2000).
// v3 : entré 5 @ 100 puis ajusté à 0 → EXCLU (quantity > 0 seulement).
async function seedValo() {
  const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
  const depotId = await creerEntrepot(organizationId, "Dépôt Central")
  const boutiqueId = await creerEntrepot(
    organizationId,
    "Boutique Valo",
    "store"
  )
  const v1 = await creerProduitSimple(organizationId, { nom: "Article Un" })
  const v2 = await creerProduitSimple(organizationId, { nom: "Article Deux" })
  const v3 = await creerProduitSimple(organizationId, { nom: "Article Vide" })
  const db = drizzle(env.DB, { schema })
  await applyMovements(db, {
    organizationId,
    userId: ownerId,
    mouvements: [
      {
        warehouseId: depotId,
        variantId: v1.variantId,
        delta: 10,
        type: "purchase",
        unitCost: 200,
      },
      {
        warehouseId: boutiqueId,
        variantId: v2.variantId,
        delta: 5,
        type: "purchase",
        unitCost: 400,
      },
      {
        warehouseId: depotId,
        variantId: v3.variantId,
        delta: 5,
        type: "purchase",
        unitCost: 100,
      },
    ],
  })
  await applyMovements(db, {
    organizationId,
    userId: ownerId,
    mouvements: [
      {
        warehouseId: depotId,
        variantId: v3.variantId,
        delta: -5,
        type: "adjustment",
        reason: "vidage test",
      },
    ],
  })
  return {
    organizationId,
    ownerId,
    ownerCookie,
    depotId,
    boutiqueId,
    v1,
    v2,
    v3,
  }
}

describe("GET /api/v1/reports/valuation", () => {
  it("valorise quantité × CMP par variante, totaux par entrepôt et global ; quantité 0 exclue", async () => {
    const { ownerCookie, depotId, boutiqueId, v1, v3 } = await seedValo()
    const res = await req(ownerCookie, "GET", "/api/v1/reports/valuation")
    expect(res.status).toBe(200)
    const { entrepots, total } = await res.json<Rapport>()
    expect(total).toBe(4000)
    expect(entrepots).toHaveLength(2)
    const depot = entrepots.find((e) => e.warehouseId === depotId)
    if (!depot) throw new Error("dépôt absent du rapport")
    expect(depot.valeur).toBe(2000)
    expect(depot.lignes).toHaveLength(1)
    expect(depot.lignes[0].quantity).toBe(10)
    expect(depot.lignes[0].avgCost).toBe(200)
    expect(depot.lignes[0].valeur).toBe(2000)
    expect(depot.lignes[0].productName).toBe("Article Un")
    const idsDepot = depot.lignes.map((l) => l.variantId)
    expect(idsDepot).not.toContain(v3.variantId)
    void v1
    const boutique = entrepots.find((e) => e.warehouseId === boutiqueId)
    expect(boutique?.valeur).toBe(2000)
  })

  it("stock_manager : 200 sur TOUS les entrepôts (son seul rapport)", async () => {
    const { organizationId } = await seedValo()
    const gestionnaire = await createUserWithRole(
      organizationId,
      "stock_manager"
    )
    const res = await req(
      gestionnaire.cookie,
      "GET",
      "/api/v1/reports/valuation"
    )
    expect(res.status).toBe(200)
    expect((await res.json<Rapport>()).total).toBe(4000)
  })

  it("manager local : SES entrepôts seulement ; warehouseId hors portée 403", async () => {
    const { organizationId, depotId, boutiqueId } = await seedValo()
    const manager = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      manager.userId,
      boutiqueId,
      "manager"
    )
    const res = await req(manager.cookie, "GET", "/api/v1/reports/valuation")
    expect(res.status).toBe(200)
    const { entrepots, total } = await res.json<Rapport>()
    expect(total).toBe(2000)
    expect(entrepots).toHaveLength(1)
    expect(entrepots[0].warehouseId).toBe(boutiqueId)
    const horsPortee = await req(
      manager.cookie,
      "GET",
      `/api/v1/reports/valuation?warehouseId=${depotId}`
    )
    expect(horsPortee.status).toBe(403)
  })

  it("caissier pur : 403 ; warehouseId inexistant : 404", async () => {
    const { organizationId, ownerCookie, boutiqueId } = await seedValo()
    const caissier = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      caissier.userId,
      boutiqueId,
      "cashier"
    )
    const refus = await req(caissier.cookie, "GET", "/api/v1/reports/valuation")
    expect(refus.status).toBe(403)
    expect((await refus.json<Erreur>()).code).toBe("ACCES_REFUSE")
    const inconnu = await req(
      ownerCookie,
      "GET",
      `/api/v1/reports/valuation?warehouseId=${crypto.randomUUID()}`
    )
    expect(inconnu.status).toBe(404)
  })

  it("format=csv : plat, en-têtes français, nom daté", async () => {
    const { ownerCookie } = await seedValo()
    const res = await req(
      ownerCookie,
      "GET",
      "/api/v1/reports/valuation?format=csv"
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/csv")
    const jour = new Date().toISOString().slice(0, 10)
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="rapport-valorisation_${jour}.csv"`
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
    expect(lignes[0]).toBe("Entrepôt;Produit;Variante;SKU;Quantité;CMP;Valeur")
    expect(
      lignes.some((l) => l.startsWith("Dépôt Central;Article Un;Standard;"))
    ).toBe(true)
  })

  it("produits inactifs INCLUS dans la valorisation", async () => {
    const { organizationId, ownerCookie, depotId, ownerId } = await seedValo()
    // Créer un produit inactif avec du stock
    const produitInactif = await creerProduitSimple(organizationId, {
      nom: "Article Inactif",
    })
    const db = drizzle(env.DB, { schema })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId: depotId,
          variantId: produitInactif.variantId,
          delta: 8,
          type: "purchase",
          unitCost: 150,
        },
      ],
    })
    // Désactiver le produit
    await db
      .update(schema.products)
      .set({ isActive: false })
      .where(eq(schema.products.id, produitInactif.productId))
    // Appeler le rapport
    const res = await req(ownerCookie, "GET", "/api/v1/reports/valuation")
    expect(res.status).toBe(200)
    const { entrepots, total } = await res.json<Rapport>()
    // Le produit inactif doit toujours être compté
    // Valeur attendue : 8 × 150 = 1200
    expect(total).toBe(5200) // 4000 (seed) + 1200 (inactif)
    const depot = entrepots.find((e) => e.warehouseId === depotId)
    if (!depot) throw new Error("dépôt absent du rapport")
    expect(depot.valeur).toBe(3200) // 2000 (seed) + 1200 (inactif)
    const produitInactifLigne = depot.lignes.find(
      (l) => l.variantId === produitInactif.variantId
    )
    expect(produitInactifLigne).toBeDefined()
    if (produitInactifLigne) {
      expect(produitInactifLigne.productName).toBe("Article Inactif")
      expect(produitInactifLigne.quantity).toBe(8)
      expect(produitInactifLigne.avgCost).toBe(150)
      expect(produitInactifLigne.valeur).toBe(1200)
    }
  })
})
