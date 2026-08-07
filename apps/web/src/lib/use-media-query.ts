import { useEffect, useState } from "react"

/** `md` breakpoint (48rem / 768px) — tables become tables again. */
const REQUETE_LARGE = "(min-width: 48rem)"
/** `lg` breakpoint (64rem / 1024px) — the sidebar becomes permanent. */
const REQUETE_DESKTOP = "(min-width: 64rem)"

function lire(requete: string): boolean {
  // jsdom implements neither matchMedia nor a layout engine. Degrading to the
  // desktop tier keeps every existing screen test rendering the same tree it
  // rendered before this feature existed; card-mode tests opt in explicitly
  // through the test helper.
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return true
  }
  return window.matchMedia(requete).matches
}

/**
 * Structural breakpoint hook. Governs which component tree is mounted —
 * never use it for purely dimensional tweaks, which belong in CSS.
 */
export function useMediaQuery(requete: string): boolean {
  const [correspond, setCorrespond] = useState(() => lire(requete))

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return
    const liste = window.matchMedia(requete)
    const surChangement = (e: MediaQueryListEvent) => setCorrespond(e.matches)
    setCorrespond(liste.matches)
    liste.addEventListener("change", surChangement)
    return () => liste.removeEventListener("change", surChangement)
  }, [requete])

  return correspond
}

/** True from the `md` tier up (≥ 768px). */
export function useEstLarge(): boolean {
  return useMediaQuery(REQUETE_LARGE)
}

/** True from the `lg` tier up (≥ 1024px). */
export function useEstDesktop(): boolean {
  return useMediaQuery(REQUETE_DESKTOP)
}
