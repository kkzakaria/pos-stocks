import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import app from "../src/index"
import * as schema from "../src/db/schema"
import { applyMovements, definirSeuil } from "../src/services/stock"
import {
  bootstrapOwner,
  createUserWithRole,
  creerEntrepot,
  creerProduitSimple,
  affecterEntrepot,
} from "./helpers"

function get(cookie: string, url: string) {
  return app.request(url, { headers: { cookie } }, env)
}

type Niveau = {
  variantId: string
  productName: string
  quantity: number
  avgCost: number
  seuilEffectif: number | null
  enAlerte: boolean
}

async function seed() {
  const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
  const depotId = await creerEntrepot(organizationId, "Dépôt central")
  const boutiqueId = await creerEntrepot(
    organizationId,
    "Boutique Plateau",
    "store"
  )
  const produit = await creerProduitSimple(organizationId, {
    nom: "Coca 50cl",
    defaultMinStock: 10,
  })
  const db = drizzle(env.DB, { schema })
  await applyMovements(db, {
    organizationId,
    userId: ownerId,
    mouvements: [
      {
        warehouseId: depotId,
        variantId: produit.variantId,
        delta: 24,
        type: "purchase",
        unitCost: 150,
      },
      {
        warehouseId: boutiqueId,
        variantId: produit.variantId,
        delta: 4,
        type: "purchase",
        unitCost: 150,
      },
    ],
  })
  return {
    organizationId,
    ownerId,
    ownerCookie,
    depotId,
    boutiqueId,
    produit,
    db,
  }
}

describe("GET /api/v1/stock/levels", () => {
  it("owner : niveaux d'un entrepôt avec CMP et seuil effectif hérité du produit", async () => {
    const { ownerCookie, depotId } = await seed()
    const res = await get(
      ownerCookie,
      `/api/v1/stock/levels?warehouseId=${depotId}`
    )
    expect(res.status).toBe(200)
    const { levels } = await res.json<{ levels: Niveau[] }>()
    expect(levels).toHaveLength(1)
    expect(levels[0]?.quantity).toBe(24)
    expect(levels[0]?.avgCost).toBe(150)
    expect(levels[0]?.seuilEffectif).toBe(10)
    expect(levels[0]?.enAlerte).toBe(false)
  })

  it("warehouseId requis (400) ; entrepôt d'une autre organisation → 404", async () => {
    const { ownerCookie } = await seed()
    expect((await get(ownerCookie, "/api/v1/stock/levels")).status).toBe(400)

    const db = drizzle(env.DB, { schema })
    const autreOrgId = crypto.randomUUID()
    await db.insert(schema.organization).values({
      id: autreOrgId,
      name: "Autre",
      slug: "autre-stock",
      createdAt: new Date(),
    })
    const entrepotCache = await creerEntrepot(autreOrgId, "Caché")
    expect(
      (
        await get(
          ownerCookie,
          `/api/v1/stock/levels?warehouseId=${entrepotCache}`
        )
      ).status
    ).toBe(404)
  })

  it("staff : manager/auditor voit SES entrepôts, cashier et non-affecté 403", async () => {
    const { organizationId, depotId, boutiqueId } = await seed()
    const manager = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, manager.userId, depotId, "manager")
    const caissier = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      caissier.userId,
      boutiqueId,
      "cashier"
    )

    expect(
      (await get(manager.cookie, `/api/v1/stock/levels?warehouseId=${depotId}`))
        .status
    ).toBe(200)
    expect(
      (
        await get(
          manager.cookie,
          `/api/v1/stock/levels?warehouseId=${boutiqueId}`
        )
      ).status
    ).toBe(403)
    expect(
      (
        await get(
          caissier.cookie,
          `/api/v1/stock/levels?warehouseId=${boutiqueId}`
        )
      ).status
    ).toBe(403)
  })

  it("recherche littérale et filtre alertes=true", async () => {
    const { organizationId, ownerId, ownerCookie, depotId, db } = await seed()
    const bas = await creerProduitSimple(organizationId, {
      nom: "Fanta 100%",
      defaultMinStock: 10,
    })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId: depotId,
          variantId: bas.variantId,
          delta: 3,
          type: "purchase",
          unitCost: 100,
        },
      ],
    })

    const params = new URLSearchParams({
      warehouseId: depotId,
      recherche: "100%",
    })
    const recherche = await get(
      ownerCookie,
      `/api/v1/stock/levels?${params.toString()}`
    )
    const corpsRecherche = await recherche.json<{ levels: Niveau[] }>()
    expect(corpsRecherche.levels.map((l) => l.productName)).toEqual([
      "Fanta 100%",
    ])

    const alertes = await get(
      ownerCookie,
      `/api/v1/stock/levels?warehouseId=${depotId}&alertes=true`
    )
    const corpsAlertes = await alertes.json<{ levels: Niveau[] }>()
    expect(corpsAlertes.levels.map((l) => l.productName)).toEqual([
      "Fanta 100%",
    ])
    expect(corpsAlertes.levels[0]?.enAlerte).toBe(true)
  })

  it.each([
    { role: "admin", name: "admin" },
    { role: "auditor", name: "auditeur" },
    { role: "stock_manager", name: "gestionnaire de stock" },
  ] as const)(
    "rôle global $name : lit les niveaux de tous les entrepôts",
    async ({ role, name }) => {
      const { organizationId, depotId, boutiqueId } = await seed()
      const user = await createUserWithRole(organizationId, role)

      // Lit du dépôt (non-assigné localement)
      const resDepot = await get(
        user.cookie,
        `/api/v1/stock/levels?warehouseId=${depotId}`
      )
      expect(resDepot.status).toBe(200)
      const { levels } = await resDepot.json<{ levels: Niveau[] }>()
      expect(levels).toHaveLength(1)
      expect(levels[0]?.quantity).toBe(24)

      // Lit de la boutique (non-assigné localement)
      const resBoutique = await get(
        user.cookie,
        `/api/v1/stock/levels?warehouseId=${boutiqueId}`
      )
      expect(resBoutique.status).toBe(200)
      const { levels: levelsBoutique } = await resBoutique.json<{
        levels: Niveau[]
      }>()
      expect(levelsBoutique).toHaveLength(1)
      expect(levelsBoutique[0]?.quantity).toBe(4)
    }
  )

  it("pagination : borne les niveaux, total compte le même périmètre, isolation par entrepôt", async () => {
    const { organizationId, ownerId, ownerCookie, depotId, db } = await seed()
    const fanta = await creerProduitSimple(organizationId, { nom: "Fanta" })
    const sprite = await creerProduitSimple(organizationId, { nom: "Sprite" })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId: depotId,
          variantId: fanta.variantId,
          delta: 5,
          type: "purchase",
          unitCost: 100,
        },
        {
          warehouseId: depotId,
          variantId: sprite.variantId,
          delta: 5,
          type: "purchase",
          unitCost: 100,
        },
      ],
    })
    // depotId a maintenant 3 variantes en stock ; boutiqueId (via seed()) en a
    // 1 seule — sert de témoin d'isolation.

    const page1 = await get(
      ownerCookie,
      `/api/v1/stock/levels?warehouseId=${depotId}&page=1&limite=2`
    )
    expect(page1.status).toBe(200)
    const corps1 = await page1.json<{
      levels: Niveau[]
      total: number
      page: number
      limite: number
    }>()
    expect(corps1.total).toBe(3)
    expect(corps1.levels).toHaveLength(2)
    expect(corps1.page).toBe(1)
    expect(corps1.limite).toBe(2)

    const page2 = await get(
      ownerCookie,
      `/api/v1/stock/levels?warehouseId=${depotId}&page=2&limite=2`
    )
    const corps2 = await page2.json<{ levels: Niveau[]; total: number }>()
    expect(corps2.levels).toHaveLength(1)
    expect(corps2.total).toBe(3)

    const page3 = await get(
      ownerCookie,
      `/api/v1/stock/levels?warehouseId=${depotId}&page=3&limite=2`
    )
    const corps3 = await page3.json<{ levels: Niveau[]; total: number }>()
    expect(corps3.levels).toEqual([])
    expect(corps3.total).toBe(3)

    const invalide = await get(
      ownerCookie,
      `/api/v1/stock/levels?warehouseId=${depotId}&limite=0`
    )
    expect(invalide.status).toBe(400)
    const corpsInvalide = await invalide.json<{ code: string }>()
    expect(corpsInvalide.code).toBe("VALIDATION")
  })
})

describe("GET /api/v1/stock/movements", () => {
  it("journal anté-chronologique, filtres type/entrepôt, portée staff", async () => {
    const {
      organizationId,
      ownerId,
      ownerCookie,
      depotId,
      boutiqueId,
      produit,
      db,
    } = await seed()
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId: depotId,
          variantId: produit.variantId,
          delta: -2,
          type: "adjustment",
          reason: "casse",
        },
      ],
    })

    const tout = await get(ownerCookie, "/api/v1/stock/movements")
    expect(tout.status).toBe(200)
    const corpsTout = await tout.json<{
      movements: Array<{ type: string; delta: number; userName: string }>
      total: number
    }>()
    expect(corpsTout.total).toBe(3)
    expect(corpsTout.movements[0]?.type).toBe("adjustment")
    expect(corpsTout.movements[0]?.userName).toBe("Propriétaire")

    const filtre = await get(
      ownerCookie,
      `/api/v1/stock/movements?warehouseId=${depotId}&type=purchase`
    )
    const corpsFiltre = await filtre.json<{ total: number }>()
    expect(corpsFiltre.total).toBe(1)

    expect(
      (await get(ownerCookie, "/api/v1/stock/movements?type=inconnu")).status
    ).toBe(400)

    // "2024-02-30" passe le format AAAA-MM-JJ mais n'est pas une date
    // calendaire réelle (février n'a jamais 30 jours) — doit être rejetée,
    // pas silencieusement décalée sur mars.
    expect(
      (await get(ownerCookie, "/api/v1/stock/movements?du=2024-02-30")).status
    ).toBe(400)
    expect(
      (await get(ownerCookie, "/api/v1/stock/movements?au=2024-02-30")).status
    ).toBe(400)

    // staff auditor du dépôt : ne voit que le dépôt, même sans filtre
    const auditeur = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, auditeur.userId, depotId, "auditor")
    const vueAuditeur = await get(auditeur.cookie, "/api/v1/stock/movements")
    const corpsAuditeur = await vueAuditeur.json<{
      movements: Array<{ warehouseId: string }>
      total: number
    }>()
    expect(corpsAuditeur.total).toBe(2)
    expect(
      corpsAuditeur.movements.every((m) => m.warehouseId === depotId)
    ).toBe(true)
    // et 403 s'il force un autre entrepôt
    expect(
      (
        await get(
          auditeur.cookie,
          `/api/v1/stock/movements?warehouseId=${boutiqueId}`
        )
      ).status
    ).toBe(403)
  })

  it("limite invalide → 400 VALIDATION", async () => {
    const { ownerCookie, depotId } = await seed()
    const res = await get(
      ownerCookie,
      `/api/v1/stock/movements?warehouseId=${depotId}&limite=500`
    )
    expect(res.status).toBe(400)
    expect((await res.json<{ code: string }>()).code).toBe("VALIDATION")
  })
})

describe("GET /api/v1/stock/alerts", () => {
  it("liste les articles sous le seuil (surcharge entrepôt comprise) dans la portée du lecteur", async () => {
    const {
      organizationId,
      ownerId,
      ownerCookie,
      depotId,
      boutiqueId,
      produit,
      db,
    } = await seed()
    // boutique : 4 en stock, seuil produit 10 → alerte ; dépôt : 24 → pas d'alerte
    const avant = await get(ownerCookie, "/api/v1/stock/alerts")
    const corpsAvant = await avant.json<{
      alerts: Array<{
        warehouseId: string
        quantity: number
        seuilEffectif: number
      }>
      total: number
    }>()
    expect(corpsAvant.total).toBe(1)
    expect(corpsAvant.alerts[0]?.warehouseId).toBe(boutiqueId)

    // Surcharge par entrepôt : seuil 30 au dépôt → le dépôt passe en alerte
    await definirSeuil(db, {
      organizationId,
      warehouseId: depotId,
      variantId: produit.variantId,
      minStock: 30,
    })
    const apres = await get(ownerCookie, "/api/v1/stock/alerts")
    expect((await apres.json<{ total: number }>()).total).toBe(2)

    // staff manager de la boutique : ne voit que l'alerte de la boutique
    const manager = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      manager.userId,
      boutiqueId,
      "manager"
    )
    const vueManager = await get(manager.cookie, "/api/v1/stock/alerts")
    const corpsManager = await vueManager.json<{
      alerts: Array<{ warehouseId: string }>
      total: number
    }>()
    expect(corpsManager.total).toBe(1)
    expect(corpsManager.alerts[0]?.warehouseId).toBe(boutiqueId)
    expect(ownerId).toBeTruthy()
  })
})
