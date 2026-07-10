// Montants entiers (XOF) : jamais de décimales à l'affichage.
export function formaterMontant(montant: number, devise = "XOF"): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: devise,
    maximumFractionDigits: 0,
  }).format(montant)
}
