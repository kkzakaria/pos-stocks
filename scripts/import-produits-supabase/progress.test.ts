import { describe, test, expect } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  chargerProgression,
  enregistrerEntree,
  dejaImporte
  
} from "./progress"
import type {JournalProgression} from "./progress";

function cheminTemporaire(): string {
  const dossier = mkdtempSync(path.join(tmpdir(), "progress-test-"))
  return path.join(dossier, "progress.json")
}

describe("progress", () => {
  test("retourne un journal vide si le fichier n'existe pas", () => {
    expect(chargerProgression(cheminTemporaire())).toEqual({})
  })

  test("enregistre puis relit une entrée", () => {
    const chemin = cheminTemporaire()
    let journal = chargerProgression(chemin)
    journal = enregistrerEntree(chemin, journal, "src-1", {
      statut: "produit_cree",
      productId: "p1",
      sku: "SKU-1",
    })
    const relu = chargerProgression(chemin)
    expect(relu["src-1"]).toEqual({
      statut: "produit_cree",
      productId: "p1",
      sku: "SKU-1",
    })
  })

  test("dejaImporte reconnaît produit_cree et image_ok, pas echec", () => {
    const journal: JournalProgression = {
      a: { statut: "produit_cree", sku: "A" },
      b: { statut: "image_ok", sku: "B" },
      c: { statut: "echec", sku: "C", erreur: "boom" },
    }
    expect(dejaImporte(journal, "a")).toBe(true)
    expect(dejaImporte(journal, "b")).toBe(true)
    expect(dejaImporte(journal, "c")).toBe(false)
    expect(dejaImporte(journal, "inconnu")).toBe(false)
  })
})
