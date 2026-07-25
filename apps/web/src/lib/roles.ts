import type { CompanyRole, WarehouseRole } from "shared"

export const ROLES_ENTREPRISE_FR: Record<CompanyRole, string> = {
  owner: "Propriétaire",
  admin: "Administrateur",
  auditor: "Auditeur",
  stock_manager: "Gestionnaire de stock",
  staff: "Employé",
}

export const ROLES_ENTREPOT_FR: Record<WarehouseRole, string> = {
  manager: "Responsable",
  auditor: "Auditeur",
  cashier: "Caissier",
}

/**
 * Company roles whose stock scope already covers every warehouse — front
 * mirror of `lectureTous` in `useAccesStock`. Only `staff` draws its scope
 * from warehouse assignments, which is why a staff account without one has
 * no access at all.
 */
const ROLES_PORTEE_GLOBALE: readonly CompanyRole[] = [
  "owner",
  "admin",
  "auditor",
  "stock_manager",
]

export function aPorteeGlobale(role: CompanyRole): boolean {
  return ROLES_PORTEE_GLOBALE.includes(role)
}

/**
 * Company roles an admin who is not the owner may assign or edit — front
 * mirror of the API's `ROLES_GERABLES_PAR_ADMIN`. The front hides what the
 * API would refuse; the API remains the authority.
 */
const ROLES_GERABLES_PAR_ADMIN: readonly CompanyRole[] = [
  "auditor",
  "stock_manager",
  "staff",
]

/** Whether `demandeur` may edit the role, assignments and status of an account holding `cible`. */
export function peutGererRole(
  demandeur: CompanyRole,
  cible: CompanyRole
): boolean {
  if (demandeur === "owner") return true
  if (demandeur !== "admin") return false
  return ROLES_GERABLES_PAR_ADMIN.includes(cible)
}

/**
 * Company roles `demandeur` may assign, in the order shown in the selects.
 * Empty for every role without management rights, so the list stays aligned
 * with `peutGererRole` instead of handing an auditor a set of roles it may
 * not grant.
 */
export function rolesAttribuables(demandeur: CompanyRole): CompanyRole[] {
  if (demandeur === "owner") {
    return ["owner", "admin", "stock_manager", "auditor", "staff"]
  }
  if (demandeur === "admin") return [...ROLES_GERABLES_PAR_ADMIN]
  return []
}
