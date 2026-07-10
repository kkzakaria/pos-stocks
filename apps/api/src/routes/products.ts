import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, asc, eq, inArray, like, or } from "drizzle-orm"
import {
  productCreateSchema,
  productUpdateSchema,
  variantCreateSchema,
} from "shared"
import * as schema from "../db/schema"
import { validerCorps } from "../lib/validation"
import { estViolationUnicite } from "../lib/db-errors"
import { genererSkuProduit, genererSkuVariante } from "../lib/sku"
import { requireAuth } from "../middleware/require-auth"
import { requireMembership, requireRole } from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import type { Env } from "../env"

export const productsRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

productsRoute.use(requireAuth, requireMembership)

async function categorieValide(
  env: Env,
  organizationId: string,
  categoryId: string
): Promise<boolean> {
  const db = drizzle(env.DB, { schema })
  const rows = await db
    .select({ id: schema.categories.id })
    .from(schema.categories)
    .where(
      and(
        eq(schema.categories.id, categoryId),
        eq(schema.categories.organizationId, organizationId)
      )
    )
    .limit(1)
  return rows.length > 0
}

// Lecture : TOUS les membres (le staff/caissier consulte le catalogue)
productsRoute.get("/", async (c) => {
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const recherche = c.req.query("recherche")
  const categorie = c.req.query("categorie")
  const actifs = c.req.query("actifs")

  const conditions = [eq(schema.products.organizationId, organizationId)]
  if (categorie) {
    conditions.push(eq(schema.products.categoryId, categorie))
  }
  if (actifs === "true") {
    conditions.push(eq(schema.products.isActive, true))
  }
  if (recherche) {
    const motif = `%${recherche}%`
    const filtre = or(
      like(schema.products.name, motif),
      like(schema.products.sku, motif),
      like(schema.products.barcode, motif),
      // La recherche atteint aussi les SKU/code-barres des variantes
      inArray(
        schema.products.id,
        db
          .select({ productId: schema.productVariants.productId })
          .from(schema.productVariants)
          .where(
            and(
              eq(schema.productVariants.organizationId, organizationId),
              or(
                like(schema.productVariants.sku, motif),
                like(schema.productVariants.barcode, motif)
              )
            )
          )
      )
    )
    if (filtre) {
      conditions.push(filtre)
    }
  }

  const produits = await db
    .select()
    .from(schema.products)
    .where(and(...conditions))
    .orderBy(asc(schema.products.name))
  const variantes = await db
    .select()
    .from(schema.productVariants)
    .where(eq(schema.productVariants.organizationId, organizationId))
  const products = produits.map((p) => ({
    ...p,
    variants: variantes.filter((v) => v.productId === p.id),
  }))
  return c.json({ products })
})

productsRoute.get("/:id", async (c) => {
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const produits = await db
    .select()
    .from(schema.products)
    .where(
      and(
        eq(schema.products.id, c.req.param("id")),
        eq(schema.products.organizationId, organizationId)
      )
    )
    .limit(1)
  if (produits.length === 0) {
    return c.json({ code: "INTROUVABLE", message: "Produit introuvable" }, 404)
  }
  const produit = produits[0]
  const variantes = await db
    .select()
    .from(schema.productVariants)
    .where(eq(schema.productVariants.productId, produit.id))
    .orderBy(asc(schema.productVariants.name))
  const idsVariantes = variantes.map((v) => v.id)
  // inArray([]) génère un SQL invalide : garde explicite
  const lots =
    idsVariantes.length > 0
      ? await db
          .select()
          .from(schema.lots)
          .where(inArray(schema.lots.variantId, idsVariantes))
          .orderBy(asc(schema.lots.lotNumber))
      : []
  return c.json({
    product: {
      ...produit,
      variants: variantes.map((v) => ({
        ...v,
        lots: lots.filter((l) => l.variantId === v.id),
      })),
    },
  })
})

productsRoute.post(
  "/",
  requireRole("owner", "admin", "stock_manager"),
  async (c) => {
    const corps = await validerCorps(c, productCreateSchema)
    if (!corps.ok) return corps.reponse
    const { organizationId } = c.get("membership")
    const db = drizzle(c.env.DB, { schema })

    if (
      corps.data.categoryId &&
      !(await categorieValide(c.env, organizationId, corps.data.categoryId))
    ) {
      return c.json(
        { code: "INTROUVABLE", message: "Catégorie introuvable" },
        404
      )
    }

    const skuFourni = corps.data.sku
    // SKU auto : régénéré en cas de course sur l'index unique (org, sku),
    // 3 tentatives maximum puis 409.
    for (let tentative = 0; tentative < 3; tentative++) {
      const sku = skuFourni ?? (await genererSkuProduit(db, organizationId))
      const id = crypto.randomUUID()
      const now = new Date()
      try {
        // Piège : batch hétérogène = tableau construit directement
        // (pas de push + cast).
        await db.batch([
          db.insert(schema.products).values({
            id,
            organizationId,
            categoryId: corps.data.categoryId ?? null,
            name: corps.data.name,
            description: corps.data.description ?? null,
            sku,
            barcode: corps.data.barcode ?? null,
            price: corps.data.price,
            minPrice: corps.data.minPrice ?? null,
            defaultMinStock: corps.data.defaultMinStock ?? null,
            trackLots: corps.data.trackLots ?? false,
            createdAt: now,
            updatedAt: now,
          }),
          db.insert(schema.productVariants).values({
            id: crypto.randomUUID(),
            organizationId,
            productId: id,
            name: "Standard",
            attributes: "{}",
            sku: `${sku}-STD`,
            createdAt: now,
          }),
        ])
      } catch (err) {
        if (estViolationUnicite(err)) {
          if (skuFourni) {
            return c.json(
              { code: "SKU_EXISTANT", message: "Ce SKU existe déjà" },
              409
            )
          }
          continue
        }
        throw err
      }
      return c.json({ id, sku }, 201)
    }
    return c.json(
      {
        code: "SKU_EXISTANT",
        message: "Impossible de générer un SKU unique, veuillez réessayer",
      },
      409
    )
  }
)

productsRoute.patch(
  "/:id",
  requireRole("owner", "admin", "stock_manager"),
  async (c) => {
    const corps = await validerCorps(c, productUpdateSchema)
    if (!corps.ok) return corps.reponse
    const { organizationId } = c.get("membership")
    const db = drizzle(c.env.DB, { schema })
    const produits = await db
      .select()
      .from(schema.products)
      .where(
        and(
          eq(schema.products.id, c.req.param("id")),
          eq(schema.products.organizationId, organizationId)
        )
      )
      .limit(1)
    if (produits.length === 0) {
      return c.json(
        { code: "INTROUVABLE", message: "Produit introuvable" },
        404
      )
    }
    const produit = produits[0]
    if (
      corps.data.categoryId &&
      !(await categorieValide(c.env, organizationId, corps.data.categoryId))
    ) {
      return c.json(
        { code: "INTROUVABLE", message: "Catégorie introuvable" },
        404
      )
    }
    // Cohérence prix/plancher : si un seul des deux champs est fourni,
    // l'autre est relu depuis la ligne existante.
    const prix = corps.data.price ?? produit.price
    const plancher =
      corps.data.minPrice !== undefined ? corps.data.minPrice : produit.minPrice
    if (plancher !== null && plancher > prix) {
      return c.json(
        {
          code: "VALIDATION",
          message:
            "Le prix plancher doit être inférieur ou égal au prix de vente",
        },
        400
      )
    }
    await db
      .update(schema.products)
      .set({ ...corps.data, updatedAt: new Date() })
      .where(eq(schema.products.id, produit.id))
    return c.json({ ok: true })
  }
)

productsRoute.post(
  "/:id/variants",
  requireRole("owner", "admin", "stock_manager"),
  async (c) => {
    const corps = await validerCorps(c, variantCreateSchema)
    if (!corps.ok) return corps.reponse
    const { organizationId } = c.get("membership")
    const db = drizzle(c.env.DB, { schema })
    const produits = await db
      .select()
      .from(schema.products)
      .where(
        and(
          eq(schema.products.id, c.req.param("id")),
          eq(schema.products.organizationId, organizationId)
        )
      )
      .limit(1)
    if (produits.length === 0) {
      return c.json(
        { code: "INTROUVABLE", message: "Produit introuvable" },
        404
      )
    }
    const produit = produits[0]
    const prixEffectif = corps.data.priceOverride ?? produit.price
    if (
      corps.data.minPriceOverride !== undefined &&
      corps.data.minPriceOverride > prixEffectif
    ) {
      return c.json(
        {
          code: "VALIDATION",
          message:
            "Le prix plancher doit être inférieur ou égal au prix de vente",
        },
        400
      )
    }
    const sku =
      corps.data.sku ?? genererSkuVariante(produit.sku, corps.data.attributes)
    const id = crypto.randomUUID()
    const valeurs = {
      id,
      organizationId,
      productId: produit.id,
      name: corps.data.name,
      attributes: JSON.stringify(corps.data.attributes),
      sku,
      barcode: corps.data.barcode ?? null,
      priceOverride: corps.data.priceOverride ?? null,
      minPriceOverride: corps.data.minPriceOverride ?? null,
      createdAt: new Date(),
    }
    try {
      if (produit.hasVariants) {
        await db.insert(schema.productVariants).values(valeurs)
      } else {
        // Première variante explicite : retirer la variante implicite
        // « -STD » et basculer le produit, atomiquement (batch hétérogène :
        // tableau construit directement).
        await db.batch([
          db
            .update(schema.productVariants)
            .set({ isActive: false })
            .where(
              and(
                eq(schema.productVariants.productId, produit.id),
                eq(schema.productVariants.sku, `${produit.sku}-STD`)
              )
            ),
          db.insert(schema.productVariants).values(valeurs),
          db
            .update(schema.products)
            .set({ hasVariants: true, updatedAt: new Date() })
            .where(eq(schema.products.id, produit.id)),
        ])
      }
    } catch (err) {
      if (estViolationUnicite(err)) {
        return c.json(
          { code: "SKU_EXISTANT", message: "Ce SKU existe déjà" },
          409
        )
      }
      throw err
    }
    return c.json({ id, sku }, 201)
  }
)

const TAILLE_MAX_IMAGE = 2 * 1024 * 1024

const EXTENSIONS_IMAGE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}

productsRoute.post(
  "/:id/image",
  requireRole("owner", "admin", "stock_manager"),
  async (c) => {
    const { organizationId } = c.get("membership")
    const db = drizzle(c.env.DB, { schema })
    const produits = await db
      .select({ id: schema.products.id, imageKey: schema.products.imageKey })
      .from(schema.products)
      .where(
        and(
          eq(schema.products.id, c.req.param("id")),
          eq(schema.products.organizationId, organizationId)
        )
      )
      .limit(1)
    if (produits.length === 0) {
      return c.json(
        { code: "INTROUVABLE", message: "Produit introuvable" },
        404
      )
    }
    const produit = produits[0]

    const form = await c.req.parseBody()
    const fichier = form["image"]
    if (!(fichier instanceof File)) {
      return c.json(
        { code: "VALIDATION", message: "Champ « image » manquant" },
        400
      )
    }
    if (fichier.size > TAILLE_MAX_IMAGE) {
      return c.json(
        { code: "IMAGE_TROP_LOURDE", message: "L'image dépasse 2 Mo" },
        400
      )
    }
    const extension = EXTENSIONS_IMAGE[fichier.type]
    if (!extension) {
      return c.json(
        { code: "FORMAT_IMAGE", message: "Formats acceptés : JPEG, PNG, WebP" },
        400
      )
    }

    const cle = `produits/${produit.id}.${extension}`
    // L'extension peut changer (jpg → png) : purger l'ancienne clé orpheline
    if (produit.imageKey && produit.imageKey !== cle) {
      await c.env.IMAGES.delete(produit.imageKey)
    }
    await c.env.IMAGES.put(cle, fichier, {
      httpMetadata: { contentType: fichier.type },
    })
    await db
      .update(schema.products)
      .set({ imageKey: cle, updatedAt: new Date() })
      .where(eq(schema.products.id, produit.id))
    return c.json({ imageKey: cle })
  }
)
