import { Badge } from "@/components/ui/badge"
import { aPorteeGlobale, ROLES_ENTREPOT_FR } from "@/lib/roles"
import type { Utilisateur } from "./types"

/**
 * Effective stock scope of an account, not its raw assignment rows: a
 * company-wide role already reaches every warehouse, whereas a staff account
 * only reaches what it is assigned to — so a staff account with no assignment
 * reaches nothing, which the register states outright.
 */
export function PorteeUtilisateur({
  utilisateur,
}: {
  utilisateur: Utilisateur
}) {
  if (aPorteeGlobale(utilisateur.role)) {
    return <span>Tous les entrepôts</span>
  }
  if (utilisateur.assignments.length === 0) {
    return <Badge variant="warning">Aucun accès</Badge>
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {utilisateur.assignments.map((a) => (
        <li key={a.id}>
          {a.warehouseName}{" "}
          <span className="text-muted-foreground">
            · {ROLES_ENTREPOT_FR[a.role]}
          </span>
        </li>
      ))}
    </ul>
  )
}
