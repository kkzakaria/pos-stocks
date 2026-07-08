import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import app from "../src/index"

const payload = {
  organizationName: "Ma Société",
  name: "Propriétaire",
  email: "owner@exemple.com",
  password: "MotDePasseTresSolide1",
}

function setup(body: unknown, token?: string) {
  return app.request(
    "/api/v1/setup",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { "x-setup-token": token } : {}),
      },
      body: JSON.stringify(body),
    },
    env
  )
}

describe("POST /api/v1/setup", () => {
  it("refuse sans jeton valide", async () => {
    const res = await setup(payload, "mauvais-jeton")
    expect(res.status).toBe(403)
  })

  it("refuse un payload invalide", async () => {
    const res = await setup({ ...payload, password: "court" }, env.SETUP_TOKEN)
    expect(res.status).toBe(400)
  })

  it("crée l'owner et l'organisation, puis refuse une seconde initialisation", async () => {
    const res = await setup(payload, env.SETUP_TOKEN)
    expect(res.status).toBe(201)
    const body = await res.json<{ organizationId: string; userId: string }>()
    expect(body.organizationId).toBeTruthy()
    expect(body.userId).toBeTruthy()

    const again = await setup(payload, env.SETUP_TOKEN)
    expect(again.status).toBe(409)
    expect((await again.json<{ code: string }>()).code).toBe("DEJA_INITIALISE")
  })
})
