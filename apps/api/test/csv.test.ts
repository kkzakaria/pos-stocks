import { describe, it, expect } from "vitest"
import { champCsv, genererCsv } from "../src/lib/csv"

describe("champCsv — neutralisation des formules (injection CSV)", () => {
  it("préfixe d'une apostrophe une chaîne commençant par =, +, -, @", () => {
    expect(champCsv("=1+1")).toBe("'=1+1")
    expect(champCsv("+cmd")).toBe("'+cmd")
    expect(champCsv("-2+3")).toBe("'-2+3")
    expect(champCsv("@SUM(A1)")).toBe("'@SUM(A1)")
  })

  it("neutralise aussi une tabulation ou un retour chariot en tête", () => {
    // Tabulation : préfixée mais non guillemetée (hors jeu RFC 4180 " ; \n \r).
    expect(champCsv("\t=1+1")).toBe("'\t=1+1")
    // Retour chariot : préfixé PUIS guillemeté (le \r déclenche le guillemetage).
    expect(champCsv("\r=1+1")).toBe('"' + "'\r=1+1" + '"')
  })

  it("laisse les nombres intacts — un montant négatif n'est pas une formule", () => {
    expect(champCsv(-500)).toBe("-500")
    expect(champCsv(0)).toBe("0")
    expect(champCsv(1200)).toBe("1200")
  })

  it("ne touche pas une chaîne sans caractère dangereux en tête", () => {
    expect(champCsv("Café =maison")).toBe("Café =maison")
    expect(champCsv("Riz 5kg")).toBe("Riz 5kg")
  })

  it("compose neutralisation ET guillemetage RFC 4180", () => {
    // La formule contient aussi un point-virgule → apostrophe PUIS guillemets.
    expect(champCsv("=A1;B2")).toBe('"' + "'=A1;B2" + '"')
    // Une formule avec guillemet interne : apostrophe puis doublement.
    expect(champCsv('=HYPERLINK("x")')).toBe('"' + '\'=HYPERLINK(""x"")' + '"')
  })

  it("le guillemet CSV ne suffit pas : la formule reste préfixée", () => {
    // Sans préfixe, un tableur évaluerait la cellule même entre guillemets CSV.
    const champ = champCsv("=2+2")
    expect(champ.startsWith("'")).toBe(true)
  })
})

describe("genererCsv — le guard s'applique aux cellules générées", () => {
  it("neutralise une valeur de cellule injectée via un nom de produit", () => {
    const csv = genererCsv(["Produit", "CA"], [["=cmd|'/c calc'!A1", 1000]])
    expect(csv).toContain("'=cmd")
    expect(csv).not.toMatch(/(^|;)=cmd/)
  })
})
