import { useRouteContext } from "@tanstack/react-router"

// Rôles d'entreprise autorisés à écrire le catalogue (matrice spec §4).
// Centralisé ici : le trio owner/admin/stock_manager était recopié dans
// chaque écran du catalogue.
export function usePeutEcrire(): boolean {
  const { me } = useRouteContext({ from: "/_app" })
  const role = me.membership?.role
  return role === "owner" || role === "admin" || role === "stock_manager"
}
