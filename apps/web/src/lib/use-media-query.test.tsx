import { renderHook } from "@testing-library/react"
import { useEstLarge, useEstDesktop } from "./use-media-query"
import { installerMatchMedia } from "@/test/media-query"

describe("useMediaQuery", () => {
  it("dégrade vers desktop quand matchMedia est absent", () => {
    expect(window.matchMedia).toBeUndefined()
    expect(renderHook(() => useEstLarge()).result.current).toBe(true)
    expect(renderHook(() => useEstDesktop()).result.current).toBe(true)
  })

  it("détecte un téléphone à 375 px", () => {
    const nettoyer = installerMatchMedia(375)
    expect(renderHook(() => useEstLarge()).result.current).toBe(false)
    expect(renderHook(() => useEstDesktop()).result.current).toBe(false)
    nettoyer()
  })

  it("détecte une tablette à 768 px : large mais pas desktop", () => {
    const nettoyer = installerMatchMedia(768)
    expect(renderHook(() => useEstLarge()).result.current).toBe(true)
    expect(renderHook(() => useEstDesktop()).result.current).toBe(false)
    nettoyer()
  })

  it("détecte un desktop à 1280 px", () => {
    const nettoyer = installerMatchMedia(1280)
    expect(renderHook(() => useEstDesktop()).result.current).toBe(true)
    nettoyer()
  })

  it("restaure l'absence de matchMedia après nettoyage", () => {
    installerMatchMedia(375)()
    expect(window.matchMedia).toBeUndefined()
  })
})
