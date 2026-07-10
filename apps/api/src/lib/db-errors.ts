// D1 n'expose pas de code d'erreur structuré : la détection par texte est le
// seul moyen fiable. De plus, Drizzle enveloppe l'erreur D1 dans une
// DrizzleQueryError dont le message top-level ("Failed query: ...") ne contient
// pas le texte de la contrainte : il faut remonter la chaîne `cause` pour le
// trouver.
export function estViolationUnicite(err: unknown): boolean {
  let current: unknown = err
  let profondeur = 0
  // Plafond défensif : une chaîne `cause` cyclique ou pathologiquement
  // profonde ne doit pas bloquer le worker.
  while (current instanceof Error && profondeur < 10) {
    if (current.message.includes("UNIQUE constraint failed")) {
      return true
    }
    current = current.cause
    profondeur += 1
  }
  return false
}
