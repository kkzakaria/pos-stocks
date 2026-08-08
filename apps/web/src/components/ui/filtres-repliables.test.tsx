import { render, screen } from "@testing-library/react"
import { FiltresRepliables } from "./filtres-repliables"
import { installerMatchMedia } from "@/test/media-query"

function afficher(nbActifs: number, largeur: number) {
  const nettoyer = installerMatchMedia(largeur)
  render(
    <FiltresRepliables nbActifs={nbActifs}>
      <label htmlFor="x">Entrepôt</label>
      <input id="x" />
    </FiltresRepliables>
  )
  return nettoyer
}

describe("FiltresRepliables", () => {
  it("laisse les filtres visibles et sans résumé à partir de md", () => {
    const nettoyer = afficher(0, 1280)
    expect(screen.getByLabelText("Entrepôt")).toBeTruthy()
    expect(screen.queryByText(/Filtres/)).toBeNull()
    nettoyer()
  })

  it("replie les filtres sous md derrière un résumé", () => {
    const nettoyer = afficher(0, 375)
    const resume = screen.getByText(/Filtres/)
    expect(resume).toBeTruthy()
    // The content stays in the DOM (thus reachable), simply collapsed.
    expect(screen.getByLabelText("Entrepôt")).toBeTruthy()
    nettoyer()
  })

  it("annonce le nombre de filtres actifs sous md", () => {
    const nettoyer = afficher(2, 375)
    expect(screen.getByText(/Filtres \(2\)/)).toBeTruthy()
    nettoyer()
  })

  it("s'ouvre d'emblée quand au moins un filtre est actif", () => {
    const nettoyer = afficher(1, 375)
    const details = document.querySelector("details")
    expect(details).not.toBeNull()
    expect(details?.open).toBe(true)
    nettoyer()
  })

  it("reste replié quand aucun filtre n'est actif", () => {
    const nettoyer = afficher(0, 375)
    expect(document.querySelector("details")?.open).toBe(false)
    nettoyer()
  })
})
