import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import app from "../src/index"
import {
  affecterEntrepot,
  bootstrapOwner,
  createUserWithRole,
  creerEntrepot,
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
type SessionFermee = {
  session: {
    id: string
    status: string
    openingFloat: number
    countedAmount: number | null
    expectedCash: number | null
    difference: number | null
  }
}

async function seedBoutique() {
  const { organizationId, ownerCookie } = await bootstrapOwner()
  const storeId = await creerEntrepot(organizationId, "Boutique RS", "store")
  const caissier = await createUserWithRole(organizationId, "staff")
  await affecterEntrepot(organizationId, caissier.userId, storeId, "cashier")
  return { organizationId, ownerCookie, storeId, caissier }
}

describe("sessions de caisse", () => {
  it("un caissier ouvre une session avec son fond de caisse", async () => {
    const { storeId, caissier } = await seedBoutique()
    const res = await req(
      caissier.cookie,
      "POST",
      "/api/v1/register-sessions",
      {
        storeId,
        openingFloat: 10000,
      }
    )
    expect(res.status).toBe(201)
    const { id } = await res.json<{ id: string }>()
    expect(id.length).toBeGreaterThan(0)
    // GET /current la retrouve
    const courante = await req(
      caissier.cookie,
      "GET",
      `/api/v1/register-sessions/current?storeId=${storeId}`
    )
    const corps = await courante.json<{
      session: { id: string; openingFloat: number } | null
    }>()
    expect(corps.session?.id).toBe(id)
    expect(corps.session?.openingFloat).toBe(10000)
  })

  it("refuse une seconde session ouverte pour le même caissier+boutique", async () => {
    const { storeId, caissier } = await seedBoutique()
    await req(caissier.cookie, "POST", "/api/v1/register-sessions", {
      storeId,
      openingFloat: 0,
    })
    const res = await req(
      caissier.cookie,
      "POST",
      "/api/v1/register-sessions",
      {
        storeId,
        openingFloat: 0,
      }
    )
    expect(res.status).toBe(409)
    expect((await res.json<Erreur>()).code).toBe("SESSION_DEJA_OUVERTE")
  })

  it("refuse d'ouvrir une session sur un entrepôt qui n'est pas une boutique", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const depotId = await creerEntrepot(organizationId, "Dépôt RS", "warehouse")
    const res = await req(ownerCookie, "POST", "/api/v1/register-sessions", {
      storeId: depotId,
      openingFloat: 0,
    })
    expect(res.status).toBe(400)
    expect((await res.json<Erreur>()).code).toBe("ENTREPOT_NON_BOUTIQUE")
  })

  it("matrice vendre : stock_manager et auditor sont refusés, owner passe", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const storeId = await creerEntrepot(organizationId, "Boutique M", "store")
    const gestionnaire = await createUserWithRole(
      organizationId,
      "stock_manager"
    )
    const auditeur = await createUserWithRole(organizationId, "auditor")
    for (const cookie of [gestionnaire.cookie, auditeur.cookie]) {
      const res = await req(cookie, "POST", "/api/v1/register-sessions", {
        storeId,
        openingFloat: 0,
      })
      expect(res.status).toBe(403)
    }
    const res = await req(ownerCookie, "POST", "/api/v1/register-sessions", {
      storeId,
      openingFloat: 0,
    })
    expect(res.status).toBe(201)
  })

  it("un caissier ne peut pas ouvrir sur une AUTRE boutique", async () => {
    const { organizationId, caissier } = await seedBoutique()
    const autreBoutique = await creerEntrepot(
      organizationId,
      "Autre B",
      "store"
    )
    const res = await req(
      caissier.cookie,
      "POST",
      "/api/v1/register-sessions",
      {
        storeId: autreBoutique,
        openingFloat: 0,
      }
    )
    expect(res.status).toBe(403)
  })

  it("fermeture sans vente : attendu = fond, écart = compté − fond", async () => {
    const { storeId, caissier } = await seedBoutique()
    const ouverture = await req(
      caissier.cookie,
      "POST",
      "/api/v1/register-sessions",
      { storeId, openingFloat: 10000 }
    )
    const { id } = await ouverture.json<{ id: string }>()
    const fermeture = await req(
      caissier.cookie,
      "POST",
      `/api/v1/register-sessions/${id}/close`,
      { countedAmount: 9500 }
    )
    expect(fermeture.status).toBe(200)
    const { session } = await fermeture.json<SessionFermee>()
    expect(session.status).toBe("closed")
    expect(session.expectedCash).toBe(10000)
    expect(session.difference).toBe(-500)
    // Double fermeture → 409
    const double = await req(
      caissier.cookie,
      "POST",
      `/api/v1/register-sessions/${id}/close`,
      { countedAmount: 9500 }
    )
    expect(double.status).toBe(409)
    expect((await double.json<Erreur>()).code).toBe("SESSION_FERMEE")
    // /current redevient null
    const courante = await req(
      caissier.cookie,
      "GET",
      `/api/v1/register-sessions/current?storeId=${storeId}`
    )
    expect((await courante.json<{ session: unknown }>()).session).toBeNull()
  })

  it("un caissier ne ferme pas la session d'un collègue ; le owner si", async () => {
    const { organizationId, ownerCookie, storeId, caissier } =
      await seedBoutique()
    const collegue = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, collegue.userId, storeId, "cashier")
    const ouverture = await req(
      caissier.cookie,
      "POST",
      "/api/v1/register-sessions",
      { storeId, openingFloat: 0 }
    )
    const { id } = await ouverture.json<{ id: string }>()
    const parCollegue = await req(
      collegue.cookie,
      "POST",
      `/api/v1/register-sessions/${id}/close`,
      { countedAmount: 0 }
    )
    expect(parCollegue.status).toBe(403)
    const parOwner = await req(
      ownerCookie,
      "POST",
      `/api/v1/register-sessions/${id}/close`,
      { countedAmount: 0 }
    )
    expect(parOwner.status).toBe(200)
  })

  it("historique : le caissier ne voit que SES sessions, le owner tout", async () => {
    const { organizationId, ownerCookie, storeId, caissier } =
      await seedBoutique()
    const collegue = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, collegue.userId, storeId, "cashier")
    await req(caissier.cookie, "POST", "/api/v1/register-sessions", {
      storeId,
      openingFloat: 1000,
    })
    await req(collegue.cookie, "POST", "/api/v1/register-sessions", {
      storeId,
      openingFloat: 2000,
    })
    const vueCaissier = await req(
      caissier.cookie,
      "GET",
      `/api/v1/register-sessions?storeId=${storeId}`
    )
    const corpsCaissier = await vueCaissier.json<{
      sessions: Array<{ openingFloat: number }>
    }>()
    expect(corpsCaissier.sessions.length).toBe(1)
    expect(corpsCaissier.sessions[0].openingFloat).toBe(1000)
    const vueOwner = await req(
      ownerCookie,
      "GET",
      `/api/v1/register-sessions?storeId=${storeId}`
    )
    expect(
      (await vueOwner.json<{ sessions: unknown[] }>()).sessions.length
    ).toBe(2)
  })
})
