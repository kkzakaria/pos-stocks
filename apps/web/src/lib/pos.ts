import type {
  CompanyRole,
  SaleCreateInput,
  SalePaymentInput,
  WarehouseRole,
} from "shared"

// Article vendable renvoyé par GET /api/v1/pos/catalogue (Task 8)
export type ArticlePos = {
  variantId: string
  productId: string
  productName: string
  variantName: string
  nom: string
  sku: string
  barcode: string | null
  categoryId: string | null
  trackLots: boolean
  imageKey: string | null
  price: number
  minPrice: number | null
  quantity: number
}

// Ligne de panier. Clé d'identité : (variantId, sourceWarehouseId) — le
// même article en dépannage depuis la réserve est une ligne DISTINCTE.
export type LignePanier = {
  variantId: string
  nom: string
  sku: string
  // Product thumbnail (R2 key) for the cart preview; set when the line is added.
  imageKey?: string | null
  quantite: number
  prixUnitaire: number
  prixCatalogue: number
  prixPlancher: number | null
  // null = la boutique (défaut) ; sinon dépannage
  sourceWarehouseId: string | null
  sourceNom: string | null
  // posée au retour d'un 409 STOCK_INSUFFISANT (spec §5, étape 5)
  enAlerte: boolean
}

function memeLigne(
  ligne: LignePanier,
  variantId: string,
  sourceWarehouseId: string | null
): boolean {
  return (
    ligne.variantId === variantId &&
    ligne.sourceWarehouseId === sourceWarehouseId
  )
}

export function totalPanier(lignes: LignePanier[]): number {
  return lignes.reduce(
    (somme, ligne) => somme + ligne.quantite * ligne.prixUnitaire,
    0
  )
}

export function monnaieARendre(totalDu: number, recu: number): number {
  return Math.max(0, recu - totalDu)
}

export function resteAPayer(
  total: number,
  paiements: SalePaymentInput[]
): number {
  return Math.max(
    0,
    total - paiements.reduce((somme, p) => somme + p.amount, 0)
  )
}

// Scan/tuile : la ligne « boutique » (source null) de la variante est
// incrémentée si elle existe, sinon créée au prix catalogue.
export function ajouterArticle(
  lignes: LignePanier[],
  article: ArticlePos
): LignePanier[] {
  const existante = lignes.find((l) => memeLigne(l, article.variantId, null))
  if (existante) {
    return lignes.map((l) =>
      memeLigne(l, article.variantId, null)
        ? { ...l, quantite: l.quantite + 1 }
        : l
    )
  }
  return [
    ...lignes,
    {
      variantId: article.variantId,
      nom: article.nom,
      sku: article.sku,
      imageKey: article.imageKey,
      quantite: 1,
      prixUnitaire: article.price,
      prixCatalogue: article.price,
      prixPlancher: article.minPrice,
      sourceWarehouseId: null,
      sourceNom: null,
      enAlerte: false,
    },
  ]
}

export function changerQuantite(
  lignes: LignePanier[],
  variantId: string,
  sourceWarehouseId: string | null,
  quantite: number
): LignePanier[] {
  if (!Number.isInteger(quantite) || quantite < 1) return lignes
  return lignes.map((l) =>
    memeLigne(l, variantId, sourceWarehouseId) ? { ...l, quantite } : l
  )
}

export type ResultatPrix =
  | { ok: true; lignes: LignePanier[] }
  | { ok: false; raison: "SOUS_PLANCHER" | "NON_NEGOCIABLE"; minimum: number }

// Négociation (spec §5, étape 3) : plancher défini → prix ≥ plancher (refus
// immédiat avec le minimum affichable) ; sans plancher → prix catalogue non
// modifiable. Miroir front de la règle serveur (décision 8) — l'API fait
// autorité.
export function changerPrix(
  lignes: LignePanier[],
  variantId: string,
  sourceWarehouseId: string | null,
  prix: number
): ResultatPrix {
  const ligne = lignes.find((l) => memeLigne(l, variantId, sourceWarehouseId))
  // A negative price is NOT swallowed here: it falls through to the floor (or
  // non-negotiable) guard below and yields an explicit rejection rather than a
  // silent no-op. Only a missing line and a non-integer (never produced by the
  // UI, which rounds) stay as neutral no-ops.
  if (!ligne || !Number.isInteger(prix)) {
    return { ok: true, lignes }
  }
  if (ligne.prixPlancher === null) {
    if (prix !== ligne.prixCatalogue) {
      return {
        ok: false,
        raison: "NON_NEGOCIABLE",
        minimum: ligne.prixCatalogue,
      }
    }
    return { ok: true, lignes }
  }
  if (prix < ligne.prixPlancher) {
    return { ok: false, raison: "SOUS_PLANCHER", minimum: ligne.prixPlancher }
  }
  return {
    ok: true,
    lignes: lignes.map((l) =>
      memeLigne(l, variantId, sourceWarehouseId)
        ? { ...l, prixUnitaire: prix }
        : l
    ),
  }
}

// Dépannage : pose l'entrepôt source sur la ligne (badge « réserve »). Si une
// ligne existe déjà à la clé cible (variantId, source), les deux lignes
// FUSIONNENT — quantités additionnées dans la ligne cible, qui conserve SON
// propre prix négocié ; la ligne déplacée disparaît. Évite deux lignes de
// même clé en panier (rejet Zod à l'encaissement, spec §5/§8).
export function definirSource(
  lignes: LignePanier[],
  variantId: string,
  ancienneSource: string | null,
  source: string | null,
  sourceNom: string | null
): LignePanier[] {
  const ligneDeplacee = lignes.find((l) =>
    memeLigne(l, variantId, ancienneSource)
  )
  if (!ligneDeplacee) return lignes
  const ligneCible = lignes.find((l) => memeLigne(l, variantId, source))
  if (ligneCible && ligneCible !== ligneDeplacee) {
    return lignes
      .filter((l) => l !== ligneDeplacee)
      .map((l) =>
        l === ligneCible
          ? {
              ...l,
              quantite: l.quantite + ligneDeplacee.quantite,
              enAlerte: false,
            }
          : l
      )
  }
  return lignes.map((l) =>
    memeLigne(l, variantId, ancienneSource)
      ? { ...l, sourceWarehouseId: source, sourceNom, enAlerte: false }
      : l
  )
}

export function supprimerLigne(
  lignes: LignePanier[],
  variantId: string,
  sourceWarehouseId: string | null
): LignePanier[] {
  return lignes.filter((l) => !memeLigne(l, variantId, sourceWarehouseId))
}

// Retour panier sur 409 STOCK_INSUFFISANT : les variantes fautives passent
// en alerte (et proposeront le dépannage), les autres redeviennent normales.
export function marquerLignesEnAlerte(
  lignes: LignePanier[],
  variantIds: string[]
): LignePanier[] {
  return lignes.map((l) => ({
    ...l,
    enAlerte: variantIds.includes(l.variantId),
  }))
}

export function preparerVente(
  storeId: string,
  clientRequestId: string,
  lignes: LignePanier[],
  paiements: SalePaymentInput[]
): SaleCreateInput {
  return {
    storeId,
    clientRequestId,
    items: lignes.map((l) => ({
      variantId: l.variantId,
      quantity: l.quantite,
      unitPrice: l.prixUnitaire,
      ...(l.sourceWarehouseId !== null
        ? { sourceWarehouseId: l.sourceWarehouseId }
        : {}),
    })),
    payments: paiements,
  }
}

// Sous-ensemble de Me (lib/me.ts) réellement consommé ici — DÉRIVÉ des
// mêmes types partagés (différé P6 : l'ancien type local à base de `string`
// pouvait dériver de Me sans erreur de compilation). Exporté : le tableau
// de bord et la section Ventes (Phase 7) réutilisent la même forme.
export type MeLike = {
  membership: { role: CompanyRole } | null
  assignments: Array<{
    warehouseId: string
    warehouseName: string
    role: WarehouseRole
  }>
}

// « Caissier pur » (décision 13) : staff dont TOUTES les affectations sont
// cashier (au moins une) — redirigé vers /pos à la connexion, il n'a rien à
// faire au back-office.
export function estCaissierPur(me: MeLike): boolean {
  if (me.membership?.role !== "staff") return false
  const roles = me.assignments.map((a) => a.role)
  return roles.includes("cashier") && roles.every((r) => r === "cashier")
}

// Boutiques où l'utilisateur peut vendre (matrice spec §4) : owner/admin →
// toutes les boutiques actives (destinations filtrées type store) ; sinon
// intersection affectations manager/cashier × boutiques.
export function boutiquesVendables(
  me: MeLike,
  destinations: Array<{ id: string; name: string; type: string }>
): Array<{ id: string; name: string }> {
  const boutiques = destinations.filter((d) => d.type === "store")
  const role = me.membership?.role
  if (role === "owner" || role === "admin") {
    return boutiques.map((b) => ({ id: b.id, name: b.name }))
  }
  const vendables = new Set(
    me.assignments
      .filter((a) => a.role === "manager" || a.role === "cashier")
      .map((a) => a.warehouseId)
  )
  return boutiques
    .filter((b) => vendables.has(b.id))
    .map((b) => ({ id: b.id, name: b.name }))
}

// Jour LOCAL (les « tickets du jour » suivent la journée de la boutique,
// pas UTC — GMT en Afrique de l'Ouest, l'écart est théorique mais gratuit).
export function jourLocal(date: Date = new Date()): string {
  const mois = String(date.getMonth() + 1).padStart(2, "0")
  const jour = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${mois}-${jour}`
}

// Buffer scan douchette GLOBAL (spec §7) : une douchette USB « tape » très
// vite et termine par Entrée. Accumule les caractères dont l'intervalle est
// ≤ delaiMs ; Entrée déclenche le scan si le tampon est assez long. La
// frappe humaine (lente) réinitialise le tampon à chaque pause — la
// recherche au clavier reste utilisable sans déclencher de scan.
export function creerBufferScan(
  onScan: (code: string) => void,
  options: { delaiMs?: number; longueurMin?: number } = {}
): (e: KeyboardEvent) => void {
  const delaiMs = options.delaiMs ?? 80
  const longueurMin = options.longueurMin ?? 3
  let tampon = ""
  let dernierAppui = 0
  return (e: KeyboardEvent) => {
    const maintenant = Date.now()
    if (e.key === "Enter") {
      if (
        tampon.length >= longueurMin &&
        maintenant - dernierAppui <= delaiMs
      ) {
        e.preventDefault()
        onScan(tampon)
      }
      tampon = ""
      return
    }
    if (e.key.length !== 1) return
    if (maintenant - dernierAppui > delaiMs) {
      tampon = ""
    }
    tampon += e.key
    dernierAppui = maintenant
  }
}
