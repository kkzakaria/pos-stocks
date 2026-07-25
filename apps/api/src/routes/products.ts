import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm"
import {
  productCreateSchema,
  productUpdateSchema,
  variantCreateSchema,
} from "shared"
import * as schema from "../db/schema"
import { validerCorps } from "../lib/validation"
import { estViolationUnicite } from "../lib/db-errors"
import { requeterParLots } from "../lib/db-batch"
import { barcodeDejaUtilise } from "../lib/barcode"
import { genererSkuProduit, genererSkuVariante } from "../lib/sku"
import { categorieExiste, produitScope } from "../lib/org-scope"
import { filtrePortee, porteeLectureStock } from "../lib/stock-acces"
import { likeEchappe } from "../lib/recherche"
import { lirePagination } from "../lib/pagination"
import { requireAuth } from "../middleware/require-auth"
import { requireMembership, requireRole } from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import type { Env } from "../env"
import type { Context } from "hono"
import type { z } from "zod"

export const productsRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

productsRoute.use(requireAuth, requireMembership)

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
  } else if (actifs === "false") {
    conditions.push(eq(schema.products.isActive, false))
  }
  if (recherche) {
    const filtre = or(
      likeEchappe(schema.products.name, recherche),
      likeEchappe(schema.products.sku, recherche),
      likeEchappe(schema.products.barcode, recherche),
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
                likeEchappe(schema.productVariants.sku, recherche),
                likeEchappe(schema.productVariants.barcode, recherche)
              )
            )
          )
      )
    )
    if (filtre) {
      conditions.push(filtre)
    }
  }

  const pagination = lirePagination(c)
  if (pagination instanceof Response) return pagination
  const { page, limite } = pagination
  const totalRows = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(schema.products)
    .where(and(...conditions))
  const total = totalRows[0]?.total ?? 0

  const produits = await db
    .select()
    .from(schema.products)
    .where(and(...conditions))
    .orderBy(asc(schema.products.name), asc(schema.products.id))
    .limit(limite)
    .offset((page - 1) * limite)
  const idsProduits = produits.map((p) => p.id)
  // Batched: idsProduits is unbounded (every product in the list), so a plain
  // inArray exceeds SQLite/D1's bound-variable cap on large catalogs (observed
  // crash at 720 products). requeterParLots also handles the empty case, so the
  // former inArray([]) guard is no longer needed here.
  const variantes = await requeterParLots(idsProduits, (lot) =>
    db
      .select()
      .from(schema.productVariants)
      .where(
        and(
          eq(schema.productVariants.organizationId, organizationId),
          inArray(schema.productVariants.productId, lot)
        )
      )
  )
  const products = produits.map((p) => ({
    ...p,
    variants: variantes.filter((v) => v.productId === p.id),
  }))
  return c.json({ products, total, page, limite })
})

productsRoute.get("/:id", async (c) => {
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const produit = await produitScope(db, organizationId, c.req.param("id"))
  if (!produit) {
    return c.json({ code: "INTROUVABLE", message: "Produit introuvable" }, 404)
  }
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

// Product stock by warehouse, read-only, filtered by the caller's stock
// reading scope (spec §4). Out-of-scope users get an empty list (200), so
// the product page stays viewable; cross-tenant products stay 404.
productsRoute.get("/:id/stock", async (c) => {
  const { organizationId, role } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const produit = await produitScope(db, organizationId, c.req.param("id"))
  if (!produit) {
    return c.json({ code: "INTROUVABLE", message: "Produit introuvable" }, 404)
  }
  const portee = await porteeLectureStock(
    db,
    organizationId,
    c.get("user").id,
    role
  )
  const filtre = filtrePortee(portee, schema.stockLevels.warehouseId)
  if (filtre.vide) {
    return c.json({ stock: [] })
  }
  const conditions = [
    eq(schema.stockLevels.organizationId, organizationId),
    eq(schema.productVariants.productId, produit.id),
  ]
  if (filtre.condition) {
    conditions.push(filtre.condition)
  }
  const stock = await db
    .select({
      warehouseId: schema.stockLevels.warehouseId,
      warehouseName: schema.warehouses.name,
      variantId: schema.stockLevels.variantId,
      variantName: schema.productVariants.name,
      quantity: schema.stockLevels.quantity,
      avgCost: schema.stockLevels.avgCost,
    })
    .from(schema.stockLevels)
    .innerJoin(
      schema.productVariants,
      eq(schema.stockLevels.variantId, schema.productVariants.id)
    )
    .innerJoin(
      schema.warehouses,
      eq(schema.stockLevels.warehouseId, schema.warehouses.id)
    )
    .where(and(...conditions))
    .orderBy(asc(schema.warehouses.name), asc(schema.productVariants.name))
  return c.json({ stock })
})

type ContexteProduits = Context<{
  Bindings: Env
  Variables: PermissionVariables
}>

type DonneesCreation = z.infer<typeof productCreateSchema>

const TAILLE_MAX_IMAGE = 2 * 1024 * 1024

const EXTENSIONS_IMAGE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}

const MARGE_ENTETES_MULTIPART = 4096

productsRoute.post(
  "/",
  requireRole("owner", "admin", "stock_manager"),
  async (c) => {
    // The Content-Type discriminates: multipart is the creation page, JSON is
    // the historical contract the Supabase import relies on.
    if ((c.req.header("content-type") ?? "").includes("multipart/form-data")) {
      return creerDepuisMultipart(c)
    }
    const corps = await validerCorps(c, productCreateSchema)
    if (!corps.ok) return corps.reponse
    return creerProduit(c, corps.data, null)
  }
)

/** Reads the `donnees` JSON part and the optional `image` part, then delegates to the shared creation. */
async function creerDepuisMultipart(c: ContexteProduits): Promise<Response> {
  // Early rejection before parseBody() buffers the whole body. The declared
  // Content-Length can lie (absent, wrong, chunked), hence the post-parse check
  // kept below as defence in depth.
  const longueurDeclaree = Number(c.req.header("content-length") ?? 0)
  if (longueurDeclaree > TAILLE_MAX_IMAGE + MARGE_ENTETES_MULTIPART) {
    return c.json(
      { code: "IMAGE_TROP_LOURDE", message: "L'image dépasse 2 Mo" },
      400
    )
  }

  const form = await c.req.parseBody()
  const brut = form["donnees"]
  if (typeof brut !== "string") {
    return c.json(
      { code: "VALIDATION", message: "Champ « donnees » manquant" },
      400
    )
  }
  let json: unknown
  try {
    json = JSON.parse(brut)
  } catch {
    return c.json(
      { code: "VALIDATION", message: "Champ « donnees » illisible" },
      400
    )
  }
  const parsed = productCreateSchema.safeParse(json)
  if (!parsed.success) {
    return c.json(
      {
        code: "VALIDATION",
        message: "Données invalides",
        details: parsed.error.flatten(),
      },
      400
    )
  }

  const fichier = form["image"]
  return creerProduit(c, parsed.data, fichier instanceof File ? fichier : null)
}

/**
 * Single creation path for both formats. Everything is validated before the
 * first write; the image lands in R2 first because the product row must carry
 * its key, and a failed batch removes it again.
 */
async function creerProduit(
  c: ContexteProduits,
  donnees: DonneesCreation,
  image: File | null
): Promise<Response> {
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })

  if (
    donnees.categoryId &&
    !(await categorieExiste(db, organizationId, donnees.categoryId))
  ) {
    return c.json(
      { code: "INTROUVABLE", message: "Catégorie introuvable" },
      404
    )
  }

  if (
    donnees.barcode &&
    (await barcodeDejaUtilise(db, organizationId, donnees.barcode))
  ) {
    return c.json(
      { code: "BARCODE_EXISTANT", message: "Ce code-barres est déjà utilisé" },
      409
    )
  }

  // The id is drawn once, outside the SKU retry loop: the R2 key derives from
  // it, so it must not change between attempts. A failed batch inserts nothing,
  // which makes reusing the id safe.
  const id = crypto.randomUUID()

  let cleImage: string | null = null
  if (image) {
    if (image.size > TAILLE_MAX_IMAGE) {
      return c.json(
        { code: "IMAGE_TROP_LOURDE", message: "L'image dépasse 2 Mo" },
        400
      )
    }
    const extension = EXTENSIONS_IMAGE[image.type]
    if (!extension) {
      return c.json(
        { code: "FORMAT_IMAGE", message: "Formats acceptés : JPEG, PNG, WebP" },
        400
      )
    }
    cleImage = `produits/${id}.${extension}`
    await c.env.IMAGES.put(cleImage, image, {
      httpMetadata: { contentType: image.type },
    })
  }

  // Best-effort cleanup: an orphan R2 object is preferable to a broken row, and
  // a failed cleanup must never mask the error that triggered it.
  const oublierImage = async () => {
    if (!cleImage) return
    try {
      await c.env.IMAGES.delete(cleImage)
    } catch {
      // Ignored on purpose: the object simply becomes orphaned.
    }
  }

  const skuFourni = donnees.sku
  // Auto SKU: regenerated on a race over the unique (org, sku) index, three
  // attempts then 409.
  for (let tentative = 0; tentative < 3; tentative++) {
    const sku = skuFourni ?? (await genererSkuProduit(db, organizationId))
    const now = new Date()
    try {
      // Trap: a heterogeneous batch must be built as a direct array literal —
      // no push + cast.
      await db.batch([
        db.insert(schema.products).values({
          id,
          organizationId,
          categoryId: donnees.categoryId ?? null,
          name: donnees.name,
          description: donnees.description ?? null,
          sku,
          barcode: donnees.barcode ?? null,
          price: donnees.price,
          minPrice: donnees.minPrice ?? null,
          defaultMinStock: donnees.defaultMinStock ?? null,
          trackLots: donnees.trackLots ?? false,
          imageKey: cleImage,
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
      if (estViolationUnicite(err, "barcode")) {
        await oublierImage()
        return c.json(
          {
            code: "BARCODE_EXISTANT",
            message: "Ce code-barres est déjà utilisé",
          },
          409
        )
      }
      if (estViolationUnicite(err, "products.name")) {
        await oublierImage()
        return c.json(
          { code: "NOM_EXISTANT", message: "Ce nom est déjà utilisé" },
          409
        )
      }
      if (estViolationUnicite(err)) {
        if (skuFourni) {
          await oublierImage()
          return c.json(
            { code: "SKU_EXISTANT", message: "Ce SKU existe déjà" },
            409
          )
        }
        continue
      }
      await oublierImage()
      throw err
    }
    return c.json({ id, sku }, 201)
  }
  await oublierImage()
  return c.json(
    {
      code: "SKU_EXISTANT",
      message: "Impossible de générer un SKU unique, veuillez réessayer",
    },
    409
  )
}

productsRoute.patch(
  "/:id",
  requireRole("owner", "admin", "stock_manager"),
  async (c) => {
    const corps = await validerCorps(c, productUpdateSchema)
    if (!corps.ok) return corps.reponse
    const { organizationId } = c.get("membership")
    const db = drizzle(c.env.DB, { schema })
    const produit = await produitScope(db, organizationId, c.req.param("id"))
    if (!produit) {
      return c.json(
        { code: "INTROUVABLE", message: "Produit introuvable" },
        404
      )
    }
    if (
      corps.data.categoryId &&
      !(await categorieExiste(db, organizationId, corps.data.categoryId))
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
    // Baisse de prix : une variante SANS priceOverride hérite du prix produit ;
    // son minPriceOverride ne doit pas devenir supérieur au nouveau prix.
    if (corps.data.price !== undefined && corps.data.price !== produit.price) {
      const variantesIncoherentes = await db
        .select({ id: schema.productVariants.id })
        .from(schema.productVariants)
        .where(
          and(
            eq(schema.productVariants.productId, produit.id),
            eq(schema.productVariants.isActive, true),
            isNull(schema.productVariants.priceOverride),
            gt(schema.productVariants.minPriceOverride, corps.data.price)
          )
        )
        .limit(1)
      if (variantesIncoherentes.length > 0) {
        return c.json(
          {
            code: "VALIDATION",
            message:
              "Le nouveau prix est inférieur au prix plancher d'une variante",
          },
          400
        )
      }
    }
    if (
      typeof corps.data.barcode === "string" &&
      corps.data.barcode !== produit.barcode &&
      (await barcodeDejaUtilise(db, organizationId, corps.data.barcode, {
        produitId: produit.id,
      }))
    ) {
      return c.json(
        {
          code: "BARCODE_EXISTANT",
          message: "Ce code-barres est déjà utilisé",
        },
        409
      )
    }
    try {
      await db
        .update(schema.products)
        .set({ ...corps.data, updatedAt: new Date() })
        .where(eq(schema.products.id, produit.id))
    } catch (err) {
      if (estViolationUnicite(err, "barcode")) {
        return c.json(
          {
            code: "BARCODE_EXISTANT",
            message: "Ce code-barres est déjà utilisé",
          },
          409
        )
      }
      if (estViolationUnicite(err, "products.name")) {
        return c.json(
          { code: "NOM_EXISTANT", message: "Ce nom est déjà utilisé" },
          409
        )
      }
      throw err
    }
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
    const produit = await produitScope(db, organizationId, c.req.param("id"))
    if (!produit) {
      return c.json(
        { code: "INTROUVABLE", message: "Produit introuvable" },
        404
      )
    }
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
    if (
      corps.data.barcode &&
      (await barcodeDejaUtilise(db, organizationId, corps.data.barcode))
    ) {
      return c.json(
        {
          code: "BARCODE_EXISTANT",
          message: "Ce code-barres est déjà utilisé",
        },
        409
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
        // (attributes "{}", encore active) et basculer le produit,
        // atomiquement (batch hétérogène : tableau construit directement).
        // Repérage par attributs plutôt que par SKU reconstruit (`-STD`) :
        // le SKU n'est plus garanti de suivre ce format.
        await db.batch([
          db
            .update(schema.productVariants)
            .set({ isActive: false })
            .where(
              and(
                eq(schema.productVariants.productId, produit.id),
                eq(schema.productVariants.attributes, "{}"),
                eq(schema.productVariants.isActive, true)
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
      if (estViolationUnicite(err, "barcode")) {
        return c.json(
          {
            code: "BARCODE_EXISTANT",
            message: "Ce code-barres est déjà utilisé",
          },
          409
        )
      }
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

productsRoute.post(
  "/:id/image",
  requireRole("owner", "admin", "stock_manager"),
  async (c) => {
    // Rejet précoce avant tampon complet du corps par parseBody() : le
    // Content-Length déclaré peut mentir (absent, erroné, chunked), d'où le
    // contrôle post-parse conservé plus bas en défense en profondeur — mais
    // quand il est présent et manifestement excessif, on évite de bufferiser
    // pour rien un gros fichier. La marge couvre l'overhead des limites et
    // en-têtes multipart autour du contenu utile.
    const longueurDeclaree = Number(c.req.header("content-length") ?? 0)
    if (longueurDeclaree > TAILLE_MAX_IMAGE + MARGE_ENTETES_MULTIPART) {
      return c.json(
        { code: "IMAGE_TROP_LOURDE", message: "L'image dépasse 2 Mo" },
        400
      )
    }
    const { organizationId } = c.get("membership")
    const db = drizzle(c.env.DB, { schema })
    const produit = await produitScope(db, organizationId, c.req.param("id"))
    if (!produit) {
      return c.json(
        { code: "INTROUVABLE", message: "Produit introuvable" },
        404
      )
    }

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
    // On uploade la nouvelle image AVANT de toucher à l'ancienne : si le put
    // échoue, product.imageKey reste valide (jamais de référence cassée).
    await c.env.IMAGES.put(cle, fichier, {
      httpMetadata: { contentType: fichier.type },
    })
    await db
      .update(schema.products)
      .set({ imageKey: cle, updatedAt: new Date() })
      .where(eq(schema.products.id, produit.id))
    // L'extension peut changer (jpg → png) : purger l'ancienne clé orpheline
    // en best-effort — un échec de nettoyage ne doit pas faire échouer la
    // requête (on préfère un objet orphelin à une fiche cassée).
    if (produit.imageKey && produit.imageKey !== cle) {
      try {
        await c.env.IMAGES.delete(produit.imageKey)
      } catch {
        // Nettoyage best-effort : on ignore l'échec, l'objet devient orphelin.
      }
    }
    return c.json({ imageKey: cle })
  }
)
