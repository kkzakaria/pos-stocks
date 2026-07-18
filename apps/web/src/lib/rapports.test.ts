import { describe, it, expect } from "vitest"
import {
  blocsTableauDeBord,
  boutiquesLisibles,
  periodePreset,
} from "@/lib/rapports"
import type { MeLike } from "@/lib/pos"
import type { CompanyRole, WarehouseRole } from "shared"

const me = (
  role: CompanyRole | undefined,
  assignments: Array<{
    warehouseId: string
    warehouseName: string
    role: WarehouseRole
  }> = []
): MeLike => ({
  membership: role ? { role } : null,
  assignments,
})

describe("periodePreset", () => {
  // Date fixe : samedi 2026-07-12 (heure locale)
  const maintenant = new Date(2026, 6, 12, 15, 30)

  it("jour : du = au = aujourd'hui", () => {
    expect(periodePreset("jour", maintenant)).toEqual({
      du: "2026-07-12",
      au: "2026-07-12",
    })
  })

  it("semaine : 7 jours glissants (aujourd'hui inclus)", () => {
    expect(periodePreset("semaine", maintenant)).toEqual({
      du: "2026-07-06",
      au: "2026-07-12",
    })
  })

  it("mois : depuis le 1er du mois courant", () => {
    expect(periodePreset("mois", maintenant)).toEqual({
      du: "2026-07-01",
      au: "2026-07-12",
    })
  })

  it("semaine à cheval sur deux mois", () => {
    expect(periodePreset("semaine", new Date(2026, 7, 3))).toEqual({
      du: "2026-07-28",
      au: "2026-08-03",
    })
  })
})

describe("blocsTableauDeBord", () => {
  it("owner/admin/auditor : les 4 blocs", () => {
    for (const role of ["owner", "admin", "auditor"] as const) {
      expect(blocsTableauDeBord(me(role))).toEqual({
        ventes: true,
        alertes: true,
        transferts: true,
        valorisation: true,
        aucun: false,
      })
    }
  })

  it("stock_manager : alertes, transferts, valorisation — pas les ventes", () => {
    expect(blocsTableauDeBord(me("stock_manager"))).toEqual({
      ventes: false,
      alertes: true,
      transferts: true,
      valorisation: true,
      aucun: false,
    })
  })

  it("manager/auditor local : les 4 blocs — la valorisation suit l'onglet Rapports", () => {
    for (const role of ["manager", "auditor"] as const) {
      expect(
        blocsTableauDeBord(
          me("staff", [{ warehouseId: "b1", warehouseName: "B1", role }])
        )
      ).toEqual({
        ventes: true,
        alertes: true,
        transferts: true,
        valorisation: true,
        aucun: false,
      })
    }
  })

  it("caissier pur : aucun bloc", () => {
    expect(
      blocsTableauDeBord(
        me("staff", [
          { warehouseId: "b1", warehouseName: "B1", role: "cashier" },
        ])
      ).aucun
    ).toBe(true)
  })
})

describe("boutiquesLisibles", () => {
  const destinations = [
    { id: "b1", name: "Boutique 1", type: "store" },
    { id: "b2", name: "Boutique 2", type: "store" },
    { id: "d1", name: "Dépôt", type: "warehouse" },
  ]

  it("rôles org : toutes les boutiques (jamais les dépôts)", () => {
    expect(boutiquesLisibles(me("owner"), destinations)).toEqual([
      { id: "b1", name: "Boutique 1" },
      { id: "b2", name: "Boutique 2" },
    ])
    expect(boutiquesLisibles(me("auditor"), destinations)).toHaveLength(2)
  })

  it("staff : ses affectations (manager, auditor OU cashier) croisées avec les boutiques", () => {
    expect(
      boutiquesLisibles(
        me("staff", [
          { warehouseId: "b1", warehouseName: "Boutique 1", role: "cashier" },
          { warehouseId: "d1", warehouseName: "Dépôt", role: "manager" },
        ]),
        destinations
      )
    ).toEqual([{ id: "b1", name: "Boutique 1" }])
  })

  it("stock_manager sans affectation : aucune boutique", () => {
    expect(boutiquesLisibles(me("stock_manager"), destinations)).toEqual([])
  })
})
