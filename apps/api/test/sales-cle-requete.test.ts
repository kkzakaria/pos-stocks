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

async function seedAvecVente(nomBoutique: string) {
  const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
  const storeId = await creerEntrepot(organizationId, nomBoutique, "store")
  const caissier = await createUserWithRole(organizationId, "staff")
  await affecterEntrepot(organizationId, caissier.userId, storeId, "cashier")
  const { variantId } = await creerProduitSimple(organizationId, {
    nom: `Eau ${nomBoutique}`,
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
  await req(caissier.cookie, "POST", "/api/v1/register-sessions", {
    storeId,
    openingFloat: 0,
  })
  const clientRequestId = crypto.randomUUID()
  const vente = await req(caissier.cookie, "POST", "/api/v1/sales", {
    storeId,
    clientRequestId,
    items: [{ variantId, quantity: 2, unitPrice: 300 }],
    payments: [{ method: "cash", amount: 600, receivedAmount: 600 }],
  })
  const { sale } = await vente.json<{ sale: { id: string; total: number } }>()
  return {
    organizationId,
    ownerCookie,
    storeId,
    caissier,
    clientRequestId,
    saleId: sale.id,
  }
}

const CHEMIN = "/api/v1/sales/par-cle-requete"

describe("consultation d'une vente par clé d'idempotence", () => {
  it("retrouve la vente et renvoie son détail", async () => {
    const { caissier, clientRequestId, saleId } =
      await seedAvecVente("Boutique K1")
    const res = await req(
      caissier.cookie,
      "GET",
      `${CHEMIN}/${clientRequestId}`
    )
    expect(res.status).toBe(200)
    const corps = await res.json<{ sale: { id: string; total: number } }>()
    expect(corps.sale.id).toBe(saleId)
    // 2 × 300 = 600: hand-computed value.
    expect(corps.sale.total).toBe(600)
  })

  it("404 INTROUVABLE sur une clé inconnue", async () => {
    const { caissier } = await seedAvecVente("Boutique K2")
    const res = await req(
      caissier.cookie,
      "GET",
      `${CHEMIN}/${crypto.randomUUID()}`
    )
    expect(res.status).toBe(404)
    const corps = await res.json<{ code: string }>()
    expect(corps.code).toBe("INTROUVABLE")
  })

  it("404 INTROUVABLE sur une vente d'une AUTRE organisation", async () => {
    const a = await seedAvecVente("Boutique K3")
    // Second organization inserted directly: /api/v1/setup
    // allows a single global initialization (see setup.ts), so
    // `seedAvecVente`/`bootstrapOwner` cannot be called a second time within
    // the same test (409 DEJA_INITIALISE). `requireMembership` resolves scope
    // only from `member` (organizationId, role), so a plain "owner" member
    // attached to that organization is enough to authenticate the request,
    // with no real store or sale on B's side.
    const db = drizzle(env.DB, { schema })
    const autreOrgId = crypto.randomUUID()
    await db.insert(schema.organization).values({
      id: autreOrgId,
      name: "Autre Société",
      slug: `autre-org-${autreOrgId.slice(0, 8)}`,
      createdAt: new Date(),
    })
    const autreOwner = await createUserWithRole(autreOrgId, "owner")
    // B's owner queries A's key: the lookup being scoped to its own
    // organization, the sale is not found — never 403, which would leak
    // its existence.
    const res = await req(
      autreOwner.cookie,
      "GET",
      `${CHEMIN}/${a.clientRequestId}`
    )
    expect(res.status).toBe(404)
    const corps = await res.json<{ code: string }>()
    expect(corps.code).toBe("INTROUVABLE")
  })

  it("403 ACCES_REFUSE pour un caissier hors de sa boutique", async () => {
    const { organizationId, clientRequestId } =
      await seedAvecVente("Boutique K5")
    const autreBoutique = await creerEntrepot(
      organizationId,
      "Boutique K5 bis",
      "store"
    )
    const intrus = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      intrus.userId,
      autreBoutique,
      "cashier"
    )
    const res = await req(intrus.cookie, "GET", `${CHEMIN}/${clientRequestId}`)
    expect(res.status).toBe(403)
    const corps = await res.json<{ code: string }>()
    expect(corps.code).toBe("ACCES_REFUSE")
  })

  it("la route n'est pas captée par GET /sales/:id", async () => {
    const { caissier, saleId } = await seedAvecVente("Boutique K6")
    // An unknown key must NOT be read as a sale id: if /:id captured the
    // segment, the response would carry a `sale`.
    const res = await req(caissier.cookie, "GET", `${CHEMIN}/${saleId}`)
    expect(res.status).toBe(404)
  })
})
