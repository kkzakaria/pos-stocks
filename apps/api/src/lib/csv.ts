// Export CSV des rapports (spec §6) : UTF-8 avec BOM (Excel fr détecte
// l'encodage), séparateur POINT-VIRGULE (convention des locales à virgule
// décimale), fins de ligne CRLF, échappement RFC 4180. Module PUR — les
// routes composent la Response (Content-Type/Content-Disposition).
const BOM = "\uFEFF"

// CSV/formula-injection guard (OWASP): a spreadsheet treats a cell as a formula
// when it starts with = + - @, a tab or a carriage return. RFC 4180 quoting does
// NOT neutralize this \u2014 the quotes are stripped on parse, so the formula still
// runs. We prefix such cells with an apostrophe so they render as literal text.
const DEBUT_FORMULE = /^[=+\-@\t\r]/

export function champCsv(valeur: string | number | null): string {
  if (valeur === null) return ""
  let texte = String(valeur)
  // Only strings can carry an injected formula; a number (e.g. a negative
  // amount) is a genuine value and prefixing it would corrupt the cell.
  if (typeof valeur === "string" && DEBUT_FORMULE.test(texte)) {
    texte = `'${texte}`
  }
  if (/[";\n\r]/.test(texte)) {
    return `"${texte.replaceAll('"', '""')}"`
  }
  return texte
}

export function genererCsv(
  entetes: string[],
  lignes: Array<Array<string | number | null>>
): string {
  const rangs = [
    entetes.map(champCsv),
    ...lignes.map((ligne) => ligne.map(champCsv)),
  ]
  return BOM + rangs.map((rang) => rang.join(";")).join("\r\n") + "\r\n"
}
