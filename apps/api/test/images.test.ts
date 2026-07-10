import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import app from "../src/index"
import * as schema from "../src/db/schema"
import { bootstrapOwner, createUserWithRole } from "./helpers"

async function creerProduit(cookie: string) {
  const res = await app.request(
    "/api/v1/products",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "Coca 33cl", price: 500 }),
    },
    env
  )
  return res.json<{ id: string }>()
}

function uploader(cookie: string, productId: string, fichier: File) {
  const donnees = new FormData()
  donnees.append("image", fichier)
  return app.request(
    `/api/v1/products/${productId}/image`,
    { method: "POST", headers: { cookie }, body: donnees },
    env
  )
}

const petiteImage = () =>
  new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "photo.jpg", {
    type: "image/jpeg",
  })

describe("API images produits", () => {
  it("upload puis service du fichier avec le bon content-type", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const { id } = await creerProduit(ownerCookie)

    const res = await uploader(ownerCookie, id, petiteImage())
    expect(res.status).toBe(200)
    const { imageKey } = await res.json<{ imageKey: string }>()
    expect(imageKey).toBe(`produits/${id}.jpg`)

    const servi = await app.request(
      `/api/v1/files/${imageKey}`,
      { headers: { cookie: ownerCookie } },
      env
    )
    expect(servi.status).toBe(200)
    expect(servi.headers.get("content-type")).toBe("image/jpeg")
    expect((await servi.arrayBuffer()).byteLength).toBe(4)
  })

  it("refuse une image de plus de 2 Mo (IMAGE_TROP_LOURDE)", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const { id } = await creerProduit(ownerCookie)
    const grosse = new File(
      [new Uint8Array(2 * 1024 * 1024 + 1)],
      "grosse.jpg",
      { type: "image/jpeg" }
    )
    const res = await uploader(ownerCookie, id, grosse)
    expect(res.status).toBe(400)
    const corps = await res.json<{ code: string; message: string }>()
    expect(corps.code).toBe("IMAGE_TROP_LOURDE")
    expect(corps.message).toBe("L'image dépasse 2 Mo")
  })

  it("refuse précocement via Content-Length mensonger, avant même de lire le corps (IMAGE_TROP_LOURDE)", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const { id } = await creerProduit(ownerCookie)

    const donnees = new FormData()
    donnees.append("image", petiteImage())
    // Le corps réel est minuscule, mais l'en-tête Content-Length prétend
    // dépasser largement la limite : la route doit rejeter avant parseBody()
    // sans avoir besoin de lire/bufferiser le corps.
    const requete = new Request(
      `http://localhost/api/v1/products/${id}/image`,
      {
        method: "POST",
        headers: {
          cookie: ownerCookie,
          "content-length": String(10 * 1024 * 1024),
        },
        body: donnees,
      }
    )
    const res = await app.request(requete, undefined, env)
    expect(res.status).toBe(400)
    const corps = await res.json<{ code: string; message: string }>()
    expect(corps.code).toBe("IMAGE_TROP_LOURDE")
    expect(corps.message).toBe("L'image dépasse 2 Mo")
  })

  it("refuse un format non supporté (FORMAT_IMAGE) et le staff en écriture (403)", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const { id } = await creerProduit(ownerCookie)

    const gif = new File([new Uint8Array([0x47, 0x49, 0x46])], "anim.gif", {
      type: "image/gif",
    })
    const res = await uploader(ownerCookie, id, gif)
    expect(res.status).toBe(400)
    const corps = await res.json<{ code: string; message: string }>()
    expect(corps.code).toBe("FORMAT_IMAGE")
    expect(corps.message).toBe("Formats acceptés : JPEG, PNG, WebP")

    const staff = await createUserWithRole(organizationId, "staff")
    expect((await uploader(staff.cookie, id, petiteImage())).status).toBe(403)
  })

  it("cross-org : le fichier d'une autre organisation est introuvable (404)", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const { id } = await creerProduit(ownerCookie)
    const upload = await uploader(ownerCookie, id, petiteImage())
    const { imageKey } = await upload.json<{ imageKey: string }>()

    // Seconde organisation insérée directement (même approche que
    // permissions.test.ts), avec un membre qui tente de lire le fichier.
    const db = drizzle(env.DB, { schema })
    const autreOrgId = crypto.randomUUID()
    await db.insert(schema.organization).values({
      id: autreOrgId,
      name: "Autre Société",
      slug: "autre",
      createdAt: new Date(),
    })
    const espion = await createUserWithRole(autreOrgId, "staff")

    const res = await app.request(
      `/api/v1/files/${imageKey}`,
      { headers: { cookie: espion.cookie } },
      env
    )
    expect(res.status).toBe(404)
  })
})
