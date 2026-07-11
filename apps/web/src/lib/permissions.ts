import { useRouteContext } from "@tanstack/react-router"

// Rôles d'entreprise autorisés à écrire le catalogue (matrice spec §4).
// Centralisé ici : le trio owner/admin/stock_manager était recopié dans
// chaque écran du catalogue.
export function usePeutEcrire(): boolean {
  const { me } = useRouteContext({ from: "/_app" })
  const role = me.membership?.role
  return role === "owner" || role === "admin" || role === "stock_manager"
}

export type AccesStock = {
  // au moins un entrepôt lisible
  lecture: boolean
  // owner/admin/auditor/stock_manager : tout voir
  lectureTous: boolean
  // entrepôts lisibles d'un staff (rôles locaux manager/auditor)
  entrepotsLecture: string[]
  // owner/admin/stock_manager : écrire partout
  ecritureTous: boolean
  // entrepôts où un staff est manager
  entrepotsEcriture: string[]
}

// Miroir front de la portée stock de l'API (matrice spec §4) — le front
// masque, l'API fait autorité.
export function useAccesStock(): AccesStock {
  const { me } = useRouteContext({ from: "/_app" })
  const role = me.membership?.role
  const lectureTous =
    role === "owner" ||
    role === "admin" ||
    role === "auditor" ||
    role === "stock_manager"
  const ecritureTous =
    role === "owner" || role === "admin" || role === "stock_manager"
  const entrepotsLecture = me.assignments
    .filter((a) => a.role === "manager" || a.role === "auditor")
    .map((a) => a.warehouseId)
  const entrepotsEcriture = me.assignments
    .filter((a) => a.role === "manager")
    .map((a) => a.warehouseId)
  return {
    lecture: lectureTous || entrepotsLecture.length > 0,
    lectureTous,
    entrepotsLecture,
    ecritureTous,
    entrepotsEcriture,
  }
}
