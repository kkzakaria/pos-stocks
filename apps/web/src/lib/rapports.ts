import { apiFetch, apiUrl } from "./api"
import { jourLocal } from "./pos"
import type { MeLike } from "./pos"
import type { PageVentes, VenteDetail } from "./pos-api"

// ---- Types miroirs des contrats /api/v1/reports (l'API fait autorité) ----

export type TotalVentes = {
  ca: number
  tickets: number
  panierMoyen: number
  cash: number
  mobileMoney: number
}

export type LigneVentesBoutique = TotalVentes & {
  storeId: string
  storeName: string
}

export type LigneVentesProduit = {
  productId: string
  productName: string
  variantId: string
  variantName: string
  sku: string
  quantite: number
  ca: number
  remise: number
  tickets: number
}

export type RapportVentesBoutiques = {
  periode: { du: string; au: string }
  groupe: "boutique"
  total: TotalVentes
  lignes: LigneVentesBoutique[]
}

export type RapportVentesProduits = {
  periode: { du: string; au: string }
  groupe: "produit"
  total: TotalVentes
  lignes: LigneVentesProduit[]
}

export type LigneValorisation = {
  variantId: string
  productName: string
  variantName: string
  sku: string
  quantity: number
  avgCost: number
  valeur: number
}

export type EntrepotValorisation = {
  warehouseId: string
  warehouseName: string
  valeur: number
  lignes: LigneValorisation[]
}

export type RapportValorisation = {
  entrepots: EntrepotValorisation[]
  total: number
}

export type LigneMarge = {
  productId: string
  productName: string
  variantId: string
  variantName: string
  sku: string
  quantite: number
  ca: number
  cout: number
  marge: number
  estime: boolean
}

export type RapportMarges = {
  periode: { du: string; au: string }
  total: { ca: number; cout: number; marge: number; estime: boolean }
  lignes: LigneMarge[]
}

export type MargeVente = { cout: number; marge: number; estime: boolean }

// ---- Fetchers ----

function suffixeStore(storeId?: string): string {
  return storeId ? `&storeId=${storeId}` : ""
}

export function fetchRapportVentesBoutiques(
  du: string,
  au: string,
  storeId?: string
) {
  return apiFetch<RapportVentesBoutiques>(
    `/api/v1/reports/sales?du=${du}&au=${au}&groupe=boutique${suffixeStore(storeId)}`
  )
}

export function fetchRapportVentesProduits(
  du: string,
  au: string,
  storeId?: string
) {
  return apiFetch<RapportVentesProduits>(
    `/api/v1/reports/sales?du=${du}&au=${au}&groupe=produit${suffixeStore(storeId)}`
  )
}

export function fetchRapportValorisation(warehouseId?: string) {
  return apiFetch<RapportValorisation>(
    `/api/v1/reports/valuation${warehouseId ? `?warehouseId=${warehouseId}` : ""}`
  )
}

export function fetchRapportMarges(du: string, au: string, storeId?: string) {
  return apiFetch<RapportMarges>(
    `/api/v1/reports/margins?du=${du}&au=${au}${suffixeStore(storeId)}`
  )
}

export function fetchVentesPeriode(params: {
  storeId: string
  du: string
  au: string
  page: number
}) {
  return apiFetch<PageVentes>(
    `/api/v1/sales?storeId=${params.storeId}&du=${params.du}&au=${params.au}&page=${params.page}&limite=50`
  )
}

export function fetchVenteDetail(saleId: string) {
  return apiFetch<{ sale: VenteDetail; marge: MargeVente | null }>(
    `/api/v1/sales/${saleId}`
  )
}

// ---- Logique pure ----

// Presets de période (spec §6) : calculés CÔTÉ CLIENT en jours LOCAUX
// (motif jourLocal) et envoyés comme du/au — l'API ne connaît que la
// période (décision 4 du plan).
export function periodePreset(
  preset: "jour" | "semaine" | "mois",
  maintenant: Date = new Date()
): { du: string; au: string } {
  const au = jourLocal(maintenant)
  if (preset === "jour") {
    return { du: au, au }
  }
  if (preset === "semaine") {
    const debut = new Date(maintenant)
    debut.setDate(debut.getDate() - 6)
    return { du: jourLocal(debut), au }
  }
  return {
    du: jourLocal(new Date(maintenant.getFullYear(), maintenant.getMonth(), 1)),
    au,
  }
}

// Dashboard block visibility (spec §7) — front mirror, the API is authoritative.
// Valuation is open to org roles, to stock_manager AND to local manager/auditor:
// the block follows the Reports tab access exactly (porteeRapport "valorisation"),
// otherwise a local user would see valuation in Reports but not on the dashboard
// (matrix §4 takes precedence over the "owner/admin" of §7).
export type BlocsTableauDeBord = {
  ventes: boolean
  alertes: boolean
  transferts: boolean
  valorisation: boolean
  aucun: boolean
}

export function blocsTableauDeBord(me: MeLike): BlocsTableauDeBord {
  const role = me.membership?.role
  const org = role === "owner" || role === "admin" || role === "auditor"
  const locaux = me.assignments.some(
    (a) => a.role === "manager" || a.role === "auditor"
  )
  const blocs = {
    ventes: org || locaux,
    alertes: org || role === "stock_manager" || locaux,
    transferts: org || role === "stock_manager" || locaux,
    valorisation: org || role === "stock_manager" || locaux,
  }
  return {
    ...blocs,
    aucun:
      !blocs.ventes &&
      !blocs.alertes &&
      !blocs.transferts &&
      !blocs.valorisation,
  }
}

// Boutiques dont l'HISTORIQUE des ventes est lisible (décision 10 de la
// Phase 6) : rôles org owner/admin/auditor → toutes les boutiques ; sinon
// TOUTE affectation locale (manager, auditor, cashier) croisée avec les
// boutiques. L'API (verifierLectureVentes) fait autorité.
export function boutiquesLisibles(
  me: MeLike,
  destinations: Array<{ id: string; name: string; type: string }>
): Array<{ id: string; name: string }> {
  const boutiques = destinations.filter((d) => d.type === "store")
  const role = me.membership?.role
  if (role === "owner" || role === "admin" || role === "auditor") {
    return boutiques.map((b) => ({ id: b.id, name: b.name }))
  }
  const lisibles = new Set(me.assignments.map((a) => a.warehouseId))
  return boutiques
    .filter((b) => lisibles.has(b.id))
    .map((b) => ({ id: b.id, name: b.name }))
}

// Téléchargement d'un export CSV avec le cookie de session : fetch + blob
// (un simple <a href> cross-origine ne porterait pas credentials). Le nom
// de fichier est recomposé côté client — lire Content-Disposition exigerait
// Access-Control-Expose-Headers (décision 7 du plan).
export async function telechargerCsv(
  path: string,
  nomFichier: string
): Promise<void> {
  const res = await fetch(apiUrl(path), { credentials: "include" })
  if (!res.ok) {
    throw new Error(`Export impossible (erreur ${res.status})`)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const lien = document.createElement("a")
  lien.href = url
  lien.download = nomFichier
  document.body.appendChild(lien)
  lien.click()
  lien.remove()
  URL.revokeObjectURL(url)
}
