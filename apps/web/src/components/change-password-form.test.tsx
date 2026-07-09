import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ChangePasswordForm } from "./change-password-form"

describe("ChangePasswordForm", () => {
  it("refuse si la confirmation ne correspond pas, sans appeler onSubmit", async () => {
    const onSubmit = vi.fn()
    render(<ChangePasswordForm onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText("Mot de passe actuel"), {
      target: { value: "ancien-mdp" },
    })
    fireEvent.change(screen.getByLabelText("Nouveau mot de passe"), {
      target: { value: "NouveauMotDePasse1" },
    })
    fireEvent.change(
      screen.getByLabelText("Confirmer le nouveau mot de passe"),
      {
        target: { value: "Different1" },
      }
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Changer le mot de passe" })
    )

    expect(
      await screen.findByText("Les mots de passe ne correspondent pas")
    ).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("soumet les valeurs quand tout est cohérent", async () => {
    const onSubmit = vi.fn().mockResolvedValue(null)
    render(<ChangePasswordForm onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText("Mot de passe actuel"), {
      target: { value: "ancien-mdp" },
    })
    fireEvent.change(screen.getByLabelText("Nouveau mot de passe"), {
      target: { value: "NouveauMotDePasse1" },
    })
    fireEvent.change(
      screen.getByLabelText("Confirmer le nouveau mot de passe"),
      {
        target: { value: "NouveauMotDePasse1" },
      }
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Changer le mot de passe" })
    )

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        currentPassword: "ancien-mdp",
        newPassword: "NouveauMotDePasse1",
      })
    )
  })
})
