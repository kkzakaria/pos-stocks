import { describe, it, expect } from "vitest"
import {
  ACCEPT_IMAGE,
  AIDE_IMAGE,
  ERREUR_PREPARATION_IMAGE,
  ERREUR_TAILLE_IMAGE,
  LIBELLE_TAILLE_IMAGE_MAX,
  TAILLE_IMAGE_MAX,
  TYPES_IMAGE_ACCEPTES,
  preparerImage,
} from "./image"

const octets = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

/**
 * Reads the bytes back through FileReader: jsdom's Blob implements neither
 * `arrayBuffer()` nor `text()`.
 */
const lireOctets = (fichier: File) =>
  new Promise<Uint8Array>((resoudre, rejeter) => {
    const lecteur = new FileReader()
    lecteur.onerror = () => rejeter(lecteur.error ?? new Error("lecture"))
    lecteur.onload = () =>
      lecteur.result instanceof ArrayBuffer
        ? resoudre(new Uint8Array(lecteur.result))
        : rejeter(new Error("résultat inattendu"))
    lecteur.readAsArrayBuffer(fichier)
  })

describe("preparerImage", () => {
  it("préserve le contenu, le type MIME et le nom du fichier", async () => {
    const source = new File([octets], "photo.png", { type: "image/png" })

    const prepare = await preparerImage(source)

    // Assert the bytes actually read back, never `prepare === source`: an
    // identity assertion would stay green the day compression lands and would
    // therefore guard nothing.
    expect(Array.from(await lireOctets(prepare))).toEqual(Array.from(octets))
    expect(prepare.type).toBe("image/png")
    expect(prepare.name).toBe("photo.png")
  })

  it("préserve un fichier vide sans le corrompre", async () => {
    const prepare = await preparerImage(
      new File([], "vide.webp", { type: "image/webp" })
    )

    expect(prepare.size).toBe(0)
    expect(prepare.type).toBe("image/webp")
    expect(prepare.name).toBe("vide.webp")
  })
})

describe("constantes partagées", () => {
  it("plafonne à 2 Mo et n'accepte que JPEG, PNG et WebP", () => {
    expect(TAILLE_IMAGE_MAX).toBe(2 * 1024 * 1024)
    expect([...TYPES_IMAGE_ACCEPTES]).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
    ])
    // The `accept` attribute is derived, so it can never drift from the list
    // actually used for validation.
    expect(ACCEPT_IMAGE).toBe("image/jpeg,image/png,image/webp")
  })

  it("dérive tout rendu humain du plafond de la constante", () => {
    // Computed from TAILLE_IMAGE_MAX, never restated: raising the cap must not
    // leave three texts announcing a threshold the code no longer enforces.
    expect(LIBELLE_TAILLE_IMAGE_MAX).toBe(
      `${TAILLE_IMAGE_MAX / 1024 / 1024} Mo`
    )
    expect(ERREUR_TAILLE_IMAGE).toContain(LIBELLE_TAILLE_IMAGE_MAX)
    expect(AIDE_IMAGE).toContain(LIBELLE_TAILLE_IMAGE_MAX)
    expect(AIDE_IMAGE).toBe("JPEG, PNG, WebP — 2 Mo max")
  })

  it("formule l'échec de préparation en français, sans texte navigateur", () => {
    // The catch branch must never surface `err.message` ("The source image
    // could not be decoded") in an all-French interface.
    expect(ERREUR_PREPARATION_IMAGE).toContain("Impossible de préparer")
    expect(ERREUR_PREPARATION_IMAGE).not.toMatch(/[Ii]mage could not/)
  })
})
