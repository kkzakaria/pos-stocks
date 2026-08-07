import { render, screen } from "@testing-library/react"
import { Input } from "./input"
import { Textarea } from "./textarea"

describe("cibles tactiles et lisibilité", () => {
  it("porte text-base sur pointeur grossier pour empêcher le zoom iOS", () => {
    render(<Input aria-label="Champ" />)
    expect(screen.getByLabelText("Champ").className).toContain(
      "pointer-coarse:text-base"
    )
  })

  it("applique la même règle au textarea", () => {
    render(<Textarea aria-label="Zone" />)
    expect(screen.getByLabelText("Zone").className).toContain(
      "pointer-coarse:text-base"
    )
  })

  it("conserve la taille dense sur pointeur fin à partir de md", () => {
    render(<Input aria-label="Champ" />)
    expect(screen.getByLabelText("Champ").className).toContain(
      "md:text-xs/relaxed"
    )
  })
})
