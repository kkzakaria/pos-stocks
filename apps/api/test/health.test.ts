import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import app from "../src/index"

describe("GET /api/v1/health", () => {
  it("répond 200 avec le statut ok", async () => {
    const res = await app.request("/api/v1/health", {}, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: "ok" })
  })

  it("les migrations sont appliquées", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='user'"
    ).all()
    expect(results).toHaveLength(1)
  })
})
