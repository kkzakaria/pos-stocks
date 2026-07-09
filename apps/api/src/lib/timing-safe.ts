// Comparaison constant-time d'un jeton fourni avec le secret attendu.
// Échoue (false) si le secret est absent/vide — jamais de fail-open.
export function safeTokenEqual(
  provided: string | undefined,
  expected: string | undefined
): boolean {
  if (!expected || !provided) return false
  const enc = new TextEncoder()
  const a = enc.encode(provided)
  const b = enc.encode(expected)
  if (a.byteLength !== b.byteLength) {
    // comparaison factice pour garder un temps constant, puis échec
    crypto.subtle.timingSafeEqual(a, a)
    return false
  }
  return crypto.subtle.timingSafeEqual(a, b)
}
