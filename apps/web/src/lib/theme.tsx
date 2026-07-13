import * as React from "react"

export type Theme = "light" | "dark" | "system"

const STORAGE_KEY = "theme"

type ThemeContextValue = {
  /** Préférence choisie par l'utilisateur (peut être « system »). */
  theme: Theme
  /** Thème effectivement appliqué (résout « system »). */
  resolvedTheme: "light" | "dark"
  setTheme: (theme: Theme) => void
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null)

function prefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  )
}

function lireThemeStocke(): Theme {
  if (typeof localStorage === "undefined") return "system"
  const brut = localStorage.getItem(STORAGE_KEY)
  return brut === "light" || brut === "dark" || brut === "system"
    ? brut
    : "system"
}

/** Applique/retire la classe `.dark` sur <html> selon le thème résolu. */
function appliquerClasse(resolved: "light" | "dark"): void {
  if (typeof document === "undefined") return
  document.documentElement.classList.toggle("dark", resolved === "dark")
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(lireThemeStocke)
  const [systemDark, setSystemDark] = React.useState<boolean>(prefersDark)

  // Suit les changements de préférence OS quand le thème est « system ».
  React.useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return
    }
    const mql = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  const resolvedTheme: "light" | "dark" =
    theme === "system" ? (systemDark ? "dark" : "light") : theme

  React.useEffect(() => {
    appliquerClasse(resolvedTheme)
  }, [resolvedTheme])

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next)
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, next)
    }
  }, [])

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme]
  )

  return <ThemeContext value={value}>{children}</ThemeContext>
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext)
  if (!ctx) {
    throw new Error("useTheme doit être utilisé dans un <ThemeProvider>")
  }
  return ctx
}
