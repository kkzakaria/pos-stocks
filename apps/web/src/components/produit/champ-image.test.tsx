import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ChampImage } from "@/components/produit/champ-image"

const fichierJpeg = (octets = 4) =>
  new File([new Uint8Array(octets)], "photo.jpg", { type: "image/jpeg" })

describe("ChampImage", () => {
  it("remonte le fichier choisi et en affiche l'aperçu", () => {
    const onChange = vi.fn()
    const { rerender } = render(<ChampImage value={null} onChange={onChange} />)

    const entree = screen.getByLabelText("Choisir une image")
    fireEvent.change(entree, { target: { files: [fichierJpeg()] } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]?.[0]).toBeInstanceOf(File)

    rerender(<ChampImage value={fichierJpeg()} onChange={onChange} />)
    expect(screen.getByAltText("Aperçu de l'image du produit")).toBeTruthy()
  })

  it("refuse un fichier de plus de 2 Mo sans le remonter", () => {
    const onChange = vi.fn()
    render(<ChampImage value={null} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText("Choisir une image"), {
      target: { files: [fichierJpeg(2 * 1024 * 1024 + 1)] },
    })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toContain("2 Mo")
  })

  it("refuse un format non accepté sans le remonter", () => {
    const onChange = vi.fn()
    render(<ChampImage value={null} onChange={onChange} />)

    const gif = new File([new Uint8Array(4)], "anim.gif", { type: "image/gif" })
    fireEvent.change(screen.getByLabelText("Choisir une image"), {
      target: { files: [gif] },
    })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toContain("JPEG")
  })

  it("révoque l'URL de l'aperçu au démontage", () => {
    const revoquer = vi.spyOn(URL, "revokeObjectURL")
    const { unmount } = render(
      <ChampImage value={fichierJpeg()} onChange={vi.fn()} />
    )
    unmount()
    expect(revoquer).toHaveBeenCalled()
    revoquer.mockRestore()
  })

  it("permet de retirer l'image choisie", () => {
    const onChange = vi.fn()
    render(<ChampImage value={fichierJpeg()} onChange={onChange} />)

    fireEvent.click(screen.getByRole("button", { name: "Retirer l'image" }))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it("affiche le focus clavier sur le label via le motif peer", () => {
    const { container } = render(<ChampImage value={null} onChange={vi.fn()} />)

    const input = screen.getByLabelText("Choisir une image")
    const label = container.querySelector("label[for='p-image']")

    // Tailwind's peer-focus-visible: compiles to a general sibling combinator
    // (.peer:focus-visible ~ .target): it only works if the label is an
    // actual sibling of the input, not merely a class-name match. Assert the
    // real DOM relationship, not just the presence of the class strings.
    expect(input.nextElementSibling).toBe(label)

    // Verify that the input has the peer class so the selector can work
    expect(input.className).toContain("peer")

    // Verify that the label has the peer-focus-visible classes to display
    // the ring when the input is focused, making keyboard navigation visible
    expect(label).toBeTruthy()
    expect(label?.className).toContain("peer-focus-visible:ring-2")
    expect(label?.className).toContain("peer-focus-visible:ring-ring/30")
  })

  it("accepte un id personnalisé pour cohabiter avec un autre champ image", () => {
    render(<ChampImage id="v-image" value={null} onChange={vi.fn()} />)

    const input = screen.getByLabelText("Choisir une image")
    expect(input.getAttribute("id")).toBe("v-image")
  })
})
