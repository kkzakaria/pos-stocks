// D1 caps a query at 100 bound parameters ("too many SQL variables", observed
// crashing GET /products at 720 rows — see
// docs/superpowers/specs/2026-07-18-inarray-lots-design.md). An inArray() fed by
// an unbounded list can exceed that cap once real data volume is reached. This
// helper splits the call into safe batches and concatenates the results.
//
// The batch is capped BELOW 100 so the surrounding query keeps room for its own
// bound parameters: e.g. GET /products binds an extra organizationId alongside
// the inArray, so a full 100-id batch would total 101 and still crash. 90 leaves
// 10 parameters of headroom for every current call site.
const TAILLE_LOT_MAX = 90

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
