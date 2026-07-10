// Mot de passe provisoire lisible et dictable : 3 blocs de 4 caractères
// non ambigus (pas de O/0, I/1, L). Entropie ~57 bits.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

export function generateProvisionalPassword(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length])
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8).join("")}`
}
