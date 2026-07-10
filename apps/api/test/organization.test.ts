import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import app from "../src/index"
import { bootstrapOwner, createUserWithRole } from "./helpers"

describe("API organisation", () => {
  it("GET renvoie les défauts ; PATCH modifie et merge ; staff lit mais n'écrit pas", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const staff = await createUserWithRole(organizationId, "staff")

    const get1 = await app.request(
      "/api/v1/organization",
      { headers: { cookie: ownerCookie } },
      env
    )
    expect(get1.status).toBe(200)
    const initial = await get1.json<{ name: string; currency: string }>()
    expect(initial.name).toBe("Ma Société")
    expect(initial.currency).toBe("XOF")

    const patch = await app.request(
      "/api/v1/organization",
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({
          receiptHeader: "Merci de votre visite",
          currency: "xof",
        }),
      },
      env
    )
    expect(patch.status).toBe(200)

    const get2 = await app.request(
      "/api/v1/organization",
      { headers: { cookie: staff.cookie } },
      env
    )
    expect(get2.status).toBe(200)
    const apres = await get2.json<{ currency: string; receiptHeader: string }>()
    expect(apres.currency).toBe("XOF")
    expect(apres.receiptHeader).toBe("Merci de votre visite")

    const ko = await app.request(
      "/api/v1/organization",
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: staff.cookie },
        body: JSON.stringify({ name: "Piratage" }),
      },
      env
    )
    expect(ko.status).toBe(403)
  })
})
