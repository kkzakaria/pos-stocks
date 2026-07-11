import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import app from "../src/index"
import { bootstrapOwner, MDP } from "./helpers"

function changer(cookie: string, body: unknown) {
  return app.request(
    "/api/v1/mon-compte/mot-de-passe",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

describe("mon compte", () => {
  // retry : ce test (plusieurs hachages scrypt + révocation de sessions) est le
  // seul à faire flancher workerd sur les runners CI partagés (« Network
  // connection lost », 3 occurrences PR #5) ; il passe systématiquement en local.
  it(
    "change le mot de passe et lève l'obligation ; l'ancien ne marche plus",
    { retry: 2 },
    async () => {
      const { ownerCookie } = await bootstrapOwner()
      // créer un employé avec mdp provisoire (mustChangePassword = true)
      const creation = await app.request(
        "/api/v1/users",
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: ownerCookie },
          body: JSON.stringify({
            name: "Employé",
            email: "emp@exemple.com",
            role: "staff",
          }),
        },
        env
      )
      const { provisionalPassword } = await creation.json<{
        provisionalPassword: string
      }>()

      const signIn = await app.request(
        "/api/auth/sign-in/email",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "emp@exemple.com",
            password: provisionalPassword,
          }),
        },
        env
      )
      const cookie = signIn.headers.get("set-cookie") ?? ""

      // tant que le mdp n'est pas changé, les autres routes API sont bloquées
      const bloque = await app.request(
        "/api/v1/warehouses",
        { headers: { cookie } },
        env
      )
      expect(bloque.status).toBe(403)
      expect((await bloque.json<{ code: string }>()).code).toBe(
        "MOT_DE_PASSE_A_CHANGER"
      )

      // mauvais mot de passe actuel → 400
      const ko = await changer(cookie, {
        currentPassword: "faux-mot-de-passe",
        newPassword: MDP,
      })
      expect(ko.status).toBe(400)
      expect((await ko.json<{ code: string }>()).code).toBe(
        "MOT_DE_PASSE_INCORRECT"
      )

      // changement OK
      const ok = await changer(cookie, {
        currentPassword: provisionalPassword,
        newPassword: MDP,
      })
      expect(ok.status).toBe(200)

      // reconnexion avec le nouveau mot de passe : mustChangePassword est retombé
      const signIn2 = await app.request(
        "/api/auth/sign-in/email",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "emp@exemple.com", password: MDP }),
        },
        env
      )
      expect(signIn2.status).toBe(200)
      const cookie2 = signIn2.headers.get("set-cookie") ?? ""
      const me = await app.request(
        "/api/v1/me",
        { headers: { cookie: cookie2 } },
        env
      )
      expect(
        (await me.json<{ user: { mustChangePassword: boolean } }>()).user
          .mustChangePassword
      ).toBe(false)

      // l'ancien mot de passe provisoire ne fonctionne plus
      const ancien = await app.request(
        "/api/auth/sign-in/email",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "emp@exemple.com",
            password: provisionalPassword,
          }),
        },
        env
      )
      expect(ancien.status).not.toBe(200)
    }
  )

  it("refuse un nouveau mot de passe de plus de 128 caractères avec le code VALIDATION", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const res = await changer(ownerCookie, {
      currentPassword: MDP,
      newPassword: "A".repeat(200),
    })
    expect(res.status).toBe(400)
    expect((await res.json<{ code: string }>()).code).toBe("VALIDATION")
  })
})
