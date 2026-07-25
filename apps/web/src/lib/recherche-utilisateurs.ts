import { COMPANY_ROLES } from "shared"
import type { CompanyRole } from "shared"

// URL-state contract for the users list: filters live in the URL so a
// filtered view is shareable, refresh- and back-safe. The API applies the
// same filters server-side, so `total` always matches what is on screen.
export type RechercheUtilisateurs = {
  q?: string
  role?: CompanyRole
  // Boolean, not "true"/"false": the router parses `?actif=false` back as a
  // boolean, so a string type would silently drop the filter on reload.
  actif?: boolean
  page?: number
}

export function validerRechercheUtilisateurs(
  search: Record<string, unknown>
): RechercheUtilisateurs {
  const resultat: RechercheUtilisateurs = {}
  if (typeof search.q === "string" && search.q) resultat.q = search.q
  if (
    typeof search.role === "string" &&
    (COMPANY_ROLES as readonly string[]).includes(search.role)
  ) {
    resultat.role = search.role as CompanyRole
  }
  if (typeof search.actif === "boolean") resultat.actif = search.actif
  const page = Number(search.page)
  if (Number.isInteger(page) && page > 1) resultat.page = page
  return resultat
}
