// D1 n'expose pas de code d'erreur structuré : la détection par texte est le
// seul moyen fiable. De plus, Drizzle enveloppe l'erreur D1 dans une
// DrizzleQueryError dont le message top-level ("Failed query: ...") ne
// contient pas le texte SQLite : il faut remonter la chaîne `cause`.
function messageDansCauses(err: unknown, fragment: string): boolean {
  let current: unknown = err
  let profondeur = 0
  // Plafond défensif : une chaîne `cause` cyclique ou pathologiquement
  // profonde ne doit pas bloquer le worker.
  while (current instanceof Error && profondeur < 10) {
    if (current.message.includes(fragment)) {
      return true
    }
    current = current.cause
    profondeur += 1
  }
  return false
}

// `fragment` optionnel : nom d'index ou de colonne, pour discriminer QUELLE
// contrainte unique a sauté (ex. estViolationUnicite(err, "barcode") vs SKU).
export function estViolationUnicite(err: unknown, fragment?: string): boolean {
  if (!messageDansCauses(err, "UNIQUE constraint failed")) {
    return false
  }
  return fragment ? messageDansCauses(err, fragment) : true
}

// Contrainte CHECK violée (ex. stock_levels_quantity_positive : la garde
// anti-stock-négatif du service de stock). `fragment` optionnel : nom de la
// contrainte, pour discriminer QUEL CHECK a sauté — indispensable quand
// plusieurs statements de tables différentes cohabitent dans le même batch
// (ex. instructionsAvant de stockService.applyMovements) : un CHECK sans
// rapport avec stock_levels ne doit pas être classé en stock insuffisant.
export function estViolationCheck(err: unknown, fragment?: string): boolean {
  if (!messageDansCauses(err, "CHECK constraint failed")) {
    return false
  }
  return fragment ? messageDansCauses(err, fragment) : true
}

// RAISE(ABORT, code) émis par un trigger custom (0005_stock_guards,
// 0007_transfer_inventory_guards). Forme d'erreur D1 vérifiée
// empiriquement : « D1_ERROR: <code>: SQLITE_CONSTRAINT » (la cause
// imbriquée porte « <code>: SQLITE_CONSTRAINT »). Ancrer sur le format
// complet « <code>: SQLITE_CONSTRAINT » — et non sur le code seul —
// évite qu'un code court (ex. « VALIDATION ») matche par accident un
// fragment d'un message d'erreur sans rapport.
export function estErreurDeclencheur(err: unknown, code: string): boolean {
  return messageDansCauses(err, `${code}: SQLITE_CONSTRAINT`)
}
