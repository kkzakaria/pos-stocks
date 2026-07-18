// SQLite/D1 limite le nombre de variables liées par requête préparée
// (observé : crash « too many SQL variables » sur GET /products à 720
// lignes, cf. docs/superpowers/specs/2026-07-18-inarray-lots-design.md).
// Un inArray() alimenté par une liste non bornée (résultat d'une liste
// non paginée, par exemple) peut dépasser cette limite une fois le volume
// de données réel atteint. Ce helper découpe l'appel en lots sûrs et
// concatène les résultats.
const TAILLE_LOT_MAX = 100

export async function requeterParLots<T>(
  ids: string[],
  requete: (lot: string[]) => Promise<T[]>
): Promise<T[]> {
  if (ids.length === 0) return []
  const resultats: T[] = []
  for (let i = 0; i < ids.length; i += TAILLE_LOT_MAX) {
    const lot = ids.slice(i, i + TAILLE_LOT_MAX)
    resultats.push(...(await requete(lot)))
  }
  return resultats
}
