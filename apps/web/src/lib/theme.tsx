import * as React from "react"

export type Theme = "light" | "dark" | "system"

const STORAGE_KEY = "theme"

type ThemeContextValue = {
  /** Preference chosen by the user (may be "system"). */
  theme: Theme
  /** Theme actually applied (resolves "system"). */
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

/** Adds/removes the `.dark` class on <html> according to the resolved theme. */
function appliquerClasse(resolved: "light" | "dark"): void {
  if (typeof document === "undefined") return
  document.documentElement.classList.toggle("dark", resolved === "dark")
}

/**
 * Provides the theme context: reads the persisted preference, resolves "system"
 * via `prefers-color-scheme` (tracking OS changes), and applies the `.dark`
 * class on `<html>` according to the effective theme.
 */
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

/**
 * Hook for accessing the current theme; throws an error if used outside a
 * `<ThemeProvider>`.
 */
export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext)
  if (!ctx) {
    throw new Error("useTheme doit être utilisé dans un <ThemeProvider>")
  }
  return ctx
}
