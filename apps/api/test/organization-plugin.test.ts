import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import app from "../src/index"
import { bootstrapOwner, createUserWithRole } from "./helpers"

describe("Surface HTTP du plugin organization", () => {
  it("bloque la création d'organisation via /api/auth/organization/create", async () => {
    const { organizationId } = await bootstrapOwner()
    const staff = await createUserWithRole(organizationId, "staff")

    const res = await app.request(
      "/api/auth/organization/create",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: staff.cookie,
        },
        body: JSON.stringify({ name: "Pirate", slug: "pirate" }),
      },
      env
    )
    expect(res.status).toBe(403)
  })
})
