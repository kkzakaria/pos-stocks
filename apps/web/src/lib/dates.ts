// Une date de péremption (AAAA-MM-JJ stocké à minuit UTC) est expirée
// STRICTEMENT avant le jour local courant : on compare des jours
// calendaires, pas des instants — le fuseau de l'utilisateur ne doit pas
// faire basculer le badge autour de minuit (l'ancien code comparait
// new Date(expiryDate) UTC à l'instant local).
export function estDateExpiree(expiryDate: string | null): boolean {
  if (!expiryDate) return false
  const jourPeremption = expiryDate.slice(0, 10)
  // fr-CA donne le format AAAA-MM-JJ, comparable lexicalement
  const aujourdHui = new Date().toLocaleDateString("fr-CA")
  return jourPeremption < aujourdHui
}

// Formate une date AAAA-MM-JJ (ou un ISO complet "AAAA-MM-JJT...Z") en
// JJ/MM/AAAA SANS passer par `Date` : `new Date(date).toLocaleDateString()`
// interprète le "Z" en UTC puis affiche dans le fuseau LOCAL, ce qui peut
// reculer d'un jour (ex. en soirée dans un fuseau UTC-x). Un découpage
// direct de la chaîne évite tout décalage de fuseau.
export function formatDateJour(date: string): string {
  const [annee = "", mois = "", jour = ""] = date.slice(0, 10).split("-")
  return `${jour}/${mois}/${annee}`
}
