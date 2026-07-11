import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import app from "../src/index"
import * as schema from "../src/db/schema"
import type { CompanyRole, WarehouseRole } from "shared"

export const MDP = "MotDePasseTresSolide1"

async function signInCookie(email: string): Promise<string> {
  const res = await app.request(
    "/api/auth/sign-in/email",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: MDP }),
    },
    env
  )
  return res.headers.get("set-cookie") ?? ""
}

export async function bootstrapOwner() {
  const res = await app.request(
    "/api/v1/setup",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-setup-token": env.SETUP_TOKEN,
      },
      body: JSON.stringify({
        organizationName: "Ma Société",
        name: "Propriétaire",
        email: "owner@exemple.com",
        password: MDP,
      }),
    },
    env
  )
  const body = await res.json<{ organizationId: string; userId: string }>()
  return {
    organizationId: body.organizationId,
    ownerId: body.userId,
    ownerCookie: await signInCookie("owner@exemple.com"),
  }
}

export async function createUserWithRole(
  organizationId: string,
  role: CompanyRole,
  email = `${role}-${crypto.randomUUID().slice(0, 8)}@exemple.com`
) {
  const res = await app.request(
    "/api/auth/sign-up/email",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-setup-token": env.SETUP_TOKEN,
      },
      body: JSON.stringify({ email, password: MDP, name: `Test ${role}` }),
    },
    env
  )
  const { user } = await res.json<{ user: { id: string } }>()
  const db = drizzle(env.DB, { schema })
  await db.insert(schema.member).values({
    id: crypto.randomUUID(),
    organizationId,
    userId: user.id,
    role,
    createdAt: new Date(),
  })
  return { userId: user.id, email, cookie: await signInCookie(email) }
}

export async function creerEntrepot(
  organizationId: string,
  nom = "Dépôt central",
  type: "warehouse" | "store" = "warehouse"
): Promise<string> {
  const db = drizzle(env.DB, { schema })
  const id = crypto.randomUUID()
  const now = new Date()
  await db.insert(schema.warehouses).values({
    id,
    organizationId,
    name: nom,
    type,
    createdAt: now,
    updatedAt: now,
  })
  return id
}

export async function affecterEntrepot(
  organizationId: string,
  userId: string,
  warehouseId: string,
  role: WarehouseRole
): Promise<void> {
  const db = drizzle(env.DB, { schema })
  await db.insert(schema.warehouseMembers).values({
    id: crypto.randomUUID(),
    organizationId,
    warehouseId,
    userId,
    role,
    createdAt: new Date(),
  })
}

// Produit + variante implicite « Standard », insérés directement en base
// (plus rapide et plus stable que de passer par l'API dans les seeds).
export async function creerProduitSimple(
  organizationId: string,
  options: {
    nom?: string
    prix?: number
    trackLots?: boolean
    defaultMinStock?: number | null
    barcode?: string | null
  } = {}
): Promise<{ productId: string; variantId: string }> {
  const db = drizzle(env.DB, { schema })
  const productId = crypto.randomUUID()
  const variantId = crypto.randomUUID()
  const now = new Date()
  const suffixe = productId.slice(0, 8)
  await db.batch([
    db.insert(schema.products).values({
      id: productId,
      organizationId,
      name: options.nom ?? `Produit ${suffixe}`,
      sku: `TST-${suffixe}`,
      barcode: options.barcode ?? null,
      price: options.prix ?? 1000,
      defaultMinStock: options.defaultMinStock ?? null,
      trackLots: options.trackLots ?? false,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(schema.productVariants).values({
      id: variantId,
      organizationId,
      productId,
      name: "Standard",
      attributes: "{}",
      sku: `TST-${suffixe}-STD`,
      createdAt: now,
    }),
  ])
  return { productId, variantId }
}
