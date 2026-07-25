import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
import app from "../src/index"
import * as schema from "../src/db/schema"
import { bootstrapOwner, createUserWithRole } from "./helpers"

/** Builds the multipart body used by the creation page: a JSON part plus an optional file part. */
function creerMultipart(
  cookie: string,
  donnees: unknown,
  image?: File
): Response | Promise<Response> {
  const corps = new FormData()
  corps.append("donnees", JSON.stringify(donnees))
  if (image) corps.append("image", image)
  return app.request(
    "/api/v1/products",
    { method: "POST", headers: { cookie }, body: corps },
    env
  )
}

function creerJson(
  cookie: string,
  donnees: unknown
): Response | Promise<Response> {
  return app.request(
    "/api/v1/products",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(donnees),
    },
    env
  )
}

const petiteImage = () =>
  new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "photo.jpg", {
    type: "image/jpeg",
  })

describe("POST /api/v1/products — création multipart", () => {
  it("crée le produit avec son image en un seul appel", async () => {
    const { ownerCookie } = await bootstrapOwner()

    const res = await creerMultipart(
      ownerCookie,
      { name: "Marteau charpentier", price: 12000 },
      petiteImage()
    )
    expect(res.status).toBe(201)
    const { id, sku } = await res.json<{ id: string; sku: string }>()
    expect(sku).toBe("PRD-0001")

    const db = drizzle(env.DB, { schema })
    const lignes = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, id))
    expect(lignes[0]?.imageKey).toBe(`produits/${id}.jpg`)

    // The stored object is readable through the files route, with its type.
    const servi = await app.request(
      `/api/v1/files/produits/${id}.jpg`,
      { headers: { cookie: ownerCookie } },
      env
    )
    expect(servi.status).toBe(200)
    expect(servi.headers.get("content-type")).toBe("image/jpeg")
    expect((await servi.arrayBuffer()).byteLength).toBe(4)
  })

  it("sans image, le multipart est équivalent au JSON : variante implicite active, hasVariants faux", async () => {
    const { ownerCookie } = await bootstrapOwner()

    const res = await creerMultipart(ownerCookie, {
      name: "Tournevis plat",
      price: 3000,
    })
    expect(res.status).toBe(201)
    const { id } = await res.json<{ id: string }>()

    const db = drizzle(env.DB, { schema })
    const lignesProduit = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, id))
    expect(lignesProduit[0]?.hasVariants).toBe(false)
    expect(lignesProduit[0]?.imageKey).toBeNull()

    const variantes = await db
      .select()
      .from(schema.productVariants)
      .where(eq(schema.productVariants.productId, id))
    expect(variantes).toHaveLength(1)
    expect(variantes[0]?.name).toBe("Standard")
    expect(variantes[0]?.attributes).toBe("{}")
    expect(variantes[0]?.isActive).toBe(true)
  })

  it("la voie application/json reste inchangée (non-régression du script d'import)", async () => {
    const { ownerCookie } = await bootstrapOwner()

    const res = await creerJson(ownerCookie, {
      name: "Scie égoïne",
      price: 8000,
      barcode: "3011110000123",
    })
    expect(res.status).toBe(201)
    const { id, sku } = await res.json<{ id: string; sku: string }>()
    expect(sku).toBe("PRD-0001")

    const db = drizzle(env.DB, { schema })
    const variantes = await db
      .select()
      .from(schema.productVariants)
      .where(eq(schema.productVariants.productId, id))
    expect(variantes).toHaveLength(1)
    expect(variantes[0]?.sku).toBe("PRD-0001-STD")
  })

  it("refuse une image de plus de 2 Mo sans rien créer", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const grosse = new File(
      [new Uint8Array(2 * 1024 * 1024 + 1)],
      "grosse.jpg",
      { type: "image/jpeg" }
    )

    const res = await creerMultipart(
      ownerCookie,
      { name: "Perceuse", price: 45000 },
      grosse
    )
    expect(res.status).toBe(400)
    expect((await res.json<{ code: string }>()).code).toBe("IMAGE_TROP_LOURDE")

    const db = drizzle(env.DB, { schema })
    expect(await db.select().from(schema.products)).toHaveLength(0)
  })

  it("refuse un format d'image non accepté sans rien créer", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const gif = new File([new Uint8Array([0x47, 0x49, 0x46])], "anim.gif", {
      type: "image/gif",
    })

    const res = await creerMultipart(
      ownerCookie,
      { name: "Niveau à bulle", price: 6000 },
      gif
    )
    expect(res.status).toBe(400)
    expect((await res.json<{ code: string }>()).code).toBe("FORMAT_IMAGE")

    const db = drizzle(env.DB, { schema })
    expect(await db.select().from(schema.products)).toHaveLength(0)
  })

  it("refuse une catégorie inconnue sans rien créer ni laisser d'image", async () => {
    const { ownerCookie } = await bootstrapOwner()

    const res = await creerMultipart(
      ownerCookie,
      { name: "Pince", price: 5000, categoryId: "categorie-fantome" },
      petiteImage()
    )
    expect(res.status).toBe(404)
    expect((await res.json<{ code: string }>()).code).toBe("INTROUVABLE")

    const db = drizzle(env.DB, { schema })
    expect(await db.select().from(schema.products)).toHaveLength(0)
    // The category check runs before the R2 put, so nothing should ever land
    // in the bucket on this path.
    expect(await env.IMAGES.list()).toMatchObject({ objects: [] })
  })

  it("purge l'image R2 déjà envoyée quand le batch échoue après coup (nom déjà utilisé)", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const premier = await creerMultipart(ownerCookie, {
      name: "Marteau rivet",
      price: 7000,
    })
    expect(premier.status).toBe(201)

    // This is the only case in the suite where the R2 put has already
    // happened (unlike the size/format/category rejections above, which all
    // fail before ever touching R2) and the batch still fails afterwards: the
    // unique constraint on products.name rejects the insert. oublierImage()
    // must run, or this image would stay orphaned in the bucket.
    const doublon = await creerMultipart(
      ownerCookie,
      { name: "Marteau rivet", price: 7500 },
      petiteImage()
    )
    expect(doublon.status).toBe(409)
    expect((await doublon.json<{ code: string }>()).code).toBe("NOM_EXISTANT")

    expect(await env.IMAGES.list()).toMatchObject({ objects: [] })
  })

  it("refuse un corps multipart dont la partie donnees est absente", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const corps = new FormData()
    corps.append("image", petiteImage())

    const res = await app.request(
      "/api/v1/products",
      { method: "POST", headers: { cookie: ownerCookie }, body: corps },
      env
    )
    expect(res.status).toBe(400)
    expect((await res.json<{ code: string }>()).code).toBe("VALIDATION")
  })

  it("matrice de rôles : staff et auditor refusés en multipart", async () => {
    const { organizationId } = await bootstrapOwner()
    const staff = await createUserWithRole(organizationId, "staff")
    const auditor = await createUserWithRole(organizationId, "auditor")

    for (const { cookie } of [staff, auditor]) {
      const res = await creerMultipart(cookie, { name: "X", price: 1000 })
      expect(res.status).toBe(403)
    }
  })
})
