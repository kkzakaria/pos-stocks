import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { Panier } from "./panier"
import type { LignePanier } from "@/lib/pos"

const ligne = (surcharge: Partial<LignePanier> = {}): LignePanier => ({
  variantId: "v1",
  nom: "Coca 50cl",
  sku: "PRD-0001-STD",
  quantite: 2,
  prixUnitaire: 500,
  prixCatalogue: 500,
  prixPlancher: null,
  sourceWarehouseId: null,
  sourceNom: null,
  enAlerte: false,
  ...surcharge,
})

describe("Panier", () => {
  it("affiche les lignes, les sous-totaux et le total", () => {
    render(
      <Panier
        lignes={[
          ligne(),
          ligne({
            variantId: "v2",
            nom: "Fanta",
            quantite: 1,
            prixUnitaire: 400,
          }),
        ]}
        onChoisirLigne={vi.fn()}
        onEncaisser={vi.fn()}
      />
    )
    expect(screen.getByText("Coca 50cl")).toBeTruthy()
    expect(screen.getByText("Fanta")).toBeTruthy()
    // total = 2×500 + 400 — formaterMontant insère des espaces insécables
    expect(screen.getByText(/1 400|1 400/)).toBeTruthy()
  })

  it("ENCAISSER est désactivé sur panier vide, actif sinon, et remonte le clic", () => {
    const onEncaisser = vi.fn()
    const { rerender } = render(
      <Panier lignes={[]} onChoisirLigne={vi.fn()} onEncaisser={onEncaisser} />
    )
    const bouton = screen.getByRole<HTMLButtonElement>("button", {
      name: /encaisser/i,
    })
    expect(bouton.disabled).toBe(true)
    rerender(
      <Panier
        lignes={[ligne()]}
        onChoisirLigne={vi.fn()}
        onEncaisser={onEncaisser}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: /encaisser/i }))
    expect(onEncaisser).toHaveBeenCalledTimes(1)
  })

  it("une ligne en alerte est signalée et un badge réserve apparaît en dépannage", () => {
    render(
      <Panier
        lignes={[
          ligne({ enAlerte: true }),
          ligne({
            variantId: "v2",
            nom: "Fanta",
            sourceWarehouseId: "r1",
            sourceNom: "Réserve",
          }),
        ]}
        onChoisirLigne={vi.fn()}
        onEncaisser={vi.fn()}
      />
    )
    expect(screen.getByText("Stock insuffisant")).toBeTruthy()
    expect(screen.getByText("Réserve")).toBeTruthy()
  })

  it("toucher une ligne la remonte pour ouvrir le panneau", () => {
    const onChoisirLigne = vi.fn()
    render(
      <Panier
        lignes={[ligne()]}
        onChoisirLigne={onChoisirLigne}
        onEncaisser={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText("Coca 50cl"))
    expect(onChoisirLigne).toHaveBeenCalledWith(
      expect.objectContaining({
        variantId: "v1",
      })
    )
  })
})
