import type { ArticlePos, LignePanier } from "./pos"

export interface PanierPersiste {
  v: 1
  lignes: LignePanier[]
  requestId: string
  verrouille: boolean
  majA: string
}

/** Storage key scoped to a till session: closing the register drops the cart. */
export function clePanier(boutiqueId: string, sessionId: string): string {
  return `pos:panier:${boutiqueId}:${sessionId}`
}

/**
 * Reads the stored cart. Returns null — purging the entry — when the payload
 * is unreadable or carries a foreign version, so a format change can never
 * crash the till screen.
 */
export function charger(cle: string): PanierPersiste | null {
  let brut: string | null
  try {
    brut = localStorage.getItem(cle)
  } catch {
    return null
  }
  if (brut === null) return null
  let donnees: unknown
  try {
    donnees = JSON.parse(brut)
  } catch {
    purger(cle)
    return null
  }
  if (
    typeof donnees !== "object" ||
    donnees === null ||
    (donnees as { v?: unknown }).v !== 1 ||
    !Array.isArray((donnees as { lignes?: unknown }).lignes) ||
    typeof (donnees as { requestId?: unknown }).requestId !== "string" ||
    typeof (donnees as { verrouille?: unknown }).verrouille !== "boolean"
  ) {
    purger(cle)
    return null
  }
  return donnees as PanierPersiste
}

export function enregistrer(cle: string, etat: PanierPersiste): void {
  try {
    localStorage.setItem(cle, JSON.stringify(etat))
  } catch {
    // Storage unavailable (private mode) or quota exceeded: degrade silently
    // to the in-memory behaviour rather than crashing the till screen.
  }
}

export function purger(cle: string): void {
  try {
    localStorage.removeItem(cle)
  } catch {
    // Same rationale as enregistrer: never crash on storage failure.
  }
}

export interface ResultatRevalidation {
  lignes: LignePanier[]
  retirees: number
  prixModifies: number
}

/**
 * Reconciles a restored cart against the freshly loaded catalogue: drops lines
 * whose variant disappeared, and flags lines whose catalogue price moved. It
 * never touches `prixUnitaire`, which may hold a negotiated price.
 */
export function revaliderPanier(
  lignes: LignePanier[],
  articles: ArticlePos[]
): ResultatRevalidation {
  const parVariante = new Map(articles.map((a) => [a.variantId, a]))
  const gardees: LignePanier[] = []
  let retirees = 0
  let prixModifies = 0
  for (const ligne of lignes) {
    const article = parVariante.get(ligne.variantId)
    if (article === undefined) {
      retirees += 1
      continue
    }
    if (article.price !== ligne.prixCatalogue) {
      gardees.push({
        ...ligne,
        prixCatalogue: article.price,
        prixModifie: true,
      })
      prixModifies += 1
      continue
    }
    gardees.push(ligne)
  }
  return { lignes: gardees, retirees, prixModifies }
}
