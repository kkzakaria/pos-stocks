import { render, screen } from "@testing-library/react"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "./drawer"

function afficher(ouvert: boolean) {
  return render(
    <Drawer open={ouvert} onOpenChange={() => undefined}>
      <DrawerTrigger>Ouvrir le menu</DrawerTrigger>
      <DrawerContent>
        <DrawerTitle>Navigation</DrawerTitle>
        <DrawerDescription>Sections de l'application</DrawerDescription>
        <a href="/stock">Stock</a>
      </DrawerContent>
    </Drawer>
  )
}

describe("Drawer", () => {
  it("n'affiche pas le contenu tant qu'il est fermé", () => {
    afficher(false)
    expect(screen.getByText("Ouvrir le menu")).toBeTruthy()
    expect(screen.queryByText("Stock")).toBeNull()
  })

  it("affiche le contenu, son titre et sa description une fois ouvert", () => {
    afficher(true)
    expect(screen.getByText("Navigation")).toBeTruthy()
    expect(screen.getByText("Sections de l'application")).toBeTruthy()
    expect(screen.getByText("Stock")).toBeTruthy()
  })

  it("ancre le panneau à gauche et l'exclut de l'impression", () => {
    const { baseElement } = afficher(true)
    const panneau = baseElement.querySelector('[data-slot="drawer-content"]')
    expect(panneau).not.toBeNull()
    expect(panneau!.className).toContain("left-0")
    expect(panneau!.className).toContain("print:hidden")
    expect(panneau!.className).toContain("overscroll-contain")
  })
})
