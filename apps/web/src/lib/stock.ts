import { useQuery } from "@tanstack/react-query"
import { useRouteContext } from "@tanstack/react-router"
import { apiFetch } from "./api"
import { useAccesStock } from "./permissions"

export type EntrepotOption = { id: string; name: string }

export type NiveauStock = {
  variantId: string
  productId: string
  productName: string
  variantName: string
  sku: string
  quantity: number
  avgCost: number
  minStock: number | null
  seuilEffectif: number | null
  enAlerte: boolean
}

export type MouvementJournal = {
  id: string
  createdAt: string
  warehouseId: string
  warehouseName: string
  variantId: string
  productName: string
  variantName: string
  sku: string
  delta: number
  type: string
  reason: string | null
  refType: string | null
  refId: string | null
  userName: string
  lotNumber: string | null
}

export const LIBELLES_TYPE_MOUVEMENT: Record<string, string> = {
  purchase: "Réception",
  sale: "Vente",
  transfer_out: "Transfert (sortie)",
  transfer_in: "Transfert (entrée)",
  adjustment: "Ajustement",
  count: "Inventaire",
}

// Entrepôts proposés dans les sélecteurs : les rôles d'entreprise chargent
// la liste complète (GET /warehouses leur est réservé) ; un staff se
// contente de ses affectations manager/auditor (déjà dans le contexte me).
export function useEntrepotsVisibles(): {
  options: EntrepotOption[]
  isPending: boolean
} {
  const acces = useAccesStock()
  const { me } = useRouteContext({ from: "/_app" })
  const entrepots = useQuery({
    queryKey: ["warehouses"],
    queryFn: () =>
      apiFetch<{ warehouses: Array<{ id: string; name: string }> }>(
        "/api/v1/warehouses"
      ),
    enabled: acces.lectureTous,
  })
  if (acces.lectureTous) {
    return {
      options: (entrepots.data?.warehouses ?? []).map((w) => ({
        id: w.id,
        name: w.name,
      })),
      isPending: entrepots.isPending,
    }
  }
  return {
    options: me.assignments
      .filter((a) => a.role === "manager" || a.role === "auditor")
      .map((a) => ({ id: a.warehouseId, name: a.warehouseName })),
    isPending: false,
  }
}
