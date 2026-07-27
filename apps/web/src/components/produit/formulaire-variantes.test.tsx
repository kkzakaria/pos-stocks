import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { FormulaireVariantes } from "@/components/produit/formulaire-variantes"
import type { VarianteSaisie } from "@/components/produit/formulaire-variantes"

describe("FormulaireVariantes", () => {
  it("ajoute une variante avec son attribut et son prix", () => {
    const onChange = vi.fn()
    render(<FormulaireVariantes value={[]} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText("Nom (ex : M / Rouge)"), {
      target: { value: "1.5 mm²" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — nom"), {
      target: { value: "section" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — valeur"), {
      target: { value: "1.5" },
    })
    fireEvent.change(screen.getByLabelText("Prix (optionnel)"), {
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

    fireEvent.change(screen.getByLabelText("Nom (ex : M / Rouge)"), {
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
    fireEvent.change(screen.getByLabelText("Nom (ex : M / Rouge)"), {
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
    fireEvent.change(screen.getByLabelText("Nom (ex : M / Rouge)"), {
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

    fireEvent.change(screen.getByLabelText("Nom (ex : M / Rouge)"), {
      target: { value: "Variant" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — nom"), {
      target: { value: "taille" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — valeur"), {
      target: { value: "M" },
    })
    fireEvent.change(screen.getByLabelText("Prix (optionnel)"), {
      target: { value: "1500.5" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la variante" }))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toContain("entier")
  })

  it("refuse un prix à zéro", () => {
    const onChange = vi.fn()
    render(<FormulaireVariantes value={[]} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText("Nom (ex : M / Rouge)"), {
      target: { value: "Variant" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — nom"), {
      target: { value: "taille" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — valeur"), {
      target: { value: "M" },
    })
    fireEvent.change(screen.getByLabelText("Prix (optionnel)"), {
      target: { value: "0" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la variante" }))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toContain("positif")
  })

  it("inclut barcode et minPriceOverride dans la variante si renseignés", () => {
    const onChange = vi.fn()
    render(<FormulaireVariantes value={[]} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText("Nom (ex : M / Rouge)"), {
      target: { value: "Premium" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — nom"), {
      target: { value: "grade" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — valeur"), {
      target: { value: "A" },
    })
    fireEvent.change(screen.getByLabelText("Code-barres (optionnel)"), {
      target: { value: "123456789" },
    })
    fireEvent.change(screen.getByLabelText("Plancher (optionnel)"), {
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

  it("refuse une variante dont les valeurs d'attributs produisent une référence déjà prise", () => {
    // The API derives the variant SKU from attribute VALUES, so distinct keys
    // do not avoid the clash: both yield the "-ROUGE" suffix.
    const onChange = vi.fn()
    render(
      <FormulaireVariantes
        value={[{ name: "Rouge", attributes: { teinte: "Rouge" } }]}
        onChange={onChange}
      />
    )

    fireEvent.change(screen.getByLabelText("Nom (ex : M / Rouge)"), {
      target: { value: "Autre rouge" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — nom"), {
      target: { value: "couleur" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — valeur"), {
      target: { value: "Rouge" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la variante" }))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toContain("ROUGE")
  })

  it("ne se laisse pas contourner par la casse ni par les accents", () => {
    const onChange = vi.fn()
    render(
      <FormulaireVariantes
        value={[{ name: "Rouge", attributes: { teinte: "Rouge" } }]}
        onChange={onChange}
      />
    )

    fireEvent.change(screen.getByLabelText("Nom (ex : M / Rouge)"), {
      target: { value: "Rougé minuscule" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — nom"), {
      target: { value: "teinte" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — valeur"), {
      target: { value: "rougé" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la variante" }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it("accepte deux variantes de même nom dont les attributs diffèrent", () => {
    // The name plays no part in the SKU: only the values matter.
    const onChange = vi.fn()
    render(
      <FormulaireVariantes
        value={[{ name: "Standard", attributes: { taille: "M" } }]}
        onChange={onChange}
      />
    )

    fireEvent.change(screen.getByLabelText("Nom (ex : M / Rouge)"), {
      target: { value: "Standard" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — nom"), {
      target: { value: "taille" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — valeur"), {
      target: { value: "L" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la variante" }))

    expect(onChange).toHaveBeenCalledWith([
      { name: "Standard", attributes: { taille: "M" } },
      { name: "Standard", attributes: { taille: "L" } },
    ])
  })

  it("refuse deux attributs portant la même clé plutôt que d'en perdre un", () => {
    const onChange = vi.fn()
    render(<FormulaireVariantes value={[]} onChange={onChange} />)

    fireEvent.click(screen.getByRole("button", { name: "Ajouter un attribut" }))
    fireEvent.change(screen.getByLabelText("Nom (ex : M / Rouge)"), {
      target: { value: "M rouge" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — nom"), {
      target: { value: "taille" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — valeur"), {
      target: { value: "M" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 2 — nom"), {
      target: { value: "taille" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 2 — valeur"), {
      target: { value: "L" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la variante" }))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toContain("taille")
  })

  it("permet de retirer une paire d'attributs ajoutée par erreur", () => {
    const onChange = vi.fn()
    render(<FormulaireVariantes value={[]} onChange={onChange} />)

    // A single pair offers no removal: a variant needs one attribute.
    expect(
      screen.queryByRole("button", { name: "Retirer l'attribut 1" })
    ).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Ajouter un attribut" }))
    fireEvent.change(screen.getByLabelText("Attribut 2 — nom"), {
      target: { value: "erreur" },
    })
    fireEvent.click(
      screen.getByRole("button", { name: "Retirer l'attribut 2" })
    )

    expect(screen.queryByLabelText("Attribut 2 — nom")).toBeNull()
  })

  it("plafonne le nombre de variantes sur la borne de l'API", () => {
    const onChange = vi.fn()
    const pleines = Array.from({ length: 50 }, (_, i) => ({
      name: `V${i}`,
      attributes: { indice: String(i) },
    }))
    render(<FormulaireVariantes value={pleines} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText("Nom (ex : M / Rouge)"), {
      target: { value: "De trop" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — nom"), {
      target: { value: "indice" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — valeur"), {
      target: { value: "99" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la variante" }))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toContain("50")
  })
})
