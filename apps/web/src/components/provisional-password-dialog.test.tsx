import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ProvisionalPasswordDialog } from "./provisional-password-dialog"

describe("ProvisionalPasswordDialog", () => {
  it("affiche le mot de passe et l'email, et se ferme", () => {
    const onClose = vi.fn()
    render(
      <ProvisionalPasswordDialog
        password="ABCD-EFGH-JKMN"
        email="emp@exemple.com"
        onClose={onClose}
      />
    )
    expect(screen.getByText("ABCD-EFGH-JKMN")).toBeTruthy()
    expect(screen.getByText(/emp@exemple\.com/)).toBeTruthy()
    fireEvent.click(
      screen.getByRole("button", { name: "J'ai transmis le mot de passe" })
    )
    expect(onClose).toHaveBeenCalled()
  })

  it("affiche « Copié ! » quand la copie réussit et un message d'échec sinon", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(
      <ProvisionalPasswordDialog
        password="ABCD-EFGH-JKMN"
        email="emp@exemple.com"
        onClose={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Copier" }))
    expect(await screen.findByText("Copié !")).toBeTruthy()
    expect(writeText).toHaveBeenCalledWith("ABCD-EFGH-JKMN")

    writeText.mockRejectedValueOnce(new Error("refusé"))
    fireEvent.click(screen.getByRole("button", { name: "Copier" }))
    expect(
      await screen.findByText(
        "Échec de la copie — notez le mot de passe manuellement."
      )
    ).toBeTruthy()
  })

  it("ne se ferme pas avec la touche Échap", () => {
    const onClose = vi.fn()
    render(
      <ProvisionalPasswordDialog
        password="ABCD-EFGH-JKMN"
        email="emp@exemple.com"
        onClose={onClose}
      />
    )
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).not.toHaveBeenCalled()
  })
})
