# Création de produit — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le modal de création de produit par une page dédiée qui crée le produit, son image et ses variantes en un seul appel atomique.

**Architecture:** `POST /api/v1/products` accepte un second format, `multipart/form-data`, discriminé par le `Content-Type` ; la voie `application/json` reste intacte pour le script d'import. Les deux voies convergent vers une fonction de création unique qui valide tout avant d'écrire, pousse l'image dans R2, puis insère produit et variantes dans **un seul `db.batch`**, avec suppression best-effort de l'objet R2 si le batch échoue. Côté web, une route `/catalogue/produits/nouveau` en colonne unique remplace le modal, appuyée sur deux composants contrôlés sans dépendance réseau.

**Tech Stack:** Hono 4, Drizzle ORM, D1, R2, Zod 4 (`packages/shared`), React 19, TanStack Router/Query, shadcn base-mira sur `@base-ui/react`, Tailwind 4, Vitest (`@cloudflare/vitest-pool-workers` côté API, jsdom + Testing Library côté web).

**Spec:** `docs/superpowers/specs/2026-07-25-creation-produit-design.md`

## Global Constraints

- **Séquencement** : développement mené en parallèle de `worktree-import-produits-supabase`, **merge après le sien** (décision utilisateur). Cette branche ne touche aucun fichier de `apps/api`, `apps/web` ni `packages/shared` : aucun conflit possible, le rebase restera vide. Ne pas ouvrir la PR au merge avant que celle de l'import soit passée.
- **Le contrat `application/json` de `POST /api/v1/products` ne change pas.** Le script d'import en dépend. Un test de non-régression le verrouille (Tâche 1).
- Langue : UI, messages d'erreur et messages de commit en **français** ; **commentaires de code et JSDoc en anglais**.
- Enveloppe d'erreur API : `{ code: "MAJUSCULES", message: "français", details? }`. Réutiliser les codes existants avant d'en créer.
- Montants en **entiers XOF**. IDs texte via `crypto.randomUUID()`. Toutes les tables métier portent `organizationId`.
- **Jamais `db.run(sql)` dans un batch D1.** Batch hétérogène = tableau construit directement, pas de `push` + cast.
- Écriture autorisée aux rôles `owner`, `admin`, `stock_manager` (déjà porté par `requireRole` sur la route).
- Hooks husky actifs : pre-commit (lint-staged + typecheck), pre-push (suites complètes). **Jamais `--no-verify`.** Le pre-push local peut échouer sur la flakiness workerd : relancer avec `CI=1 git push` (`singleWorker` + retry), jamais en contournant le hook.
- Pièges eslint du dépôt : `no-unnecessary-condition` (annoter `| null` les retours de lookups), types dans un `import type` séparé, `no-irregular-whitespace`. Dialog base-ui : `<DialogTrigger render={…}>`, jamais `asChild`.
- Valeurs de test **recalculables à la main**, jamais dérivées de la sortie de l'implémentation.
- Assertions Testing Library : le dépôt utilise `toBeTruthy()` / `toBeNull()`, **pas** `toBeInTheDocument()` (jest-dom n'est pas installé).

## File Structure

| Fichier                                                         | Responsabilité                                                                                                         | Tâche |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----- |
| `packages/shared/src/schemas/catalog.ts`                        | extraire l'objet de base de `productCreateSchema`, exporter `productCreateMultipartSchema` et `MAX_VARIANTES_CREATION` | 1, 2  |
| `apps/api/src/routes/products.ts`                               | branche multipart sur `POST /`, fonction de création unique, atomicité R2 + batch                                      | 1, 2  |
| `apps/api/test/products-creation-multipart.test.ts`             | tests d'intégration de la voie multipart (image, variantes, atomicité, non-régression JSON)                            | 1, 2  |
| `apps/web/src/components/produit/champ-image.tsx`               | sélection de fichier, aperçu, validation client, révocation de l'URL objet                                             | 3     |
| `apps/web/src/components/produit/champ-image.test.tsx`          | tests du composant                                                                                                     | 3     |
| `apps/web/src/components/produit/formulaire-variantes.tsx`      | liste et ajout de variantes, composant contrôlé                                                                        | 4     |
| `apps/web/src/components/produit/formulaire-variantes.test.tsx` | tests du composant                                                                                                     | 4     |
| `apps/web/src/routes/_app/catalogue/produits/nouveau.tsx`       | page de création : état, `FormData`, mutation, navigation                                                              | 5     |
| `apps/web/src/routes/_app/catalogue/produits/index.tsx`         | retrait du modal et de son état, le bouton navigue                                                                     | 5     |
| `apps/web/src/test-setup.ts`                                    | shim `URL.createObjectURL` / `revokeObjectURL` (absents de jsdom)                                                      | 3     |

---

### Task 1: Voie multipart et image atomique

Le endpoint accepte `multipart/form-data` avec une partie `donnees` (JSON) et une partie `image` optionnelle. L'image est écrite dans R2 **avant** le batch, et supprimée si le batch échoue. La voie `application/json` reste inchangée. Les variantes viennent en Tâche 2.

**Files:**

- Modify: `apps/api/src/routes/products.ts:197-303` (le handler `POST /`)
- Create: `apps/api/test/products-creation-multipart.test.ts`

Aucune modification de `packages/shared` : la voie multipart réutilise
`productCreateSchema` tel quel. Le schéma dédié aux variantes arrive en Tâche 2,
au moment où il porte enfin quelque chose de différent.

**Interfaces:**

- Consumes : `genererSkuProduit`, `barcodeDejaUtilise`, `categorieExiste` (déjà importés dans `products.ts`), les constantes `TAILLE_MAX_IMAGE`, `EXTENSIONS_IMAGE`, `MARGE_ENTETES_MULTIPART` (déclarées `apps/api/src/routes/products.ts:516-524`).
- Produces :
  - `POST /api/v1/products` en multipart → `201 { id, sku }`, identique à la voie JSON.
  - `creerProduit(c, donnees, image)` — fonction de création partagée par les deux formats, étendue aux variantes en Tâche 2.

- [ ] **Step 1: Écrire les tests d'intégration qui échouent**

Créer `apps/api/test/products-creation-multipart.test.ts` :

```ts
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
): Promise<Response> {
  const corps = new FormData()
  corps.append("donnees", JSON.stringify(donnees))
  if (image) corps.append("image", image)
  return app.request(
    "/api/v1/products",
    { method: "POST", headers: { cookie }, body: corps },
    env
  )
}

function creerJson(cookie: string, donnees: unknown): Promise<Response> {
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
    const produit = (
      await db.select().from(schema.products).where(eq(schema.products.id, id))
    )[0]
    expect(produit?.hasVariants).toBe(false)
    expect(produit?.imageKey).toBeNull()

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
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `bun run --cwd apps/api test -- products-creation-multipart.test.ts`
Expected: FAIL. Les appels multipart partent aujourd'hui dans `validerCorps`, qui fait `c.req.json()` sur un corps multipart et échoue → `400 VALIDATION` au lieu de `201`. Le test « voie JSON inchangée » doit en revanche **déjà passer** : c'est le filet de non-régression.

- [ ] **Step 3: Extraire la fonction de création commune**

Dans `apps/api/src/routes/products.ts`, remplacer le handler `POST /` (lignes 197-303) par une branche de format et une fonction unique. Ajouter en haut du fichier les imports manquants :

```ts
import type { Context } from "hono"
import type { z } from "zod"
```

`productCreateSchema` est déjà importé en tête de fichier.

Puis :

```ts
type ContexteProduits = Context<{
  Bindings: Env
  Variables: PermissionVariables
}>

type DonneesCreation = z.infer<typeof productCreateSchema>

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
```

Déplacer les constantes `TAILLE_MAX_IMAGE`, `EXTENSIONS_IMAGE` et `MARGE_ENTETES_MULTIPART` (aujourd'hui lignes 516-524, après leur nouvel usage) **au-dessus** de `productsRoute.post("/")`, sans quoi elles sont référencées avant déclaration.

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `bun run --cwd apps/api test -- products-creation-multipart.test.ts`
Expected: PASS, 8/8.

- [ ] **Step 5: Vérifier la non-régression de toute la suite produits**

Run: `bun run --cwd apps/api test -- products.test.ts` puis `bun run --cwd apps/api test -- images.test.ts`
Expected: PASS. Ces deux fichiers couvrent la voie JSON et l'endpoint image séparé, aucun des deux ne doit bouger.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/products.ts \
        apps/api/test/products-creation-multipart.test.ts
git commit -m "feat(api): création de produit en multipart avec image atomique"
```

---

### Task 2: Les variantes dans la création

Le même appel porte désormais les variantes. La variante implicite « Standard » est toujours créée, inactive quand des variantes explicites l'accompagnent — l'état final ne dépend pas du chemin emprunté.

**Files:**

- Modify: `packages/shared/src/schemas/catalog.ts`
- Modify: `apps/api/src/routes/products.ts` (la fonction `creerProduit` de la Tâche 1)
- Modify: `apps/api/test/products-creation-multipart.test.ts`

**Interfaces:**

- Consumes : `creerProduit(c, donnees, image)` (Tâche 1), qui valide aujourd'hui avec `productCreateSchema` ; `genererSkuVariante(skuProduit, attributes)` (`apps/api/src/lib/sku.ts`) ; `variantCreateSchema` (`packages/shared/src/schemas/catalog.ts:96`).
- Produces : `productCreateMultipartSchema` porte `variants?: VariantCreateInput[]` borné à `MAX_VARIANTES_CREATION`.

- [ ] **Step 1: Créer le schéma multipart dans le paquet partagé**

`productCreateSchema` est un `ZodEffects` (il porte un `.refine`) : **on ne peut pas l'étendre**. Il faut extraire l'objet nu, puis reposer le `refine` sur chaque export.

Dans `packages/shared/src/schemas/catalog.ts`, déplacer d'abord le bloc `export const variantCreateSchema = z.object({…})` (actuellement ligne 96) **au-dessus** de `productCreateSchema` (ligne 36) — le nouveau schéma le référence. Puis remplacer `productCreateSchema` par :

```ts
export const MAX_VARIANTES_CREATION = 50

// Shared by both creation schemas: the floor price may not exceed the selling
// price. Kept as a standalone predicate because a refined schema is a
// ZodEffects and can no longer be extended.
const plancherInferieurAuPrix = (v: { price: number; minPrice?: number }) =>
  v.minPrice === undefined || v.minPrice <= v.price

const MESSAGE_PLANCHER = {
  message: "Le prix plancher doit être inférieur ou égal au prix de vente",
  path: ["minPrice"],
}

const productCreateBase = z.object({
  name: z.string().trim().min(1, "Le nom est requis"),
  description: z.string().trim().min(1).optional(),
  categoryId: z.string().min(1).optional(),
  barcode: z.string().trim().min(1).optional(),
  price: z
    .number()
    .int("Le prix doit être un entier")
    .positive("Le prix doit être positif"),
  minPrice: z
    .number()
    .int("Le prix plancher doit être un entier")
    .positive("Le prix plancher doit être positif")
    .optional(),
  defaultMinStock: z.number().int().nonnegative().optional(),
  trackLots: z.boolean().optional(),
  sku: z.string().trim().min(1).optional(),
})

export const productCreateSchema = productCreateBase.refine(
  plancherInferieurAuPrix,
  MESSAGE_PLANCHER
)

// Multipart creation: same fields, plus the variants carried in the same call.
// Bounded because every variant adds a statement to a single D1 batch.
export const productCreateMultipartSchema = productCreateBase
  .extend({
    variants: z
      .array(variantCreateSchema)
      .max(
        MAX_VARIANTES_CREATION,
        `Maximum ${MAX_VARIANTES_CREATION} variantes`
      )
      .optional(),
  })
  .refine(plancherInferieurAuPrix, MESSAGE_PLANCHER)
```

Exporter les nouveautés depuis `packages/shared/src/index.ts` (exports **nommés** uniquement, jamais `export *`) : ajouter `productCreateMultipartSchema` et `MAX_VARIANTES_CREATION` à la liste qui contient déjà `productCreateSchema`.

Puis, dans `apps/api/src/routes/products.ts`, brancher la voie multipart sur le nouveau schéma : importer `productCreateMultipartSchema` depuis `shared`, remplacer `productCreateSchema.safeParse(json)` par `productCreateMultipartSchema.safeParse(json)`, et faire pointer `type DonneesCreation = z.infer<typeof productCreateMultipartSchema>`. La voie JSON continue de valider avec `productCreateSchema`.

- [ ] **Step 2: Écrire les tests qui échouent**

Ajouter à `apps/api/test/products-creation-multipart.test.ts`, à l'intérieur du `describe` existant :

```ts
it("crée produit et variantes en un seul appel : implicite inactive, hasVariants vrai", async () => {
  const { ownerCookie } = await bootstrapOwner()

  const res = await creerMultipart(ownerCookie, {
    name: "Câble électrique",
    price: 1500,
    variants: [
      { name: "1.5 mm²", attributes: { section: "1.5" }, priceOverride: 1500 },
      { name: "2.5 mm²", attributes: { section: "2.5" }, priceOverride: 2200 },
    ],
  })
  expect(res.status).toBe(201)
  const { id, sku } = await res.json<{ id: string; sku: string }>()

  const db = drizzle(env.DB, { schema })
  const produit = (
    await db.select().from(schema.products).where(eq(schema.products.id, id))
  )[0]
  expect(produit?.hasVariants).toBe(true)

  const variantes = await db
    .select()
    .from(schema.productVariants)
    .where(eq(schema.productVariants.productId, id))
  expect(variantes).toHaveLength(3)

  const implicite = variantes.find((v) => v.attributes === "{}")
  expect(implicite?.name).toBe("Standard")
  expect(implicite?.sku).toBe(`${sku}-STD`)
  expect(implicite?.isActive).toBe(false)

  const explicites = variantes.filter((v) => v.attributes !== "{}")
  expect(explicites.map((v) => v.sku).sort()).toEqual([
    `${sku}-1-5`,
    `${sku}-2-5`,
  ])
  expect(explicites.every((v) => v.isActive)).toBe(true)
})

it("équivalence des chemins : création d'un bloc et création puis ajout donnent le même état", async () => {
  const { ownerCookie } = await bootstrapOwner()
  const db = drizzle(env.DB, { schema })

  // Path A: everything in one call.
  const bloc = await creerMultipart(ownerCookie, {
    name: "Peinture A",
    price: 9000,
    variants: [{ name: "Blanc", attributes: { teinte: "Blanc" } }],
  })
  const { id: idBloc } = await bloc.json<{ id: string }>()

  // Path B: bare product, then the variant added from the product sheet.
  const nu = await creerJson(ownerCookie, { name: "Peinture B", price: 9000 })
  const { id: idNu } = await nu.json<{ id: string }>()
  const ajout = await app.request(
    `/api/v1/products/${idNu}/variants`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ name: "Blanc", attributes: { teinte: "Blanc" } }),
    },
    env
  )
  expect(ajout.status).toBe(201)

  const resume = async (produitId: string) => {
    const produit = (
      await db
        .select()
        .from(schema.products)
        .where(eq(schema.products.id, produitId))
    )[0]
    const variantes = await db
      .select()
      .from(schema.productVariants)
      .where(eq(schema.productVariants.productId, produitId))
    return {
      hasVariants: produit?.hasVariants,
      // SKU prefixes differ between the two products, so compare suffixes.
      variantes: variantes
        .map((v) => ({
          name: v.name,
          attributes: v.attributes,
          suffixe: v.sku.replace(produit?.sku ?? "", ""),
          isActive: v.isActive,
        }))
        .sort((a, b) => a.suffixe.localeCompare(b.suffixe)),
    }
  }

  expect(await resume(idBloc)).toEqual(await resume(idNu))
})

it("refuse une variante dont le code-barres est déjà pris, sans rien créer ni laisser d'image", async () => {
  const { ownerCookie } = await bootstrapOwner()
  // An existing product already holds the barcode.
  expect(
    (
      await creerJson(ownerCookie, {
        name: "Article témoin",
        price: 1000,
        barcode: "3011110000999",
      })
    ).status
  ).toBe(201)

  const res = await creerMultipart(
    ownerCookie,
    {
      name: "Câble conflit",
      price: 1500,
      variants: [
        { name: "1.5 mm²", attributes: { section: "1.5" } },
        {
          name: "2.5 mm²",
          attributes: { section: "2.5" },
          barcode: "3011110000999",
        },
      ],
    },
    petiteImage()
  )
  expect(res.status).toBe(409)
  const corps = await res.json<{ code: string; message: string }>()
  expect(corps.code).toBe("BARCODE_EXISTANT")
  // The message must name the offending variant, not just the conflict.
  expect(corps.message).toContain("2.5 mm²")

  const db = drizzle(env.DB, { schema })
  const produits = await db.select().from(schema.products)
  expect(produits).toHaveLength(1)
  expect(produits[0]?.name).toBe("Article témoin")
  // No orphan object left behind by the rejected creation.
  expect(await env.IMAGES.list()).toMatchObject({ objects: [] })
})

it("refuse deux variantes du même envoi partageant un code-barres", async () => {
  const { ownerCookie } = await bootstrapOwner()

  const res = await creerMultipart(ownerCookie, {
    name: "Câble doublon",
    price: 1500,
    variants: [
      { name: "1.5 mm²", attributes: { section: "1.5" }, barcode: "111" },
      { name: "2.5 mm²", attributes: { section: "2.5" }, barcode: "111" },
    ],
  })
  expect(res.status).toBe(409)
  expect((await res.json<{ code: string }>()).code).toBe("BARCODE_EXISTANT")

  const db = drizzle(env.DB, { schema })
  expect(await db.select().from(schema.products)).toHaveLength(0)
})

it("refuse deux variantes dont le SKU calculé entre en collision", async () => {
  const { ownerCookie } = await bootstrapOwner()

  // Same attribute values → same generated suffix → same SKU.
  const res = await creerMultipart(ownerCookie, {
    name: "Câble collision",
    price: 1500,
    variants: [
      { name: "Rouge", attributes: { teinte: "Rouge" } },
      { name: "Rouge bis", attributes: { couleur: "Rouge" } },
    ],
  })
  expect(res.status).toBe(409)
  expect((await res.json<{ code: string }>()).code).toBe("SKU_EXISTANT")

  const db = drizzle(env.DB, { schema })
  expect(await db.select().from(schema.products)).toHaveLength(0)
})

it("refuse une variante sans attribut, qui entrerait en collision avec l'implicite", async () => {
  const { ownerCookie } = await bootstrapOwner()

  const res = await creerMultipart(ownerCookie, {
    name: "Câble sans attribut",
    price: 1500,
    variants: [{ name: "Unique", attributes: {} }],
  })
  expect(res.status).toBe(409)
  expect((await res.json<{ code: string }>()).code).toBe("SKU_EXISTANT")

  const db = drizzle(env.DB, { schema })
  expect(await db.select().from(schema.products)).toHaveLength(0)
})
```

- [ ] **Step 3: Lancer les tests et vérifier qu'ils échouent**

Run: `bun run --cwd apps/api test -- products-creation-multipart.test.ts`
Expected: FAIL sur les six nouveaux cas — `variants` est ignoré, donc une seule variante implicite active est créée et `hasVariants` reste `false`.

- [ ] **Step 4: Insérer les variantes dans le batch**

Dans `creerProduit` (`apps/api/src/routes/products.ts`), après le contrôle du code-barres produit et **avant** le tirage de l'id, ajouter la validation des variantes :

```ts
const variantes = donnees.variants ?? []
const aDesVariantes = variantes.length > 0

// Barcodes are checked against the database and against each other: two
// variants of the same payload cannot share one, and the conflict must be
// refused rather than discovered by the unique index.
const barcodesVus = new Set<string>()
if (donnees.barcode) barcodesVus.add(donnees.barcode)
for (const variante of variantes) {
  if (!variante.barcode) continue
  if (
    barcodesVus.has(variante.barcode) ||
    (await barcodeDejaUtilise(db, organizationId, variante.barcode))
  ) {
    return c.json(
      {
        code: "BARCODE_EXISTANT",
        message: `Le code-barres de la variante « ${variante.name} » est déjà utilisé`,
      },
      409
    )
  }
  barcodesVus.add(variante.barcode)
}
```

Puis, à l'intérieur de la boucle de SKU, juste après `const sku = …`, calculer les lignes de variantes et refuser les collisions de SKU :

```ts
// Variant SKUs derive from their attributes, so a collision is stable
// across retries: it is a definitive 409, never a reason to regenerate.
const skuImplicite = `${sku}-STD`
const skusVus = new Set<string>([skuImplicite])
const lignesVariantes: Array<typeof schema.productVariants.$inferInsert> = []
for (const variante of variantes) {
  const skuVariante =
    variante.sku ?? genererSkuVariante(sku, variante.attributes)
  if (skusVus.has(skuVariante)) {
    await oublierImage()
    return c.json(
      {
        code: "SKU_EXISTANT",
        message: `Le SKU « ${skuVariante} » est déjà pris par une autre variante de ce produit`,
      },
      409
    )
  }
  skusVus.add(skuVariante)
  lignesVariantes.push({
    id: crypto.randomUUID(),
    organizationId,
    productId: id,
    name: variante.name,
    attributes: JSON.stringify(variante.attributes),
    sku: skuVariante,
    barcode: variante.barcode ?? null,
    priceOverride: variante.priceOverride ?? null,
    minPriceOverride: variante.minPriceOverride ?? null,
    createdAt: now,
  })
}
```

Attention : `const now = new Date()` doit être déclaré **avant** ce bloc, il l'est déjà en Tâche 1.

Enfin, remplacer le batch par sa forme complète. Le tableau reste un littéral direct — jamais de `push` sur un tableau de statements typé.

```ts
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
    // Explicit variants make the product a variant product straight away.
    hasVariants: aDesVariantes,
    createdAt: now,
    updatedAt: now,
  }),
  db.insert(schema.productVariants).values({
    id: crypto.randomUUID(),
    organizationId,
    productId: id,
    name: "Standard",
    attributes: "{}",
    sku: skuImplicite,
    // The implicit variant is always written, inactive when explicit ones
    // accompany it: the final state must not depend on the path taken.
    isActive: !aDesVariantes,
    createdAt: now,
  }),
  ...lignesVariantes.map((ligne) =>
    db.insert(schema.productVariants).values(ligne)
  ),
])
```

- [ ] **Step 5: Lancer les tests et vérifier qu'ils passent**

Run: `bun run --cwd apps/api test -- products-creation-multipart.test.ts`
Expected: PASS, 14/14.

- [ ] **Step 6: Vérifier la suite API complète**

Run: `CI=1 bun run --cwd apps/api test`
Expected: PASS. `CI=1` évite la flakiness workerd locale (58 processus) documentée dans `CLAUDE.md`.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/schemas/catalog.ts apps/api/src/routes/products.ts \
        apps/api/test/products-creation-multipart.test.ts
git commit -m "feat(api): variantes créées dans le même appel que le produit"
```

---

### Task 3: Composant `champ-image`

Sélection d'un fichier, aperçu local, validation client, révocation de l'URL objet. Aucun appel réseau : le composant est contrôlé et rend son fichier au parent.

**Files:**

- Create: `apps/web/src/components/produit/champ-image.tsx`
- Create: `apps/web/src/components/produit/champ-image.test.tsx`
- Modify: `apps/web/src/test-setup.ts`

**Interfaces:**

- Produces :

  ```ts
  export function ChampImage(props: {
    value: File | null
    onChange: (fichier: File | null) => void
  }): JSX.Element
  ```

  Utilisé par `nouveau.tsx` (Tâche 5).

- [ ] **Step 1: Ajouter le shim jsdom pour les URL objet**

jsdom n'implémente ni `URL.createObjectURL` ni `URL.revokeObjectURL` : sans shim, le rendu du composant lève « not implemented ». Le fichier de setup contient déjà un shim documenté pour Web Locks ; suivre le même motif. Ajouter à la fin de `apps/web/src/test-setup.ts` :

```ts
// jsdom implements neither createObjectURL nor revokeObjectURL. The image field
// builds a local preview from the selected file, so provide a counter-based
// stub: tests assert that every created URL is revoked, which a no-op would
// make untestable.
if (typeof URL.createObjectURL !== "function") {
  let compteur = 0
  URL.createObjectURL = () => `blob:test/${++compteur}`
  URL.revokeObjectURL = () => undefined
}
```

- [ ] **Step 2: Écrire les tests qui échouent**

Créer `apps/web/src/components/produit/champ-image.test.tsx` :

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ChampImage } from "@/components/produit/champ-image"

const fichierJpeg = (octets = 4) =>
  new File([new Uint8Array(octets)], "photo.jpg", { type: "image/jpeg" })

describe("ChampImage", () => {
  it("remonte le fichier choisi et en affiche l'aperçu", () => {
    const onChange = vi.fn()
    const { rerender } = render(<ChampImage value={null} onChange={onChange} />)

    const entree = screen.getByLabelText("Choisir une image")
    fireEvent.change(entree, { target: { files: [fichierJpeg()] } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]?.[0]).toBeInstanceOf(File)

    rerender(<ChampImage value={fichierJpeg()} onChange={onChange} />)
    expect(screen.getByAltText("Aperçu de l'image du produit")).toBeTruthy()
  })

  it("refuse un fichier de plus de 2 Mo sans le remonter", () => {
    const onChange = vi.fn()
    render(<ChampImage value={null} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText("Choisir une image"), {
      target: { files: [fichierJpeg(2 * 1024 * 1024 + 1)] },
    })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toContain("2 Mo")
  })

  it("refuse un format non accepté sans le remonter", () => {
    const onChange = vi.fn()
    render(<ChampImage value={null} onChange={onChange} />)

    const gif = new File([new Uint8Array(4)], "anim.gif", { type: "image/gif" })
    fireEvent.change(screen.getByLabelText("Choisir une image"), {
      target: { files: [gif] },
    })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toContain("JPEG")
  })

  it("révoque l'URL de l'aperçu au démontage", () => {
    const revoquer = vi.spyOn(URL, "revokeObjectURL")
    const { unmount } = render(
      <ChampImage value={fichierJpeg()} onChange={vi.fn()} />
    )
    unmount()
    expect(revoquer).toHaveBeenCalled()
    revoquer.mockRestore()
  })

  it("permet de retirer l'image choisie", () => {
    const onChange = vi.fn()
    render(<ChampImage value={fichierJpeg()} onChange={onChange} />)

    fireEvent.click(screen.getByRole("button", { name: "Retirer l'image" }))
    expect(onChange).toHaveBeenCalledWith(null)
  })
})
```

- [ ] **Step 3: Lancer les tests et vérifier qu'ils échouent**

Run: `bun run --cwd apps/web test -- champ-image`
Expected: FAIL, « Failed to resolve import "@/components/produit/champ-image" ».

- [ ] **Step 4: Écrire le composant**

Créer `apps/web/src/components/produit/champ-image.tsx` :

```tsx
import { useEffect, useState } from "react"
import { Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const TAILLE_MAX = 2 * 1024 * 1024
const TYPES_ACCEPTES = ["image/jpeg", "image/png", "image/webp"]

/**
 * Controlled image field: validates the file locally for immediate feedback,
 * shows a preview built from an object URL, and hands the file to its parent.
 * It performs no request — the file travels with the creation call.
 */
export function ChampImage({
  value,
  onChange,
}: {
  value: File | null
  onChange: (fichier: File | null) => void
}) {
  const [erreur, setErreur] = useState<string | null>(null)
  const [apercu, setApercu] = useState<string | null>(null)

  // The object URL is rebuilt on every file change and revoked on cleanup:
  // leaving it alive would retain the file for the page's lifetime.
  useEffect(() => {
    if (!value) {
      setApercu(null)
      return
    }
    const url = URL.createObjectURL(value)
    setApercu(url)
    return () => URL.revokeObjectURL(url)
  }, [value])

  return (
    <div className="flex flex-col gap-2">
      {apercu ? (
        <img
          src={apercu}
          alt="Aperçu de l'image du produit"
          width={128}
          height={128}
          className="h-32 w-32 rounded-md border object-cover"
        />
      ) : (
        <div className="flex h-32 w-32 items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">
          Aucune image
        </div>
      )}
      <div className="flex items-center gap-2">
        <label
          htmlFor="p-image"
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "w-fit cursor-pointer"
          )}
        >
          <Upload />
          Choisir une image
        </label>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setErreur(null)
              onChange(null)
            }}
          >
            Retirer l'image
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        JPEG, PNG, WebP — 2 Mo max
      </p>
      {erreur && (
        <p role="alert" className="text-xs text-destructive">
          {erreur}
        </p>
      )}
      <input
        id="p-image"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Choisir une image"
        onChange={(e) => {
          // e.target.files is nullable (FileList | null): the optional chain is
          // legitimate for no-unnecessary-condition.
          const input = e.target
          const fichier = input.files?.[0]
          // Reset after every attempt: otherwise re-selecting the SAME file
          // does not fire onChange.
          input.value = ""
          if (!fichier) return
          if (fichier.size > TAILLE_MAX) {
            setErreur("L'image dépasse 2 Mo")
            return
          }
          if (!TYPES_ACCEPTES.includes(fichier.type)) {
            setErreur("Formats acceptés : JPEG, PNG, WebP")
            return
          }
          setErreur(null)
          onChange(fichier)
        }}
        className="sr-only"
      />
    </div>
  )
}
```

- [ ] **Step 5: Lancer les tests et vérifier qu'ils passent**

Run: `bun run --cwd apps/web test -- champ-image`
Expected: PASS, 5/5.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/produit/champ-image.tsx \
        apps/web/src/components/produit/champ-image.test.tsx \
        apps/web/src/test-setup.ts
git commit -m "feat(web): champ image contrôlé avec aperçu et validation locale"
```

---

### Task 4: Composant `formulaire-variantes`

Liste des variantes saisies et formulaire d'ajout, entièrement contrôlé. Aucun appel réseau.

**Files:**

- Create: `apps/web/src/components/produit/formulaire-variantes.tsx`
- Create: `apps/web/src/components/produit/formulaire-variantes.test.tsx`

**Interfaces:**

- Produces :

  ```ts
  export type VarianteSaisie = {
    name: string
    attributes: Record<string, string>
    barcode?: string
    priceOverride?: number
    minPriceOverride?: number
  }

  export function FormulaireVariantes(props: {
    value: VarianteSaisie[]
    onChange: (variantes: VarianteSaisie[]) => void
  }): JSX.Element
  ```

  `VarianteSaisie` correspond exactement à `variantCreateSchema` moins `sku` : la page sérialise ce tableau tel quel dans la partie `donnees`.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `apps/web/src/components/produit/formulaire-variantes.test.tsx` :

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { FormulaireVariantes } from "@/components/produit/formulaire-variantes"
import type { VarianteSaisie } from "@/components/produit/formulaire-variantes"

describe("FormulaireVariantes", () => {
  it("ajoute une variante avec son attribut et son prix", () => {
    const onChange = vi.fn()
    render(<FormulaireVariantes value={[]} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText("Nom de la variante"), {
      target: { value: "1.5 mm²" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — nom"), {
      target: { value: "section" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — valeur"), {
      target: { value: "1.5" },
    })
    fireEvent.change(screen.getByLabelText("Prix de la variante"), {
      target: { value: "1500" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la variante" }))

    expect(onChange).toHaveBeenCalledWith([
      {
        name: "1.5 mm²",
        attributes: { section: "1.5" },
        priceOverride: 1500,
      },
    ])
  })

  it("refuse d'ajouter une variante sans nom", () => {
    const onChange = vi.fn()
    render(<FormulaireVariantes value={[]} onChange={onChange} />)

    fireEvent.click(screen.getByRole("button", { name: "Ajouter la variante" }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toContain("nom")
  })

  it("refuse une variante sans aucun attribut renseigné", () => {
    const onChange = vi.fn()
    render(<FormulaireVariantes value={[]} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText("Nom de la variante"), {
      target: { value: "Unique" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la variante" }))

    expect(onChange).not.toHaveBeenCalled()
    // Without an attribute the generated SKU would collide with the implicit
    // "Standard" variant, which the API refuses with SKU_EXISTANT.
    expect(screen.getByRole("alert").textContent).toContain("attribut")
  })

  it("liste les variantes déjà saisies et permet d'en retirer une", () => {
    const variantes: VarianteSaisie[] = [
      { name: "1.5 mm²", attributes: { section: "1.5" } },
      { name: "2.5 mm²", attributes: { section: "2.5" } },
    ]
    const onChange = vi.fn()
    render(<FormulaireVariantes value={variantes} onChange={onChange} />)

    expect(screen.getByText("1.5 mm²")).toBeTruthy()
    expect(screen.getByText("2.5 mm²")).toBeTruthy()

    fireEvent.click(
      screen.getByRole("button", { name: "Retirer la variante 1.5 mm²" })
    )
    expect(onChange).toHaveBeenCalledWith([
      { name: "2.5 mm²", attributes: { section: "2.5" } },
    ])
  })

  it("permet d'ajouter une seconde paire d'attributs", () => {
    const onChange = vi.fn()
    render(<FormulaireVariantes value={[]} onChange={onChange} />)

    fireEvent.click(screen.getByRole("button", { name: "Ajouter un attribut" }))
    fireEvent.change(screen.getByLabelText("Nom de la variante"), {
      target: { value: "M / Rouge" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — nom"), {
      target: { value: "taille" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — valeur"), {
      target: { value: "M" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 2 — nom"), {
      target: { value: "couleur" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 2 — valeur"), {
      target: { value: "Rouge" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la variante" }))

    expect(onChange).toHaveBeenCalledWith([
      { name: "M / Rouge", attributes: { taille: "M", couleur: "Rouge" } },
    ])
  })
})
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `bun run --cwd apps/web test -- formulaire-variantes`
Expected: FAIL, import non résolu.

- [ ] **Step 3: Écrire le composant**

Créer `apps/web/src/components/produit/formulaire-variantes.tsx` :

```tsx
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export type VarianteSaisie = {
  name: string
  attributes: Record<string, string>
  barcode?: string
  priceOverride?: number
  minPriceOverride?: number
}

type PaireAttribut = { cle: string; valeur: string }

const PAIRE_VIDE: PaireAttribut = { cle: "", valeur: "" }

/**
 * Controlled variant list: holds the draft row locally and hands the committed
 * variants to its parent. It issues no request — variants travel with the
 * creation call, so nothing here is persisted until the product is submitted.
 */
export function FormulaireVariantes({
  value,
  onChange,
}: {
  value: VarianteSaisie[]
  onChange: (variantes: VarianteSaisie[]) => void
}) {
  const [nom, setNom] = useState("")
  const [attributs, setAttributs] = useState<PaireAttribut[]>([PAIRE_VIDE])
  const [prix, setPrix] = useState("")
  const [plancher, setPlancher] = useState("")
  const [codeBarres, setCodeBarres] = useState("")
  const [erreur, setErreur] = useState<string | null>(null)

  const ajouter = () => {
    if (!nom.trim()) {
      setErreur("Donnez un nom à la variante")
      return
    }
    const attributes: Record<string, string> = {}
    for (const { cle, valeur } of attributs) {
      if (cle.trim() && valeur.trim()) attributes[cle.trim()] = valeur.trim()
    }
    if (Object.keys(attributes).length === 0) {
      // Without an attribute the API generates the same SKU as the implicit
      // "Standard" variant and refuses the whole creation.
      setErreur("Renseignez au moins un attribut (ex. taille, couleur)")
      return
    }
    const variante: VarianteSaisie = { name: nom.trim(), attributes }
    if (prix) variante.priceOverride = Number(prix)
    if (plancher) variante.minPriceOverride = Number(plancher)
    if (codeBarres.trim()) variante.barcode = codeBarres.trim()

    onChange([...value, variante])
    setNom("")
    setAttributs([PAIRE_VIDE])
    setPrix("")
    setPlancher("")
    setCodeBarres("")
    setErreur(null)
  }

  return (
    <div className="flex flex-col gap-3">
      {value.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-md border">
          {value.map((variante, index) => (
            <li
              key={`${variante.name}-${index}`}
              className="flex items-center justify-between gap-2 px-2 py-1.5"
            >
              <span className="text-xs">
                {variante.name}{" "}
                <span className="text-muted-foreground">
                  ·{" "}
                  {Object.entries(variante.attributes)
                    .map(([cle, valeur]) => `${cle} : ${valeur}`)
                    .join(", ")}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Retirer la variante ${variante.name}`}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                Retirer
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="v-nom">Nom (ex : M / Rouge)</Label>
        <Input
          id="v-nom"
          aria-label="Nom de la variante"
          value={nom}
          onChange={(e) => setNom(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Attributs</Label>
        {attributs.map((paire, index) => (
          <div key={index} className="flex gap-2">
            <Input
              aria-label={`Attribut ${index + 1} — nom`}
              placeholder="taille"
              value={paire.cle}
              onChange={(e) =>
                setAttributs(
                  attributs.map((item, i) =>
                    i === index ? { ...item, cle: e.target.value } : item
                  )
                )
              }
            />
            <Input
              aria-label={`Attribut ${index + 1} — valeur`}
              placeholder="M"
              value={paire.valeur}
              onChange={(e) =>
                setAttributs(
                  attributs.map((item, i) =>
                    i === index ? { ...item, valeur: e.target.value } : item
                  )
                )
              }
            />
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => setAttributs([...attributs, PAIRE_VIDE])}
        >
          Ajouter un attribut
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="v-prix">Prix (optionnel)</Label>
          <Input
            id="v-prix"
            type="number"
            min={1}
            step={1}
            aria-label="Prix de la variante"
            value={prix}
            onChange={(e) => setPrix(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="v-plancher">Plancher (optionnel)</Label>
          <Input
            id="v-plancher"
            type="number"
            min={1}
            step={1}
            aria-label="Prix plancher de la variante"
            value={plancher}
            onChange={(e) => setPlancher(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="v-barcode">Code-barres (optionnel)</Label>
          <Input
            id="v-barcode"
            autoComplete="off"
            spellCheck={false}
            aria-label="Code-barres de la variante"
            value={codeBarres}
            onChange={(e) => setCodeBarres(e.target.value)}
          />
        </div>
      </div>

      {erreur && (
        <p role="alert" className="text-xs text-destructive">
          {erreur}
        </p>
      )}

      <Button
        type="button"
        variant="outline"
        className="w-fit"
        onClick={ajouter}
      >
        Ajouter la variante
      </Button>
    </div>
  )
}
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `bun run --cwd apps/web test -- formulaire-variantes`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/produit/formulaire-variantes.tsx \
        apps/web/src/components/produit/formulaire-variantes.test.tsx
git commit -m "feat(web): formulaire de variantes contrôlé, sans appel réseau"
```

---

### Task 5: Page de création et retrait du modal

**Files:**

- Create: `apps/web/src/routes/_app/catalogue/produits/nouveau.tsx`
- Create: `apps/web/src/routes/_app/catalogue/produits/nouveau.test.tsx`
- Modify: `apps/web/src/routes/_app/catalogue/produits/index.tsx`

**Interfaces:**

- Consumes : `ChampImage` (Tâche 3), `FormulaireVariantes` et `VarianteSaisie` (Tâche 4), `POST /api/v1/products` en multipart (Tâches 1-2), `validerRechercheProduits` (`apps/web/src/lib/recherche-produits.ts`), `usePeutEcrire` (`apps/web/src/lib/permissions.ts`).
- Produces : route `/catalogue/produits/nouveau`.

- [ ] **Step 1: Écrire le test de la page qui échoue**

Créer `apps/web/src/routes/_app/catalogue/produits/nouveau.test.tsx`. Le test cible la construction du `FormData`, seul point que les composants ne couvrent pas :

```tsx
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { FormulaireCreationProduit } from "@/routes/_app/catalogue/produits/nouveau"
import { apiFetch } from "@/lib/api"

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(() => Promise.resolve({ id: "p1", sku: "PRD-0001" })),
  apiUrl: (chemin: string) => chemin,
}))

afterEach(() => vi.clearAllMocks())

function monter(surSucces = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <FormulaireCreationProduit categories={[]} surSucces={surSucces} />
    </QueryClientProvider>
  )
}

/** Reads back the JSON part the form submitted. */
function donneesEnvoyees(): Record<string, unknown> {
  const appel = vi.mocked(apiFetch).mock.calls[0]
  const corps = (appel?.[1] as { body: FormData }).body
  return JSON.parse(corps.get("donnees") as string) as Record<string, unknown>
}

describe("FormulaireCreationProduit", () => {
  it("envoie un multipart contenant les champs saisis", async () => {
    const surSucces = vi.fn()
    monter(surSucces)

    fireEvent.change(screen.getByLabelText("Nom"), {
      target: { value: "Marteau" },
    })
    fireEvent.change(screen.getByLabelText("Prix de vente"), {
      target: { value: "12000" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Créer le produit" }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    expect(donneesEnvoyees()).toEqual({ name: "Marteau", price: 12000 })
    await waitFor(() => expect(surSucces).toHaveBeenCalledWith("p1"))
  })

  it("joint les variantes saisies à la partie donnees", async () => {
    monter()

    fireEvent.change(screen.getByLabelText("Nom"), {
      target: { value: "Câble" },
    })
    fireEvent.change(screen.getByLabelText("Prix de vente"), {
      target: { value: "1500" },
    })
    fireEvent.click(
      screen.getByRole("button", { name: "Ce produit se décline" })
    )
    fireEvent.change(screen.getByLabelText("Nom de la variante"), {
      target: { value: "1.5 mm²" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — nom"), {
      target: { value: "section" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — valeur"), {
      target: { value: "1.5" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la variante" }))
    fireEvent.click(screen.getByRole("button", { name: "Créer le produit" }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    expect(donneesEnvoyees()).toMatchObject({
      variants: [{ name: "1.5 mm²", attributes: { section: "1.5" } }],
    })
  })

  it("affiche l'erreur de l'API sans vider la saisie", async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(
      new Error("Ce nom est déjà utilisé")
    )
    monter()

    fireEvent.change(screen.getByLabelText("Nom"), {
      target: { value: "Doublon" },
    })
    fireEvent.change(screen.getByLabelText("Prix de vente"), {
      target: { value: "500" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Créer le produit" }))

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Ce nom est déjà utilisé"
      )
    )
    expect(screen.getByLabelText<HTMLInputElement>("Nom").value).toBe("Doublon")
  })
})
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `bun run --cwd apps/web test -- nouveau`
Expected: FAIL, import non résolu.

- [ ] **Step 3: Écrire la page**

Créer `apps/web/src/routes/_app/catalogue/produits/nouveau.tsx`. La page exporte `FormulaireCreationProduit` séparément pour être testable sans routeur.

```tsx
import { useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { usePeutEcrire } from "@/lib/permissions"
import { validerRechercheProduits } from "@/lib/recherche-produits"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { ChampImage } from "@/components/produit/champ-image"
import { FormulaireVariantes } from "@/components/produit/formulaire-variantes"
import type { VarianteSaisie } from "@/components/produit/formulaire-variantes"

export const Route = createFileRoute("/_app/catalogue/produits/nouveau")({
  // The list's filters ride along so that Cancel returns to the exact view.
  validateSearch: validerRechercheProduits,
  component: NouveauProduitPage,
})

type Categorie = { id: string; name: string }

function NouveauProduitPage() {
  const navigate = useNavigate()
  const peutEcrire = usePeutEcrire()
  const { q, categorie, page } = Route.useSearch()
  const retour = {
    to: "/catalogue/produits",
    search: { q, categorie, page },
  } as const

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<{ categories: Categorie[] }>("/api/v1/categories"),
  })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="mb-2 w-fit"
          onClick={() => void navigate(retour)}
        >
          ← Produits
        </Button>
        <h1 className="text-xl font-semibold">Nouveau produit</h1>
      </div>
      {peutEcrire ? (
        <FormulaireCreationProduit
          categories={categories.data?.categories ?? []}
          surSucces={(productId) =>
            void navigate({
              to: "/catalogue/produits/$productId",
              params: { productId },
            })
          }
          surAnnulation={() => void navigate(retour)}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          Vous n'avez pas le droit de créer un produit.
        </p>
      )}
    </div>
  )
}

/**
 * Creation form, exported on its own so it can be tested without a router.
 * Everything is held locally and submitted as a single multipart call: nothing
 * is created until the user validates.
 */
export function FormulaireCreationProduit({
  categories,
  surSucces,
  surAnnulation,
}: {
  categories: Categorie[]
  surSucces: (productId: string) => void
  surAnnulation?: () => void
}) {
  const queryClient = useQueryClient()
  const [nom, setNom] = useState("")
  const [description, setDescription] = useState("")
  const [categorieId, setCategorieId] = useState("")
  const [codeBarres, setCodeBarres] = useState("")
  const [prix, setPrix] = useState("")
  const [plancher, setPlancher] = useState("")
  const [seuilAlerte, setSeuilAlerte] = useState("")
  const [suiviLots, setSuiviLots] = useState(false)
  const [image, setImage] = useState<File | null>(null)
  const [variantes, setVariantes] = useState<VarianteSaisie[]>([])
  const [blocVariantes, setBlocVariantes] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const idsCategories = categories.map((c) => c.id)
  const nomCategorie = (id: string) =>
    categories.find((c) => c.id === id)?.name ?? id

  const creer = useMutation({
    mutationFn: () => {
      const donnees: Record<string, unknown> = {
        name: nom,
        price: Number(prix),
      }
      if (description) donnees.description = description
      if (categorieId) donnees.categoryId = categorieId
      if (codeBarres) donnees.barcode = codeBarres
      if (plancher) donnees.minPrice = Number(plancher)
      if (seuilAlerte) donnees.defaultMinStock = Number(seuilAlerte)
      if (suiviLots) donnees.trackLots = true
      if (variantes.length > 0) donnees.variants = variantes

      const corps = new FormData()
      corps.append("donnees", JSON.stringify(donnees))
      if (image) corps.append("image", image)
      // No content-type header: the browser sets the multipart boundary.
      return apiFetch<{ id: string; sku: string }>("/api/v1/products", {
        method: "POST",
        body: corps,
      })
    },
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ["products"] })
      surSucces(res.id)
    },
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <form
      className="flex max-w-2xl flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        setErreur(null)
        creer.mutate()
      }}
    >
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Identité</h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-nom">Nom</Label>
          <Input
            id="p-nom"
            required
            autoComplete="off"
            value={nom}
            onChange={(e) => setNom(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-description">Description (optionnel)</Label>
          <Textarea
            id="p-description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-categorie">Catégorie</Label>
          <Combobox
            items={idsCategories}
            itemToStringLabel={nomCategorie}
            autoHighlight
            value={categorieId || null}
            onValueChange={(valeur) => setCategorieId(valeur ?? "")}
          >
            <ComboboxInput
              id="p-categorie"
              placeholder="— aucune —"
              showClear
              className="w-full"
            />
            <ComboboxContent>
              <ComboboxEmpty>Aucune catégorie trouvée</ComboboxEmpty>
              <ComboboxList>
                {(id: string) => (
                  <ComboboxItem key={id} value={id}>
                    {nomCategorie(id)}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-barcode">Code-barres (optionnel)</Label>
          <Input
            id="p-barcode"
            autoComplete="off"
            spellCheck={false}
            value={codeBarres}
            onChange={(e) => setCodeBarres(e.target.value)}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Prix</h2>
        <div className="flex gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="p-prix">Prix de vente</Label>
            <Input
              id="p-prix"
              type="number"
              min={1}
              step={1}
              required
              value={prix}
              onChange={(e) => setPrix(e.target.value)}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="p-plancher">Prix plancher (optionnel)</Label>
            <Input
              id="p-plancher"
              type="number"
              min={1}
              step={1}
              value={plancher}
              onChange={(e) => setPlancher(e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Stock</h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-seuil-alerte">
            Seuil d'alerte par défaut (optionnel)
          </Label>
          <Input
            id="p-seuil-alerte"
            type="number"
            min={0}
            step={1}
            value={seuilAlerte}
            onChange={(e) => setSeuilAlerte(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Alerte quand le stock d'un entrepôt passe sous ce seuil —
            surchargeable par entrepôt.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="p-suivi-lots"
            checked={suiviLots}
            onCheckedChange={(valeur) => setSuiviLots(valeur === true)}
          />
          <Label htmlFor="p-suivi-lots">Suivre les lots (péremption)</Label>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">
          Image{" "}
          <span className="font-normal text-muted-foreground">
            (facultatif)
          </span>
        </h2>
        <ChampImage value={image} onChange={setImage} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">
          Variantes{" "}
          <span className="font-normal text-muted-foreground">
            (facultatif)
          </span>
        </h2>
        {blocVariantes ? (
          <FormulaireVariantes value={variantes} onChange={setVariantes} />
        ) : (
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => setBlocVariantes(true)}
          >
            Ce produit se décline
          </Button>
        )}
      </section>

      {erreur && (
        <p role="alert" className="text-sm text-destructive">
          {erreur}
        </p>
      )}

      <div className="flex gap-2">
        {surAnnulation && (
          <Button type="button" variant="outline" onClick={surAnnulation}>
            Annuler
          </Button>
        )}
        <Button type="submit" disabled={creer.isPending}>
          {creer.isPending ? "Création…" : "Créer le produit"}
        </Button>
      </div>
    </form>
  )
}
```

- [ ] **Step 4: Lancer le test et vérifier qu'il passe**

Run: `bun run --cwd apps/web test -- nouveau`
Expected: PASS, 3/3.

- [ ] **Step 5: Retirer le modal de la liste et faire naviguer le bouton**

Dans `apps/web/src/routes/_app/catalogue/produits/index.tsx` :

1. Supprimer l'état de création : `dialogOuvert`, `nom`, `prix`, `plancher`, `seuilAlerte`, `categorieProduit`, `codeBarres`, `description`, `suiviLots`, `erreur`, ainsi que la mutation `creer`.
2. Remplacer tout le bloc `<Dialog open={dialogOuvert} …>…</Dialog>` par un lien-bouton :

```tsx
{
  peutEcrire && (
    <Button
      onClick={() =>
        void navigate({
          to: "/catalogue/produits/nouveau",
          search: {
            q: q || undefined,
            categorie: categorie || undefined,
            page: page > 1 ? page : undefined,
          },
        })
      }
    >
      Nouveau produit
    </Button>
  )
}
```

3. Dans l'`EtatVide`, remplacer `onClick={() => setDialogOuvert(true)}` par la même navigation.
4. Retirer les imports devenus inutilisés : `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogTrigger`, `Textarea`, `Checkbox`, `useMutation`, `useQueryClient` — **vérifier chaque import** avec le lint plutôt que de les supprimer de mémoire.

- [ ] **Step 6: Régénérer l'arbre de routes et vérifier**

Run: `bun run --cwd apps/web build`
Expected: PASS. La construction régénère `routeTree.gen.ts` avec la nouvelle route. **Ne jamais éditer ce fichier à la main.**

- [ ] **Step 7: Vérifier typecheck, lint et suite web**

Run: `bun run typecheck && bun run lint && bun run --cwd apps/web test`
Expected: PASS partout. Le lint signale les imports orphelins laissés en Step 5.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/routes/_app/catalogue/produits/nouveau.tsx \
        apps/web/src/routes/_app/catalogue/produits/nouveau.test.tsx \
        apps/web/src/routes/_app/catalogue/produits/index.tsx \
        apps/web/src/routeTree.gen.ts
git commit -m "feat(web): page de création de produit en remplacement du modal"
```

---

### Task 6: Vérification navigateur et revue de branche

**Files:** aucun fichier de production. Correctifs éventuels dans les fichiers des Tâches 1-5.

- [ ] **Step 1: Démarrer les deux serveurs**

```bash
bun run --cwd apps/api dev    # http://localhost:8787
bun run --cwd apps/web dev    # http://localhost:3000
```

- [ ] **Step 2: Parcours propriétaire complet**

Se connecter avec `owner@exemple.com` / `OwnerLocal!2026`, puis vérifier, en notant chaque écart :

1. Depuis `/catalogue/produits`, filtrer sur un terme, cliquer « Nouveau produit » → l'URL porte les filtres ; « Annuler » revient à la liste **filtrée**.
2. Créer un produit simple avec une image → redirection vers la fiche, image affichée, `hasVariants` faux.
3. Créer un produit avec deux variantes et une image → la fiche montre les deux variantes ; la variante « Standard » n'apparaît pas dans la liste des variantes actives.
4. Provoquer un échec : reprendre le nom d'un produit existant → message d'erreur affiché, **saisie conservée**, et aucun produit créé (vérifier la liste).
5. Choisir une image de plus de 2 Mo → refus côté client, sans requête réseau (onglet Réseau vide).

- [ ] **Step 3: Vérifier qu'aucun objet R2 orphelin ne subsiste après un échec**

```bash
cd apps/api && bunx wrangler r2 object list pos-stocks-images --local
```

Expected: seules les clés des produits réellement créés. Une clé sans produit correspondant signale un défaut de nettoyage.

- [ ] **Step 4: Vérifier la non-régression du script d'import**

Le script appelle `POST /api/v1/products` en JSON puis téléverse l'image séparément.

**Si `scripts/import-produits-supabase/` n'existe pas encore** (l'import n'est pas mergé au moment de l'exécution), la couverture repose entièrement sur le test « la voie application/json reste inchangée » de la Tâche 1 : le vérifier vert et passer à l'étape suivante.

**S'il existe**, lancer son dry-run contre l'API locale :

```bash
bun run --cwd scripts/import-produits-supabase run.ts --dry-run
```

Expected: aucun échec de création. Consulter `scripts/import-produits-supabase/README.md` si la commande diffère.

- [ ] **Step 5: Suites complètes**

Run: `bun run typecheck && bun run lint && bun run --cwd apps/web test && CI=1 bun run --cwd apps/api test`
Expected: PASS partout.

- [ ] **Step 6: Revue de branche puis PR**

Lancer la revue CodeRabbit sur la branche, corriger le fondé en une vague unique, écarter le reste en citant le motif, puis relancer la revue jusqu'à zéro constat :

```bash
coderabbit review --agent -t committed --base main
```

Ouvrir la PR, attendre CI verte, et **ne merger que sur feu vert explicite de l'utilisateur** (merge commit, jamais de squash).

- [ ] **Step 7: Consigner au ledger**

Ajouter l'entrée du lot à `.superpowers/sdd/progress.md` (fichier suivi malgré le `.gitignore` racine : `git add -f`), en documentant les arbitrages, les écarts et les différés.

---

## Self-Review

**Couverture de la spec.** Chaque section trouve sa tâche : les deux formats et l'atomicité (Tâche 1), les variantes et la convergence des chemins (Tâche 2), l'image côté web (Tâche 3), les variantes côté web (Tâche 4), la page et le retrait du modal (Tâche 5), la vérification navigateur (Tâche 6). Le bloc « Stock » séparé est traité en Tâche 5, Step 3. La non-régression de l'import est verrouillée par un test en Tâche 1 et rejouée en Tâche 6.

**Point tranché ici, laissé ouvert par la spec.** Le message de `BARCODE_EXISTANT` **nomme la variante fautive dans son `message`**, sans `details` structuré : `apiFetch` remonte déjà `message` tel quel aux écrans, un champ supplémentaire n'aurait aucun consommateur.

**Deux cas découverts en écrivant le plan, absents de la spec, couverts par des tests :**

- deux variantes aux attributs distincts peuvent produire le **même SKU** (`{teinte: "Rouge"}` et `{couleur: "Rouge"}` donnent tous deux le suffixe `-ROUGE`) → 409 `SKU_EXISTANT` définitif, jamais une régénération ;
- une variante **sans attribut** génère le suffixe `-STD` et entre en collision avec la variante implicite → refusée côté API et côté formulaire.

**Cohérence des types.** `VarianteSaisie` (Tâche 4) correspond à `variantCreateSchema` moins `sku` ; la page sérialise ce tableau tel quel dans `donnees.variants`, que `productCreateMultipartSchema` valide (Tâche 2). `ChampImage` et `FormulaireVariantes` exposent le même contrat `value` / `onChange` et sont consommés sous ces noms en Tâche 5.
