import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { FormulaireVariantes } from "@/components/produit/formulaire-variantes"
import type { VarianteSaisie } from "@/components/produit/formulaire-variantes"

describe("FormulaireVariantes", () => {
  it("ajoute une variante avec son attribut et son prix", () => {
    const onChange = vi.fn()
    render(<FormulaireVariantes value={[]} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText("Nom de la variante"), {
      target: { value: "1.5 mm²" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — nom"), {
      target: { value: "section" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — valeur"), {
      target: { value: "1.5" },
    })
    fireEvent.change(screen.getByLabelText("Prix de la variante"), {
      target: { value: "1500" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la variante" }))

    expect(onChange).toHaveBeenCalledWith([
      {
        name: "1.5 mm²",
        attributes: { section: "1.5" },
        priceOverride: 1500,
      },
    ])
  })

  it("refuse d'ajouter une variante sans nom", () => {
    const onChange = vi.fn()
    render(<FormulaireVariantes value={[]} onChange={onChange} />)

    fireEvent.click(screen.getByRole("button", { name: "Ajouter la variante" }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toContain("nom")
  })

  it("refuse une variante sans aucun attribut renseigné", () => {
    const onChange = vi.fn()
    render(<FormulaireVariantes value={[]} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText("Nom de la variante"), {
      target: { value: "Unique" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la variante" }))

    expect(onChange).not.toHaveBeenCalled()
    // Without an attribute the generated SKU would collide with the implicit
    // "Standard" variant, which the API refuses with SKU_EXISTANT.
    expect(screen.getByRole("alert").textContent).toContain("attribut")
  })

  it("liste les variantes déjà saisies et permet d'en retirer une", () => {
    const variantes: VarianteSaisie[] = [
      { name: "1.5 mm²", attributes: { section: "1.5" } },
      { name: "2.5 mm²", attributes: { section: "2.5" } },
    ]
    const onChange = vi.fn()
    render(<FormulaireVariantes value={variantes} onChange={onChange} />)

    expect(screen.getByText("1.5 mm²")).toBeTruthy()
    expect(screen.getByText("2.5 mm²")).toBeTruthy()

    fireEvent.click(
      screen.getByRole("button", { name: "Retirer la variante 1.5 mm²" })
    )
    expect(onChange).toHaveBeenCalledWith([
      { name: "2.5 mm²", attributes: { section: "2.5" } },
    ])
  })

  it("permet d'ajouter une seconde paire d'attributs", () => {
    const onChange = vi.fn()
    render(<FormulaireVariantes value={[]} onChange={onChange} />)

    fireEvent.click(screen.getByRole("button", { name: "Ajouter un attribut" }))
    fireEvent.change(screen.getByLabelText("Nom de la variante"), {
      target: { value: "M / Rouge" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — nom"), {
      target: { value: "taille" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — valeur"), {
      target: { value: "M" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 2 — nom"), {
      target: { value: "couleur" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 2 — valeur"), {
      target: { value: "Rouge" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la variante" }))

    expect(onChange).toHaveBeenCalledWith([
      { name: "M / Rouge", attributes: { taille: "M", couleur: "Rouge" } },
    ])
  })

  it("filtre les paires d'attributs partiellement remplies et accepte si au moins une est complète", () => {
    const onChange = vi.fn()
    render(<FormulaireVariantes value={[]} onChange={onChange} />)

    fireEvent.click(screen.getByRole("button", { name: "Ajouter un attribut" }))
    fireEvent.change(screen.getByLabelText("Nom de la variante"), {
      target: { value: "M" },
    })
    // First pair: key filled, value empty (will be filtered out)
    fireEvent.change(screen.getByLabelText("Attribut 1 — nom"), {
      target: { value: "taille" },
    })
    // Second pair: both key and value filled (will be included)
    fireEvent.change(screen.getByLabelText("Attribut 2 — nom"), {
      target: { value: "couleur" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 2 — valeur"), {
      target: { value: "Rouge" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la variante" }))

    expect(onChange).toHaveBeenCalledWith([
      { name: "M", attributes: { couleur: "Rouge" } },
    ])
  })

  it("refuse un prix décimal", () => {
    const onChange = vi.fn()
    render(<FormulaireVariantes value={[]} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText("Nom de la variante"), {
      target: { value: "Variant" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — nom"), {
      target: { value: "taille" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — valeur"), {
      target: { value: "M" },
    })
    fireEvent.change(screen.getByLabelText("Prix de la variante"), {
      target: { value: "1500.5" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la variante" }))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toContain("entier")
  })

  it("refuse un prix à zéro", () => {
    const onChange = vi.fn()
    render(<FormulaireVariantes value={[]} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText("Nom de la variante"), {
      target: { value: "Variant" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — nom"), {
      target: { value: "taille" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — valeur"), {
      target: { value: "M" },
    })
    fireEvent.change(screen.getByLabelText("Prix de la variante"), {
      target: { value: "0" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la variante" }))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toContain("positif")
  })

  it("inclut barcode et minPriceOverride dans la variante si renseignés", () => {
    const onChange = vi.fn()
    render(<FormulaireVariantes value={[]} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText("Nom de la variante"), {
      target: { value: "Premium" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — nom"), {
      target: { value: "grade" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — valeur"), {
      target: { value: "A" },
    })
    fireEvent.change(screen.getByLabelText("Code-barres de la variante"), {
      target: { value: "123456789" },
    })
    fireEvent.change(screen.getByLabelText("Prix plancher de la variante"), {
      target: { value: "1000" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la variante" }))

    expect(onChange).toHaveBeenCalledWith([
      {
        name: "Premium",
        attributes: { grade: "A" },
        barcode: "123456789",
        minPriceOverride: 1000,
      },
    ])
  })
})
