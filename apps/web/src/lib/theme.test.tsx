import { describe, it, expect, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

import { ThemeProvider, useTheme } from "./theme"

function Sonde() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button onClick={() => setTheme("dark")}>sombre</button>
      <button onClick={() => setTheme("light")}>clair</button>
    </div>
  )
}

function html() {
  return document.documentElement
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear()
    html().classList.remove("dark")
  })

  it("par défaut : thème « system », résolu en clair (pas de matchMedia en jsdom), sans classe dark", () => {
    render(
      <ThemeProvider>
        <Sonde />
      </ThemeProvider>
    )
    expect(screen.getByTestId("theme").textContent).toBe("system")
    expect(screen.getByTestId("resolved").textContent).toBe("light")
    expect(html().classList.contains("dark")).toBe(false)
  })

  it("applique la classe dark au montage quand localStorage vaut « dark »", () => {
    localStorage.setItem("theme", "dark")
    render(
      <ThemeProvider>
        <Sonde />
      </ThemeProvider>
    )
    expect(screen.getByTestId("theme").textContent).toBe("dark")
    expect(html().classList.contains("dark")).toBe(true)
  })

  it("setTheme bascule la classe dark et persiste la préférence", () => {
    render(
      <ThemeProvider>
        <Sonde />
      </ThemeProvider>
    )
    fireEvent.click(screen.getByRole("button", { name: "sombre" }))
    expect(html().classList.contains("dark")).toBe(true)
    expect(localStorage.getItem("theme")).toBe("dark")

    fireEvent.click(screen.getByRole("button", { name: "clair" }))
    expect(html().classList.contains("dark")).toBe(false)
    expect(localStorage.getItem("theme")).toBe("light")
  })
})
