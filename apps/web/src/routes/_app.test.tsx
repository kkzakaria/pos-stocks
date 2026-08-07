import { render, screen } from "@testing-library/react"
import { EnteteMobile } from "@/components/entete-mobile"

describe("EnteteMobile", () => {
  it("expose un bouton de menu accessible", () => {
    render(<EnteteMobile onOuvrir={() => undefined} />)
    expect(screen.getByRole("button", { name: "Ouvrir le menu" })).toBeTruthy()
  })

  it("déclenche l'ouverture au clic", () => {
    let ouvert = false
    render(<EnteteMobile onOuvrir={() => (ouvert = true)} />)
    screen.getByRole("button", { name: "Ouvrir le menu" }).click()
    expect(ouvert).toBe(true)
  })
})
