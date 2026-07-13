export type StatutTransfert = "pending" | "sent" | "received" | "cancelled"

export const STATUTS_TRANSFERT_FR: Record<StatutTransfert, string> = {
  pending: "En attente",
  sent: "Expédié",
  received: "Réceptionné",
  cancelled: "Annulé",
}

// Statuts en badges sémantiques NON-indigo (l'indigo reste réservé à l'action
// et à la sélection) : en attente = warning, expédié/en transit = secondary,
// réceptionné = success, annulé = destructive.
export function varianteBadgeStatut(
  statut: StatutTransfert
): "warning" | "secondary" | "success" | "destructive" {
  switch (statut) {
    case "pending":
      return "warning"
    case "sent":
      return "secondary"
    case "received":
      return "success"
    case "cancelled":
      return "destructive"
  }
}

export type LigneTransfert = {
  id: string
  variantId: string
  productId: string
  productName: string
  variantName: string
  sku: string
  trackLots: boolean
  lotId: string | null
  lotNumber: string | null
  quantity: number
  unitCost: number | null
  receivedQuantity: number | null
}

export type TransfertDetail = {
  id: string
  fromWarehouseId: string
  fromWarehouseName: string
  toWarehouseId: string
  toWarehouseName: string
  reference: string | null
  status: StatutTransfert
  createdAt: string
  sentAt: string | null
  receivedAt: string | null
  cancelledAt: string | null
  items: LigneTransfert[]
}

export type TransfertListe = {
  id: string
  fromWarehouseId: string
  fromWarehouseName: string
  toWarehouseId: string
  toWarehouseName: string
  reference: string | null
  status: StatutTransfert
  createdAt: string
  sentAt: string | null
  receivedAt: string | null
  itemCount: number
  totalQuantity: number
}

// Valide la saisie des quantités reçues (chaînes brutes des inputs) contre
// les quantités expédiées et construit le corps de POST /receive : seuls les
// écarts sont transmis (ligne vide ou égale à l'expédié = tout reçu).
export function preparerReception(
  lignes: Array<{ id: string; quantity: number }>,
  saisies: Record<string, string | undefined>
):
  | { ok: true; items: Array<{ itemId: string; receivedQuantity: number }> }
  | { ok: false; erreur: string } {
  const items: Array<{ itemId: string; receivedQuantity: number }> = []
  for (const ligne of lignes) {
    const brut = saisies[ligne.id]
    if (brut === undefined || brut === "") continue
    const valeur = Number(brut)
    if (!Number.isInteger(valeur) || valeur < 0) {
      return {
        ok: false,
        erreur:
          "Les quantités reçues doivent être des entiers positifs ou nuls",
      }
    }
    if (valeur > ligne.quantity) {
      return {
        ok: false,
        erreur: `Quantité reçue supérieure à la quantité expédiée (${ligne.quantity})`,
      }
    }
    if (valeur !== ligne.quantity) {
      items.push({ itemId: ligne.id, receivedQuantity: valeur })
    }
  }
  return { ok: true, items }
}
