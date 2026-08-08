import { fireEvent, render, screen, within } from "@testing-library/react"
import { FiltresRepliables } from "./filtres-repliables"
import { installerMatchMedia } from "@/test/media-query"

function contenu() {
  return (
    <>
      <label htmlFor="x">Entrepôt</label>
      <input id="x" />
    </>
  )
}

function afficher(nbActifs: number, largeur: number) {
  const nettoyer = installerMatchMedia(largeur)
  render(<FiltresRepliables nbActifs={nbActifs}>{contenu()}</FiltresRepliables>)
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
    const resume = document.querySelector("summary")
    expect(resume).not.toBeNull()
    if (!resume) return
    expect(within(resume).getByText("2")).toBeTruthy()
    expect(resume.textContent).toContain("Filtres")
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

  it("le repli manuel survit à un re-rendu sans rapport", () => {
    const nettoyer = installerMatchMedia(375)
    const { rerender } = render(
      <FiltresRepliables nbActifs={1}>{contenu()}</FiltresRepliables>
    )
    const details = document.querySelector("details")
    expect(details).not.toBeNull()
    if (!details) return
    expect(details.open).toBe(true)

    fireEvent.click(screen.getByText(/Filtres/))
    expect(details.open).toBe(false)

    // nbActifs is unchanged: the re-render must not force the panel back open.
    rerender(<FiltresRepliables nbActifs={1}>{contenu()}</FiltresRepliables>)
    expect(details.open).toBe(false)
    nettoyer()
  })

  it("un filtre nouvellement actif rouvre le panneau", () => {
    const nettoyer = installerMatchMedia(375)
    const { rerender } = render(
      <FiltresRepliables nbActifs={0}>{contenu()}</FiltresRepliables>
    )
    const details = document.querySelector("details")
    expect(details).not.toBeNull()
    if (!details) return
    expect(details.open).toBe(false)

    rerender(<FiltresRepliables nbActifs={1}>{contenu()}</FiltresRepliables>)
    expect(details.open).toBe(true)
    nettoyer()
  })
})
