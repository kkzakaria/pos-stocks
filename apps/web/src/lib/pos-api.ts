import { apiFetch } from "./api"
import type { ArticlePos } from "./pos"
import type { SaleCreateInput } from "shared"

export type CategoriePos = { id: string; name: string }

export type SessionCaisse = {
  id: string
  openingFloat: number
  openedAt: string
}

export type SessionFermeture = {
  id: string
  status: string
  openingFloat: number
  countedAmount: number | null
  expectedCash: number | null
  difference: number | null
  openedAt: string
  closedAt: string | null
}

export type Disponibilite = {
  warehouseId: string
  warehouseName: string
  type: string
  quantity: number
}

export type LigneVente = {
  id: string
  variantId: string
  productName: string
  variantName: string
  sku: string
  quantity: number
  unitPrice: number
  catalogPrice: number
  sourceWarehouseId: string
  sourceWarehouseName: string
  lotNumber: string | null
}

export type PaiementVente = {
  method: "cash" | "mobile_money"
  amount: number
  reference: string | null
  receivedAmount: number | null
  changeGiven: number | null
}

export type VenteDetail = {
  id: string
  ticketNumber: number
  total: number
  currency: string
  status: string
  createdAt: string
  storeId: string
  storeName: string
  cashierName: string
  items: LigneVente[]
  payments: PaiementVente[]
}

export type VenteListe = {
  id: string
  ticketNumber: number
  total: number
  currency: string
  status: string
  createdAt: string
  cashierName: string
  itemCount: number
}

export type ReglagesTicket = {
  name: string
  currency: string
  receiptHeader: string
  receiptFooter: string
}

export function fetchCataloguePos(storeId: string) {
  return apiFetch<{ categories: CategoriePos[]; articles: ArticlePos[] }>(
    `/api/v1/pos/catalogue?storeId=${storeId}`
  )
}

export function fetchSessionCourante(storeId: string) {
  return apiFetch<{ session: SessionCaisse | null }>(
    `/api/v1/register-sessions/current?storeId=${storeId}`
  )
}

export function ouvrirSession(storeId: string, openingFloat: number) {
  return apiFetch<{ id: string }>("/api/v1/register-sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ storeId, openingFloat }),
  })
}

export function fermerSession(sessionId: string, countedAmount: number) {
  return apiFetch<{ session: SessionFermeture }>(
    `/api/v1/register-sessions/${sessionId}/close`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ countedAmount }),
    }
  )
}

export function fetchDisponibilites(storeId: string, variantId: string) {
  return apiFetch<{ disponibilites: Disponibilite[] }>(
    `/api/v1/pos/disponibilites?storeId=${storeId}&variantId=${variantId}`
  )
}

export function envoyerVente(corps: SaleCreateInput) {
  return apiFetch<{ sale: VenteDetail; dejaEnregistree: boolean }>(
    "/api/v1/sales",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corps),
    }
  )
}

export type PageVentes = {
  sales: VenteListe[]
  total: number
  page: number
  parPage: number
}

export function fetchVentesDuJour(storeId: string, jour: string, page = 1) {
  return apiFetch<PageVentes>(
    `/api/v1/sales?storeId=${storeId}&jour=${jour}&page=${page}&parPage=50`
  )
}

export function fetchVente(saleId: string) {
  return apiFetch<{ sale: VenteDetail }>(`/api/v1/sales/${saleId}`)
}

export function fetchReglagesTicket() {
  return apiFetch<ReglagesTicket>("/api/v1/organization")
}
