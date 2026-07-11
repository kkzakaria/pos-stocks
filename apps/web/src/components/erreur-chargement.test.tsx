import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ErreurChargement } from "./erreur-chargement"

describe("ErreurChargement", () => {
  it("affiche le message par défaut et relance au clic", () => {
    const onRetry = vi.fn()
    render(<ErreurChargement onRetry={onRetry} />)
    expect(screen.getByRole("alert").textContent).toContain(
      "Impossible de charger les données."
    )
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("affiche un message personnalisé", () => {
    render(
      <ErreurChargement
        message="Impossible de charger les transferts."
        onRetry={() => undefined}
      />
    )
    expect(screen.getByRole("alert").textContent).toContain(
      "Impossible de charger les transferts."
    )
  })
})
