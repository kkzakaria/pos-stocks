import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { Pagination } from "./pagination"

const element = { un: "vente", plusieurs: "ventes" }
const noop = () => undefined

describe("Pagination", () => {
  it("page unique : compteur seul, aucun bouton", () => {
    render(
      <Pagination
        page={1}
        total={7}
        pageSize={50}
        onPageChange={noop}
        element={element}
      />
    )
    expect(
      screen.getByRole("navigation", { name: "Pagination" }).textContent
    ).toBe("7 ventes")
    expect(screen.queryByRole("button", { name: "Précédent" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Suivant" })).toBeNull()
  })

  it("multi-pages : texte « Page X / Y — N ventes »", () => {
    render(
      <Pagination
        page={2}
        total={138}
        pageSize={50}
        onPageChange={noop}
        element={element}
      />
    )
    expect(screen.getByText("Page 2 / 3 — 138 ventes").textContent).toBe(
      "Page 2 / 3 — 138 ventes"
    )
  })

  it("désactive Précédent en première page, Suivant en dernière", () => {
    const { rerender } = render(
      <Pagination
        page={1}
        total={138}
        pageSize={50}
        onPageChange={noop}
        element={element}
      />
    )
    const prev = screen.getByRole("button", { name: "Précédent" })
    const next = screen.getByRole("button", { name: "Suivant" })
    expect((prev as HTMLButtonElement).disabled).toBe(true)
    expect((next as HTMLButtonElement).disabled).toBe(false)
    rerender(
      <Pagination
        page={3}
        total={138}
        pageSize={50}
        onPageChange={noop}
        element={element}
      />
    )
    const nextLast = screen.getByRole("button", { name: "Suivant" })
    expect((nextLast as HTMLButtonElement).disabled).toBe(true)
  })

  it("onPageChange reçoit page±1 au clic", () => {
    const onPageChange = vi.fn()
    render(
      <Pagination
        page={2}
        total={138}
        pageSize={50}
        onPageChange={onPageChange}
        element={element}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Précédent" }))
    expect(onPageChange).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }))
    expect(onPageChange).toHaveBeenCalledWith(3)
  })

  it("accord : 0 et 1 → singulier, 2+ → pluriel", () => {
    const { rerender } = render(
      <Pagination
        page={1}
        total={0}
        pageSize={50}
        onPageChange={noop}
        element={element}
      />
    )
    expect(screen.getByRole("navigation").textContent).toBe("0 vente")
    rerender(
      <Pagination
        page={1}
        total={1}
        pageSize={50}
        onPageChange={noop}
        element={element}
      />
    )
    expect(screen.getByRole("navigation").textContent).toBe("1 vente")
    rerender(
      <Pagination
        page={1}
        total={2}
        pageSize={50}
        onPageChange={noop}
        element={element}
      />
    )
    expect(screen.getByRole("navigation").textContent).toContain("2 ventes")
  })
})
