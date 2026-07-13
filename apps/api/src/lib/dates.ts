const MOTIF_JOUR = /^\d{4}-\d{2}-\d{2}$/

// Le format AAAA-MM-JJ ne suffit pas : "2024-02-30" passe le motif mais
// n'existe pas — Date normalise silencieusement en débordant sur le mois
// suivant, ce qui décale les bornes du/au sans jamais échouer. Round-trip
// year/month/day pour rejeter les dates calendaires impossibles.
// (Extrait de routes/stock.ts en Phase 6 — partagé avec routes/sales.ts.)
export function dateCalendaireValide(chaine: string): boolean {
  if (!MOTIF_JOUR.test(chaine)) return false
  const [annee, mois, jour] = chaine.split("-").map(Number) as [
    number,
    number,
    number,
  ]
  const date = new Date(Date.UTC(annee, mois - 1, jour))
  return (
    date.getUTCFullYear() === annee &&
    date.getUTCMonth() === mois - 1 &&
    date.getUTCDate() === jour
  )
}

// Bornes UTC d'une période de rapports [du, au] (spec §6) : début inclus à
// 00:00 UTC, fin EXCLUSIVE au lendemain de `au` — le motif exact des bornes
// de journée de routes/sales.ts (gte debut / lt finExclue). null = période
// invalide (date calendaire impossible ou du > au) → 400 côté route.
export function bornesPeriode(
  du: string,
  au: string
): { debut: Date; finExclue: Date } | null {
  if (!dateCalendaireValide(du) || !dateCalendaireValide(au) || du > au) {
    return null
  }
  const debut = new Date(`${du}T00:00:00.000Z`)
  const finExclue = new Date(
    new Date(`${au}T00:00:00.000Z`).getTime() + 86_400_000
  )
  return { debut, finExclue }
}
