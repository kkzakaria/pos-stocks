/**
 * Installs a minimal matchMedia backed by a fixed viewport width, and returns
 * a cleanup function that removes it again. Deliberately NOT registered in
 * test-setup.ts: a global stub would break theme.test.tsx, which asserts the
 * production code's behaviour when matchMedia is unavailable.
 *
 * Only `(min-width: <n>rem)` queries are understood — the only form the app
 * uses.
 */
export function installerMatchMedia(largeurPx: number): () => void {
  const precedent = Object.getOwnPropertyDescriptor(window, "matchMedia")

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (requete: string): MediaQueryList => {
      const rem = /\(min-width:\s*([\d.]+)rem\)/.exec(requete)
      const seuilPx = rem ? Number(rem[1]) * 16 : 0
      return {
        matches: largeurPx >= seuilPx,
        media: requete,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      } as MediaQueryList
    },
  })

  return () => {
    if (precedent) Object.defineProperty(window, "matchMedia", precedent)
    else delete (window as { matchMedia?: unknown }).matchMedia
  }
}
