import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { LoginForm } from "./login-form"

describe("LoginForm", () => {
  it("soumet email et mot de passe", async () => {
    const onSubmit = vi.fn().mockResolvedValue(null)
    render(<LoginForm onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "a@b.com" },
    })
    fireEvent.change(screen.getByLabelText("Mot de passe"), {
      target: { value: "secret123456" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        email: "a@b.com",
        password: "secret123456",
      })
    )
  })

  it("affiche le message d'erreur retourné", async () => {
    const onSubmit = vi.fn().mockResolvedValue("Identifiants invalides")
    render(<LoginForm onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "a@b.com" },
    })
    fireEvent.change(screen.getByLabelText("Mot de passe"), {
      target: { value: "mauvais" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }))

    expect(await screen.findByText("Identifiants invalides")).toBeTruthy()
  })
})
