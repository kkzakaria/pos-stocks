// D1 n'expose pas de code d'erreur structuré : la détection par texte est le
// seul moyen fiable. De plus, Drizzle enveloppe l'erreur D1 dans une
// DrizzleQueryError dont le message top-level ("Failed query: ...") ne contient
// pas le texte de la contrainte : il faut remonter la chaîne `cause` pour le
// trouver.
export function estViolationUnicite(err: unknown): boolean {
  let current: unknown = err
  while (current instanceof Error) {
    if (current.message.includes("UNIQUE constraint failed")) {
      return true
    }
    current = current.cause
  }
  return false
}
