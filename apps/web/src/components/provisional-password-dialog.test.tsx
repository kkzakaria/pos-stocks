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
})
