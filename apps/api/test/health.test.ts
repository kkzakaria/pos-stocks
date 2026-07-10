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

  it("les tables de la Phase 2 existent", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('warehouses','warehouse_members')"
    ).all()
    expect(results).toHaveLength(2)
  })

  it("le binding R2 IMAGES fonctionne (put/get)", async () => {
    await env.IMAGES.put("test/cle.txt", "bonjour")
    const objet = await env.IMAGES.get("test/cle.txt")
    expect(objet).not.toBeNull()
    expect(await objet?.text()).toBe("bonjour")
  })

  it("les tables du catalogue (Phase 3) existent", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('categories','suppliers','products','product_variants','lots')"
    ).all()
    expect(results).toHaveLength(5)
  })
})
