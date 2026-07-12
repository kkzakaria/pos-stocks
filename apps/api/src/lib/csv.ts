// Export CSV des rapports (spec §6) : UTF-8 avec BOM (Excel fr détecte
// l'encodage), séparateur POINT-VIRGULE (convention des locales à virgule
// décimale), fins de ligne CRLF, échappement RFC 4180. Module PUR — les
// routes composent la Response (Content-Type/Content-Disposition).
const BOM = "\uFEFF"

export function champCsv(valeur: string | number | null): string {
  if (valeur === null) return ""
  const texte = String(valeur)
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
