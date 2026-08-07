import { render, screen } from "@testing-library/react"
import type { LignePanier } from "@/lib/pos"
import { BarreSynthese } from "./barre-synthese"

/** fr-FR inserts U+202F narrow no-break spaces in amounts. */
function texteMontant(valeur: number): RegExp {
  return new RegExp(String(valeur).replace(/\B(?=(\d{3})+(?!\d))/g, "\\s?"))
}

function ligne(overrides: Partial<LignePanier> = {}): LignePanier {
  return {
    variantId: "v1",
    nom: "Savon",
    sku: "SAV-1",
    quantite: 2,
    prixUnitaire: 1500,
    prixCatalogue: 1500,
    prixPlancher: null,
    sourceWarehouseId: null,
    sourceNom: null,
    enAlerte: false,
    ...overrides,
  }
}

describe("BarreSynthese", () => {
  it("affiche le nombre d'articles et le total du panier", () => {
    render(
      <BarreSynthese
        lignes={[ligne(), ligne({ variantId: "v2" })]}
        verrouille={false}
        onOuvrirPanier={() => undefined}
        onEncaisser={() => undefined}
      />
    )
    expect(screen.getByText("2 articles")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Voir le panier" }).textContent
    ).toMatch(texteMontant(6000))
  })

  it("désactive Encaisser quand le panier est vide", () => {
    render(
      <BarreSynthese
        lignes={[]}
        verrouille={false}
        onOuvrirPanier={() => undefined}
        onEncaisser={() => undefined}
      />
    )
    const bouton = screen.getByRole("button", { name: "Encaisser" })
    expect(bouton.hasAttribute("disabled")).toBe(true)
  })

  it("désactive Encaisser quand le panier est verrouillé", () => {
    render(
      <BarreSynthese
        lignes={[ligne()]}
        verrouille={true}
        onOuvrirPanier={() => undefined}
        onEncaisser={() => undefined}
      />
    )
    const bouton = screen.getByRole("button", { name: "Encaisser" })
    expect(bouton.hasAttribute("disabled")).toBe(true)
  })

  it("appelle onOuvrirPanier au clic sur la zone de synthèse", () => {
    let appele = false
    render(
      <BarreSynthese
        lignes={[ligne()]}
        verrouille={false}
        onOuvrirPanier={() => {
          appele = true
        }}
        onEncaisser={() => undefined}
      />
    )
    screen.getByRole("button", { name: "Voir le panier" }).click()
    expect(appele).toBe(true)
  })

  it("porte print:hidden sur le conteneur", () => {
    const { container } = render(
      <BarreSynthese
        lignes={[ligne()]}
        verrouille={false}
        onOuvrirPanier={() => undefined}
        onEncaisser={() => undefined}
      />
    )
    expect(container.firstElementChild?.className).toContain("print:hidden")
  })
})
