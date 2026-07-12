import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import * as schema from "../src/db/schema"
import { bornesPeriode } from "../src/lib/dates"
import { porteeRapport } from "../src/lib/reports-acces"
import { champCsv, genererCsv } from "../src/lib/csv"
import {
  affecterEntrepot,
  bootstrapOwner,
  createUserWithRole,
  creerEntrepot,
} from "./helpers"

describe("bornesPeriode", () => {
  it("borne une période valide en UTC, fin EXCLUSIVE au lendemain", () => {
    expect(bornesPeriode("2026-07-01", "2026-07-03")).toEqual({
      debut: new Date("2026-07-01T00:00:00.000Z"),
      finExclue: new Date("2026-07-04T00:00:00.000Z"),
    })
  })

  it("accepte une période d'un seul jour", () => {
    expect(bornesPeriode("2026-07-12", "2026-07-12")).toEqual({
      debut: new Date("2026-07-12T00:00:00.000Z"),
      finExclue: new Date("2026-07-13T00:00:00.000Z"),
    })
  })

  it("rejette les dates calendaires impossibles et l'ordre inversé", () => {
    expect(bornesPeriode("2026-02-30", "2026-03-01")).toBeNull()
    expect(bornesPeriode("2026-07-01", "2026-13-40")).toBeNull()
    expect(bornesPeriode("2026-07-05", "2026-07-01")).toBeNull()
  })
})

describe("champCsv / genererCsv", () => {
  it("échappe selon RFC 4180 (point-virgule, guillemets, retours ligne)", () => {
    expect(champCsv("simple")).toBe("simple")
    expect(champCsv(1500)).toBe("1500")
    expect(champCsv(null)).toBe("")
    expect(champCsv("avec;separateur")).toBe('"avec;separateur"')
    expect(champCsv('Boisson "Cola"')).toBe('"Boisson ""Cola"""')
    expect(champCsv("ligne\ncoupee")).toBe('"ligne\ncoupee"')
  })

  it("échappe un champ combinant point-virgule, guillemets et saut de ligne", () => {
    expect(champCsv('a;"b"\nc')).toBe('"a;""b""\nc"')
  })

  it("génère BOM + en-têtes + lignes en CRLF, séparateur point-virgule", () => {
    const csv = genererCsv(
      ["Boutique", "CA"],
      [
        ["Alpha", 1500],
        ["Beta;Sud", 2000],
      ]
    )
    expect(csv).toBe('\uFEFFBoutique;CA\r\nAlpha;1500\r\n"Beta;Sud";2000\r\n')
  })
})

describe("porteeRapport (matrice §4, ligne Rapports)", () => {
  it("applique la matrice rôle par rôle", async () => {
    const { organizationId, ownerId } = await bootstrapOwner()
    const entrepot = await creerEntrepot(organizationId, "Dépôt P")
    const boutique = await creerEntrepot(organizationId, "Boutique P", "store")
    const db = drizzle(env.DB, { schema })

    // owner : tout, sur les trois rapports
    for (const rapport of ["ventes", "marges", "valorisation"] as const) {
      expect(
        await porteeRapport(db, organizationId, ownerId, "owner", rapport)
      ).toEqual({ tous: true })
    }

    // auditor org : tout (lecture)
    const auditor = await createUserWithRole(organizationId, "auditor")
    expect(
      await porteeRapport(
        db,
        organizationId,
        auditor.userId,
        "auditor",
        "marges"
      )
    ).toEqual({ tous: true })

    // stock_manager : valorisation SEULEMENT
    const gestionnaire = await createUserWithRole(
      organizationId,
      "stock_manager"
    )
    expect(
      await porteeRapport(
        db,
        organizationId,
        gestionnaire.userId,
        "stock_manager",
        "valorisation"
      )
    ).toEqual({ tous: true })
    expect(
      await porteeRapport(
        db,
        organizationId,
        gestionnaire.userId,
        "stock_manager",
        "ventes"
      )
    ).toBeNull()
    expect(
      await porteeRapport(
        db,
        organizationId,
        gestionnaire.userId,
        "stock_manager",
        "marges"
      )
    ).toBeNull()

    // manager local : SES entrepôts
    const manager = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, manager.userId, boutique, "manager")
    expect(
      await porteeRapport(db, organizationId, manager.userId, "staff", "ventes")
    ).toEqual({ tous: false, warehouseIds: [boutique] })

    // caissier pur : exclu (portée vide → null → 403)
    const caissier = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, caissier.userId, boutique, "cashier")
    expect(
      await porteeRapport(
        db,
        organizationId,
        caissier.userId,
        "staff",
        "ventes"
      )
    ).toBeNull()
    expect(
      await porteeRapport(
        db,
        organizationId,
        caissier.userId,
        "staff",
        "valorisation"
      )
    ).toBeNull()

    // staff sans affectation : exclu aussi
    const sansRien = await createUserWithRole(organizationId, "staff")
    expect(
      await porteeRapport(
        db,
        organizationId,
        sansRien.userId,
        "staff",
        "ventes"
      )
    ).toBeNull()
    void entrepot
  })
})
