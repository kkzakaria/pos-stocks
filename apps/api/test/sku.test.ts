import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import * as schema from "../src/db/schema"
import { genererSkuProduit, genererSkuVariante } from "../src/lib/sku"
import { bootstrapOwner } from "./helpers"

async function insererProduit(organizationId: string, sku: string) {
  const db = drizzle(env.DB, { schema })
  await db.insert(schema.products).values({
    id: crypto.randomUUID(),
    organizationId,
    name: `Produit ${sku}`,
    sku,
    price: 1000,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

describe("génération de SKU", () => {
  it("génère PRD-0001 pour le premier produit de l'organisation", async () => {
    const { organizationId } = await bootstrapOwner()
    const db = drizzle(env.DB, { schema })
    expect(await genererSkuProduit(db, organizationId)).toBe("PRD-0001")
  })

  it("incrémente le max numérique existant avec zero-pad sur 4", async () => {
    const { organizationId } = await bootstrapOwner()
    const db = drizzle(env.DB, { schema })
    await insererProduit(organizationId, "PRD-0007")
    await insererProduit(organizationId, "PRD-0002")
    await insererProduit(organizationId, "REF-CUSTOM")
    expect(await genererSkuProduit(db, organizationId)).toBe("PRD-0008")
  })

  it("suffixe la variante avec les valeurs d'attributs upper-slugifiées", () => {
    expect(
      genererSkuVariante("PRD-0001", { taille: "M", couleur: "Rouge" })
    ).toBe("PRD-0001-M-ROUGE")
    expect(genererSkuVariante("PRD-0001", { couleur: "Rouge foncé" })).toBe(
      "PRD-0001-ROUGE-FONCE"
    )
  })

  it("suffixe -STD pour la variante implicite sans attributs", () => {
    expect(genererSkuVariante("PRD-0001", {})).toBe("PRD-0001-STD")
  })
})
