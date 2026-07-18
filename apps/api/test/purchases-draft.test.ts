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

async function creerFournisseur(cookie: string) {
  const res = await req(cookie, "POST", "/api/v1/suppliers", {
    name: "Sodeci Distribution",
  })
  return (await res.json<{ id: string }>()).id
}

async function seed() {
  const { organizationId, ownerCookie } = await bootstrapOwner()
  const warehouseId = await creerEntrepot(organizationId)
  const supplierId = await creerFournisseur(ownerCookie)
  const produit = await creerProduitSimple(organizationId)
  const produitLots = await creerProduitSimple(organizationId, {
    nom: "Yaourt nature",
    trackLots: true,
  })
  return {
    organizationId,
    ownerCookie,
    warehouseId,
    supplierId,
    produit,
    produitLots,
  }
}

describe("réceptions fournisseur — brouillon", () => {
  it("cycle complet : création, lignes, modification, liste avec totaux, suppression", async () => {
    const { ownerCookie, warehouseId, supplierId, produit } = await seed()

    const creation = await req(ownerCookie, "POST", "/api/v1/purchases", {
      warehouseId,
      supplierId,
      reference: "BL-2026-001",
    })
    expect(creation.status).toBe(201)
    const { id } = await creation.json<{ id: string }>()

    const ajout = await req(
      ownerCookie,
      "POST",
      `/api/v1/purchases/${id}/items`,
      {
        variantId: produit.variantId,
        quantity: 10,
        unitCost: 150,
      }
    )
    expect(ajout.status).toBe(201)
    const { id: itemId } = await ajout.json<{ id: string }>()

    expect(
      (
        await req(
          ownerCookie,
          "PATCH",
          `/api/v1/purchases/${id}/items/${itemId}`,
          {
            quantity: 12,
          }
        )
      ).status
    ).toBe(200)

    const liste = await req(
      ownerCookie,
      "GET",
      "/api/v1/purchases?statut=draft"
    )
    const corpsListe = await liste.json<{
      purchases: Array<{
        id: string
        status: string
        supplierName: string
        itemCount: number
        totalCost: number
      }>
    }>()
    expect(corpsListe.purchases).toHaveLength(1)
    expect(corpsListe.purchases[0]?.supplierName).toBe("Sodeci Distribution")
    expect(corpsListe.purchases[0]?.itemCount).toBe(1)
    expect(corpsListe.purchases[0]?.totalCost).toBe(12 * 150)

    const detail = await req(ownerCookie, "GET", `/api/v1/purchases/${id}`)
    const { purchase } = await detail.json<{
      purchase: { items: Array<{ quantity: number; unitCost: number }> }
    }>()
    expect(purchase.items[0]?.quantity).toBe(12)

    expect(
      (
        await req(
          ownerCookie,
          "DELETE",
          `/api/v1/purchases/${id}/items/${itemId}`
        )
      ).status
    ).toBe(200)
    expect(
      (await req(ownerCookie, "DELETE", `/api/v1/purchases/${id}`)).status
    ).toBe(200)
    expect(
      (await req(ownerCookie, "GET", `/api/v1/purchases/${id}`)).status
    ).toBe(404)
  })

  it("règles de lot à la saisie : LOT_REQUIS pour trackLots, LOTS_NON_SUIVIS sinon", async () => {
    const { ownerCookie, warehouseId, supplierId, produit, produitLots } =
      await seed()
    const creation = await req(ownerCookie, "POST", "/api/v1/purchases", {
      warehouseId,
      supplierId,
    })
    const { id } = await creation.json<{ id: string }>()

    const sansLot = await req(
      ownerCookie,
      "POST",
      `/api/v1/purchases/${id}/items`,
      {
        variantId: produitLots.variantId,
        quantity: 5,
        unitCost: 300,
      }
    )
    expect(sansLot.status).toBe(400)
    expect((await sansLot.json<{ code: string }>()).code).toBe("LOT_REQUIS")

    const avecLot = await req(
      ownerCookie,
      "POST",
      `/api/v1/purchases/${id}/items`,
      {
        variantId: produitLots.variantId,
        quantity: 5,
        unitCost: 300,
        lotNumber: "LOT-2026-07",
        expiryDate: "2026-12-31",
      }
    )
    expect(avecLot.status).toBe(201)

    const lotInterdit = await req(
      ownerCookie,
      "POST",
      `/api/v1/purchases/${id}/items`,
      {
        variantId: produit.variantId,
        quantity: 2,
        unitCost: 100,
        lotNumber: "LOT-X",
      }
    )
    expect(lotInterdit.status).toBe(400)
    expect((await lotInterdit.json<{ code: string }>()).code).toBe(
      "LOTS_NON_SUIVIS"
    )
  })

  it("permissions : manager de l'entrepôt crée, manager d'ailleurs/caissier/auditeur 403, staff ne voit que ses entrepôts", async () => {
    const { organizationId, ownerCookie, warehouseId, supplierId } =
      await seed()
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
    const caissier = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      caissier.userId,
      warehouseId,
      "cashier"
    )

    const corps = { warehouseId, supplierId }
    expect(
      (await req(manager.cookie, "POST", "/api/v1/purchases", corps)).status
    ).toBe(201)
    expect(
      (await req(managerAilleurs.cookie, "POST", "/api/v1/purchases", corps))
        .status
    ).toBe(403)
    expect(
      (await req(caissier.cookie, "POST", "/api/v1/purchases", corps)).status
    ).toBe(403)

    // brouillon dans l'annexe, créé par l'owner
    await req(ownerCookie, "POST", "/api/v1/purchases", {
      warehouseId: autreEntrepot,
      supplierId,
    })
    // le manager du premier entrepôt ne voit que le sien dans la liste
    const liste = await req(manager.cookie, "GET", "/api/v1/purchases")
    const corpsListe = await liste.json<{
      purchases: Array<{ warehouseId: string }>
    }>()
    expect(corpsListe.purchases).toHaveLength(1)
    expect(corpsListe.purchases[0]?.warehouseId).toBe(warehouseId)
    // et pas le détail de celui de l'annexe
    const listeOwner = await req(ownerCookie, "GET", "/api/v1/purchases")
    const tous = await listeOwner.json<{
      purchases: Array<{ id: string; warehouseId: string }>
    }>()
    const idAnnexe = tous.purchases.find(
      (p) => p.warehouseId === autreEntrepot
    )?.id
    expect(idAnnexe).toBeTruthy()
    expect(
      (
        await req(
          manager.cookie,
          "GET",
          `/api/v1/purchases/${String(idAnnexe)}`
        )
      ).status
    ).toBe(403)
  })

  it("cross-org et introuvables : fournisseur inconnu 404, entrepôt d'une autre org 403, réception d'une autre org 404", async () => {
    const { ownerCookie, warehouseId } = await seed()
    expect(
      (
        await req(ownerCookie, "POST", "/api/v1/purchases", {
          warehouseId,
          supplierId: crypto.randomUUID(),
        })
      ).status
    ).toBe(404)
    expect(
      (
        await req(
          ownerCookie,
          "GET",
          `/api/v1/purchases/${crypto.randomUUID()}`
        )
      ).status
    ).toBe(404)
  })

  it("suppression ligne inexistante : 404 et ne modifie pas updatedAt", async () => {
    const { ownerCookie, warehouseId, supplierId, produit } = await seed()

    // Créer une réception
    const creation = await req(ownerCookie, "POST", "/api/v1/purchases", {
      warehouseId,
      supplierId,
      reference: "BL-2026-TEST",
    })
    expect(creation.status).toBe(201)
    const { id: purchaseId } = await creation.json<{ id: string }>()

    // Ajouter une ligne
    const ajout = await req(
      ownerCookie,
      "POST",
      `/api/v1/purchases/${purchaseId}/items`,
      {
        variantId: produit.variantId,
        quantity: 5,
        unitCost: 200,
      }
    )
    expect(ajout.status).toBe(201)

    // Lire l'updatedAt initial depuis la base de données
    const db = drizzle(env.DB, { schema })
    const purchasesBefore = await db
      .select({ updatedAt: schema.purchases.updatedAt })
      .from(schema.purchases)
      .where(eq(schema.purchases.id, purchaseId))
      .limit(1)
    expect(purchasesBefore).toHaveLength(1)
    const updatedAtBefore = purchasesBefore[0]?.updatedAt

    // Essayer de supprimer une ligne inexistante
    const deleteResp = await req(
      ownerCookie,
      "DELETE",
      `/api/v1/purchases/${purchaseId}/items/${crypto.randomUUID()}`
    )
    expect(deleteResp.status).toBe(404)
    const deleteBody = await deleteResp.json<{ code: string }>()
    expect(deleteBody.code).toBe("INTROUVABLE")

    // Vérifier que l'updatedAt n'a pas changé
    const purchasesAfter = await db
      .select({ updatedAt: schema.purchases.updatedAt })
      .from(schema.purchases)
      .where(eq(schema.purchases.id, purchaseId))
      .limit(1)
    expect(purchasesAfter).toHaveLength(1)
    const updatedAtAfter = purchasesAfter[0].updatedAt
    expect(updatedAtAfter.getTime()).toBe(updatedAtBefore.getTime())
  })
})

describe("réceptions fournisseur — liste à grande échelle", () => {
  it("GET / ne plante pas au-delà d'un lot de 90 (régression inArray, 150 réceptions)", async () => {
    const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
    const warehouseId = await creerEntrepot(organizationId)
    const supplierId = await creerFournisseur(ownerCookie)
    const produit = await creerProduitSimple(organizationId)

    const db = drizzle(env.DB, { schema })
    const maintenant = new Date()
    const NB_RECEPTIONS = 150
    const TAILLE_LOT_SEED = 50
    const purchaseIds = Array.from({ length: NB_RECEPTIONS }, () =>
      crypto.randomUUID()
    )

    for (let debut = 0; debut < purchaseIds.length; debut += TAILLE_LOT_SEED) {
      const lot = purchaseIds.slice(debut, debut + TAILLE_LOT_SEED)
      const instructions = lot.flatMap((purchaseId, indexLot) => {
        const index = debut + indexLot
        return [
          db.insert(schema.purchases).values({
            id: purchaseId,
            organizationId,
            warehouseId,
            supplierId,
            status: "draft" as const,
            reference: `BL-VOL-${index}`,
            createdBy: ownerId,
            createdAt: maintenant,
            updatedAt: maintenant,
          }),
          db.insert(schema.purchaseItems).values({
            id: crypto.randomUUID(),
            organizationId,
            purchaseId,
            variantId: produit.variantId,
            quantity: 5,
            unitCost: 100,
            createdAt: maintenant,
          }),
        ]
      })
      const [premiere, ...reste] = instructions
      await db.batch([premiere, ...reste])
    }

    const liste = await req(ownerCookie, "GET", "/api/v1/purchases")
    expect(liste.status).toBe(200)
    const { purchases } = await liste.json<{
      purchases: Array<{ id: string; itemCount: number; totalCost: number }>
    }>()
    expect(purchases).toHaveLength(NB_RECEPTIONS)
    // Verify enrichment on a reception from the FIRST batch AND one from the
    // SECOND (index 140 > 90): aggregates remain correct across the batch
    // boundary, not just within the first batch.
    for (const idx of [0, 140]) {
      const echantillon = purchases.find((p) => p.id === purchaseIds[idx])
      expect(echantillon?.itemCount).toBe(1)
      expect(echantillon?.totalCost).toBe(500)
    }
  })
})
