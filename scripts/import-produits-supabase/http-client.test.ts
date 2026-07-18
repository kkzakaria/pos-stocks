import { describe, test, expect } from "bun:test"
import { analyserCookieSession } from "./http-client"

describe("analyserCookieSession", () => {
  test("extrait le nom=valeur avant les attributs", () => {
    const entete =
      "better-auth.session_token=abc123; Path=/; HttpOnly; SameSite=Lax"
    expect(analyserCookieSession(entete)).toBe(
      "better-auth.session_token=abc123"
    )
  })

  test("gère un en-tête sans attribut supplémentaire", () => {
    expect(analyserCookieSession("session=xyz")).toBe("session=xyz")
  })

  test("lève une erreur sur un en-tête vide", () => {
    expect(() => analyserCookieSession("")).toThrow()
  })

  test("lève une erreur si aucun signe = n'est présent", () => {
    expect(() => analyserCookieSession("valeur-sans-egal")).toThrow()
  })
})
