import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { and, eq } from "drizzle-orm"
import app from "../src/index"
import * as schema from "../src/db/schema"
import { applyMovements } from "../src/services/stock"
import {
  bootstrapOwner,
  createUserWithRole,
  creerEntrepot,
  creerProduitSimple,
} from "./helpers"

function reconcile(cookie: string, appliquer = false) {
  return app.request(
    `/api/v1/stock/reconcile${appliquer ? "?appliquer=true" : ""}`,
    { method: "POST", headers: { cookie } },
    env
  )
}

type Ecart = {
  warehouseId: string
  variantId: string
  quantiteJournal: number
  quantiteNiveaux: number
  ecart: number
  applicable: boolean
}

describe("POST /api/v1/stock/reconcile", () => {
  it("dry-run par défaut : rapporte l'écart sans corriger ; appliquer=true corrige la quantité sans toucher le CMP", async () => {
    const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
    const warehouseId = await creerEntrepot(organizationId)
    const { variantId } = await creerProduitSimple(organizationId)
    const db = drizzle(env.DB, { schema })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId, variantId, delta: 10, type: "purchase", unitCost: 150 },
      ],
    })

    // Sans écart : rapport vide
    const propre = await reconcile(ownerCookie)
    expect(propre.status).toBe(200)
    expect((await propre.json<{ ecarts: Ecart[] }>()).ecarts).toEqual([])

    // Corruption directe du niveau (stock_levels n'a pas de trigger : seule
    // la discipline applicative le protège — c'est exactement ce que la
    // réconciliation détecte)
    await db
      .update(schema.stockLevels)
      .set({ quantity: 99 })
      .where(
        and(
          eq(schema.stockLevels.warehouseId, warehouseId),
          eq(schema.stockLevels.variantId, variantId)
        )
      )

    const dryRun = await reconcile(ownerCookie)
    const corpsDryRun = await dryRun.json<{
      ecarts: Ecart[]
      applique: boolean
    }>()
    expect(corpsDryRun.applique).toBe(false)
    expect(corpsDryRun.ecarts).toEqual([
      {
        warehouseId,
        variantId,
        quantiteJournal: 10,
        quantiteNiveaux: 99,
        ecart: 89,
        applicable: true,
      },
    ])
    // dry-run : rien n'a bougé
    const niveauApresDryRun = await db
      .select({ quantity: schema.stockLevels.quantity })
      .from(schema.stockLevels)
      .where(eq(schema.stockLevels.variantId, variantId))
    expect(niveauApresDryRun[0]?.quantity).toBe(99)

    const application = await reconcile(ownerCookie, true)
    expect((await application.json<{ applique: boolean }>()).applique).toBe(
      true
    )
    const niveau = await db
      .select()
      .from(schema.stockLevels)
      .where(eq(schema.stockLevels.variantId, variantId))
    expect(niveau[0]?.quantity).toBe(10)
    // le CMP n'est JAMAIS recalculé par la réconciliation
    expect(niveau[0]?.avgCost).toBe(150)
  })

  it("recrée une ligne de niveau manquante depuis le journal", async () => {
    const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
    const warehouseId = await creerEntrepot(organizationId)
    const { variantId } = await creerProduitSimple(organizationId)
    const db = drizzle(env.DB, { schema })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId,
          variantId,
          delta: 7,
          type: "adjustment",
          reason: "init",
        },
      ],
    })
    await db
      .delete(schema.stockLevels)
      .where(eq(schema.stockLevels.variantId, variantId))

    const res = await reconcile(ownerCookie, true)
    const corps = await res.json<{ ecarts: Ecart[] }>()
    expect(corps.ecarts).toHaveLength(1)
    expect(corps.ecarts[0]?.quantiteJournal).toBe(7)
    expect(corps.ecarts[0]?.quantiteNiveaux).toBe(0)

    const niveau = await db
      .select({ quantity: schema.stockLevels.quantity })
      .from(schema.stockLevels)
      .where(eq(schema.stockLevels.variantId, variantId))
    expect(niveau[0]?.quantity).toBe(7)
  })

  it("réservé à owner/admin : stock_manager et staff → 403", async () => {
    const { organizationId } = await bootstrapOwner()
    const gestStock = await createUserWithRole(organizationId, "stock_manager")
    const staff = await createUserWithRole(organizationId, "staff")
    expect((await reconcile(gestStock.cookie)).status).toBe(403)
    expect((await reconcile(staff.cookie)).status).toBe(403)
  })
})
