import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, eq } from "drizzle-orm"
import * as schema from "../db/schema"
import { requireAuth } from "../middleware/require-auth"
import { requireMembership } from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import type { Env } from "../env"

export const filesRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

filesRoute.use(requireAuth, requireMembership)

// Service authentifié : la clé doit être l'imageKey d'un produit de
// l'organisation de l'appelant, sinon 404 (pas de fuite cross-tenant).
filesRoute.get("/produits/:fichier", async (c) => {
  const cle = `produits/${c.req.param("fichier")}`
  const db = drizzle(c.env.DB, { schema })
  const rows = await db
    .select({ id: schema.products.id })
    .from(schema.products)
    .where(
      and(
        eq(schema.products.imageKey, cle),
        eq(schema.products.organizationId, c.get("membership").organizationId)
      )
    )
    .limit(1)
  if (!rows[0]) {
    return c.json({ code: "INTROUVABLE", message: "Fichier introuvable" }, 404)
  }
  const objet = await c.env.IMAGES.get(cle)
  if (!objet) {
    return c.json({ code: "INTROUVABLE", message: "Fichier introuvable" }, 404)
  }
  return new Response(objet.body, {
    headers: {
      "content-type":
        objet.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "private, max-age=3600",
    },
  })
})
