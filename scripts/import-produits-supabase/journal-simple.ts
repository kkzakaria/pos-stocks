import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"

export function chargerJson<T>(chemin: string, defaut: T): T {
  if (!existsSync(chemin)) return defaut
  return JSON.parse(readFileSync(chemin, "utf-8")) as T
}

/** Atomic write (temp file + rename) so an interrupted run never corrupts the journal. */
export function ecrireJsonAtomique(chemin: string, valeur: unknown): void {
  const temp = `${chemin}.tmp`
  writeFileSync(temp, JSON.stringify(valeur, null, 2))
  renameSync(temp, chemin)
}
