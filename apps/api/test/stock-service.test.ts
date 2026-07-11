import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { and, eq, sql } from "drizzle-orm"
import * as schema from "../src/db/schema"
import {
  applyMovements,
  definirSeuil,
  ErreurStockInsuffisant,
} from "../src/services/stock"
import { bootstrapOwner, creerEntrepot, creerProduitSimple } from "./helpers"

async function seed() {
  const { organizationId, ownerId } = await bootstrapOwner()
  const warehouseId = await creerEntrepot(organizationId)
  const { variantId } = await creerProduitSimple(organizationId)
  const db = drizzle(env.DB, { schema })
  return { organizationId, ownerId, warehouseId, variantId, db }
}

async function niveau(
  db: ReturnType<typeof drizzle<typeof schema>>,
  warehouseId: string,
  variantId: string
): Promise<typeof schema.stockLevels.$inferSelect | null> {
  const rows = await db
    .select()
    .from(schema.stockLevels)
    .where(
      and(
        eq(schema.stockLevels.warehouseId, warehouseId),
        eq(schema.stockLevels.variantId, variantId)
      )
    )
    .limit(1)
  return rows[0] ?? null
}

describe("stockService.applyMovements", () => {
  it("crée le niveau au premier mouvement puis cumule, et journalise chaque mouvement", async () => {
    const { organizationId, ownerId, warehouseId, variantId, db } = await seed()

    const premier = await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId,
          variantId,
          delta: 10,
          type: "adjustment",
          reason: "init",
        },
      ],
    })
    expect(premier.movementIds).toHaveLength(1)
    expect((await niveau(db, warehouseId, variantId))?.quantity).toBe(10)

    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId,
          variantId,
          delta: -3,
          type: "adjustment",
          reason: "casse",
        },
      ],
    })
    expect((await niveau(db, warehouseId, variantId))?.quantity).toBe(7)

    const journal = await db
      .select()
      .from(schema.stockMovements)
      .where(eq(schema.stockMovements.variantId, variantId))
    expect(journal).toHaveLength(2)
  })

  it("stock insuffisant : rien n'est écrit (ni mouvements, ni niveaux) et le détail est fourni", async () => {
    const { organizationId, ownerId, warehouseId, variantId, db } = await seed()
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId,
          variantId,
          delta: 5,
          type: "adjustment",
          reason: "init",
        },
      ],
    })

    let erreur: unknown = null
    try {
      await applyMovements(db, {
        organizationId,
        userId: ownerId,
        mouvements: [
          {
            warehouseId,
            variantId,
            delta: -8,
            type: "adjustment",
            reason: "trop",
          },
        ],
      })
    } catch (err) {
      erreur = err
    }
    expect(erreur).toBeInstanceOf(ErreurStockInsuffisant)
    if (erreur instanceof ErreurStockInsuffisant) {
      expect(erreur.details).toEqual([
        { warehouseId, variantId, disponible: 5, demande: 8 },
      ])
    }
    // Atomicité : le niveau est intact et AUCUN mouvement -8 n'a été journalisé
    expect((await niveau(db, warehouseId, variantId))?.quantity).toBe(5)
    const journal = await db
      .select()
      .from(schema.stockMovements)
      .where(eq(schema.stockMovements.variantId, variantId))
    expect(journal).toHaveLength(1)
  })

  it("échec multi-lignes : si UNE ligne manque de stock, AUCUNE ligne n'est appliquée", async () => {
    const { organizationId, ownerId, warehouseId, variantId, db } = await seed()
    const autre = await creerProduitSimple(organizationId, { nom: "Autre" })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId,
          variantId,
          delta: 10,
          type: "adjustment",
          reason: "init",
        },
        {
          warehouseId,
          variantId: autre.variantId,
          delta: 2,
          type: "adjustment",
          reason: "init",
        },
      ],
    })

    await expect(
      applyMovements(db, {
        organizationId,
        userId: ownerId,
        mouvements: [
          {
            warehouseId,
            variantId,
            delta: -1,
            type: "adjustment",
            reason: "ok",
          },
          {
            warehouseId,
            variantId: autre.variantId,
            delta: -5,
            type: "adjustment",
            reason: "insuffisant",
          },
        ],
      })
    ).rejects.toBeInstanceOf(ErreurStockInsuffisant)

    // La ligne « ok » n'a pas été appliquée non plus
    expect((await niveau(db, warehouseId, variantId))?.quantity).toBe(10)
    expect((await niveau(db, warehouseId, autre.variantId))?.quantity).toBe(2)
  })

  it("premier mouvement négatif sur une paire jamais stockée : rejeté sans ligne fantôme", async () => {
    const { organizationId, ownerId, warehouseId, variantId, db } = await seed()

    // Aucun stock_levels préexistant pour (warehouseId, variantId) : le
    // batch pose d'abord le guard-INSERT (quantity 0), puis l'UPDATE porte
    // la quantité à -3, ce qui viole le CHECK et doit annuler LE BATCH
    // ENTIER — y compris le guard-INSERT, qui ne doit pas persister seul.
    let erreur: unknown = null
    try {
      await applyMovements(db, {
        organizationId,
        userId: ownerId,
        mouvements: [
          {
            warehouseId,
            variantId,
            delta: -3,
            type: "adjustment",
            reason: "casse",
          },
        ],
      })
    } catch (err) {
      erreur = err
    }
    expect(erreur).toBeInstanceOf(ErreurStockInsuffisant)
    if (erreur instanceof ErreurStockInsuffisant) {
      expect(erreur.details).toEqual([
        { warehouseId, variantId, disponible: 0, demande: 3 },
      ])
    }
    // Aucune ligne fantôme : le guard-INSERT a bien été annulé avec le reste
    // du batch.
    expect(await niveau(db, warehouseId, variantId)).toBeNull()
  })

  it("un CHECK d'une AUTRE table dans instructionsAvant n'est jamais classé en stock insuffisant", async () => {
    const { organizationId, ownerId, warehouseId, variantId, db } = await seed()

    // Table auxiliaire portant SA PROPRE contrainte CHECK, sans rapport avec
    // stock_levels_quantity_positive — simule un futur appelant (Tasks
    // 7/9/10) dont l'instructionsAvant fait échouer un CHECK non lié au
    // stock, dans le MÊME batch.
    await db.run(
      sql`CREATE TABLE aux_check_test (
        id INTEGER PRIMARY KEY,
        val INTEGER NOT NULL,
        CONSTRAINT aux_val_positive CHECK (val >= 0)
      )`
    )

    let erreur: unknown = null
    try {
      await applyMovements(db, {
        organizationId,
        userId: ownerId,
        mouvements: [
          {
            warehouseId,
            variantId,
            delta: 10,
            type: "adjustment",
            reason: "init",
          },
        ],
        instructionsAvant: [
          db.run(sql`INSERT INTO aux_check_test (val) VALUES (-1)`),
        ],
      })
    } catch (err) {
      erreur = err
    }
    // L'erreur doit remonter TELLE QUELLE (pas ErreurStockInsuffisant, qui
    // porterait un détail vide/trompeur puisqu'aucune ligne n'est réellement
    // en rupture de stock ici).
    expect(erreur).not.toBeNull()
    expect(erreur).not.toBeInstanceOf(ErreurStockInsuffisant)
    // Atomicité : le CHECK non lié a bien annulé le batch ENTIER, le
    // mouvement adjustment n'a pas non plus été appliqué.
    expect(await niveau(db, warehouseId, variantId)).toBeNull()
  })

  it("CMP : pondération, arrondi à l'entier, et cas qtyAvant <= 0", async () => {
    const { organizationId, ownerId, warehouseId, variantId, db } = await seed()

    // Première réception : 10 unités à 100 → CMP 100
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId, variantId, delta: 10, type: "purchase", unitCost: 100 },
      ],
    })
    let n = await niveau(db, warehouseId, variantId)
    expect(n?.quantity).toBe(10)
    expect(n?.avgCost).toBe(100)

    // Deuxième réception : 5 à 160 → round((10×100 + 5×160) / 15) = 120
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId, variantId, delta: 5, type: "purchase", unitCost: 160 },
      ],
    })
    n = await niveau(db, warehouseId, variantId)
    expect(n?.quantity).toBe(15)
    expect(n?.avgCost).toBe(120)

    // Arrondi : 3 à 105 → round((15×120 + 3×105) / 18) = round(117.5) = 118
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId, variantId, delta: 3, type: "purchase", unitCost: 105 },
      ],
    })
    n = await niveau(db, warehouseId, variantId)
    expect(n?.avgCost).toBe(118)

    // Vider le stock : le CMP reste (valorisation figée)…
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId,
          variantId,
          delta: -18,
          type: "adjustment",
          reason: "vide",
        },
      ],
    })
    // … et qtyAvant = 0 : la réception suivante REPART de son coût d'apport
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId, variantId, delta: 4, type: "purchase", unitCost: 500 },
      ],
    })
    n = await niveau(db, warehouseId, variantId)
    expect(n?.quantity).toBe(4)
    expect(n?.avgCost).toBe(500)
  })

  it("agrège plusieurs mouvements de la même variante en un seul niveau (coût pondéré)", async () => {
    const { organizationId, ownerId, warehouseId, variantId, db } = await seed()
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId, variantId, delta: 4, type: "purchase", unitCost: 100 },
        { warehouseId, variantId, delta: 6, type: "purchase", unitCost: 200 },
      ],
    })
    const n = await niveau(db, warehouseId, variantId)
    expect(n?.quantity).toBe(10)
    // round((4×100 + 6×200) / 10) = 160
    expect(n?.avgCost).toBe(160)
  })

  it("valide ses entrées : mouvement vide, delta nul, purchase sans unitCost", async () => {
    const { organizationId, ownerId, warehouseId, variantId, db } = await seed()
    await expect(
      applyMovements(db, { organizationId, userId: ownerId, mouvements: [] })
    ).rejects.toThrow("au moins un mouvement")
    await expect(
      applyMovements(db, {
        organizationId,
        userId: ownerId,
        mouvements: [
          { warehouseId, variantId, delta: 0, type: "adjustment", reason: "x" },
        ],
      })
    ).rejects.toThrow("delta entier non nul")
    await expect(
      applyMovements(db, {
        organizationId,
        userId: ownerId,
        mouvements: [{ warehouseId, variantId, delta: 5, type: "purchase" }],
      })
    ).rejects.toThrow("unitCost")
  })
})

describe("stockService.definirSeuil", () => {
  it("crée la ligne de niveau à quantité 0 si besoin, puis modifie le seuil sans toucher au stock", async () => {
    const { organizationId, ownerId, warehouseId, variantId, db } = await seed()

    await definirSeuil(db, {
      organizationId,
      warehouseId,
      variantId,
      minStock: 12,
    })
    let n = await niveau(db, warehouseId, variantId)
    expect(n?.quantity).toBe(0)
    expect(n?.minStock).toBe(12)

    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId,
          variantId,
          delta: 30,
          type: "adjustment",
          reason: "init",
        },
      ],
    })
    await definirSeuil(db, {
      organizationId,
      warehouseId,
      variantId,
      minStock: null,
    })
    n = await niveau(db, warehouseId, variantId)
    expect(n?.quantity).toBe(30)
    expect(n?.minStock).toBeNull()
  })
})
