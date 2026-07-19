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
    supprimerBrut(cle)
    return null
  }
  if (
    typeof donnees !== "object" ||
    donnees === null ||
    (donnees as { v?: unknown }).v !== 1 ||
    !Array.isArray((donnees as { lignes?: unknown }).lignes) ||
    typeof (donnees as { requestId?: unknown }).requestId !== "string" ||
    typeof (donnees as { verrouille?: unknown }).verrouille !== "boolean" ||
    typeof (donnees as { majA?: unknown }).majA !== "string" ||
    !(donnees as { lignes: unknown[] }).lignes.every(ligneValide)
  ) {
    supprimerBrut(cle)
    return null
  }
  return donnees as PanierPersiste
}

/**
 * Unconditional delete, used for corrupted payloads: they carry no meaningful
 * lock state, so they need neither the guard nor the cross-tab lock.
 */
function supprimerBrut(cle: string): void {
  try {
    localStorage.removeItem(cle)
  } catch {
    // Never crash the till screen on a storage failure.
  }
}

/**
 * Runs a read-modify-write on the stored cart under a cross-tab lock, so two
 * tabs cannot interleave between the guard's read and its write.
 *
 * Without the Web Locks API, persistence is DISABLED rather than run
 * non-atomically: the guard that stops one tab from clobbering another tab's
 * ambiguous (locked) cart could not hold, and its failure mode is a duplicate
 * sale — the customer charged twice. Losing the convenience of a restored cart
 * is the lesser harm.
 */
async function sousVerrou(cle: string, operation: () => void): Promise<void> {
  const verrous = globalThis.navigator.locks as LockManager | undefined
  if (verrous === undefined) return
  try {
    await verrous.request(`pos:panier-lock:${cle}`, () => {
      operation()
    })
  } catch {
    // `request()` itself can reject (SecurityError on an opaque origin,
    // InvalidStateError, AbortError…). These calls are fire-and-forget from the
    // sale screen, so an unhandled rejection must never surface: skip the write,
    // exactly as when the API is missing. Persistence is a convenience and is
    // never a reason to disturb the till.
  }
}

/**
 * Cheap per-element shape check for a restored cart line: a corrupted entry
 * (wrong type, missing field) would otherwise reach `totalPanier` and yield
 * NaN totals at the till instead of being caught here and purged.
 */
function ligneValide(ligne: unknown): boolean {
  if (typeof ligne !== "object" || ligne === null) return false
  const l = ligne as Record<string, unknown>
  const nombre = (v: unknown): boolean =>
    typeof v === "number" && Number.isFinite(v)
  const nombreOuNul = (v: unknown): boolean => v === null || nombre(v)
  const texteOuNul = (v: unknown): boolean =>
    v === null || typeof v === "string"
  // `imageKey` is optional on LignePanier, so it is deliberately not required.
  return (
    typeof l.variantId === "string" &&
    typeof l.nom === "string" &&
    typeof l.sku === "string" &&
    nombre(l.quantite) &&
    nombre(l.prixUnitaire) &&
    nombre(l.prixCatalogue) &&
    nombreOuNul(l.prixPlancher) &&
    texteOuNul(l.sourceWarehouseId) &&
    texteOuNul(l.sourceNom) &&
    typeof l.enAlerte === "boolean"
  )
}

export async function enregistrer(
  cle: string,
  etat: PanierPersiste
): Promise<void> {
  await sousVerrou(cle, () => {
    try {
      // Never clobber another tab's AMBIGUOUS (locked) cart: its requestId is
      // the only thing standing between a retry and a duplicate sale.
      const existant = charger(cle)
      if (
        existant !== null &&
        existant.verrouille &&
        existant.requestId !== etat.requestId
      ) {
        return
      }
      localStorage.setItem(cle, JSON.stringify(etat))
    } catch {
      // Storage unavailable (private mode) or quota exceeded: degrade silently
      // to the in-memory behaviour rather than crashing the till screen.
    }
  })
}

/**
 * Removes the stored cart. Pass `requestIdAttendu` from a live cart so the
 * deletion honours another tab's AMBIGUOUS (locked) entry — symmetrically to
 * `enregistrer`, an empty cart in one tab must not wipe the locked entry that
 * another tab depends on to avoid a duplicate sale. Called without it (the
 * corrupted-payload path in `charger`) the deletion is unconditional.
 */
export async function purger(
  cle: string,
  requestIdAttendu?: string
): Promise<void> {
  await sousVerrou(cle, () => {
    try {
      if (requestIdAttendu !== undefined) {
        const existant = charger(cle)
        if (
          existant !== null &&
          existant.verrouille &&
          existant.requestId !== requestIdAttendu
        ) {
          return
        }
      }
      localStorage.removeItem(cle)
    } catch {
      // Same rationale as enregistrer: never crash on storage failure.
    }
  })
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
