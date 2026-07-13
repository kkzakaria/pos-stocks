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

const props = (over: Partial<Parameters<typeof Panier>[0]> = {}) => ({
  lignes: [ligne()],
  onQuantite: vi.fn(),
  onPrix: vi.fn(),
  onSupprimer: vi.fn(),
  onDepanner: vi.fn(),
  onEncaisser: vi.fn(),
  ...over,
})

describe("Panier", () => {
  it("affiche les lignes et le total", () => {
    render(
      <Panier
        {...props({
          lignes: [
            ligne(),
            ligne({
              variantId: "v2",
              nom: "Fanta",
              quantite: 1,
              prixUnitaire: 400,
            }),
          ],
        })}
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
      <Panier {...props({ lignes: [], onEncaisser })} />
    )
    const bouton = screen.getByRole<HTMLButtonElement>("button", {
      name: /encaisser/i,
    })
    expect(bouton.disabled).toBe(true)
    rerender(<Panier {...props({ lignes: [ligne()], onEncaisser })} />)
    fireEvent.click(screen.getByRole("button", { name: /encaisser/i }))
    expect(onEncaisser).toHaveBeenCalledTimes(1)
  })

  it("signale une ligne en alerte et un badge réserve en dépannage", () => {
    render(
      <Panier
        {...props({
          lignes: [
            ligne({ enAlerte: true }),
            ligne({
              variantId: "v2",
              nom: "Fanta",
              sourceWarehouseId: "r1",
              sourceNom: "Réserve",
            }),
          ],
        })}
      />
    )
    expect(screen.getByText("Stock insuffisant")).toBeTruthy()
    expect(screen.getByText(/réserve\s+Réserve/i)).toBeTruthy()
  })

  it("le stepper remonte la nouvelle quantité (+ et −)", () => {
    const onQuantite = vi.fn()
    render(<Panier {...props({ lignes: [ligne()], onQuantite })} />)
    fireEvent.click(
      screen.getByRole("button", { name: "Augmenter la quantité" })
    )
    expect(onQuantite).toHaveBeenLastCalledWith(
      expect.objectContaining({ variantId: "v1" }),
      3
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Diminuer la quantité" })
    )
    expect(onQuantite).toHaveBeenLastCalledWith(
      expect.objectContaining({ variantId: "v1" }),
      1
    )
  })

  it("saisit une quantité précise au clavier (clic sur le nombre, blur)", () => {
    const onQuantite = vi.fn()
    render(<Panier {...props({ lignes: [ligne()], onQuantite })} />)
    fireEvent.click(
      screen.getByRole("button", { name: "Saisir la quantité de Coca 50cl" })
    )
    const champ = screen.getByLabelText("Nouvelle quantité de Coca 50cl")
    fireEvent.change(champ, { target: { value: "5" } })
    fireEvent.blur(champ)
    expect(onQuantite).toHaveBeenCalledWith(
      expect.objectContaining({ variantId: "v1" }),
      5
    )
  })

  it("le retrait inline remonte la ligne", () => {
    const onSupprimer = vi.fn()
    render(<Panier {...props({ lignes: [ligne()], onSupprimer })} />)
    fireEvent.click(screen.getByRole("button", { name: "Retirer Coca 50cl" }))
    expect(onSupprimer).toHaveBeenCalledWith(
      expect.objectContaining({ variantId: "v1" })
    )
  })

  it("édite le prix inline : ne remonte que la valeur modifiée au blur", () => {
    const onPrix = vi.fn()
    render(
      <Panier {...props({ lignes: [ligne({ prixPlancher: 400 })], onPrix })} />
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Modifier le prix de Coca 50cl" })
    )
    const champ = screen.getByLabelText("Nouveau prix de Coca 50cl")
    fireEvent.change(champ, { target: { value: "450" } })
    fireEvent.blur(champ)
    expect(onPrix).toHaveBeenCalledWith(
      expect.objectContaining({ variantId: "v1" }),
      450
    )
  })

  it("prix non révisable (sans plancher) : affiché en texte, non éditable", () => {
    render(<Panier {...props({ lignes: [ligne({ prixPlancher: null })] })} />)
    expect(
      screen.queryByRole("button", { name: "Modifier le prix de Coca 50cl" })
    ).toBeNull()
    // le montant reste affiché
    expect(screen.getAllByText(/500/).length).toBeGreaterThan(0)
  })

  it("le dépannage inline remonte la ligne", () => {
    const onDepanner = vi.fn()
    render(<Panier {...props({ lignes: [ligne()], onDepanner })} />)
    fireEvent.click(
      screen.getByRole("button", {
        name: "Puiser Coca 50cl dans un autre entrepôt",
      })
    )
    expect(onDepanner).toHaveBeenCalledWith(
      expect.objectContaining({ variantId: "v1" })
    )
  })

  it("panier verrouillé : les contrôles d'édition sont désactivés", () => {
    render(<Panier {...props({ lignes: [ligne()], verrouille: true })} />)
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Retirer Coca 50cl",
      }).disabled
    ).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Augmenter la quantité",
      }).disabled
    ).toBe(true)
  })

  it("affiche l'erreur de prix rattachée à la ligne", () => {
    render(
      <Panier
        {...props({
          lignes: [ligne()],
          erreurPrix: { cle: "v1|", message: "Refusé : minimum 400 F CFA" },
        })}
      />
    )
    expect(screen.getByRole("alert").textContent).toContain("Refusé : minimum")
  })
})
