import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import app from "../src/index"

const signUpBody = {
  email: "admin@exemple.com",
  password: "MotDePasseTresSolide1",
  name: "Admin Test",
}

function signUp(headers: Record<string, string> = {}) {
  return app.request(
    "/api/auth/sign-up/email",
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(signUpBody),
    },
    env
  )
}

describe("Better Auth", () => {
  it("refuse l'inscription publique sans jeton de setup", async () => {
    const res = await signUp()
    expect(res.status).toBe(403)
  })

  it("accepte l'inscription avec le jeton, puis la connexion", async () => {
    const created = await signUp({ "x-setup-token": env.SETUP_TOKEN })
    expect(created.status).toBe(200)

    const signIn = await app.request(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: signUpBody.email,
          password: signUpBody.password,
        }),
      },
      env
    )
    expect(signIn.status).toBe(200)
    expect(signIn.headers.get("set-cookie")).toContain("better-auth")
  })
})
