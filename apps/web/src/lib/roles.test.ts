import { describe, it, expect } from "vitest"
import { aPorteeGlobale, peutGererRole, rolesAttribuables } from "@/lib/roles"

// These helpers mirror API rules (`ROLES_GERABLES_PAR_ADMIN`, the stock scope
// of `porteeLectureStock`). A drift here shows a control the API then refuses,
// so the mirror is pinned down rather than left to the screens.
describe("peutGererRole", () => {
  it("laisse le propriétaire gérer tous les rôles", () => {
    for (const cible of [
      "owner",
      "admin",
      "auditor",
      "stock_manager",
      "staff",
    ] as const) {
      expect(peutGererRole("owner", cible)).toBe(true)
    }
  })

  it("interdit à un administrateur de gérer un propriétaire ou un autre administrateur", () => {
    expect(peutGererRole("admin", "owner")).toBe(false)
    expect(peutGererRole("admin", "admin")).toBe(false)
    expect(peutGererRole("admin", "auditor")).toBe(true)
    expect(peutGererRole("admin", "stock_manager")).toBe(true)
    expect(peutGererRole("admin", "staff")).toBe(true)
  })

  it("n'accorde la gestion à aucun autre rôle d'entreprise", () => {
    expect(peutGererRole("auditor", "staff")).toBe(false)
    expect(peutGererRole("stock_manager", "staff")).toBe(false)
    expect(peutGererRole("staff", "staff")).toBe(false)
  })
})

describe("rolesAttribuables", () => {
  it("propose les cinq rôles au propriétaire", () => {
    expect(rolesAttribuables("owner")).toEqual([
      "owner",
      "admin",
      "stock_manager",
      "auditor",
      "staff",
    ])
  })

  it("retire propriétaire et administrateur des choix d'un administrateur", () => {
    expect(rolesAttribuables("admin")).toEqual([
      "auditor",
      "stock_manager",
      "staff",
    ])
  })
})

describe("aPorteeGlobale", () => {
  it("ne réserve la portée par affectation qu'à l'employé", () => {
    expect(aPorteeGlobale("owner")).toBe(true)
    expect(aPorteeGlobale("admin")).toBe(true)
    expect(aPorteeGlobale("auditor")).toBe(true)
    expect(aPorteeGlobale("stock_manager")).toBe(true)
    expect(aPorteeGlobale("staff")).toBe(false)
  })
})
