// Shared URL-state contract between the products list and the product
// sheet: the sheet carries the list's filters so its back link can
// restore them.
export type RechercheProduits = {
  q?: string
  categorie?: string
  page?: number
}

export function validerRechercheProduits(
  search: Record<string, unknown>
): RechercheProduits {
  const resultat: RechercheProduits = {}
  if (typeof search.q === "string" && search.q) resultat.q = search.q
  if (typeof search.categorie === "string" && search.categorie)
    resultat.categorie = search.categorie
  const page = Number(search.page)
  if (Number.isInteger(page) && page > 1) resultat.page = page
  return resultat
}
