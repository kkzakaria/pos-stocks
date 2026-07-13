import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
import app from "../src/index"
import * as schema from "../src/db/schema"
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

async function creerLot(
  organizationId: string,
  variantId: string,
  lotNumber = "LOT-1"
): Promise<string> {
  const db = drizzle(env.DB, { schema })
  const id = crypto.randomUUID()
  await db.insert(schema.lots).values({
    id,
    organizationId,
    variantId,
    lotNumber,
    expiryDate: null,
    createdAt: new Date(),
  })
  return id
}

async function seed() {
  const { organizationId, ownerCookie } = await bootstrapOwner()
  const origineId = await creerEntrepot(organizationId, "Origine")
  const destinationId = await creerEntrepot(organizationId, "Destination")
  const { variantId } = await creerProduitSimple(organizationId)
  return { organizationId, ownerCookie, origineId, destinationId, variantId }
}

describe("transferts — brouillon", () => {
  it("création, ajout/édition/retrait de ligne, détail complet", async () => {
    const { ownerCookie, origineId, destinationId, variantId } = await seed()
    const creation = await req(ownerCookie, "POST", "/api/v1/transfers", {
      fromWarehouseId: origineId,
      toWarehouseId: destinationId,
      reference: "BT-001",
    })
    expect(creation.status).toBe(201)
    const { id } = await creation.json<{ id: string }>()

    const ajout = await req(
      ownerCookie,
      "POST",
      `/api/v1/transfers/${id}/items`,
      {
        variantId,
        quantity: 4,
      }
    )
    expect(ajout.status).toBe(201)
    const { id: itemId } = await ajout.json<{ id: string }>()

    expect(
      (
        await req(
          ownerCookie,
          "PATCH",
          `/api/v1/transfers/${id}/items/${itemId}`,
          { quantity: 6 }
        )
      ).status
    ).toBe(200)

    const detail = await req(ownerCookie, "GET", `/api/v1/transfers/${id}`)
    expect(detail.status).toBe(200)
    const { transfer } = await detail.json<{
      transfer: {
        status: string
        reference: string | null
        fromWarehouseName: string
        toWarehouseName: string
        items: Array<{
          id: string
          quantity: number
          unitCost: number | null
          receivedQuantity: number | null
        }>
      }
    }>()
    expect(transfer.status).toBe("pending")
    expect(transfer.reference).toBe("BT-001")
    expect(transfer.fromWarehouseName).toBe("Origine")
    expect(transfer.toWarehouseName).toBe("Destination")
    expect(transfer.items).toEqual([
      expect.objectContaining({
        id: itemId,
        quantity: 6,
        unitCost: null,
        receivedQuantity: null,
      }),
    ])

    expect(
      (
        await req(
          ownerCookie,
          "DELETE",
          `/api/v1/transfers/${id}/items/${itemId}`
        )
      ).status
    ).toBe(200)
  })

  it("refuse origine = destination (TRANSFERT_MEME_ENTREPOT)", async () => {
    const { ownerCookie, origineId } = await seed()
    const res = await req(ownerCookie, "POST", "/api/v1/transfers", {
      fromWarehouseId: origineId,
      toWarehouseId: origineId,
    })
    expect(res.status).toBe(400)
    expect((await res.json<{ code: string }>()).code).toBe(
      "TRANSFERT_MEME_ENTREPOT"
    )
  })

  it("destination inconnue ou d'une autre organisation → 404 ; origine d'une autre organisation → 403", async () => {
    const { ownerCookie, origineId } = await seed()
    const db = drizzle(env.DB, { schema })
    const autreOrgId = crypto.randomUUID()
    await db.insert(schema.organization).values({
      id: autreOrgId,
      name: "Autre Société",
      slug: `autre-${autreOrgId.slice(0, 8)}`,
      createdAt: new Date(),
    })
    const entrepotEtranger = await creerEntrepot(autreOrgId, "Étranger")

    const versEtranger = await req(ownerCookie, "POST", "/api/v1/transfers", {
      fromWarehouseId: origineId,
      toWarehouseId: entrepotEtranger,
    })
    expect(versEtranger.status).toBe(404)
    const depuisEtranger = await req(ownerCookie, "POST", "/api/v1/transfers", {
      fromWarehouseId: entrepotEtranger,
      toWarehouseId: origineId,
    })
    expect(depuisEtranger.status).toBe(403)
  })

  it("matrice d'écriture : manager ORIGINE crée, manager destination seule 403, cashier 403, auditor d'entreprise 403", async () => {
    const { organizationId, origineId, destinationId } = await seed()
    const managerOrigine = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      managerOrigine.userId,
      origineId,
      "manager"
    )
    const managerDestination = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      managerDestination.userId,
      destinationId,
      "manager"
    )
    const caissier = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      caissier.userId,
      origineId,
      "cashier"
    )
    const auditeur = await createUserWithRole(organizationId, "auditor")

    const corps = { fromWarehouseId: origineId, toWarehouseId: destinationId }
    expect(
      (await req(managerOrigine.cookie, "POST", "/api/v1/transfers", corps))
        .status
    ).toBe(201)
    expect(
      (await req(managerDestination.cookie, "POST", "/api/v1/transfers", corps))
        .status
    ).toBe(403)
    expect(
      (await req(caissier.cookie, "POST", "/api/v1/transfers", corps)).status
    ).toBe(403)
    expect(
      (await req(auditeur.cookie, "POST", "/api/v1/transfers", corps)).status
    ).toBe(403)
  })

  it("règles de lot en brouillon : lotId interdit sans trackLots, lot d'une autre variante introuvable, lot valide accepté", async () => {
    const { organizationId, ownerCookie, origineId, destinationId, variantId } =
      await seed()
    const suivie = await creerProduitSimple(organizationId, { trackLots: true })
    const lotId = await creerLot(organizationId, suivie.variantId)

    const creation = await req(ownerCookie, "POST", "/api/v1/transfers", {
      fromWarehouseId: origineId,
      toWarehouseId: destinationId,
    })
    const { id } = await creation.json<{ id: string }>()

    // lotId sur un produit sans suivi → 400 LOTS_NON_SUIVIS
    const nonSuivi = await req(
      ownerCookie,
      "POST",
      `/api/v1/transfers/${id}/items`,
      { variantId, quantity: 1, lotId }
    )
    expect(nonSuivi.status).toBe(400)
    expect((await nonSuivi.json<{ code: string }>()).code).toBe(
      "LOTS_NON_SUIVIS"
    )

    // lot d'une AUTRE variante → 404 INTROUVABLE
    const autreLot = await creerLot(organizationId, variantId, "LOT-AUTRE")
    const mauvaisLot = await req(
      ownerCookie,
      "POST",
      `/api/v1/transfers/${id}/items`,
      { variantId: suivie.variantId, quantity: 1, lotId: autreLot }
    )
    expect(mauvaisLot.status).toBe(404)

    // lot valide, et brouillon SANS lot accepté aussi (LOT_REQUIS attendra l'expédition)
    expect(
      (
        await req(ownerCookie, "POST", `/api/v1/transfers/${id}/items`, {
          variantId: suivie.variantId,
          quantity: 2,
          lotId,
        })
      ).status
    ).toBe(201)
    expect(
      (
        await req(ownerCookie, "POST", `/api/v1/transfers/${id}/items`, {
          variantId: suivie.variantId,
          quantity: 3,
        })
      ).status
    ).toBe(201)
  })

  it("un transfert non-pending refuse toute édition de ligne (409 TRANSFERT_EXPEDIE)", async () => {
    const { ownerCookie, origineId, destinationId, variantId } = await seed()
    const creation = await req(ownerCookie, "POST", "/api/v1/transfers", {
      fromWarehouseId: origineId,
      toWarehouseId: destinationId,
    })
    const { id } = await creation.json<{ id: string }>()
    const ajout = await req(
      ownerCookie,
      "POST",
      `/api/v1/transfers/${id}/items`,
      {
        variantId,
        quantity: 2,
      }
    )
    const { id: itemId } = await ajout.json<{ id: string }>()
    // Force le statut hors route (les triggers laissent sortir de pending).
    // Le trigger transfers_send_lignes_gelees (0008) exige que unit_cost soit
    // déjà figé sur chaque ligne avant la transition pending -> sent : on
    // simule ce gel ici, comme le ferait /send.
    const db = drizzle(env.DB, { schema })
    await db
      .update(schema.transferItems)
      .set({ unitCost: 0 })
      .where(eq(schema.transferItems.id, itemId))
    await db
      .update(schema.transfers)
      .set({ status: "sent" })
      .where(eq(schema.transfers.id, id))

    const refus = await req(
      ownerCookie,
      "POST",
      `/api/v1/transfers/${id}/items`,
      { variantId, quantity: 1 }
    )
    expect(refus.status).toBe(409)
    expect((await refus.json<{ code: string }>()).code).toBe(
      "TRANSFERT_EXPEDIE"
    )
    expect(
      (
        await req(
          ownerCookie,
          "PATCH",
          `/api/v1/transfers/${id}/items/${itemId}`,
          { quantity: 9 }
        )
      ).status
    ).toBe(409)
    expect(
      (
        await req(
          ownerCookie,
          "DELETE",
          `/api/v1/transfers/${id}/items/${itemId}`
        )
      ).status
    ).toBe(409)
  })

  it("annulation : pending → cancelled, puis toute ré-annulation 409 STATUT_INVALIDE", async () => {
    const { ownerCookie, origineId, destinationId } = await seed()
    const creation = await req(ownerCookie, "POST", "/api/v1/transfers", {
      fromWarehouseId: origineId,
      toWarehouseId: destinationId,
    })
    const { id } = await creation.json<{ id: string }>()
    expect(
      (await req(ownerCookie, "POST", `/api/v1/transfers/${id}/cancel`)).status
    ).toBe(200)
    const detail = await req(ownerCookie, "GET", `/api/v1/transfers/${id}`)
    expect(
      (await detail.json<{ transfer: { status: string } }>()).transfer.status
    ).toBe("cancelled")
    expect(
      (await req(ownerCookie, "POST", `/api/v1/transfers/${id}/cancel`)).status
    ).toBe(409)
  })

  it("portée de lecture bi-entrepôt : visible par le manager de l'origine ET l'auditeur de la destination, invisible pour un staff sans lien, 404 cross-org", async () => {
    const { organizationId, ownerCookie, origineId, destinationId } =
      await seed()
    const creation = await req(ownerCookie, "POST", "/api/v1/transfers", {
      fromWarehouseId: origineId,
      toWarehouseId: destinationId,
    })
    const { id } = await creation.json<{ id: string }>()

    const managerOrigine = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      managerOrigine.userId,
      origineId,
      "manager"
    )
    const auditeurDestination = await createUserWithRole(
      organizationId,
      "staff"
    )
    await affecterEntrepot(
      organizationId,
      auditeurDestination.userId,
      destinationId,
      "auditor"
    )
    const sansLien = await createUserWithRole(organizationId, "staff")

    for (const cookie of [managerOrigine.cookie, auditeurDestination.cookie]) {
      const liste = await req(cookie, "GET", "/api/v1/transfers")
      const { transfers } = await liste.json<{
        transfers: Array<{ id: string }>
      }>()
      expect(transfers.map((t) => t.id)).toContain(id)
      expect((await req(cookie, "GET", `/api/v1/transfers/${id}`)).status).toBe(
        200
      )
    }

    const listeVide = await req(sansLien.cookie, "GET", "/api/v1/transfers")
    expect(
      (await listeVide.json<{ transfers: unknown[] }>()).transfers
    ).toEqual([])
    expect(
      (await req(sansLien.cookie, "GET", `/api/v1/transfers/${id}`)).status
    ).toBe(403)
    expect(
      (
        await req(
          ownerCookie,
          "GET",
          `/api/v1/transfers/${crypto.randomUUID()}`
        )
      ).status
    ).toBe(404)
  })

  it("liste : filtre statut, agrégats itemCount/totalQuantity", async () => {
    const { ownerCookie, origineId, destinationId, variantId } = await seed()
    const creation = await req(ownerCookie, "POST", "/api/v1/transfers", {
      fromWarehouseId: origineId,
      toWarehouseId: destinationId,
    })
    const { id } = await creation.json<{ id: string }>()
    await req(ownerCookie, "POST", `/api/v1/transfers/${id}/items`, {
      variantId,
      quantity: 4,
    })
    await req(ownerCookie, "POST", `/api/v1/transfers/${id}/items`, {
      variantId,
      quantity: 6,
    })
    const liste = await req(
      ownerCookie,
      "GET",
      "/api/v1/transfers?statut=pending"
    )
    const { transfers } = await liste.json<{
      transfers: Array<{ id: string; itemCount: number; totalQuantity: number }>
    }>()
    expect(transfers).toEqual([
      expect.objectContaining({ id, itemCount: 2, totalQuantity: 10 }),
    ])
    const listeVide = await req(
      ownerCookie,
      "GET",
      "/api/v1/transfers?statut=received"
    )
    expect(
      (await listeVide.json<{ transfers: unknown[] }>()).transfers
    ).toEqual([])
    expect(
      (await req(ownerCookie, "GET", "/api/v1/transfers?statut=zzz")).status
    ).toBe(400)
  })

  it("liste : limit borne le nombre de résultats, rejette les valeurs invalides", async () => {
    const { ownerCookie, origineId, destinationId } = await seed()
    for (let i = 0; i < 3; i++) {
      await req(ownerCookie, "POST", "/api/v1/transfers", {
        fromWarehouseId: origineId,
        toWarehouseId: destinationId,
      })
    }
    const limitee = await req(
      ownerCookie,
      "GET",
      "/api/v1/transfers?statut=pending&limit=2"
    )
    expect(
      (await limitee.json<{ transfers: unknown[] }>()).transfers
    ).toHaveLength(2)
    expect(
      (await req(ownerCookie, "GET", "/api/v1/transfers?limit=0")).status
    ).toBe(400)
    expect(
      (await req(ownerCookie, "GET", "/api/v1/transfers?limit=abc")).status
    ).toBe(400)
    expect(
      (await req(ownerCookie, "GET", "/api/v1/transfers?limit=201")).status
    ).toBe(400)
  })
})
