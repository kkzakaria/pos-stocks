import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"

export type StatutEntree = "produit_cree" | "image_ok" | "echec"

export interface EntreeProgression {
  statut: StatutEntree
  productId?: string
  sku: string
  erreur?: string
}

export type JournalProgression = Record<string, EntreeProgression>

export function chargerProgression(chemin: string): JournalProgression {
  if (!existsSync(chemin)) return {}
  return JSON.parse(readFileSync(chemin, "utf-8")) as JournalProgression
}

export function enregistrerEntree(
  chemin: string,
  journal: JournalProgression,
  sourceId: string,
  entree: EntreeProgression
): JournalProgression {
  const suivant = { ...journal, [sourceId]: entree }
  // Écriture atomique (fichier temporaire + rename) : une interruption du
  // script en plein milieu de l'écriture ne doit jamais corrompre le
  // journal sur lequel repose la reprise.
  const cheminTemp = `${chemin}.tmp`
  writeFileSync(cheminTemp, JSON.stringify(suivant, null, 2))
  renameSync(cheminTemp, chemin)
  return suivant
}

export function dejaImporte(
  journal: JournalProgression,
  sourceId: string
): boolean {
  const entree = journal[sourceId] as EntreeProgression | undefined
  return entree?.statut === "produit_cree" || entree?.statut === "image_ok"
}
