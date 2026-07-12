# Phase 4 — Moteur de stock : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Archive (2026-07-12)** : phase exécutée intégralement via subagent-driven-development — le suivi d'exécution fait foi dans `.superpowers/sdd/progress.md` (ledger Phase 4) ; les cases de ce document ne sont volontairement pas cochées individuellement.

**Goal:** Le stock entre, se consulte et s'audite : journal immuable `stock_movements` + niveaux matérialisés `stock_levels` (avec coût moyen pondéré et seuils d'alerte), écrits exclusivement par `stockService.applyMovements` dans un `db.batch()` D1 atomique protégé contre le stock négatif ; réceptions fournisseur (brouillon → validée, création/réutilisation de lots, CMP), ajustements manuels tracés, alertes stock bas, commande de réconciliation admin, et écrans web `/stock` (niveaux, journal filtrable, réceptions).

**Architecture:** Une nouvelle couche service (`apps/api/src/services/stock.ts`) est le SEUL point d'écriture du stock : elle construit un `db.batch()` D1 (une transaction SQLite) contenant les instructions du document appelant + les insertions de mouvements + les upserts de niveaux. La garde anti-stock-négatif atomique est une contrainte `CHECK (quantity >= 0)` sur `stock_levels` : une violation fait échouer le statement, donc D1 annule le batch entier — le journal et les niveaux ne divergent jamais. Le CMP est recalculé côté SQL dans le même upsert (les expressions `SET` d'un UPDATE SQLite lisent les valeurs d'AVANT modification). L'immuabilité des réceptions validées et l'append-only du journal sont verrouillés par des triggers SQLite (`RAISE(ABORT, …)`) posés en migration custom, qui font aussi échouer atomiquement les batchs concurrents (double validation). Les écritures par entrepôt utilisent `requireWarehouseRole` (première utilisation réelle) et son cœur extrait `verifierAccesEntrepot` pour les routes dont l'entrepôt vient du document plutôt que du chemin. Les Tasks 1 et 2 soldent d'abord la dette Phase 3 ; l'unicité des codes-barres (index partiels org-scopés + vérification croisée applicative) fait partie du schéma de cette phase.

**Tech Stack:** existant (Hono 4, Better Auth, Drizzle ORM 0.44 / drizzle-kit 0.31, D1, vitest-pool-workers 0.12, React/Vite/TanStack Router + Query, shadcn base-mira sur @base-ui/react, Tailwind 4). Aucune dépendance nouvelle.

## Global Constraints

- Interface, messages d'erreur et commentaires en **français** ; enveloppe d'erreur `{ code: "MAJUSCULES", message: "français", details? }`. Nouveaux codes de cette phase : `STOCK_INSUFFISANT` (409), `BARCODE_EXISTANT` (409), `RECEPTION_VALIDEE` (409, document validé immuable), `STATUT_INVALIDE` (409, transition interdite — ici : re-valider une réception déjà validée), `LOT_REQUIS` (400). Codes réutilisés : `VALIDATION`, `INTROUVABLE`, `ACCES_REFUSE`, `LOTS_NON_SUIVIS`, `LOT_EXISTANT`. Le motif obligatoire des ajustements passe par Zod (`VALIDATION` 400 avec message « Le motif est requis ») — pas de code `MOTIF_REQUIS` séparé.
- **Toute opération métier = UN SEUL `db.batch()` D1** : document + mouvements + niveaux réussissent ou échouent ensemble. Batch hétérogène = tableau construit **directement** (littéral ou spread), jamais de push + cast.
- `stock_movements` est **append-only** : aucune route UPDATE/DELETE dessus (et des triggers SQLite le verrouillent en base).
- Montants en **entiers XOF** (0 décimale), formatés côté web via `formaterMontant` (`apps/web/src/lib/format.ts`) ; le CMP est arrondi à l'entier à chaque mise à jour.
- IDs texte via `crypto.randomUUID()` ; horodatages UTC ; toutes les tables métier portent `organizationId` ; ressource hors organisation → `404 INTROUVABLE` ; entrepôt hors organisation via middleware → `403 ACCES_REFUSE` (comportement Phase 2 conservé).
- **Matrice de permissions stock (spec §4)** : écriture (réceptions, ajustements, seuils) = `owner`/`admin`/`stock_manager` partout + rôle local `manager` sur SES entrepôts (première utilisation réelle de `requireWarehouseRole`). Lecture (niveaux, journal, alertes, réceptions) = `owner`/`admin`/`auditor`/`stock_manager` partout + rôles locaux `manager`/`auditor` sur leurs entrepôts. Le rôle local `cashier` n'a PAS accès au back-office stock (le POS Phase 6 aura ses propres routes). Réconciliation = `owner`/`admin` uniquement.
- Tests API sur D1 réelle (`@cloudflare/vitest-pool-workers`) pour chaque tâche : cas de succès, matrice de permissions (caissier 403, auditeur d'entrepôt lecture seule, cross-org 404/403), garde anti-négatif, atomicité (échec d'une ligne = rien n'est écrit). Dans les tests, typer les corps avec `res.json<T>()` (pas de cast `as`).
- **Le schéma Better Auth est GÉNÉRÉ** (`src/db/schema/auth.ts`) : ne pas y toucher. Les tables de cette phase vivent dans `src/db/schema/stock.ts`.
- drizzle-kit : les index/triggers custom restent **HORS des snapshots** (`drizzle/meta/*.json`) — les y reporter à la main génère un `DROP INDEX` au prochain `db:generate`. Les migrations custom se créent via `bunx drizzle-kit generate --custom --name=…` (même motif que `0002_member_user_unique.sql`).
- Pièges eslint du dépôt : `no-unnecessary-condition` (pas d'optional-chain sur un type non nullable — annoter explicitement `| null` les retours de helpers indexés), `import/consistent-type-specifier-style` (imports de types dans un `import type` séparé), `no-irregular-whitespace` (pas d'espaces insécables dans le code ni dans les littéraux — utiliser l'échappement `\u00A0` en chaîne si besoin).
- base-ui Dialog : **PAS** de `asChild` → `<DialogTrigger render={<Button />}>libellé</DialogTrigger>`.
- `apps/web/src/routeTree.gen.ts` n'est **jamais** édité ni formaté à la main (il se régénère au `bun run dev`/`build` du web).
- Gestionnaire de paquets : bun. Commits fréquents, messages conventionnels en français, hooks husky actifs (pas de `--no-verify`). Branche de travail : `feat/phase-4-moteur-de-stock`.

**Prérequis exécutant** : dépôt sur `main` à jour (Phases 1-3 mergées), `bun install` fait, suite verte (`bun run --cwd apps/api test` : 71 tests ; `bun run --cwd apps/web test` : 12 tests). Créer la branche :

```bash
git checkout -b feat/phase-4-moteur-de-stock
```

**État de départ (fin Phase 3)** — ce qui existe déjà et que cette phase consomme :

- API : middlewares `requireAuth` (`src/middleware/require-auth.ts`), `requireMembership`/`requireRole`/`requireWarehouseRole` + type `PermissionVariables` (`src/middleware/permissions.ts` — `requireWarehouseRole` lit `c.req.param("warehouseId")`, garde anti-cross-tenant AVANT le bypass `owner`/`admin`/`stock_manager`, n'est branché sur aucune route) ; `validerCorps` (`src/lib/validation.ts`) ; `estViolationUnicite` (`src/lib/db-errors.ts`) ; tables `warehouses`, `warehouse_members` (`src/db/schema/domain.ts`), `categories`, `suppliers`, `products` (avec `barcode`, `defaultMinStock`, `trackLots`), `product_variants` (avec `organizationId` et `barcode`), `lots` (index unique `lots_variant_lot_uidx` sur `(variant_id, lot_number)`) (`src/db/schema/catalog.ts`).
- Tests : helpers `bootstrapOwner()` → `{ organizationId, ownerId, ownerCookie }` et `createUserWithRole(organizationId, role)` → `{ userId, email, cookie }` (`test/helpers.ts`) ; migrations appliquées automatiquement via `TEST_MIGRATIONS` (`vitest.config.ts`).
- Web : layout `_app` avec contexte `me: Me` (`me.membership.role`, `me.assignments: Array<{ warehouseId, warehouseName, role }>`), `apiFetch`/`apiUrl` (`src/lib/api.ts`), `formaterMontant` (`src/lib/format.ts`), composants `src/components/ui/*` (Badge a un variant `destructive`).
- Migrations D1 : `0000` à `0003` (la prochaine générée sera `0004`).

---

### Task 1: Prep API — dette Phase 3 côté API et schémas partagés

Solde la dette API du ledger : helpers org-scopés partagés, échappement LIKE `%`/`_`, `supplierUpdateSchema` nullable (vider contact/téléphone), filtre `actifs=false`, statut relayé dans le retry setup, garde « baisse de price vs minPriceOverride des variantes », et course `DERNIERE_VARIANTE` rendue atomique (UPDATE gardé — coût raisonnable, on la traite).

**Files:**
- Create: `apps/api/src/lib/org-scope.ts`
- Create: `apps/api/src/lib/recherche.ts`
- Create: `apps/api/test/phase4-prep.test.ts`
- Modify: `packages/shared/src/schemas/catalog.ts` (supplierUpdateSchema)
- Modify: `apps/api/src/routes/products.ts`
- Modify: `apps/api/src/routes/variants.ts` (réécriture complète)
- Modify: `apps/api/src/routes/categories.ts`
- Modify: `apps/api/src/routes/setup.ts` (422 au lieu de 409 codé en dur)
- Modify: `apps/api/test/setup.test.ts`

**Interfaces:**
- Produces: `apps/api/src/lib/org-scope.ts` — `produitScope(db, organizationId, id): Promise<typeof schema.products.$inferSelect | null>`, `varianteScope(db, organizationId, id): Promise<typeof schema.productVariants.$inferSelect | null>`, `categorieExiste(db, organizationId, id): Promise<boolean>`, `fournisseurExiste(db, organizationId, id): Promise<boolean>` (avec `db: DrizzleD1Database<typeof schema>`). Consommés par les Tasks 7, 8, 9.
- Produces: `apps/api/src/lib/recherche.ts` — `likeEchappe(colonne: AnySQLiteColumn, terme: string): SQL` (LIKE avec `%`/`_`/`\` échappés). Consommé par la Task 6.
- Produces: `PATCH /api/v1/suppliers/:id` accepte `contact: null` / `phone: null` (efface le champ).

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `apps/api/test/phase4-prep.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import app from "../src/index"
import { bootstrapOwner } from "./helpers"

function postJson(cookie: string, url: string, body: unknown) {
  return app.request(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

function patchJson(cookie: string, url: string, body: unknown) {
  return app.request(
    url,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

describe("prep Phase 4 — dette Phase 3 API", () => {
  it("la recherche produit traite % et _ comme des caractères littéraux", async () => {
    const { ownerCookie } = await bootstrapOwner()
    expect(
      (
        await postJson(ownerCookie, "/api/v1/products", {
          name: "Sirop 100%",
          price: 500,
        })
      ).status
    ).toBe(201)
    expect(
      (
        await postJson(ownerCookie, "/api/v1/products", {
          name: "Sirop 100L",
          price: 600,
        })
      ).status
    ).toBe(201)

    const params = new URLSearchParams({ recherche: "100%" })
    const res = await app.request(
      `/api/v1/products?${params.toString()}`,
      { headers: { cookie: ownerCookie } },
      env
    )
    const { products } = await res.json<{ products: Array<{ name: string }> }>()
    expect(products.map((p) => p.name)).toEqual(["Sirop 100%"])
  })

  it("le filtre actifs=false renvoie uniquement les produits inactifs", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const creation = await postJson(ownerCookie, "/api/v1/products", {
      name: "Produit retiré",
      price: 100,
    })
    const { id } = await creation.json<{ id: string }>()
    await patchJson(ownerCookie, `/api/v1/products/${id}`, { isActive: false })
    await postJson(ownerCookie, "/api/v1/products", {
      name: "Produit vivant",
      price: 100,
    })

    const res = await app.request(
      "/api/v1/products?actifs=false",
      { headers: { cookie: ownerCookie } },
      env
    )
    const { products } = await res.json<{ products: Array<{ name: string }> }>()
    expect(products.map((p) => p.name)).toEqual(["Produit retiré"])
  })

  it("baisser le prix produit sous le plancher d'une variante héritière est refusé", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const creation = await postJson(ownerCookie, "/api/v1/products", {
      name: "Chemise",
      price: 5000,
    })
    const { id } = await creation.json<{ id: string }>()
    // Variante sans priceOverride : elle hérite du prix produit,
    // mais avec un plancher propre de 4000.
    expect(
      (
        await postJson(ownerCookie, `/api/v1/products/${id}/variants`, {
          name: "Taille M",
          attributes: { taille: "M" },
          minPriceOverride: 4000,
        })
      ).status
    ).toBe(201)

    const baisse = await patchJson(ownerCookie, `/api/v1/products/${id}`, {
      price: 3000,
    })
    expect(baisse.status).toBe(400)
    expect((await baisse.json<{ code: string }>()).code).toBe("VALIDATION")

    // Une baisse qui reste au-dessus du plancher passe.
    expect(
      (await patchJson(ownerCookie, `/api/v1/products/${id}`, { price: 4500 }))
        .status
    ).toBe(200)
  })

  it("PATCH fournisseur accepte contact: null pour effacer le champ", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const creation = await postJson(ownerCookie, "/api/v1/suppliers", {
      name: "Sodeci",
      contact: "M. Kouassi",
      phone: "+225 07 00 00 00 01",
    })
    const { id } = await creation.json<{ id: string }>()

    expect(
      (
        await patchJson(ownerCookie, `/api/v1/suppliers/${id}`, {
          contact: null,
          phone: null,
        })
      ).status
    ).toBe(200)

    const liste = await app.request(
      "/api/v1/suppliers",
      { headers: { cookie: ownerCookie } },
      env
    )
    const { suppliers } = await liste.json<{
      suppliers: Array<{ contact: string | null; phone: string | null }>
    }>()
    expect(suppliers[0]?.contact).toBeNull()
    expect(suppliers[0]?.phone).toBeNull()
  })
})
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `bun run --cwd apps/api test test/phase4-prep.test.ts`
Expected: FAIL — recherche `100%` renvoie 2 produits, `actifs=false` renvoie 2 produits, la baisse de prix renvoie 200, le PATCH `contact: null` renvoie 400 (VALIDATION).

- [ ] **Step 3: Créer les helpers partagés**

Créer `apps/api/src/lib/org-scope.ts` :

```ts
import { and, eq } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import * as schema from "../db/schema"

// Helpers de lecture scoppés organisation : tout lookup d'une ressource
// catalogue passe par ici pour garantir le 404 cross-tenant systématique.
// Retours explicitement annotés `| null` : sans l'annotation, TS élide le
// null (indexation de tableau) et eslint no-unnecessary-condition se
// déclenche chez les appelants (même piège que membershipCible dans users.ts).

type Db = DrizzleD1Database<typeof schema>

export async function produitScope(
  db: Db,
  organizationId: string,
  id: string
): Promise<typeof schema.products.$inferSelect | null> {
  const rows = await db
    .select()
    .from(schema.products)
    .where(
      and(
        eq(schema.products.id, id),
        eq(schema.products.organizationId, organizationId)
      )
    )
    .limit(1)
  return rows[0] ?? null
}

export async function varianteScope(
  db: Db,
  organizationId: string,
  id: string
): Promise<typeof schema.productVariants.$inferSelect | null> {
  const rows = await db
    .select()
    .from(schema.productVariants)
    .where(
      and(
        eq(schema.productVariants.id, id),
        eq(schema.productVariants.organizationId, organizationId)
      )
    )
    .limit(1)
  return rows[0] ?? null
}

export async function categorieExiste(
  db: Db,
  organizationId: string,
  id: string
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.categories.id })
    .from(schema.categories)
    .where(
      and(
        eq(schema.categories.id, id),
        eq(schema.categories.organizationId, organizationId)
      )
    )
    .limit(1)
  return rows.length > 0
}

export async function fournisseurExiste(
  db: Db,
  organizationId: string,
  id: string
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.suppliers.id })
    .from(schema.suppliers)
    .where(
      and(
        eq(schema.suppliers.id, id),
        eq(schema.suppliers.organizationId, organizationId)
      )
    )
    .limit(1)
  return rows.length > 0
}
```

Créer `apps/api/src/lib/recherche.ts` :

```ts
import { sql } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core"

// LIKE « littéral » : les métacaractères % et _ (et l'échappement \ lui-même)
// saisis par l'utilisateur sont neutralisés, sinon rechercher « 100% » ou
// « A_B » agit comme un joker SQL.
export function likeEchappe(colonne: AnySQLiteColumn, terme: string): SQL {
  const motif = `%${terme.replace(/[\\%_]/g, (car) => `\\${car}`)}%`
  return sql`${colonne} LIKE ${motif} ESCAPE '\\'`
}
```

- [ ] **Step 4: Rendre contact/phone effaçables dans supplierUpdateSchema**

Dans `packages/shared/src/schemas/catalog.ts`, remplacer :

```ts
export const supplierUpdateSchema = supplierCreateSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Aucun champ à modifier",
  })
```

par :

```ts
// Objet explicite (et non .partial() du create) : contact et phone doivent
// accepter null pour pouvoir être VIDÉS via PATCH.
export const supplierUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "Le nom est requis").optional(),
    contact: z.string().trim().min(1).nullable().optional(),
    phone: z.string().trim().min(1).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Aucun champ à modifier",
  })
```

- [ ] **Step 5: Refondre products.ts (helpers partagés, LIKE échappé, actifs=false, garde plancher variantes)**

Dans `apps/api/src/routes/products.ts` :

5a. Remplacer le bloc d'imports drizzle et lib (lignes 2-12) par :

```ts
import { drizzle } from "drizzle-orm/d1"
import { and, asc, eq, gt, inArray, isNull, or } from "drizzle-orm"
import {
  productCreateSchema,
  productUpdateSchema,
  variantCreateSchema,
} from "shared"
import * as schema from "../db/schema"
import { validerCorps } from "../lib/validation"
import { estViolationUnicite } from "../lib/db-errors"
import { genererSkuProduit, genererSkuVariante } from "../lib/sku"
import { categorieExiste, produitScope } from "../lib/org-scope"
import { likeEchappe } from "../lib/recherche"
```

5b. Supprimer entièrement la fonction locale `categorieValide` (lignes 25-42).

5c. Remplacer le handler `GET /` complet par :

```ts
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

  const produits = await db
    .select()
    .from(schema.products)
    .where(and(...conditions))
    .orderBy(asc(schema.products.name))
  const idsProduits = produits.map((p) => p.id)
  // inArray([]) génère un SQL invalide : garde explicite (même motif que
  // GET /:id) — évite aussi de charger les variantes de tout l'org.
  const variantes =
    idsProduits.length > 0
      ? await db
          .select()
          .from(schema.productVariants)
          .where(
            and(
              eq(schema.productVariants.organizationId, organizationId),
              inArray(schema.productVariants.productId, idsProduits)
            )
          )
      : []
  const products = produits.map((p) => ({
    ...p,
    variants: variantes.filter((v) => v.productId === p.id),
  }))
  return c.json({ products })
})
```

5d. Dans `GET /:id`, remplacer le lookup produit (le `db.select()...limit(1)` + test `produits.length === 0` + `const produit = produits[0]`) par :

```ts
  const produit = await produitScope(db, organizationId, c.req.param("id"))
  if (!produit) {
    return c.json({ code: "INTROUVABLE", message: "Produit introuvable" }, 404)
  }
```

5e. Dans `POST /`, remplacer l'appel `categorieValide(c.env, organizationId, corps.data.categoryId)` par `categorieExiste(db, organizationId, corps.data.categoryId)` (le `db` est déjà instancié juste au-dessus — déplacer la ligne `const db = drizzle(c.env.DB, { schema })` AVANT le contrôle de catégorie si besoin).

5f. Dans `PATCH /:id`, remplacer le lookup produit inliné par `produitScope` (comme en 5d), remplacer `categorieValide(c.env, …)` par `categorieExiste(db, …)`, puis insérer JUSTE AVANT le `await db.update(schema.products)...` final la garde plancher-variantes :

```ts
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
```

5g. Dans `POST /:id/variants` et `POST /:id/image`, remplacer le lookup produit inliné par `produitScope(db, organizationId, c.req.param("id"))` (comme en 5d ; pour `/image`, `produitScope` renvoie la ligne complète — `produit.imageKey` reste disponible).

- [ ] **Step 6: Réécrire variants.ts (helper partagé + DERNIERE_VARIANTE atomique)**

Remplacer le contenu complet de `apps/api/src/routes/variants.ts` par :

```ts
import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, eq, sql } from "drizzle-orm"
import { variantUpdateSchema, lotCreateSchema } from "shared"
import * as schema from "../db/schema"
import { validerCorps } from "../lib/validation"
import { estViolationUnicite } from "../lib/db-errors"
import { varianteScope } from "../lib/org-scope"
import { requireAuth } from "../middleware/require-auth"
import { requireMembership, requireRole } from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import type { Env } from "../env"

export const variantsRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

variantsRoute.use(
  requireAuth,
  requireMembership,
  requireRole("owner", "admin", "stock_manager")
)

variantsRoute.patch("/:id", async (c) => {
  const corps = await validerCorps(c, variantUpdateSchema)
  if (!corps.ok) return corps.reponse
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const variante = await varianteScope(db, organizationId, c.req.param("id"))
  if (!variante) {
    return c.json({ code: "INTROUVABLE", message: "Variante introuvable" }, 404)
  }
  const produits = await db
    .select({
      price: schema.products.price,
      isActive: schema.products.isActive,
    })
    .from(schema.products)
    .where(eq(schema.products.id, variante.productId))
    .limit(1)
  if (produits.length === 0) {
    return c.json({ code: "INTROUVABLE", message: "Produit introuvable" }, 404)
  }
  const produit = produits[0]

  const prixEffectif =
    (corps.data.priceOverride !== undefined
      ? corps.data.priceOverride
      : variante.priceOverride) ?? produit.price
  const plancher =
    corps.data.minPriceOverride !== undefined
      ? corps.data.minPriceOverride
      : variante.minPriceOverride
  if (plancher !== null && plancher > prixEffectif) {
    return c.json(
      {
        code: "VALIDATION",
        message:
          "Le prix plancher doit être inférieur ou égal au prix de vente",
      },
      400
    )
  }

  const desactivation =
    corps.data.isActive === false && variante.isActive && produit.isActive
  if (desactivation) {
    // Garde atomique anti-course : la condition « il reste au moins une autre
    // variante active » est vérifiée DANS le même UPDATE. Deux désactivations
    // concurrentes ne peuvent plus laisser un produit actif sans variante
    // (l'ancien pré-comptage séparé laissait une fenêtre).
    const result = await db
      .update(schema.productVariants)
      .set(corps.data)
      .where(
        and(
          eq(schema.productVariants.id, variante.id),
          sql`EXISTS (SELECT 1 FROM product_variants autre
            WHERE autre.product_id = ${variante.productId}
              AND autre.is_active = 1
              AND autre.id <> ${variante.id})`
        )
      )
      .returning({ id: schema.productVariants.id })
    if (result.length === 0) {
      return c.json(
        {
          code: "DERNIERE_VARIANTE",
          message:
            "Impossible de désactiver la dernière variante active d'un produit actif",
        },
        409
      )
    }
    return c.json({ ok: true })
  }

  await db
    .update(schema.productVariants)
    .set(corps.data)
    .where(eq(schema.productVariants.id, variante.id))
  return c.json({ ok: true })
})

variantsRoute.post("/:id/lots", async (c) => {
  const corps = await validerCorps(c, lotCreateSchema)
  if (!corps.ok) return corps.reponse
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const variante = await varianteScope(db, organizationId, c.req.param("id"))
  if (!variante) {
    return c.json({ code: "INTROUVABLE", message: "Variante introuvable" }, 404)
  }
  const produits = await db
    .select({ trackLots: schema.products.trackLots })
    .from(schema.products)
    .where(eq(schema.products.id, variante.productId))
    .limit(1)
  if (produits[0]?.trackLots !== true) {
    return c.json(
      {
        code: "LOTS_NON_SUIVIS",
        message: "Le suivi par lots n'est pas activé pour ce produit",
      },
      400
    )
  }
  const id = crypto.randomUUID()
  try {
    await db.insert(schema.lots).values({
      id,
      organizationId,
      variantId: variante.id,
      lotNumber: corps.data.lotNumber,
      expiryDate: corps.data.expiryDate
        ? new Date(corps.data.expiryDate)
        : null,
      createdAt: new Date(),
    })
  } catch (err) {
    if (estViolationUnicite(err)) {
      return c.json(
        {
          code: "LOT_EXISTANT",
          message: "Ce numéro de lot existe déjà pour cette variante",
        },
        409
      )
    }
    throw err
  }
  return c.json({ id }, 201)
})
```

- [ ] **Step 7: Brancher categorieExiste partagé dans categories.ts et relayer le statut dans setup.ts**

Dans `apps/api/src/routes/categories.ts` :
- Supprimer la fonction locale `categorieExiste` (lignes 19-36).
- Ajouter l'import : `import { categorieExiste } from "../lib/org-scope"`.
- Dans `POST /` : déplacer `const db = drizzle(c.env.DB, { schema })` AVANT le contrôle de parent, et remplacer `categorieExiste(c.env, organizationId, corps.data.parentId)` par `categorieExiste(db, organizationId, corps.data.parentId)`.
- Dans `PATCH /:id` : idem — instancier `db` avant les contrôles et passer `db` au lieu de `c.env` (la fonction `parentCreeraitUnCycle`, elle, garde sa signature `env` : hors périmètre de la dette).

Dans `apps/api/src/routes/setup.ts`, remplacer le retour du pré-contrôle `emailExistant` :

```ts
  if (emailExistant.length > 0) {
    return c.json(
      {
        code: "CREATION_UTILISATEUR",
        message: "Impossible de créer le compte utilisateur",
      },
      409
    )
  }
```

par :

```ts
  if (emailExistant.length > 0) {
    // 422 : même statut que l'APIError USER_ALREADY_EXISTS de Better Auth
    // (relayé via err.statusCode plus bas) — le pré-contrôle ne doit pas
    // inventer un statut différent du chemin d'erreur qu'il court-circuite.
    return c.json(
      {
        code: "CREATION_UTILISATEUR",
        message: "Impossible de créer le compte utilisateur",
      },
      422
    )
  }
```

Dans `apps/api/test/setup.test.ts`, dans le test « retry orphelin », remplacer `expect(retry.status).not.toBe(500)` par `expect(retry.status).toBe(422)`.

- [ ] **Step 8: Vérifier que tout passe**

Run: `bun run --cwd apps/api test`
Expected: PASS — les 4 nouveaux tests de `phase4-prep.test.ts` et toute la suite existante (75 tests au total), 0 échec.

Run: `bun run typecheck && bun run lint`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add apps/api packages/shared
git commit -m "refactor: helpers org-scopés partagés, LIKE échappé et dette catalogue Phase 3"
```

---

### Task 2: Prep Web — hook usePeutEcrire, décomposition de la fiche produit, dette d'affichage

Solde la dette web du ledger : hook `usePeutEcrire` partagé, décomposition de `$productId.tsx` (685 lignes) en sous-composants, `alt` des miniatures, badge « Expiré » en jours calendaires (plus de comparaison UTC vs instant local), cache-bust des miniatures de la liste après upload d'image.

**Files:**
- Create: `apps/web/src/lib/permissions.ts`
- Create: `apps/web/src/lib/dates.ts`
- Create: `apps/web/src/lib/dates.test.ts`
- Create: `apps/web/src/components/produit/types.ts`
- Create: `apps/web/src/components/produit/section-image.tsx`
- Create: `apps/web/src/components/produit/section-infos.tsx`
- Create: `apps/web/src/components/produit/section-variantes.tsx`
- Create: `apps/web/src/components/produit/section-lots.tsx`
- Modify: `apps/web/src/routes/_app/catalogue/produits/$productId.tsx` (réécriture complète, ~70 lignes)
- Modify: `apps/web/src/routes/_app/catalogue/produits/index.tsx`
- Modify: `apps/web/src/routes/_app/catalogue/fournisseurs.tsx`
- Modify: `apps/web/src/routes/_app/catalogue/categories.tsx`

**Interfaces:**
- Produces: `usePeutEcrire(): boolean` (`apps/web/src/lib/permissions.ts`) — vrai pour `owner`/`admin`/`stock_manager`. La Task 11 ajoutera `useAccesStock` dans ce même fichier.
- Produces: `estDateExpiree(expiryDate: string | null): boolean` (`apps/web/src/lib/dates.ts`).
- Consumes: contexte route `me: Me` du layout `/_app` (via `useRouteContext({ from: "/_app" })`).

- [ ] **Step 1: Test du helper de dates (échoue : module absent)**

Créer `apps/web/src/lib/dates.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { estDateExpiree } from "./dates"

describe("estDateExpiree", () => {
  it("null n'est jamais expiré", () => {
    expect(estDateExpiree(null)).toBe(false)
  })

  it("une date passée est expirée, aujourd'hui et le futur ne le sont pas", () => {
    const aujourdHui = new Date().toLocaleDateString("fr-CA")
    expect(estDateExpiree("2020-01-01T00:00:00.000Z")).toBe(true)
    expect(estDateExpiree(`${aujourdHui}T00:00:00.000Z`)).toBe(false)
    expect(estDateExpiree("2099-12-31T00:00:00.000Z")).toBe(false)
  })
})
```

Run: `bun run --cwd apps/web test`
Expected: FAIL — `./dates` introuvable.

- [ ] **Step 2: Créer les helpers web**

Créer `apps/web/src/lib/dates.ts` :

```ts
// Une date de péremption (AAAA-MM-JJ stocké à minuit UTC) est expirée
// STRICTEMENT avant le jour local courant : on compare des jours
// calendaires, pas des instants — le fuseau de l'utilisateur ne doit pas
// faire basculer le badge autour de minuit (l'ancien code comparait
// new Date(expiryDate) UTC à l'instant local).
export function estDateExpiree(expiryDate: string | null): boolean {
  if (!expiryDate) return false
  const jourPeremption = expiryDate.slice(0, 10)
  // fr-CA donne le format AAAA-MM-JJ, comparable lexicalement
  const aujourdHui = new Date().toLocaleDateString("fr-CA")
  return jourPeremption < aujourdHui
}
```

Créer `apps/web/src/lib/permissions.ts` :

```ts
import { useRouteContext } from "@tanstack/react-router"

// Rôles d'entreprise autorisés à écrire le catalogue (matrice spec §4).
// Centralisé ici : le trio owner/admin/stock_manager était recopié dans
// chaque écran du catalogue.
export function usePeutEcrire(): boolean {
  const { me } = useRouteContext({ from: "/_app" })
  const role = me.membership?.role
  return role === "owner" || role === "admin" || role === "stock_manager"
}
```

Run: `bun run --cwd apps/web test`
Expected: PASS (les 2 tests de dates + la suite existante).

- [ ] **Step 3: Extraire les types et sous-composants de la fiche produit**

Créer `apps/web/src/components/produit/types.ts` :

```ts
export type Lot = { id: string; lotNumber: string; expiryDate: string | null }

export type Variante = {
  id: string
  name: string
  attributes: string
  sku: string
  barcode: string | null
  priceOverride: number | null
  minPriceOverride: number | null
  isActive: boolean
  lots: Lot[]
}

export type Produit = {
  id: string
  name: string
  description: string | null
  categoryId: string | null
  sku: string
  barcode: string | null
  price: number
  minPrice: number | null
  hasVariants: boolean
  trackLots: boolean
  imageKey: string | null
  isActive: boolean
  variants: Variante[]
}

export function lireAttributs(brut: string): Record<string, string> {
  try {
    return JSON.parse(brut) as Record<string, string>
  } catch {
    return {}
  }
}
```

Créer `apps/web/src/components/produit/section-image.tsx` :

```tsx
import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { apiFetch, apiUrl } from "@/lib/api"
import { Label } from "@/components/ui/label"
import type { Produit } from "./types"

type Props = {
  produit: Produit
  productId: string
  peutEcrire: boolean
  onModifie: () => Promise<unknown>
}

export function SectionImage({ produit, productId, peutEcrire, onModifie }: Props) {
  const [erreurImage, setErreurImage] = useState<string | null>(null)
  const [versionImage, setVersionImage] = useState(0)

  const envoyerImage = useMutation({
    mutationFn: (fichier: File) => {
      const donnees = new FormData()
      donnees.append("image", fichier)
      // pas d'en-tête content-type : le navigateur pose le boundary multipart
      return apiFetch(`/api/v1/products/${productId}/image`, {
        method: "POST",
        body: donnees,
      })
    },
    onSuccess: async () => {
      await onModifie()
      setVersionImage((v) => v + 1)
      setErreurImage(null)
    },
    onError: (err) =>
      // Les messages IMAGE_TROP_LOURDE / FORMAT_IMAGE arrivent déjà en
      // français via apiFetch (body.message)
      setErreurImage(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <section className="mb-8 flex items-start gap-6">
      {produit.imageKey ? (
        <img
          src={`${apiUrl(`/api/v1/files/${produit.imageKey}`)}?v=${versionImage}`}
          alt={produit.name}
          crossOrigin="use-credentials"
          className="h-32 w-32 rounded-md border object-cover"
        />
      ) : (
        <div className="flex h-32 w-32 items-center justify-center rounded-md border bg-gray-50 text-xs text-gray-400">
          Aucune image
        </div>
      )}
      {peutEcrire && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="p-image">Image (JPEG, PNG, WebP — 2 Mo max)</Label>
          <input
            id="p-image"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              // e.target.files est nullable (FileList | null) : l'optional
              // chain est légitime ici pour no-unnecessary-condition
              const fichier = e.target.files?.[0]
              if (fichier) envoyerImage.mutate(fichier)
            }}
            className="text-sm"
          />
          {erreurImage && (
            <p role="alert" className="text-sm text-red-700">
              {erreurImage}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
```

Créer `apps/web/src/components/produit/section-infos.tsx` :

```tsx
import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Produit } from "./types"

type Categorie = { id: string; name: string }

type FormulaireProduit = {
  name: string
  description: string
  categoryId: string
  barcode: string
  price: string
  minPrice: string
  isActive: boolean
}

type Props = {
  produit: Produit
  productId: string
  peutEcrire: boolean
  onModifie: () => Promise<unknown>
}

// Monté avec key={produit.id} par la page : l'état initial du formulaire
// est re-semé quand on navigue vers un autre produit.
export function SectionInfos({ produit, productId, peutEcrire, onModifie }: Props) {
  const [form, setForm] = useState<FormulaireProduit>({
    name: produit.name,
    description: produit.description ?? "",
    categoryId: produit.categoryId ?? "",
    barcode: produit.barcode ?? "",
    price: String(produit.price),
    minPrice: produit.minPrice === null ? "" : String(produit.minPrice),
    isActive: produit.isActive,
  })
  const [message, setMessage] = useState<string | null>(null)

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<{ categories: Categorie[] }>("/api/v1/categories"),
  })

  const enregistrer = useMutation({
    mutationFn: (values: FormulaireProduit) =>
      apiFetch(`/api/v1/products/${productId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          description: values.description || undefined,
          categoryId: values.categoryId || undefined,
          barcode: values.barcode || undefined,
          price: Number(values.price),
          minPrice: values.minPrice ? Number(values.minPrice) : undefined,
          isActive: values.isActive,
        }),
      }),
    onSuccess: async () => {
      await onModifie()
      setMessage("Produit enregistré")
    },
    onError: (err) => setMessage(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-base font-semibold">Informations</h2>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          setMessage(null)
          enregistrer.mutate(form)
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-nom">Nom</Label>
          <Input
            id="f-nom"
            required
            disabled={!peutEcrire}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="flex gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="f-prix">Prix de vente</Label>
            <Input
              id="f-prix"
              type="number"
              min={1}
              step={1}
              required
              disabled={!peutEcrire}
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="f-plancher">Prix plancher</Label>
            <Input
              id="f-plancher"
              type="number"
              min={1}
              step={1}
              disabled={!peutEcrire}
              value={form.minPrice}
              onChange={(e) => setForm({ ...form, minPrice: e.target.value })}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-categorie">Catégorie</Label>
          <select
            id="f-categorie"
            disabled={!peutEcrire}
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            className="h-10 rounded-md border px-2 text-sm"
          >
            <option value="">— aucune —</option>
            {(categories.data?.categories ?? []).map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-barcode">Code-barres</Label>
          <Input
            id="f-barcode"
            disabled={!peutEcrire}
            value={form.barcode}
            onChange={(e) => setForm({ ...form, barcode: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-description">Description</Label>
          <textarea
            id="f-description"
            rows={2}
            disabled={!peutEcrire}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="rounded-md border px-3 py-2 text-sm"
          />
        </div>
        {peutEcrire && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            Produit actif
          </label>
        )}
        {message && (
          <p role="status" className="text-sm font-medium text-gray-700">
            {message}
          </p>
        )}
        {peutEcrire && (
          <Button type="submit" disabled={enregistrer.isPending}>
            {enregistrer.isPending ? "Enregistrement…" : "Enregistrer"}
          </Button>
        )}
      </form>
    </section>
  )
}
```

Créer `apps/web/src/components/produit/section-variantes.tsx` :

```tsx
import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { formaterMontant } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { lireAttributs } from "./types"
import type { Produit, Variante } from "./types"

type Props = {
  produit: Produit
  productId: string
  peutEcrire: boolean
  devise: string
  onModifie: () => Promise<unknown>
}

export function SectionVariantes({
  produit,
  productId,
  peutEcrire,
  devise,
  onModifie,
}: Props) {
  const [dialogVariante, setDialogVariante] = useState(false)
  const [nomVariante, setNomVariante] = useState("")
  const [attributs, setAttributs] = useState<
    Array<{ cle: string; valeur: string }>
  >([{ cle: "", valeur: "" }])
  const [prixVariante, setPrixVariante] = useState("")
  const [plancherVariante, setPlancherVariante] = useState("")
  const [codeBarresVariante, setCodeBarresVariante] = useState("")
  const [erreurVariante, setErreurVariante] = useState<string | null>(null)

  const ajouterVariante = useMutation({
    mutationFn: () => {
      const attributes: Record<string, string> = {}
      for (const { cle, valeur } of attributs) {
        if (cle.trim() && valeur.trim()) {
          attributes[cle.trim()] = valeur.trim()
        }
      }
      return apiFetch(`/api/v1/products/${productId}/variants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: nomVariante,
          attributes,
          barcode: codeBarresVariante || undefined,
          priceOverride: prixVariante ? Number(prixVariante) : undefined,
          minPriceOverride: plancherVariante
            ? Number(plancherVariante)
            : undefined,
        }),
      })
    },
    onSuccess: async () => {
      await onModifie()
      setDialogVariante(false)
      setNomVariante("")
      setAttributs([{ cle: "", valeur: "" }])
      setPrixVariante("")
      setPlancherVariante("")
      setCodeBarresVariante("")
      setErreurVariante(null)
    },
    onError: (err) =>
      setErreurVariante(err instanceof Error ? err.message : "Erreur"),
  })

  const basculerVariante = useMutation({
    mutationFn: (v: Variante) =>
      apiFetch(`/api/v1/variants/${v.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !v.isActive }),
      }),
    onSuccess: onModifie,
    onError: (err) => alert(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">Variantes</h2>
        {peutEcrire && (
          <Dialog open={dialogVariante} onOpenChange={setDialogVariante}>
            <DialogTrigger render={<Button variant="outline" size="sm" />}>
              Ajouter une variante
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nouvelle variante</DialogTitle>
              </DialogHeader>
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  setErreurVariante(null)
                  ajouterVariante.mutate()
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="v-nom">Nom (ex : M / Rouge)</Label>
                  <Input
                    id="v-nom"
                    required
                    value={nomVariante}
                    onChange={(e) => setNomVariante(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Attributs</Label>
                  {attributs.map((a, index) => (
                    <div key={index} className="flex gap-2">
                      <Input
                        aria-label={`Clé de l'attribut ${index + 1}`}
                        placeholder="taille"
                        value={a.cle}
                        onChange={(e) =>
                          setAttributs(
                            attributs.map((item, i) =>
                              i === index
                                ? { ...item, cle: e.target.value }
                                : item
                            )
                          )
                        }
                      />
                      <Input
                        aria-label={`Valeur de l'attribut ${index + 1}`}
                        placeholder="M"
                        value={a.valeur}
                        onChange={(e) =>
                          setAttributs(
                            attributs.map((item, i) =>
                              i === index
                                ? { ...item, valeur: e.target.value }
                                : item
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
                    onClick={() =>
                      setAttributs([...attributs, { cle: "", valeur: "" }])
                    }
                  >
                    Ajouter un attribut
                  </Button>
                </div>
                <div className="flex gap-3">
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor="v-prix">Prix (optionnel)</Label>
                    <Input
                      id="v-prix"
                      type="number"
                      min={1}
                      step={1}
                      value={prixVariante}
                      onChange={(e) => setPrixVariante(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor="v-plancher">Plancher (optionnel)</Label>
                    <Input
                      id="v-plancher"
                      type="number"
                      min={1}
                      step={1}
                      value={plancherVariante}
                      onChange={(e) => setPlancherVariante(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="v-barcode">Code-barres (optionnel)</Label>
                  <Input
                    id="v-barcode"
                    value={codeBarresVariante}
                    onChange={(e) => setCodeBarresVariante(e.target.value)}
                  />
                </div>
                {erreurVariante && (
                  <p role="alert" className="text-sm text-red-700">
                    {erreurVariante}
                  </p>
                )}
                <Button type="submit" disabled={ajouterVariante.isPending}>
                  {ajouterVariante.isPending ? "Ajout…" : "Ajouter"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nom</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead>Attributs</TableHead>
            <TableHead>Prix</TableHead>
            <TableHead>Statut</TableHead>
            {peutEcrire && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {produit.variants.map((v) => (
            <TableRow key={v.id}>
              <TableCell className="font-medium">{v.name}</TableCell>
              <TableCell className="font-mono text-xs">{v.sku}</TableCell>
              <TableCell className="text-sm">
                {Object.entries(lireAttributs(v.attributes))
                  .map(([cle, valeur]) => `${cle} : ${valeur}`)
                  .join(", ") || "—"}
              </TableCell>
              <TableCell>
                {formaterMontant(v.priceOverride ?? produit.price, devise)}
              </TableCell>
              <TableCell>
                <Badge variant={v.isActive ? "default" : "secondary"}>
                  {v.isActive ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              {peutEcrire && (
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => basculerVariante.mutate(v)}
                  >
                    {v.isActive ? "Désactiver" : "Réactiver"}
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  )
}
```

Créer `apps/web/src/components/produit/section-lots.tsx` :

```tsx
import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { estDateExpiree } from "@/lib/dates"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { Produit } from "./types"

type Props = {
  produit: Produit
  peutEcrire: boolean
  onModifie: () => Promise<unknown>
}

export function SectionLots({ produit, peutEcrire, onModifie }: Props) {
  const [dialogLotPour, setDialogLotPour] = useState<string | null>(null)
  const [numeroLot, setNumeroLot] = useState("")
  const [datePeremption, setDatePeremption] = useState("")
  const [erreurLot, setErreurLot] = useState<string | null>(null)

  const ajouterLot = useMutation({
    mutationFn: (variantId: string) =>
      apiFetch(`/api/v1/variants/${variantId}/lots`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lotNumber: numeroLot,
          expiryDate: datePeremption || undefined,
        }),
      }),
    onSuccess: async () => {
      await onModifie()
      setDialogLotPour(null)
      setNumeroLot("")
      setDatePeremption("")
      setErreurLot(null)
    },
    onError: (err) =>
      setErreurLot(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-base font-semibold">Lots</h2>
      {produit.variants
        .filter((v) => v.isActive)
        .map((v) => (
          <div key={v.id} className="mb-4 rounded-md border p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium">{v.name}</p>
              {peutEcrire && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDialogLotPour(v.id)}
                >
                  Ajouter un lot
                </Button>
              )}
            </div>
            {v.lots.length === 0 ? (
              <p className="text-sm text-gray-500">Aucun lot.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {v.lots.map((lot) => (
                  <li key={lot.id} className="flex items-center gap-3 text-sm">
                    <span className="font-mono">{lot.lotNumber}</span>
                    <span className="text-gray-500">
                      {lot.expiryDate
                        ? new Date(lot.expiryDate).toLocaleDateString("fr-FR")
                        : "sans péremption"}
                    </span>
                    {estDateExpiree(lot.expiryDate) && (
                      <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                        Expiré
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

      {dialogLotPour !== null && (
        <Dialog
          open
          onOpenChange={(ouvert) => {
            if (!ouvert) setDialogLotPour(null)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nouveau lot</DialogTitle>
            </DialogHeader>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                setErreurLot(null)
                ajouterLot.mutate(dialogLotPour)
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="l-numero">Numéro de lot</Label>
                <Input
                  id="l-numero"
                  required
                  value={numeroLot}
                  onChange={(e) => setNumeroLot(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="l-peremption">
                  Date de péremption (optionnel)
                </Label>
                <Input
                  id="l-peremption"
                  type="date"
                  value={datePeremption}
                  onChange={(e) => setDatePeremption(e.target.value)}
                />
              </div>
              {erreurLot && (
                <p role="alert" className="text-sm text-red-700">
                  {erreurLot}
                </p>
              )}
              <Button type="submit" disabled={ajouterLot.isPending}>
                {ajouterLot.isPending ? "Ajout…" : "Ajouter le lot"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Réécrire la page fiche produit**

Remplacer le contenu complet de `apps/web/src/routes/_app/catalogue/produits/$productId.tsx` par :

```tsx
import { createFileRoute } from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { usePeutEcrire } from "@/lib/permissions"
import { Badge } from "@/components/ui/badge"
import { SectionImage } from "@/components/produit/section-image"
import { SectionInfos } from "@/components/produit/section-infos"
import { SectionVariantes } from "@/components/produit/section-variantes"
import { SectionLots } from "@/components/produit/section-lots"
import type { Produit } from "@/components/produit/types"

export const Route = createFileRoute("/_app/catalogue/produits/$productId")({
  component: FicheProduitPage,
})

function FicheProduitPage() {
  const { productId } = Route.useParams()
  const peutEcrire = usePeutEcrire()
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: ["product", productId],
    queryFn: () =>
      apiFetch<{ product: Produit }>(`/api/v1/products/${productId}`),
  })
  const organisation = useQuery({
    queryKey: ["organization"],
    queryFn: () => apiFetch<{ currency: string }>("/api/v1/organization"),
  })
  const devise = organisation.data?.currency ?? "XOF"

  const invalider = () =>
    queryClient.invalidateQueries({ queryKey: ["product", productId] })

  if (!data) {
    return <p className="text-sm text-gray-500">Chargement…</p>
  }
  const produit = data.product

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-xl font-semibold">{produit.name}</h1>
        <span className="font-mono text-xs text-gray-500">{produit.sku}</span>
        <Badge variant={produit.isActive ? "default" : "secondary"}>
          {produit.isActive ? "Actif" : "Inactif"}
        </Badge>
      </div>
      <SectionImage
        produit={produit}
        productId={productId}
        peutEcrire={peutEcrire}
        onModifie={invalider}
      />
      <SectionInfos
        key={produit.id}
        produit={produit}
        productId={productId}
        peutEcrire={peutEcrire}
        onModifie={invalider}
      />
      <SectionVariantes
        produit={produit}
        productId={productId}
        peutEcrire={peutEcrire}
        devise={devise}
        onModifie={invalider}
      />
      {produit.trackLots && (
        <SectionLots
          produit={produit}
          peutEcrire={peutEcrire}
          onModifie={invalider}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 5: Dette d'affichage sur la liste produits et les écrans catalogue**

Dans `apps/web/src/routes/_app/catalogue/produits/index.tsx` :

5a. Ajouter `updatedAt` au type local :

```ts
type Produit = {
  id: string
  name: string
  sku: string
  price: number
  imageKey: string | null
  isActive: boolean
  updatedAt: string
  variants: Variante[]
}
```

5b. Remplacer la miniature :

```tsx
                  {p.imageKey ? (
                    <img
                      src={apiUrl(`/api/v1/files/${p.imageKey}`)}
                      alt=""
                      crossOrigin="use-credentials"
                      className="h-10 w-10 rounded object-cover"
                    />
                  ) : (
```

par (alt accessible + cache-bust basé sur updatedAt : après un upload d'image,
`updatedAt` change et la liste recharge la miniature au lieu de servir le
cache navigateur d'une heure) :

```tsx
                  {p.imageKey ? (
                    <img
                      src={`${apiUrl(`/api/v1/files/${p.imageKey}`)}?v=${encodeURIComponent(p.updatedAt)}`}
                      alt={p.name}
                      crossOrigin="use-credentials"
                      className="h-10 w-10 rounded object-cover"
                    />
                  ) : (
```

5c. Remplacer le calcul de rôle :

```ts
  const role = me.membership?.role
  const peutEcrire =
    role === "owner" || role === "admin" || role === "stock_manager"
```

par `const peutEcrire = usePeutEcrire()` avec l'import `import { usePeutEcrire } from "@/lib/permissions"`. Si `me` n'est plus utilisé ailleurs dans le fichier, supprimer aussi `const { me } = Route.useRouteContext()`.

Appliquer exactement le même remplacement 5c dans `apps/web/src/routes/_app/catalogue/fournisseurs.tsx` (lignes 38-41) et `apps/web/src/routes/_app/catalogue/categories.tsx` (lignes 29-33).

- [ ] **Step 6: Vérifier**

Run: `bun run --cwd apps/web test && bun run typecheck && bun run lint`
Expected: exit 0 (14 tests web).

Run: `bun run --cwd apps/web build`
Expected: build OK (le routeTree se régénère seul, ne pas l'éditer).

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "refactor: hook usePeutEcrire, décomposition fiche produit et dette d'affichage catalogue"
```

---

### Task 3: Schéma stock, migrations (index barcode partiels, triggers) et helpers d'erreurs D1

Crée les quatre tables du moteur de stock (`stock_movements`, `stock_levels`, `purchases`, `purchase_items`), la contrainte `CHECK (quantity >= 0)` (garde anti-négatif atomique), la migration custom `stock_guards` (déduplication des codes-barres préexistants + index uniques partiels org-scopés + triggers d'immuabilité), et généralise `db-errors.ts`.

**Files:**
- Create: `apps/api/src/db/schema/stock.ts`
- Modify: `apps/api/src/db/schema/index.ts`
- Create: `apps/api/drizzle/0004_*.sql` (généré par drizzle-kit)
- Create: `apps/api/drizzle/0005_stock_guards.sql` (migration custom)
- Modify: `apps/api/src/lib/db-errors.ts` (réécriture complète)
- Modify: `apps/api/test/helpers.ts` (helpers de seed stock)
- Create: `apps/api/test/stock-guards.test.ts`

**Interfaces:**
- Produces: tables Drizzle `schema.stockMovements`, `schema.stockLevels`, `schema.purchases`, `schema.purchaseItems`, constantes `schema.MOVEMENT_TYPES` (`["purchase","sale","transfer_out","transfer_in","adjustment","count"] as const`) et `schema.PURCHASE_STATUSES` (`["draft","received"] as const`). Consommées par toutes les tasks suivantes.
- Produces: `estViolationUnicite(err: unknown, fragment?: string): boolean` (rétro-compatible : le 2e argument optionnel discrimine l'index violé), `estViolationCheck(err: unknown): boolean`, `estErreurDeclencheur(err: unknown, code: string): boolean` (`src/lib/db-errors.ts`).
- Produces: helpers de test (`test/helpers.ts`) — `creerEntrepot(organizationId, nom?, type?): Promise<string>`, `creerProduitSimple(organizationId, options?): Promise<{ productId: string; variantId: string }>`, `affecterEntrepot(organizationId, userId, warehouseId, role): Promise<void>`.
- Produces: index uniques partiels `products_org_barcode_uidx` et `product_variants_org_barcode_uidx` (`WHERE barcode IS NOT NULL`) ; triggers `purchases_recu_immuable`, `purchase_items_recu_{insert,update,delete}`, `stock_movements_append_only_{update,delete}` — leurs codes `RAISE(ABORT, …)` sont `RECEPTION_VALIDEE` et `JOURNAL_IMMUABLE`.

- [ ] **Step 1: Créer le schéma Drizzle**

Créer `apps/api/src/db/schema/stock.ts` :

```ts
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"
import { organization, user } from "./auth"
import { warehouses } from "./domain"
import { productVariants, lots, suppliers } from "./catalog"

export const MOVEMENT_TYPES = [
  "purchase",
  "sale",
  "transfer_out",
  "transfer_in",
  "adjustment",
  "count",
] as const

export const PURCHASE_STATUSES = ["draft", "received"] as const

// Journal immuable append-only : source de vérité du stock et piste d'audit.
// PAS de onDelete cascade : on ne supprime jamais silencieusement une entité
// référencée par l'audit (et les triggers de 0005_stock_guards bloquent de
// toute façon UPDATE/DELETE sur cette table).
export const stockMovements = sqliteTable(
  "stock_movements",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id),
    lotId: text("lot_id").references(() => lots.id),
    // > 0 entrée, < 0 sortie — jamais 0
    delta: integer("delta").notNull(),
    type: text("type", { enum: MOVEMENT_TYPES }).notNull(),
    // Motif humain (obligatoire pour les ajustements, côté validation Zod)
    reason: text("reason"),
    // Référence au document source, ex. refType "purchase" + refId purchases.id
    refType: text("ref_type"),
    refId: text("ref_id"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("stock_movements_org_wh_date_idx").on(
      t.organizationId,
      t.warehouseId,
      t.createdAt
    ),
    index("stock_movements_variant_idx").on(t.variantId),
  ]
)

// Niveaux matérialisés par (entrepôt, variante), recalculables depuis le
// journal. La contrainte CHECK est LA garde anti-stock-négatif atomique :
// dans un db.batch D1 (une transaction SQLite), une violation fait échouer
// le statement et D1 annule le batch ENTIER — contrairement à un
// `UPDATE … WHERE quantity + ? >= 0` qui « réussit » silencieusement avec
// 0 ligne affectée alors que les mouvements, eux, seraient déjà écrits.
export const stockLevels = sqliteTable(
  "stock_levels",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(0),
    // Coût moyen pondéré (CMP), entier XOF, recalculé à chaque réception
    // validée dans le MÊME batch que les mouvements.
    avgCost: integer("avg_cost").notNull().default(0),
    // Surcharge par entrepôt du seuil d'alerte produit
    // (products.default_min_stock) ; NULL = hériter du produit.
    minStock: integer("min_stock"),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    uniqueIndex("stock_levels_wh_variant_uidx").on(t.warehouseId, t.variantId),
    check("stock_levels_quantity_positive", sql`${t.quantity} >= 0`),
  ]
)

// Réception fournisseur : brouillon modifiable → `received` immuable
// (trigger purchases_recu_immuable).
export const purchases = sqliteTable(
  "purchases",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    supplierId: text("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    status: text("status", { enum: PURCHASE_STATUSES })
      .notNull()
      .default("draft"),
    // Référence libre (n° de bon de livraison fournisseur)
    reference: text("reference"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    receivedBy: text("received_by").references(() => user.id),
    receivedAt: integer("received_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("purchases_org_status_idx").on(t.organizationId, t.status)]
)

export const purchaseItems = sqliteTable(
  "purchase_items",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    purchaseId: text("purchase_id")
      .notNull()
      .references(() => purchases.id, { onDelete: "cascade" }),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id),
    quantity: integer("quantity").notNull(),
    // Coût unitaire d'achat, entier XOF (base du CMP et des marges Phase 7)
    unitCost: integer("unit_cost").notNull(),
    // Saisis à la réception pour les produits trackLots ; le lot n'est créé
    // (ou réutilisé) qu'à la VALIDATION de la réception.
    lotNumber: text("lot_number"),
    expiryDate: integer("expiry_date", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("purchase_items_purchase_idx").on(t.purchaseId)]
)
```

Dans `apps/api/src/db/schema/index.ts`, ajouter la ligne :

```ts
export * from "./stock"
```

- [ ] **Step 2: Générer la migration 0004**

```bash
cd apps/api && bun run db:generate
```

Expected: un fichier `apps/api/drizzle/0004_<nom-aleatoire>.sql` contenant les `CREATE TABLE` de `purchase_items`, `purchases`, `stock_levels`, `stock_movements`, les `CREATE INDEX`/`CREATE UNIQUE INDEX` listés au Step 1, et — IMPORTANT — la contrainte `CONSTRAINT "stock_levels_quantity_positive" CHECK("stock_levels"."quantity" >= 0)` dans le CREATE TABLE de `stock_levels`. Vérifier sa présence :

```bash
grep -n "stock_levels_quantity_positive" drizzle/0004_*.sql
```

Expected: une ligne trouvée. (Si elle manque, la version de drizzle-kit est trop ancienne pour `check()` — STOP, ne pas contourner en éditant le SQL généré à la main : mettre à jour drizzle-kit/drizzle-orm mineurs puis regénérer.)

- [ ] **Step 3: Créer la migration custom stock_guards**

```bash
cd apps/api && bunx drizzle-kit generate --custom --name=stock_guards
```

Expected: `apps/api/drizzle/0005_stock_guards.sql` créé (vide) et une entrée ajoutée dans `drizzle/meta/_journal.json`. Y mettre exactement (RIEN de tout ceci ne doit être reporté dans `drizzle/meta/*.json` — même règle que `0002_member_user_unique.sql`) :

```sql
-- Custom SQL migration file, put your code below! --

-- 1) Déduplication défensive des codes-barres préexistants (la prod est
--    quasi vide, mais la migration doit passer même avec des doublons :
--    la ligne la plus ancienne garde son code-barres, les autres sont vidées).
UPDATE products SET barcode = NULL
WHERE barcode IS NOT NULL
  AND rowid NOT IN (
    SELECT MIN(rowid) FROM products
    WHERE barcode IS NOT NULL
    GROUP BY organization_id, barcode
  );--> statement-breakpoint
UPDATE product_variants SET barcode = NULL
WHERE barcode IS NOT NULL
  AND rowid NOT IN (
    SELECT MIN(rowid) FROM product_variants
    WHERE barcode IS NOT NULL
    GROUP BY organization_id, barcode
  );--> statement-breakpoint
-- Doublons croisés produits/variantes : le produit gagne, la variante est vidée.
UPDATE product_variants SET barcode = NULL
WHERE barcode IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM products p
    WHERE p.organization_id = product_variants.organization_id
      AND p.barcode = product_variants.barcode
  );--> statement-breakpoint

-- 2) Unicité des codes-barres PAR ORGANISATION, dans chaque table
--    (index partiels : plusieurs NULL restent permis). L'unicité CROISÉE
--    produits/variantes est vérifiée côté applicatif (lib/barcode.ts,
--    Task 4) : SQLite ne sait pas poser un index unique inter-tables.
CREATE UNIQUE INDEX IF NOT EXISTS products_org_barcode_uidx
  ON products(organization_id, barcode) WHERE barcode IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS product_variants_org_barcode_uidx
  ON product_variants(organization_id, barcode) WHERE barcode IS NOT NULL;--> statement-breakpoint

-- 3) Immuabilité d'une réception validée. Le RAISE(ABORT) annule le
--    STATEMENT ET SA TRANSACTION (donc tout db.batch en cours) : c'est ce
--    qui rend la double validation concurrente atomiquement impossible —
--    le batch de la seconde validation échoue en entier, mouvements compris.
CREATE TRIGGER IF NOT EXISTS purchases_recu_immuable
BEFORE UPDATE ON purchases
WHEN old.status = 'received'
BEGIN
  SELECT RAISE(ABORT, 'RECEPTION_VALIDEE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS purchase_items_recu_insert
BEFORE INSERT ON purchase_items
WHEN (SELECT status FROM purchases WHERE id = new.purchase_id) = 'received'
BEGIN
  SELECT RAISE(ABORT, 'RECEPTION_VALIDEE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS purchase_items_recu_update
BEFORE UPDATE ON purchase_items
WHEN (SELECT status FROM purchases WHERE id = old.purchase_id) = 'received'
BEGIN
  SELECT RAISE(ABORT, 'RECEPTION_VALIDEE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS purchase_items_recu_delete
BEFORE DELETE ON purchase_items
WHEN (SELECT status FROM purchases WHERE id = old.purchase_id) = 'received'
BEGIN
  SELECT RAISE(ABORT, 'RECEPTION_VALIDEE');
END;--> statement-breakpoint

-- 4) Journal append-only, verrouillé en base (aucune route ne fait
--    d'UPDATE/DELETE dessus, ceci est la ceinture ET les bretelles).
--    Effet assumé : la suppression d'une entité référencée par le journal
--    (entrepôt, variante, lot…) échouera — la piste d'audit prime, et
--    aucune route de suppression de ces entités n'existe en v1.
CREATE TRIGGER IF NOT EXISTS stock_movements_append_only_update
BEFORE UPDATE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'JOURNAL_IMMUABLE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS stock_movements_append_only_delete
BEFORE DELETE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'JOURNAL_IMMUABLE');
END;
```

- [ ] **Step 4: Généraliser db-errors.ts**

Remplacer le contenu complet de `apps/api/src/lib/db-errors.ts` par :

```ts
// D1 n'expose pas de code d'erreur structuré : la détection par texte est le
// seul moyen fiable. De plus, Drizzle enveloppe l'erreur D1 dans une
// DrizzleQueryError dont le message top-level ("Failed query: ...") ne
// contient pas le texte SQLite : il faut remonter la chaîne `cause`.
function messageDansCauses(err: unknown, fragment: string): boolean {
  let current: unknown = err
  let profondeur = 0
  // Plafond défensif : une chaîne `cause` cyclique ou pathologiquement
  // profonde ne doit pas bloquer le worker.
  while (current instanceof Error && profondeur < 10) {
    if (current.message.includes(fragment)) {
      return true
    }
    current = current.cause
    profondeur += 1
  }
  return false
}

// `fragment` optionnel : nom d'index ou de colonne, pour discriminer QUELLE
// contrainte unique a sauté (ex. estViolationUnicite(err, "barcode") vs SKU).
export function estViolationUnicite(err: unknown, fragment?: string): boolean {
  if (!messageDansCauses(err, "UNIQUE constraint failed")) {
    return false
  }
  return fragment ? messageDansCauses(err, fragment) : true
}

// Contrainte CHECK violée (ex. stock_levels_quantity_positive : la garde
// anti-stock-négatif du service de stock).
export function estViolationCheck(err: unknown): boolean {
  return messageDansCauses(err, "CHECK constraint failed")
}

// RAISE(ABORT, code) émis par un trigger de 0005_stock_guards
// (RECEPTION_VALIDEE, JOURNAL_IMMUABLE).
export function estErreurDeclencheur(err: unknown, code: string): boolean {
  return messageDansCauses(err, code)
}
```

- [ ] **Step 5: Ajouter les helpers de seed aux tests**

À la fin de `apps/api/test/helpers.ts`, ajouter (et compléter l'import de types existant : `import type { CompanyRole, WarehouseRole } from "shared"`) :

```ts
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
```

- [ ] **Step 6: Tests des gardes en base**

Créer `apps/api/test/stock-guards.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
import * as schema from "../src/db/schema"
import {
  estViolationCheck,
  estViolationUnicite,
  estErreurDeclencheur,
} from "../src/lib/db-errors"
import { bootstrapOwner, creerEntrepot, creerProduitSimple } from "./helpers"

describe("gardes du moteur de stock (migrations 0004/0005)", () => {
  it("CHECK : un niveau de stock négatif est rejeté", async () => {
    const { organizationId } = await bootstrapOwner()
    const warehouseId = await creerEntrepot(organizationId)
    const { variantId } = await creerProduitSimple(organizationId)
    const db = drizzle(env.DB, { schema })
    let erreur: unknown = null
    try {
      await db.insert(schema.stockLevels).values({
        id: crypto.randomUUID(),
        organizationId,
        warehouseId,
        variantId,
        quantity: -1,
        avgCost: 0,
        updatedAt: new Date(),
      })
    } catch (err) {
      erreur = err
    }
    expect(estViolationCheck(erreur)).toBe(true)
  })

  it("triggers : le journal refuse UPDATE et DELETE", async () => {
    const { organizationId, ownerId } = await bootstrapOwner()
    const warehouseId = await creerEntrepot(organizationId)
    const { variantId } = await creerProduitSimple(organizationId)
    const db = drizzle(env.DB, { schema })
    const movementId = crypto.randomUUID()
    await db.insert(schema.stockMovements).values({
      id: movementId,
      organizationId,
      warehouseId,
      variantId,
      delta: 5,
      type: "adjustment",
      reason: "seed",
      userId: ownerId,
      createdAt: new Date(),
    })

    let erreurUpdate: unknown = null
    try {
      await db
        .update(schema.stockMovements)
        .set({ delta: 999 })
        .where(eq(schema.stockMovements.id, movementId))
    } catch (err) {
      erreurUpdate = err
    }
    expect(estErreurDeclencheur(erreurUpdate, "JOURNAL_IMMUABLE")).toBe(true)

    let erreurDelete: unknown = null
    try {
      await db
        .delete(schema.stockMovements)
        .where(eq(schema.stockMovements.id, movementId))
    } catch (err) {
      erreurDelete = err
    }
    expect(estErreurDeclencheur(erreurDelete, "JOURNAL_IMMUABLE")).toBe(true)
  })

  it("index partiels : le même code-barres est refusé dans products, accepté après NULL", async () => {
    const { organizationId } = await bootstrapOwner()
    await creerProduitSimple(organizationId, { barcode: "6111000000001" })
    let erreur: unknown = null
    try {
      await creerProduitSimple(organizationId, { barcode: "6111000000001" })
    } catch (err) {
      erreur = err
    }
    expect(estViolationUnicite(erreur, "barcode")).toBe(true)
    // Plusieurs barcode NULL cohabitent (index partiel)
    await creerProduitSimple(organizationId, { barcode: null })
    await creerProduitSimple(organizationId, { barcode: null })
  })
})
```

- [ ] **Step 7: Vérifier**

Run: `bun run --cwd apps/api test test/stock-guards.test.ts`
Expected: PASS — 3 tests (les migrations 0004/0005 sont chargées automatiquement par `readD1Migrations`).

Run: `bun run --cwd apps/api test && bun run typecheck && bun run lint`
Expected: exit 0, aucune régression.

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat: schéma du moteur de stock, unicité barcode et triggers d'immuabilité"
```

---

### Task 4: Unicité des codes-barres — vérification croisée applicative (BARCODE_EXISTANT)

Les index partiels (Task 3) garantissent l'unicité DANS chaque table ; cette task ajoute la vérification croisée produits ↔ variantes à l'écriture et l'erreur `BARCODE_EXISTANT` (409) partout où un code-barres s'écrit : `POST /products`, `PATCH /products/:id`, `POST /products/:id/variants`, `PATCH /variants/:id`. Un scan POS résoudra toujours vers un seul article.

**Files:**
- Create: `apps/api/src/lib/barcode.ts`
- Create: `apps/api/test/barcodes.test.ts`
- Modify: `apps/api/src/routes/products.ts`
- Modify: `apps/api/src/routes/variants.ts`

**Interfaces:**
- Consumes: `estViolationUnicite(err, "barcode")` (Task 3).
- Produces: `barcodeDejaUtilise(db, organizationId, barcode, exclure?: { produitId?: string; varianteId?: string }): Promise<boolean>` (`src/lib/barcode.ts`) — vérifie `products` ET `product_variants`.
- Produces: réponse `409 { code: "BARCODE_EXISTANT", message: "Ce code-barres est déjà utilisé" }` sur les 4 routes d'écriture.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `apps/api/test/barcodes.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import app from "../src/index"
import { bootstrapOwner } from "./helpers"

function postJson(cookie: string, url: string, body: unknown) {
  return app.request(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

function patchJson(cookie: string, url: string, body: unknown) {
  return app.request(
    url,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

async function creerProduit(cookie: string, body: Record<string, unknown>) {
  const res = await postJson(cookie, "/api/v1/products", {
    price: 1000,
    ...body,
  })
  expect(res.status).toBe(201)
  return res.json<{ id: string; sku: string }>()
}

describe("unicité des codes-barres par organisation", () => {
  it("produit vs produit : 409 BARCODE_EXISTANT", async () => {
    const { ownerCookie } = await bootstrapOwner()
    await creerProduit(ownerCookie, { name: "Coca 50cl", barcode: "123456" })
    const doublon = await postJson(ownerCookie, "/api/v1/products", {
      name: "Fanta 50cl",
      price: 1000,
      barcode: "123456",
    })
    expect(doublon.status).toBe(409)
    expect((await doublon.json<{ code: string }>()).code).toBe(
      "BARCODE_EXISTANT"
    )
  })

  it("croisé : une variante ne peut pas prendre le code-barres d'un produit, ni l'inverse", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const produitA = await creerProduit(ownerCookie, {
      name: "Coca 50cl",
      barcode: "111111",
    })
    const produitB = await creerProduit(ownerCookie, { name: "Chemise" })

    // variante qui vise le barcode du produit A → refus
    const varianteDoublon = await postJson(
      ownerCookie,
      `/api/v1/products/${produitB.id}/variants`,
      { name: "Taille M", attributes: { taille: "M" }, barcode: "111111" }
    )
    expect(varianteDoublon.status).toBe(409)
    expect((await varianteDoublon.json<{ code: string }>()).code).toBe(
      "BARCODE_EXISTANT"
    )

    // variante avec son propre barcode → OK
    const variante = await postJson(
      ownerCookie,
      `/api/v1/products/${produitB.id}/variants`,
      { name: "Taille L", attributes: { taille: "L" }, barcode: "222222" }
    )
    expect(variante.status).toBe(201)

    // produit qui vise le barcode de la variante → refus
    const produitDoublon = await postJson(ownerCookie, "/api/v1/products", {
      name: "Sprite",
      price: 500,
      barcode: "222222",
    })
    expect(produitDoublon.status).toBe(409)
    expect((await produitDoublon.json<{ code: string }>()).code).toBe(
      "BARCODE_EXISTANT"
    )
  })

  it("PATCH : reposter son PROPRE code-barres passe, prendre celui d'un autre échoue", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const produitA = await creerProduit(ownerCookie, {
      name: "Coca",
      barcode: "333333",
    })
    await creerProduit(ownerCookie, { name: "Fanta", barcode: "444444" })

    expect(
      (
        await patchJson(ownerCookie, `/api/v1/products/${produitA.id}`, {
          barcode: "333333",
        })
      ).status
    ).toBe(200)

    const vol = await patchJson(ownerCookie, `/api/v1/products/${produitA.id}`, {
      barcode: "444444",
    })
    expect(vol.status).toBe(409)
    expect((await vol.json<{ code: string }>()).code).toBe("BARCODE_EXISTANT")
  })

  it("PATCH variante : même règle", async () => {
    const { ownerCookie } = await bootstrapOwner()
    await creerProduit(ownerCookie, { name: "Coca", barcode: "555555" })
    const produit = await creerProduit(ownerCookie, { name: "Chemise" })
    const creation = await postJson(
      ownerCookie,
      `/api/v1/products/${produit.id}/variants`,
      { name: "Taille M", attributes: { taille: "M" } }
    )
    const { id: varianteId } = await creation.json<{ id: string }>()

    const vol = await patchJson(ownerCookie, `/api/v1/variants/${varianteId}`, {
      barcode: "555555",
    })
    expect(vol.status).toBe(409)
    expect((await vol.json<{ code: string }>()).code).toBe("BARCODE_EXISTANT")

    expect(
      (
        await patchJson(ownerCookie, `/api/v1/variants/${varianteId}`, {
          barcode: "666666",
        })
      ).status
    ).toBe(200)
  })
})
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `bun run --cwd apps/api test test/barcodes.test.ts`
Expected: FAIL — les doublons intra-table renvoient 409 mais avec le code `SKU_EXISTANT` (mapping actuel de `estViolationUnicite`), et les doublons croisés passent en 201.

- [ ] **Step 3: Créer le helper croisé**

Créer `apps/api/src/lib/barcode.ts` :

```ts
import { and, eq, ne } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import * as schema from "../db/schema"

type Db = DrizzleD1Database<typeof schema>

// Unicité des codes-barres PAR ORGANISATION, produits et variantes
// CONFONDUS (un scan POS doit résoudre vers un seul article). Les index
// partiels org-scopés couvrent chaque table ; cette vérification couvre le
// croisement inter-tables, impossible à indexer en SQLite. `exclure` permet
// à un PATCH de re-poser son propre code-barres.
export async function barcodeDejaUtilise(
  db: Db,
  organizationId: string,
  barcode: string,
  exclure: { produitId?: string; varianteId?: string } = {}
): Promise<boolean> {
  const conditionsProduits: SQL[] = [
    eq(schema.products.organizationId, organizationId),
    eq(schema.products.barcode, barcode),
  ]
  if (exclure.produitId) {
    conditionsProduits.push(ne(schema.products.id, exclure.produitId))
  }
  const produits = await db
    .select({ id: schema.products.id })
    .from(schema.products)
    .where(and(...conditionsProduits))
    .limit(1)
  if (produits.length > 0) {
    return true
  }

  const conditionsVariantes: SQL[] = [
    eq(schema.productVariants.organizationId, organizationId),
    eq(schema.productVariants.barcode, barcode),
  ]
  if (exclure.varianteId) {
    conditionsVariantes.push(ne(schema.productVariants.id, exclure.varianteId))
  }
  const variantes = await db
    .select({ id: schema.productVariants.id })
    .from(schema.productVariants)
    .where(and(...conditionsVariantes))
    .limit(1)
  return variantes.length > 0
}
```

- [ ] **Step 4: Brancher la vérification dans products.ts**

Dans `apps/api/src/routes/products.ts`, ajouter l'import `import { barcodeDejaUtilise } from "../lib/barcode"`, puis :

4a. Dans `POST /` — juste après le contrôle de catégorie, AVANT la boucle de tentatives SKU :

```ts
    if (
      corps.data.barcode &&
      (await barcodeDejaUtilise(db, organizationId, corps.data.barcode))
    ) {
      return c.json(
        { code: "BARCODE_EXISTANT", message: "Ce code-barres est déjà utilisé" },
        409
      )
    }
```

Et dans le `catch` de la boucle, discriminer AVANT le mapping SKU existant (course entre le pré-contrôle et l'insert, rattrapée par l'index partiel) :

```ts
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
```

4b. Dans `PATCH /:id` — après la garde plancher-variantes (Task 1), AVANT le `db.update` final :

```ts
    if (
      typeof corps.data.barcode === "string" &&
      corps.data.barcode !== produit.barcode &&
      (await barcodeDejaUtilise(db, organizationId, corps.data.barcode, {
        produitId: produit.id,
      }))
    ) {
      return c.json(
        { code: "BARCODE_EXISTANT", message: "Ce code-barres est déjà utilisé" },
        409
      )
    }
```

Et remplacer le `db.update` final par une version protégée contre la course :

```ts
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
      throw err
    }
    return c.json({ ok: true })
```

4c. Dans `POST /:id/variants` — après le contrôle de plancher, AVANT le calcul du SKU :

```ts
    if (
      corps.data.barcode &&
      (await barcodeDejaUtilise(db, organizationId, corps.data.barcode))
    ) {
      return c.json(
        { code: "BARCODE_EXISTANT", message: "Ce code-barres est déjà utilisé" },
        409
      )
    }
```

Et dans le `catch` existant de ce handler, ajouter la discrimination AVANT le mapping SKU :

```ts
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
```

- [ ] **Step 5: Brancher la vérification dans variants.ts**

Dans le `PATCH /:id` de `apps/api/src/routes/variants.ts` (version Task 1), ajouter les imports `import { barcodeDejaUtilise } from "../lib/barcode"` et, juste après le contrôle de plancher :

```ts
  if (
    typeof corps.data.barcode === "string" &&
    corps.data.barcode !== variante.barcode &&
    (await barcodeDejaUtilise(db, organizationId, corps.data.barcode, {
      varianteId: variante.id,
    }))
  ) {
    return c.json(
      { code: "BARCODE_EXISTANT", message: "Ce code-barres est déjà utilisé" },
      409
    )
  }
```

Puis envelopper les DEUX updates (le gardé « désactivation » et le simple) dans un try/catch qui mappe la course résiduelle :

```ts
  try {
    // ... bloc `if (desactivation) { ... } ` puis update simple, inchangés
  } catch (err) {
    if (estViolationUnicite(err, "barcode")) {
      return c.json(
        { code: "BARCODE_EXISTANT", message: "Ce code-barres est déjà utilisé" },
        409
      )
    }
    throw err
  }
```

(Concrètement : déplacer le bloc `desactivation` + l'update simple + leurs `return` à l'intérieur du `try`.)

- [ ] **Step 6: Vérifier**

Run: `bun run --cwd apps/api test`
Expected: PASS — les 4 tests de `barcodes.test.ts` et toute la suite (0 échec).

Run: `bun run typecheck && bun run lint`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat: unicité des codes-barres par organisation avec vérification croisée (BARCODE_EXISTANT)"
```

---

### Task 5: stockService.applyMovements — écriture atomique du stock et CMP

Le SEUL point d'écriture du stock. Construit un `db.batch()` D1 unique : instructions du document appelant + insertion des mouvements + upsert des niveaux (quantité et CMP recalculés côté SQL). Échec anti-négatif = `ErreurStockInsuffisant` avec détail par (entrepôt, variante).

**Files:**
- Create: `apps/api/src/services/stock.ts`
- Create: `apps/api/test/stock-service.test.ts`

**Interfaces:**
- Consumes: `schema.stockMovements`, `schema.stockLevels`, `schema.MOVEMENT_TYPES`, `estViolationCheck` (Task 3).
- Produces (consommés par les Tasks 7, 9, 10) :
  - `type InstructionBatch = BatchItem<"sqlite">`
  - `type TypeMouvement = (typeof schema.MOVEMENT_TYPES)[number]`
  - `type MouvementStock = { warehouseId: string; variantId: string; lotId?: string | null; delta: number; type: TypeMouvement; reason?: string | null; refType?: string | null; refId?: string | null; unitCost?: number }`
  - `class ErreurStockInsuffisant extends Error { readonly details: DetailStockInsuffisant[] }` avec `type DetailStockInsuffisant = { warehouseId: string; variantId: string; disponible: number; demande: number }`
  - `applyMovements(db, params: { organizationId: string; userId: string; mouvements: MouvementStock[]; instructionsAvant?: InstructionBatch[]; date?: Date }): Promise<{ movementIds: string[] }>`
  - `definirSeuil(db, params: { organizationId: string; warehouseId: string; variantId: string; minStock: number | null }): Promise<void>`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `apps/api/test/stock-service.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { and, eq } from "drizzle-orm"
import * as schema from "../src/db/schema"
import {
  applyMovements,
  definirSeuil,
  ErreurStockInsuffisant,
} from "../src/services/stock"
import { bootstrapOwner, creerEntrepot, creerProduitSimple } from "./helpers"

async function seed() {
  const { organizationId, ownerId } = await bootstrapOwner()
  const warehouseId = await creerEntrepot(organizationId)
  const { variantId } = await creerProduitSimple(organizationId)
  const db = drizzle(env.DB, { schema })
  return { organizationId, ownerId, warehouseId, variantId, db }
}

async function niveau(
  db: ReturnType<typeof drizzle<typeof schema>>,
  warehouseId: string,
  variantId: string
) {
  const rows = await db
    .select()
    .from(schema.stockLevels)
    .where(
      and(
        eq(schema.stockLevels.warehouseId, warehouseId),
        eq(schema.stockLevels.variantId, variantId)
      )
    )
    .limit(1)
  return rows[0] ?? null
}

describe("stockService.applyMovements", () => {
  it("crée le niveau au premier mouvement puis cumule, et journalise chaque mouvement", async () => {
    const { organizationId, ownerId, warehouseId, variantId, db } = await seed()

    const premier = await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId, variantId, delta: 10, type: "adjustment", reason: "init" },
      ],
    })
    expect(premier.movementIds).toHaveLength(1)
    expect((await niveau(db, warehouseId, variantId))?.quantity).toBe(10)

    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId, variantId, delta: -3, type: "adjustment", reason: "casse" },
      ],
    })
    expect((await niveau(db, warehouseId, variantId))?.quantity).toBe(7)

    const journal = await db
      .select()
      .from(schema.stockMovements)
      .where(eq(schema.stockMovements.variantId, variantId))
    expect(journal).toHaveLength(2)
  })

  it("stock insuffisant : rien n'est écrit (ni mouvements, ni niveaux) et le détail est fourni", async () => {
    const { organizationId, ownerId, warehouseId, variantId, db } = await seed()
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId, variantId, delta: 5, type: "adjustment", reason: "init" },
      ],
    })

    let erreur: unknown = null
    try {
      await applyMovements(db, {
        organizationId,
        userId: ownerId,
        mouvements: [
          { warehouseId, variantId, delta: -8, type: "adjustment", reason: "trop" },
        ],
      })
    } catch (err) {
      erreur = err
    }
    expect(erreur).toBeInstanceOf(ErreurStockInsuffisant)
    if (erreur instanceof ErreurStockInsuffisant) {
      expect(erreur.details).toEqual([
        { warehouseId, variantId, disponible: 5, demande: 8 },
      ])
    }
    // Atomicité : le niveau est intact et AUCUN mouvement -8 n'a été journalisé
    expect((await niveau(db, warehouseId, variantId))?.quantity).toBe(5)
    const journal = await db
      .select()
      .from(schema.stockMovements)
      .where(eq(schema.stockMovements.variantId, variantId))
    expect(journal).toHaveLength(1)
  })

  it("échec multi-lignes : si UNE ligne manque de stock, AUCUNE ligne n'est appliquée", async () => {
    const { organizationId, ownerId, warehouseId, variantId, db } = await seed()
    const autre = await creerProduitSimple(organizationId, { nom: "Autre" })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId, variantId, delta: 10, type: "adjustment", reason: "init" },
        {
          warehouseId,
          variantId: autre.variantId,
          delta: 2,
          type: "adjustment",
          reason: "init",
        },
      ],
    })

    await expect(
      applyMovements(db, {
        organizationId,
        userId: ownerId,
        mouvements: [
          { warehouseId, variantId, delta: -1, type: "adjustment", reason: "ok" },
          {
            warehouseId,
            variantId: autre.variantId,
            delta: -5,
            type: "adjustment",
            reason: "insuffisant",
          },
        ],
      })
    ).rejects.toBeInstanceOf(ErreurStockInsuffisant)

    // La ligne « ok » n'a pas été appliquée non plus
    expect((await niveau(db, warehouseId, variantId))?.quantity).toBe(10)
    expect((await niveau(db, warehouseId, autre.variantId))?.quantity).toBe(2)
  })

  it("CMP : pondération, arrondi à l'entier, et cas qtyAvant <= 0", async () => {
    const { organizationId, ownerId, warehouseId, variantId, db } = await seed()

    // Première réception : 10 unités à 100 → CMP 100
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId, variantId, delta: 10, type: "purchase", unitCost: 100 },
      ],
    })
    let n = await niveau(db, warehouseId, variantId)
    expect(n?.quantity).toBe(10)
    expect(n?.avgCost).toBe(100)

    // Deuxième réception : 5 à 160 → round((10×100 + 5×160) / 15) = 120
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId, variantId, delta: 5, type: "purchase", unitCost: 160 },
      ],
    })
    n = await niveau(db, warehouseId, variantId)
    expect(n?.quantity).toBe(15)
    expect(n?.avgCost).toBe(120)

    // Arrondi : 3 à 105 → round((15×120 + 3×105) / 18) = round(117.5) = 118
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId, variantId, delta: 3, type: "purchase", unitCost: 105 },
      ],
    })
    n = await niveau(db, warehouseId, variantId)
    expect(n?.avgCost).toBe(118)

    // Vider le stock : le CMP reste (valorisation figée)…
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId, variantId, delta: -18, type: "adjustment", reason: "vide" },
      ],
    })
    // … et qtyAvant = 0 : la réception suivante REPART de son coût d'apport
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId, variantId, delta: 4, type: "purchase", unitCost: 500 },
      ],
    })
    n = await niveau(db, warehouseId, variantId)
    expect(n?.quantity).toBe(4)
    expect(n?.avgCost).toBe(500)
  })

  it("agrège plusieurs mouvements de la même variante en un seul niveau (coût pondéré)", async () => {
    const { organizationId, ownerId, warehouseId, variantId, db } = await seed()
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId, variantId, delta: 4, type: "purchase", unitCost: 100 },
        { warehouseId, variantId, delta: 6, type: "purchase", unitCost: 200 },
      ],
    })
    const n = await niveau(db, warehouseId, variantId)
    expect(n?.quantity).toBe(10)
    // round((4×100 + 6×200) / 10) = 160
    expect(n?.avgCost).toBe(160)
  })

  it("valide ses entrées : mouvement vide, delta nul, purchase sans unitCost", async () => {
    const { organizationId, ownerId, warehouseId, variantId, db } = await seed()
    await expect(
      applyMovements(db, { organizationId, userId: ownerId, mouvements: [] })
    ).rejects.toThrow("au moins un mouvement")
    await expect(
      applyMovements(db, {
        organizationId,
        userId: ownerId,
        mouvements: [
          { warehouseId, variantId, delta: 0, type: "adjustment", reason: "x" },
        ],
      })
    ).rejects.toThrow("delta entier non nul")
    await expect(
      applyMovements(db, {
        organizationId,
        userId: ownerId,
        mouvements: [{ warehouseId, variantId, delta: 5, type: "purchase" }],
      })
    ).rejects.toThrow("unitCost")
  })
})

describe("stockService.definirSeuil", () => {
  it("crée la ligne de niveau à quantité 0 si besoin, puis modifie le seuil sans toucher au stock", async () => {
    const { organizationId, ownerId, warehouseId, variantId, db } = await seed()

    await definirSeuil(db, { organizationId, warehouseId, variantId, minStock: 12 })
    let n = await niveau(db, warehouseId, variantId)
    expect(n?.quantity).toBe(0)
    expect(n?.minStock).toBe(12)

    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId, variantId, delta: 30, type: "adjustment", reason: "init" },
      ],
    })
    await definirSeuil(db, { organizationId, warehouseId, variantId, minStock: null })
    n = await niveau(db, warehouseId, variantId)
    expect(n?.quantity).toBe(30)
    expect(n?.minStock).toBeNull()
  })
})
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `bun run --cwd apps/api test test/stock-service.test.ts`
Expected: FAIL — module `../src/services/stock` introuvable.

- [ ] **Step 3: Implémenter le service**

Créer `apps/api/src/services/stock.ts` :

```ts
import { inArray, sql } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import type { BatchItem } from "drizzle-orm/batch"
import * as schema from "../db/schema"
import { estViolationCheck } from "../lib/db-errors"

type Db = DrizzleD1Database<typeof schema>

export type InstructionBatch = BatchItem<"sqlite">

export type TypeMouvement = (typeof schema.MOVEMENT_TYPES)[number]

export type MouvementStock = {
  warehouseId: string
  variantId: string
  lotId?: string | null
  // > 0 entrée, < 0 sortie — jamais 0
  delta: number
  type: TypeMouvement
  reason?: string | null
  refType?: string | null
  refId?: string | null
  // Requis pour type "purchase" : alimente le CMP
  unitCost?: number
}

export type DetailStockInsuffisant = {
  warehouseId: string
  variantId: string
  disponible: number
  demande: number
}

export class ErreurStockInsuffisant extends Error {
  readonly details: DetailStockInsuffisant[]
  constructor(details: DetailStockInsuffisant[]) {
    super("Stock insuffisant")
    this.name = "ErreurStockInsuffisant"
    this.details = details
  }
}

type Agregat = {
  warehouseId: string
  variantId: string
  totalDelta: number
  // Somme des deltas des mouvements `purchase` du groupe
  qtyRecue: number
  // Somme des quantité × coût unitaire des mouvements `purchase` du groupe
  coutTotalApport: number
}

function agregerParNiveau(mouvements: MouvementStock[]): Agregat[] {
  const parCle = new Map<string, Agregat>()
  for (const m of mouvements) {
    const cle = `${m.warehouseId}|${m.variantId}`
    let agregat = parCle.get(cle)
    if (!agregat) {
      agregat = {
        warehouseId: m.warehouseId,
        variantId: m.variantId,
        totalDelta: 0,
        qtyRecue: 0,
        coutTotalApport: 0,
      }
      parCle.set(cle, agregat)
    }
    agregat.totalDelta += m.delta
    if (m.type === "purchase") {
      agregat.qtyRecue += m.delta
      agregat.coutTotalApport += m.delta * (m.unitCost ?? 0)
    }
  }
  return [...parCle.values()]
}

// Après un rollback, reconstruit le détail « qui manquait de combien » pour
// l'erreur 409. Lecture post-échec : sous forte concurrence le détail est
// une photographie approchée, l'invariant (aucune écriture partielle) est,
// lui, garanti par la transaction.
async function calculerDeficits(
  db: Db,
  mouvements: MouvementStock[]
): Promise<DetailStockInsuffisant[]> {
  const sorties = agregerParNiveau(mouvements).filter((a) => a.totalDelta < 0)
  if (sorties.length === 0) {
    return []
  }
  const variantIds = [...new Set(sorties.map((s) => s.variantId))]
  const niveaux = await db
    .select({
      warehouseId: schema.stockLevels.warehouseId,
      variantId: schema.stockLevels.variantId,
      quantity: schema.stockLevels.quantity,
    })
    .from(schema.stockLevels)
    .where(inArray(schema.stockLevels.variantId, variantIds))
  return sorties
    .map((s) => {
      const ligne = niveaux.find(
        (n) => n.warehouseId === s.warehouseId && n.variantId === s.variantId
      )
      return {
        warehouseId: s.warehouseId,
        variantId: s.variantId,
        disponible: ligne?.quantity ?? 0,
        demande: -s.totalDelta,
      }
    })
    .filter((d) => d.disponible < d.demande)
}

// SEUL point d'écriture du stock (spec §8) : aucune route ne touche
// stock_levels ni stock_movements directement.
//
// Atomicité : tout part dans UN db.batch D1 (= une transaction SQLite) —
// instructionsAvant (mise à jour du document appelant, création de lots…)
// + insertion des mouvements + upsert des niveaux. La garde anti-négatif est
// la contrainte CHECK stock_levels_quantity_positive : un solde négatif fait
// ÉCHOUER le statement, donc D1 annule le batch ENTIER, qui est traduit en
// ErreurStockInsuffisant. (Un `UPDATE … WHERE quantity + ? >= 0` seul ne
// suffirait pas : 0 ligne affectée n'est pas une erreur SQL, le batch serait
// déjà committé — mouvements écrits sans décrément — au moment de lire
// meta.changes.)
//
// CMP (coût moyen pondéré, entier XOF), pour les mouvements `purchase`,
// recalculé dans le MÊME upsert, côté SQL, afin de lire quantity/avg_cost
// au moment de la transaction (pas de course avec une vente concurrente) :
//   nouveauCmp = ROUND((qtyAvant × avgAvant + coutTotalApport) / (qtyAvant + qtyRecue))
//   — équivalent à ROUND((qtyAvant × avgAvant + qtyReçue × coûtUnitaire) / (qtyAvant + qtyReçue))
//     quand la réception a un seul coût unitaire.
//   Cas qtyAvant <= 0 : un stock résiduel nul (ou négatif, impossible ici
//   grâce au CHECK, mais l'expression reste défensive) ne porte plus de
//   valeur → le CMP repart du coût de l'apport : ROUND(coutTotalApport / qtyRecue).
// Nota SQLite : dans un UPDATE, toutes les expressions SET lisent les
// valeurs d'AVANT modification — l'ordre des affectations est sans effet.
export async function applyMovements(
  db: Db,
  params: {
    organizationId: string
    userId: string
    mouvements: MouvementStock[]
    instructionsAvant?: InstructionBatch[]
    date?: Date
  }
): Promise<{ movementIds: string[] }> {
  const { organizationId, userId, mouvements } = params
  if (mouvements.length === 0) {
    throw new Error("applyMovements exige au moins un mouvement")
  }
  for (const m of mouvements) {
    if (!Number.isInteger(m.delta) || m.delta === 0) {
      throw new Error("Chaque mouvement doit porter un delta entier non nul")
    }
    if (m.type === "purchase") {
      if (m.delta <= 0 || m.unitCost === undefined) {
        throw new Error(
          "Un mouvement purchase exige un delta positif et un unitCost"
        )
      }
      if (!Number.isInteger(m.unitCost) || m.unitCost < 0) {
        throw new Error("unitCost doit être un entier positif ou nul")
      }
    }
  }
  const date = params.date ?? new Date()

  const lignes = mouvements.map((m) => ({ m, id: crypto.randomUUID() }))
  const insertionsMouvements = lignes.map(({ m, id }) =>
    db.insert(schema.stockMovements).values({
      id,
      organizationId,
      warehouseId: m.warehouseId,
      variantId: m.variantId,
      lotId: m.lotId ?? null,
      delta: m.delta,
      type: m.type,
      reason: m.reason ?? null,
      refType: m.refType ?? null,
      refId: m.refId ?? null,
      userId,
      createdAt: date,
    })
  )

  const cible = [schema.stockLevels.warehouseId, schema.stockLevels.variantId]
  const upsertsNiveaux = agregerParNiveau(mouvements).map((a) => {
    const cmpApport =
      a.qtyRecue > 0 ? Math.round(a.coutTotalApport / a.qtyRecue) : 0
    const insertion = {
      id: crypto.randomUUID(),
      organizationId,
      warehouseId: a.warehouseId,
      variantId: a.variantId,
      quantity: a.totalDelta,
      avgCost: cmpApport,
      minStock: null,
      updatedAt: date,
    }
    const nouvelleQuantite = sql`${schema.stockLevels.quantity} + ${a.totalDelta}`
    if (a.qtyRecue > 0) {
      return db
        .insert(schema.stockLevels)
        .values(insertion)
        .onConflictDoUpdate({
          target: cible,
          set: {
            quantity: nouvelleQuantite,
            avgCost: sql`CASE
              WHEN ${schema.stockLevels.quantity} <= 0 THEN ${cmpApport}
              ELSE CAST(ROUND((${schema.stockLevels.quantity} * ${schema.stockLevels.avgCost} + ${a.coutTotalApport}) * 1.0
                / (${schema.stockLevels.quantity} + ${a.qtyRecue})) AS INTEGER)
            END`,
            updatedAt: date,
          },
        })
    }
    // Pas d'apport valorisé : le CMP ne bouge pas (les sorties et
    // ajustements ne modifient jamais la valorisation unitaire).
    return db
      .insert(schema.stockLevels)
      .values(insertion)
      .onConflictDoUpdate({
        target: cible,
        set: { quantity: nouvelleQuantite, updatedAt: date },
      })
  })

  // Batch hétérogène : tableau construit DIRECTEMENT (spreads), pas de
  // push + cast — le typage D1 des batchs l'exige.
  const instructions = [
    ...(params.instructionsAvant ?? []),
    ...insertionsMouvements,
    ...upsertsNiveaux,
  ]
  const [premiere, ...reste] = instructions
  if (!premiere) {
    throw new Error("applyMovements : batch vide")
  }
  try {
    await db.batch([premiere, ...reste])
  } catch (err) {
    if (estViolationCheck(err)) {
      throw new ErreurStockInsuffisant(await calculerDeficits(db, mouvements))
    }
    throw err
  }
  return { movementIds: lignes.map((l) => l.id) }
}

// Seuil d'alerte par entrepôt (surcharge de products.default_min_stock).
// Vit dans le service pour préserver l'invariant « seul stockService écrit
// stock_levels » ; ne touche JAMAIS quantity ni avgCost d'une ligne
// existante.
export async function definirSeuil(
  db: Db,
  params: {
    organizationId: string
    warehouseId: string
    variantId: string
    minStock: number | null
  }
): Promise<void> {
  const maintenant = new Date()
  await db
    .insert(schema.stockLevels)
    .values({
      id: crypto.randomUUID(),
      organizationId: params.organizationId,
      warehouseId: params.warehouseId,
      variantId: params.variantId,
      quantity: 0,
      avgCost: 0,
      minStock: params.minStock,
      updatedAt: maintenant,
    })
    .onConflictDoUpdate({
      target: [schema.stockLevels.warehouseId, schema.stockLevels.variantId],
      set: { minStock: params.minStock, updatedAt: maintenant },
    })
}
```

- [ ] **Step 4: Vérifier**

Run: `bun run --cwd apps/api test test/stock-service.test.ts`
Expected: PASS — 7 tests.

Run: `bun run --cwd apps/api test && bun run typecheck && bun run lint`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat: stockService.applyMovements — batch D1 atomique, garde anti-négatif et CMP"
```

---

### Task 6: Lecture du stock — portée par rôle, niveaux, journal filtrable, alertes

Extrait le cœur de `requireWarehouseRole` en `verifierAccesEntrepot` (réutilisable quand l'entrepôt vient d'un document et non du chemin), ajoute la portée de LECTURE stock, et expose `GET /api/v1/stock/levels`, `GET /api/v1/stock/movements`, `GET /api/v1/stock/alerts`.

**Files:**
- Modify: `apps/api/src/middleware/permissions.ts`
- Create: `apps/api/src/lib/stock-acces.ts`
- Create: `apps/api/src/routes/stock.ts`
- Modify: `apps/api/src/index.ts`
- Create: `apps/api/test/stock-read.test.ts`

**Interfaces:**
- Consumes: `applyMovements`, `definirSeuil` (Task 5) pour les seeds de test ; `likeEchappe` (Task 1).
- Produces: `verifierAccesEntrepot(c: Context<{ Bindings: Env; Variables: PermissionVariables }>, warehouseId: string, roles: WarehouseRole[], bypass?: CompanyRole[]): Promise<Response | null>` (`src/middleware/permissions.ts`) — null si autorisé, sinon la réponse 403 `ACCES_REFUSE`. `requireWarehouseRole` devient un wrapper mince et garde un comportement STRICTEMENT identique (les tests Phase 2 ne bougent pas). Consommé par les Tasks 8 et 9.
- Produces: `porteeLectureStock(db, organizationId, userId, role): Promise<PorteeLectureStock>` avec `type PorteeLectureStock = { tous: true } | { tous: false; warehouseIds: string[] }` (`src/lib/stock-acces.ts`). Consommé par la Task 8.
- Produces (API, consommée par les écrans Tasks 11-12) :
  - `GET /api/v1/stock/levels?warehouseId=<requis>&recherche=&alertes=true` → `200 { levels: Array<{ variantId, productId, productName, variantName, sku, quantity, avgCost, minStock, seuilEffectif, enAlerte }> }`
  - `GET /api/v1/stock/movements?warehouseId=&type=&variantId=&recherche=&du=AAAA-MM-JJ&au=AAAA-MM-JJ&page=1&limite=50` → `200 { movements: Array<{ id, createdAt, warehouseId, warehouseName, variantId, productName, variantName, sku, delta, type, reason, refType, refId, userName, lotNumber }>, total, page, limite }` (tri anté-chronologique)
  - `GET /api/v1/stock/alerts` → `200 { alerts: Array<{ warehouseId, warehouseName, variantId, productId, productName, variantName, sku, quantity, seuilEffectif }>, total }` — articles actifs dont `quantity <= COALESCE(minStock, defaultMinStock)`

- [ ] **Step 1: Extraire verifierAccesEntrepot**

Dans `apps/api/src/middleware/permissions.ts`, ajouter `import type { Context } from "hono"` puis remplacer la fonction `requireWarehouseRole` complète par :

```ts
// Cœur de la vérification d'accès entrepôt, appelable hors middleware quand
// le warehouseId vient d'un document (ex. purchases.warehouseId) plutôt que
// du chemin. Renvoie null si autorisé, sinon la réponse 403 à retourner.
export async function verifierAccesEntrepot(
  c: Context<{ Bindings: Env; Variables: PermissionVariables }>,
  warehouseId: string,
  roles: WarehouseRole[],
  bypass: CompanyRole[] = ["owner", "admin", "stock_manager"]
): Promise<Response | null> {
  const db = drizzle(c.env.DB, { schema })
  // Garde anti cross-tenant : l'entrepôt doit exister et appartenir à
  // l'organisation du membre, y compris sur le chemin bypass.
  const warehouse = await db
    .select({ organizationId: schema.warehouses.organizationId })
    .from(schema.warehouses)
    .where(eq(schema.warehouses.id, warehouseId))
    .limit(1)
  if (
    !warehouse[0] ||
    warehouse[0].organizationId !== c.get("membership").organizationId
  ) {
    return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
  }
  if (bypass.includes(c.get("membership").role)) {
    return null
  }
  const rows = await db
    .select({ role: schema.warehouseMembers.role })
    .from(schema.warehouseMembers)
    .where(
      and(
        eq(schema.warehouseMembers.warehouseId, warehouseId),
        eq(schema.warehouseMembers.userId, c.get("user").id),
        eq(
          schema.warehouseMembers.organizationId,
          c.get("membership").organizationId
        )
      )
    )
    .limit(1)
  if (!rows[0] || !roles.includes(rows[0].role)) {
    return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
  }
  return null
}

export function requireWarehouseRole(
  roles: WarehouseRole[],
  bypass: CompanyRole[] = ["owner", "admin", "stock_manager"]
) {
  return createMiddleware<Ctx>(async (c, next) => {
    const warehouseId = c.req.param("warehouseId")
    if (!warehouseId) {
      return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
    }
    const refus = await verifierAccesEntrepot(c, warehouseId, roles, bypass)
    if (refus) {
      return refus
    }
    await next()
  })
}
```

Run: `bun run --cwd apps/api test test/permissions.test.ts`
Expected: PASS — le refactor est iso-comportement, les tests Phase 2 passent sans modification.

- [ ] **Step 2: Créer la portée de lecture**

Créer `apps/api/src/lib/stock-acces.ts` :

```ts
import { and, eq, inArray } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import type { CompanyRole } from "shared"
import * as schema from "../db/schema"

type Db = DrizzleD1Database<typeof schema>

export type PorteeLectureStock =
  | { tous: true }
  | { tous: false; warehouseIds: string[] }

// Matrice spec §4, lecture stock (niveaux, journal, alertes, réceptions) :
// owner/admin/auditor/stock_manager voient TOUT ; un membre `staff` voit les
// entrepôts où il est manager ou auditor. Le rôle local `cashier` n'ouvre
// PAS la lecture back-office — le POS (Phase 6) exposera le stock de sa
// boutique par ses propres routes.
export async function porteeLectureStock(
  db: Db,
  organizationId: string,
  userId: string,
  role: CompanyRole
): Promise<PorteeLectureStock> {
  if (
    role === "owner" ||
    role === "admin" ||
    role === "auditor" ||
    role === "stock_manager"
  ) {
    return { tous: true }
  }
  const rows = await db
    .select({ warehouseId: schema.warehouseMembers.warehouseId })
    .from(schema.warehouseMembers)
    .where(
      and(
        eq(schema.warehouseMembers.userId, userId),
        eq(schema.warehouseMembers.organizationId, organizationId),
        inArray(schema.warehouseMembers.role, ["manager", "auditor"])
      )
    )
  return { tous: false, warehouseIds: rows.map((r) => r.warehouseId) }
}
```

- [ ] **Step 3: Écrire les tests de lecture qui échouent**

Créer `apps/api/test/stock-read.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import app from "../src/index"
import * as schema from "../src/db/schema"
import { applyMovements, definirSeuil } from "../src/services/stock"
import {
  bootstrapOwner,
  createUserWithRole,
  creerEntrepot,
  creerProduitSimple,
  affecterEntrepot,
} from "./helpers"

function get(cookie: string, url: string) {
  return app.request(url, { headers: { cookie } }, env)
}

type Niveau = {
  variantId: string
  productName: string
  quantity: number
  avgCost: number
  seuilEffectif: number | null
  enAlerte: boolean
}

async function seed() {
  const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
  const depotId = await creerEntrepot(organizationId, "Dépôt central")
  const boutiqueId = await creerEntrepot(organizationId, "Boutique Plateau", "store")
  const produit = await creerProduitSimple(organizationId, {
    nom: "Coca 50cl",
    defaultMinStock: 10,
  })
  const db = drizzle(env.DB, { schema })
  await applyMovements(db, {
    organizationId,
    userId: ownerId,
    mouvements: [
      {
        warehouseId: depotId,
        variantId: produit.variantId,
        delta: 24,
        type: "purchase",
        unitCost: 150,
      },
      {
        warehouseId: boutiqueId,
        variantId: produit.variantId,
        delta: 4,
        type: "purchase",
        unitCost: 150,
      },
    ],
  })
  return { organizationId, ownerId, ownerCookie, depotId, boutiqueId, produit, db }
}

describe("GET /api/v1/stock/levels", () => {
  it("owner : niveaux d'un entrepôt avec CMP et seuil effectif hérité du produit", async () => {
    const { ownerCookie, depotId } = await seed()
    const res = await get(ownerCookie, `/api/v1/stock/levels?warehouseId=${depotId}`)
    expect(res.status).toBe(200)
    const { levels } = await res.json<{ levels: Niveau[] }>()
    expect(levels).toHaveLength(1)
    expect(levels[0]?.quantity).toBe(24)
    expect(levels[0]?.avgCost).toBe(150)
    expect(levels[0]?.seuilEffectif).toBe(10)
    expect(levels[0]?.enAlerte).toBe(false)
  })

  it("warehouseId requis (400) ; entrepôt d'une autre organisation → 404", async () => {
    const { ownerCookie } = await seed()
    expect((await get(ownerCookie, "/api/v1/stock/levels")).status).toBe(400)

    const db = drizzle(env.DB, { schema })
    const autreOrgId = crypto.randomUUID()
    await db.insert(schema.organization).values({
      id: autreOrgId,
      name: "Autre",
      slug: "autre-stock",
      createdAt: new Date(),
    })
    const entrepotCache = await creerEntrepot(autreOrgId, "Caché")
    expect(
      (await get(ownerCookie, `/api/v1/stock/levels?warehouseId=${entrepotCache}`))
        .status
    ).toBe(404)
  })

  it("staff : manager/auditor voit SES entrepôts, cashier et non-affecté 403", async () => {
    const { organizationId, depotId, boutiqueId } = await seed()
    const manager = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, manager.userId, depotId, "manager")
    const caissier = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, caissier.userId, boutiqueId, "cashier")

    expect(
      (await get(manager.cookie, `/api/v1/stock/levels?warehouseId=${depotId}`))
        .status
    ).toBe(200)
    expect(
      (await get(manager.cookie, `/api/v1/stock/levels?warehouseId=${boutiqueId}`))
        .status
    ).toBe(403)
    expect(
      (await get(caissier.cookie, `/api/v1/stock/levels?warehouseId=${boutiqueId}`))
        .status
    ).toBe(403)
  })

  it("recherche littérale et filtre alertes=true", async () => {
    const { organizationId, ownerId, ownerCookie, depotId, db } = await seed()
    const bas = await creerProduitSimple(organizationId, {
      nom: "Fanta 100%",
      defaultMinStock: 10,
    })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId: depotId,
          variantId: bas.variantId,
          delta: 3,
          type: "purchase",
          unitCost: 100,
        },
      ],
    })

    const params = new URLSearchParams({ warehouseId: depotId, recherche: "100%" })
    const recherche = await get(ownerCookie, `/api/v1/stock/levels?${params.toString()}`)
    const corpsRecherche = await recherche.json<{ levels: Niveau[] }>()
    expect(corpsRecherche.levels.map((l) => l.productName)).toEqual(["Fanta 100%"])

    const alertes = await get(
      ownerCookie,
      `/api/v1/stock/levels?warehouseId=${depotId}&alertes=true`
    )
    const corpsAlertes = await alertes.json<{ levels: Niveau[] }>()
    expect(corpsAlertes.levels.map((l) => l.productName)).toEqual(["Fanta 100%"])
    expect(corpsAlertes.levels[0]?.enAlerte).toBe(true)
  })
})

describe("GET /api/v1/stock/movements", () => {
  it("journal anté-chronologique, filtres type/entrepôt, portée staff", async () => {
    const { organizationId, ownerId, ownerCookie, depotId, boutiqueId, produit, db } =
      await seed()
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId: depotId,
          variantId: produit.variantId,
          delta: -2,
          type: "adjustment",
          reason: "casse",
        },
      ],
    })

    const tout = await get(ownerCookie, "/api/v1/stock/movements")
    expect(tout.status).toBe(200)
    const corpsTout = await tout.json<{
      movements: Array<{ type: string; delta: number; userName: string }>
      total: number
    }>()
    expect(corpsTout.total).toBe(3)
    expect(corpsTout.movements[0]?.type).toBe("adjustment")
    expect(corpsTout.movements[0]?.userName).toBe("Propriétaire")

    const filtre = await get(
      ownerCookie,
      `/api/v1/stock/movements?warehouseId=${depotId}&type=purchase`
    )
    const corpsFiltre = await filtre.json<{ total: number }>()
    expect(corpsFiltre.total).toBe(1)

    expect((await get(ownerCookie, "/api/v1/stock/movements?type=inconnu")).status).toBe(400)

    // staff auditor du dépôt : ne voit que le dépôt, même sans filtre
    const auditeur = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, auditeur.userId, depotId, "auditor")
    const vueAuditeur = await get(auditeur.cookie, "/api/v1/stock/movements")
    const corpsAuditeur = await vueAuditeur.json<{
      movements: Array<{ warehouseId: string }>
      total: number
    }>()
    expect(corpsAuditeur.total).toBe(2)
    expect(
      corpsAuditeur.movements.every((m) => m.warehouseId === depotId)
    ).toBe(true)
    // et 403 s'il force un autre entrepôt
    expect(
      (
        await get(
          auditeur.cookie,
          `/api/v1/stock/movements?warehouseId=${boutiqueId}`
        )
      ).status
    ).toBe(403)
  })
})

describe("GET /api/v1/stock/alerts", () => {
  it("liste les articles sous le seuil (surcharge entrepôt comprise) dans la portée du lecteur", async () => {
    const { organizationId, ownerId, ownerCookie, depotId, boutiqueId, produit, db } =
      await seed()
    // boutique : 4 en stock, seuil produit 10 → alerte ; dépôt : 24 → pas d'alerte
    const avant = await get(ownerCookie, "/api/v1/stock/alerts")
    const corpsAvant = await avant.json<{
      alerts: Array<{ warehouseId: string; quantity: number; seuilEffectif: number }>
      total: number
    }>()
    expect(corpsAvant.total).toBe(1)
    expect(corpsAvant.alerts[0]?.warehouseId).toBe(boutiqueId)

    // Surcharge par entrepôt : seuil 30 au dépôt → le dépôt passe en alerte
    await definirSeuil(db, {
      organizationId,
      warehouseId: depotId,
      variantId: produit.variantId,
      minStock: 30,
    })
    const apres = await get(ownerCookie, "/api/v1/stock/alerts")
    expect((await apres.json<{ total: number }>()).total).toBe(2)

    // staff manager de la boutique : ne voit que l'alerte de la boutique
    const manager = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, manager.userId, boutiqueId, "manager")
    const vueManager = await get(manager.cookie, "/api/v1/stock/alerts")
    const corpsManager = await vueManager.json<{
      alerts: Array<{ warehouseId: string }>
      total: number
    }>()
    expect(corpsManager.total).toBe(1)
    expect(corpsManager.alerts[0]?.warehouseId).toBe(boutiqueId)
    expect(ownerId).toBeTruthy()
  })
})
```

Run: `bun run --cwd apps/api test test/stock-read.test.ts`
Expected: FAIL — 404 sur toutes les routes `/api/v1/stock/*` (non montées).

- [ ] **Step 4: Implémenter les routes de lecture**

Créer `apps/api/src/routes/stock.ts` :

```ts
import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, asc, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import * as schema from "../db/schema"
import { likeEchappe } from "../lib/recherche"
import { porteeLectureStock } from "../lib/stock-acces"
import { requireAuth } from "../middleware/require-auth"
import { requireMembership } from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import type { Env } from "../env"

export const stockRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

stockRoute.use(requireAuth, requireMembership)

const MOTIF_JOUR = /^\d{4}-\d{2}-\d{2}$/

// Seuil effectif d'une ligne de niveau : surcharge entrepôt sinon défaut produit
const seuilEffectif = sql<number | null>`COALESCE(${schema.stockLevels.minStock}, ${schema.products.defaultMinStock})`

stockRoute.get("/levels", async (c) => {
  const { organizationId, role } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const warehouseId = c.req.query("warehouseId")
  if (!warehouseId) {
    return c.json(
      { code: "VALIDATION", message: "Le paramètre warehouseId est requis" },
      400
    )
  }
  const portee = await porteeLectureStock(
    db,
    organizationId,
    c.get("user").id,
    role
  )
  if (!portee.tous && !portee.warehouseIds.includes(warehouseId)) {
    return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
  }
  const entrepots = await db
    .select({ id: schema.warehouses.id })
    .from(schema.warehouses)
    .where(
      and(
        eq(schema.warehouses.id, warehouseId),
        eq(schema.warehouses.organizationId, organizationId)
      )
    )
    .limit(1)
  if (entrepots.length === 0) {
    return c.json({ code: "INTROUVABLE", message: "Entrepôt introuvable" }, 404)
  }

  const recherche = c.req.query("recherche")
  const alertes = c.req.query("alertes")
  const conditions: SQL[] = [
    eq(schema.stockLevels.organizationId, organizationId),
    eq(schema.stockLevels.warehouseId, warehouseId),
  ]
  if (recherche) {
    const filtre = or(
      likeEchappe(schema.products.name, recherche),
      likeEchappe(schema.productVariants.name, recherche),
      likeEchappe(schema.productVariants.sku, recherche),
      likeEchappe(schema.productVariants.barcode, recherche)
    )
    if (filtre) {
      conditions.push(filtre)
    }
  }
  if (alertes === "true") {
    conditions.push(
      sql`${seuilEffectif} IS NOT NULL AND ${schema.stockLevels.quantity} <= ${seuilEffectif}`
    )
  }

  const rows = await db
    .select({
      variantId: schema.stockLevels.variantId,
      productId: schema.products.id,
      productName: schema.products.name,
      variantName: schema.productVariants.name,
      sku: schema.productVariants.sku,
      quantity: schema.stockLevels.quantity,
      avgCost: schema.stockLevels.avgCost,
      minStock: schema.stockLevels.minStock,
      seuilEffectif,
    })
    .from(schema.stockLevels)
    .innerJoin(
      schema.productVariants,
      eq(schema.stockLevels.variantId, schema.productVariants.id)
    )
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id)
    )
    .where(and(...conditions))
    .orderBy(asc(schema.products.name), asc(schema.productVariants.name))
  const levels = rows.map((r) => ({
    ...r,
    enAlerte: r.seuilEffectif !== null && r.quantity <= r.seuilEffectif,
  }))
  return c.json({ levels })
})

stockRoute.get("/movements", async (c) => {
  const { organizationId, role } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const portee = await porteeLectureStock(
    db,
    organizationId,
    c.get("user").id,
    role
  )

  const warehouseId = c.req.query("warehouseId")
  const type = c.req.query("type")
  const variantId = c.req.query("variantId")
  const recherche = c.req.query("recherche")
  const du = c.req.query("du")
  const au = c.req.query("au")
  const page = Math.max(1, Number(c.req.query("page") ?? "1") || 1)
  const limite = Math.min(200, Math.max(1, Number(c.req.query("limite") ?? "50") || 50))

  if (type && !(schema.MOVEMENT_TYPES as readonly string[]).includes(type)) {
    return c.json(
      { code: "VALIDATION", message: "Type de mouvement invalide" },
      400
    )
  }
  if ((du && !MOTIF_JOUR.test(du)) || (au && !MOTIF_JOUR.test(au))) {
    return c.json(
      { code: "VALIDATION", message: "Dates invalides (AAAA-MM-JJ)" },
      400
    )
  }

  const conditions: SQL[] = [
    eq(schema.stockMovements.organizationId, organizationId),
  ]
  if (warehouseId) {
    if (!portee.tous && !portee.warehouseIds.includes(warehouseId)) {
      return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
    }
    conditions.push(eq(schema.stockMovements.warehouseId, warehouseId))
  } else if (!portee.tous) {
    if (portee.warehouseIds.length === 0) {
      return c.json({ movements: [], total: 0, page, limite })
    }
    conditions.push(
      inArray(schema.stockMovements.warehouseId, portee.warehouseIds)
    )
  }
  if (type) {
    conditions.push(
      eq(
        schema.stockMovements.type,
        type as (typeof schema.MOVEMENT_TYPES)[number]
      )
    )
  }
  if (variantId) {
    conditions.push(eq(schema.stockMovements.variantId, variantId))
  }
  if (du) {
    conditions.push(
      gte(schema.stockMovements.createdAt, new Date(`${du}T00:00:00.000Z`))
    )
  }
  if (au) {
    // borne haute inclusive : < lendemain 00:00 UTC
    conditions.push(
      lt(
        schema.stockMovements.createdAt,
        new Date(new Date(`${au}T00:00:00.000Z`).getTime() + 86_400_000)
      )
    )
  }
  if (recherche) {
    const filtre = or(
      likeEchappe(schema.products.name, recherche),
      likeEchappe(schema.productVariants.sku, recherche)
    )
    if (filtre) {
      conditions.push(filtre)
    }
  }
  const critere = and(...conditions)

  const totaux = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(schema.stockMovements)
    .innerJoin(
      schema.productVariants,
      eq(schema.stockMovements.variantId, schema.productVariants.id)
    )
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id)
    )
    .where(critere)
  const total = totaux[0]?.total ?? 0

  const movements = await db
    .select({
      id: schema.stockMovements.id,
      createdAt: schema.stockMovements.createdAt,
      warehouseId: schema.stockMovements.warehouseId,
      warehouseName: schema.warehouses.name,
      variantId: schema.stockMovements.variantId,
      productName: schema.products.name,
      variantName: schema.productVariants.name,
      sku: schema.productVariants.sku,
      delta: schema.stockMovements.delta,
      type: schema.stockMovements.type,
      reason: schema.stockMovements.reason,
      refType: schema.stockMovements.refType,
      refId: schema.stockMovements.refId,
      userName: schema.user.name,
      lotNumber: schema.lots.lotNumber,
    })
    .from(schema.stockMovements)
    .innerJoin(
      schema.productVariants,
      eq(schema.stockMovements.variantId, schema.productVariants.id)
    )
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id)
    )
    .innerJoin(
      schema.warehouses,
      eq(schema.stockMovements.warehouseId, schema.warehouses.id)
    )
    .innerJoin(schema.user, eq(schema.stockMovements.userId, schema.user.id))
    .leftJoin(schema.lots, eq(schema.stockMovements.lotId, schema.lots.id))
    .where(critere)
    .orderBy(desc(schema.stockMovements.createdAt))
    .limit(limite)
    .offset((page - 1) * limite)

  return c.json({ movements, total, page, limite })
})

stockRoute.get("/alerts", async (c) => {
  const { organizationId, role } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const portee = await porteeLectureStock(
    db,
    organizationId,
    c.get("user").id,
    role
  )
  const conditions: SQL[] = [
    eq(schema.stockLevels.organizationId, organizationId),
    sql`${seuilEffectif} IS NOT NULL AND ${schema.stockLevels.quantity} <= ${seuilEffectif}`,
    eq(schema.products.isActive, true),
    eq(schema.productVariants.isActive, true),
    eq(schema.warehouses.isActive, true),
  ]
  if (!portee.tous) {
    if (portee.warehouseIds.length === 0) {
      return c.json({ alerts: [], total: 0 })
    }
    conditions.push(
      inArray(schema.stockLevels.warehouseId, portee.warehouseIds)
    )
  }
  const alerts = await db
    .select({
      warehouseId: schema.stockLevels.warehouseId,
      warehouseName: schema.warehouses.name,
      variantId: schema.stockLevels.variantId,
      productId: schema.products.id,
      productName: schema.products.name,
      variantName: schema.productVariants.name,
      sku: schema.productVariants.sku,
      quantity: schema.stockLevels.quantity,
      seuilEffectif,
    })
    .from(schema.stockLevels)
    .innerJoin(
      schema.productVariants,
      eq(schema.stockLevels.variantId, schema.productVariants.id)
    )
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id)
    )
    .innerJoin(
      schema.warehouses,
      eq(schema.stockLevels.warehouseId, schema.warehouses.id)
    )
    .where(and(...conditions))
    .orderBy(asc(schema.warehouses.name), asc(schema.products.name))
  return c.json({ alerts, total: alerts.length })
})
```

Dans `apps/api/src/index.ts`, ajouter l'import `import { stockRoute } from "./routes/stock"` et, après le montage de `filesRoute` :

```ts
app.route("/api/v1/stock", stockRoute)
```

- [ ] **Step 5: Vérifier**

Run: `bun run --cwd apps/api test test/stock-read.test.ts`
Expected: PASS — 6 tests.

Run: `bun run --cwd apps/api test && bun run typecheck && bun run lint`
Expected: exit 0 (les tests permissions Phase 2 passent toujours).

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat: lecture du stock — niveaux, journal filtrable, alertes et portée par rôle"
```

---

### Task 7: Ajustements manuels tracés et seuil d'alerte par entrepôt

Écritures par entrepôt sur le chemin `/stock/warehouses/:warehouseId/…`, gardées par `requireWarehouseRole(["manager"])` — sa première utilisation réelle. L'ajustement exige un motif et passe par `applyMovements` (delta ±, type `adjustment`).

**Files:**
- Create: `packages/shared/src/schemas/stock.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/api/src/routes/stock.ts`
- Create: `apps/api/test/stock-adjustments.test.ts`

**Interfaces:**
- Consumes: `applyMovements`, `definirSeuil`, `ErreurStockInsuffisant` (Task 5) ; `requireWarehouseRole` (Task 6) ; `varianteScope` (Task 1).
- Produces (schémas partagés, complétés par la Task 8 dans le même fichier) :
  - `adjustmentCreateSchema` : `{ variantId: string; delta: number (entier ≠ 0); reason: string (requis); lotId?: string }`
  - `minStockSchema` : `{ minStock: number | null (entier ≥ 0 ou null) }`
- Produces (API, consommée par la Task 11) :
  - `POST /api/v1/stock/warehouses/:warehouseId/adjustments` → `201 { id }` (id du mouvement) ; `409 STOCK_INSUFFISANT` avec `details: [{ warehouseId, variantId, sku, variantName, disponible, demande }]`
  - `PATCH /api/v1/stock/warehouses/:warehouseId/levels/:variantId` → `200 { ok: true }`

- [ ] **Step 1: Schémas partagés**

Créer `packages/shared/src/schemas/stock.ts` :

```ts
import { z } from "zod"

export const adjustmentCreateSchema = z.object({
  variantId: z.string().min(1, "La variante est requise"),
  delta: z
    .number()
    .int("Le delta doit être un entier")
    .refine((v) => v !== 0, "Le delta ne peut pas être nul"),
  reason: z.string().trim().min(1, "Le motif est requis"),
  lotId: z.string().min(1).optional(),
})

export const minStockSchema = z.object({
  minStock: z
    .number()
    .int("Le seuil doit être un entier")
    .nonnegative("Le seuil doit être positif ou nul")
    .nullable(),
})

export type AdjustmentCreateInput = z.infer<typeof adjustmentCreateSchema>
export type MinStockInput = z.infer<typeof minStockSchema>
```

Dans `packages/shared/src/index.ts`, ajouter :

```ts
export {
  adjustmentCreateSchema,
  minStockSchema,
  type AdjustmentCreateInput,
  type MinStockInput,
} from "./schemas/stock"
```

- [ ] **Step 2: Écrire les tests qui échouent**

Créer `apps/api/test/stock-adjustments.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
import app from "../src/index"
import * as schema from "../src/db/schema"
import {
  bootstrapOwner,
  createUserWithRole,
  creerEntrepot,
  creerProduitSimple,
  affecterEntrepot,
} from "./helpers"

function ajuster(cookie: string, warehouseId: string, body: unknown) {
  return app.request(
    `/api/v1/stock/warehouses/${warehouseId}/adjustments`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

function definirSeuilHttp(
  cookie: string,
  warehouseId: string,
  variantId: string,
  body: unknown
) {
  return app.request(
    `/api/v1/stock/warehouses/${warehouseId}/levels/${variantId}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

async function seed() {
  const { organizationId, ownerCookie } = await bootstrapOwner()
  const warehouseId = await creerEntrepot(organizationId)
  const { variantId } = await creerProduitSimple(organizationId)
  return { organizationId, ownerCookie, warehouseId, variantId }
}

describe("POST /api/v1/stock/warehouses/:warehouseId/adjustments", () => {
  it("owner ajuste (delta +), le mouvement est journalisé avec motif et auteur", async () => {
    const { ownerCookie, warehouseId, variantId } = await seed()
    const res = await ajuster(ownerCookie, warehouseId, {
      variantId,
      delta: 12,
      reason: "Inventaire de départ",
    })
    expect(res.status).toBe(201)
    const { id } = await res.json<{ id: string }>()

    const db = drizzle(env.DB, { schema })
    const mouvements = await db
      .select()
      .from(schema.stockMovements)
      .where(eq(schema.stockMovements.id, id))
    expect(mouvements[0]?.type).toBe("adjustment")
    expect(mouvements[0]?.delta).toBe(12)
    expect(mouvements[0]?.reason).toBe("Inventaire de départ")
  })

  it("motif manquant → 400 VALIDATION ; delta négatif > stock → 409 STOCK_INSUFFISANT détaillé", async () => {
    const { ownerCookie, warehouseId, variantId } = await seed()
    const sansMotif = await ajuster(ownerCookie, warehouseId, {
      variantId,
      delta: 5,
    })
    expect(sansMotif.status).toBe(400)
    expect((await sansMotif.json<{ code: string }>()).code).toBe("VALIDATION")

    await ajuster(ownerCookie, warehouseId, {
      variantId,
      delta: 5,
      reason: "init",
    })
    const trop = await ajuster(ownerCookie, warehouseId, {
      variantId,
      delta: -9,
      reason: "casse",
    })
    expect(trop.status).toBe(409)
    const corps = await trop.json<{
      code: string
      details: Array<{ variantId: string; disponible: number; demande: number; sku: string }>
    }>()
    expect(corps.code).toBe("STOCK_INSUFFISANT")
    expect(corps.details[0]?.disponible).toBe(5)
    expect(corps.details[0]?.demande).toBe(9)
    expect(corps.details[0]?.sku).toContain("TST-")
  })

  it("matrice : manager de l'entrepôt OK, manager d'un autre entrepôt/auditeur/caissier 403, stock_manager OK", async () => {
    const { organizationId, warehouseId, variantId } = await seed()
    const autreEntrepot = await creerEntrepot(organizationId, "Annexe")
    const manager = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, manager.userId, warehouseId, "manager")
    const managerAilleurs = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      managerAilleurs.userId,
      autreEntrepot,
      "manager"
    )
    const auditeurEntrepot = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      auditeurEntrepot.userId,
      warehouseId,
      "auditor"
    )
    const caissier = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, caissier.userId, warehouseId, "cashier")
    const gestStock = await createUserWithRole(organizationId, "stock_manager")

    const corps = { variantId, delta: 1, reason: "test" }
    expect((await ajuster(manager.cookie, warehouseId, corps)).status).toBe(201)
    expect((await ajuster(managerAilleurs.cookie, warehouseId, corps)).status).toBe(403)
    expect((await ajuster(auditeurEntrepot.cookie, warehouseId, corps)).status).toBe(403)
    expect((await ajuster(caissier.cookie, warehouseId, corps)).status).toBe(403)
    expect((await ajuster(gestStock.cookie, warehouseId, corps)).status).toBe(201)
  })

  it("cross-org : entrepôt d'une autre organisation → 403 ; variante d'une autre organisation → 404", async () => {
    const { ownerCookie, warehouseId } = await seed()
    const db = drizzle(env.DB, { schema })
    const autreOrgId = crypto.randomUUID()
    await db.insert(schema.organization).values({
      id: autreOrgId,
      name: "Autre",
      slug: "autre-ajustements",
      createdAt: new Date(),
    })
    const entrepotCache = await creerEntrepot(autreOrgId)
    const produitCache = await creerProduitSimple(autreOrgId)

    expect(
      (
        await ajuster(ownerCookie, entrepotCache, {
          variantId: produitCache.variantId,
          delta: 1,
          reason: "x",
        })
      ).status
    ).toBe(403)
    expect(
      (
        await ajuster(ownerCookie, warehouseId, {
          variantId: produitCache.variantId,
          delta: 1,
          reason: "x",
        })
      ).status
    ).toBe(404)
  })
})

describe("PATCH /api/v1/stock/warehouses/:warehouseId/levels/:variantId", () => {
  it("manager pose une surcharge de seuil, l'alerte suit, null la retire", async () => {
    const { organizationId, ownerCookie, warehouseId, variantId } = await seed()
    await ajuster(ownerCookie, warehouseId, {
      variantId,
      delta: 8,
      reason: "init",
    })
    const manager = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, manager.userId, warehouseId, "manager")

    expect(
      (
        await definirSeuilHttp(manager.cookie, warehouseId, variantId, {
          minStock: 20,
        })
      ).status
    ).toBe(200)
    const alertes = await app.request(
      "/api/v1/stock/alerts",
      { headers: { cookie: ownerCookie } },
      env
    )
    expect((await alertes.json<{ total: number }>()).total).toBe(1)

    expect(
      (
        await definirSeuilHttp(manager.cookie, warehouseId, variantId, {
          minStock: null,
        })
      ).status
    ).toBe(200)
    const apres = await app.request(
      "/api/v1/stock/alerts",
      { headers: { cookie: ownerCookie } },
      env
    )
    expect((await apres.json<{ total: number }>()).total).toBe(0)
  })

  it("auditeur d'entrepôt → 403", async () => {
    const { organizationId, warehouseId, variantId } = await seed()
    const auditeur = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, auditeur.userId, warehouseId, "auditor")
    expect(
      (
        await definirSeuilHttp(auditeur.cookie, warehouseId, variantId, {
          minStock: 5,
        })
      ).status
    ).toBe(403)
  })
})
```

Run: `bun run --cwd apps/api test test/stock-adjustments.test.ts`
Expected: FAIL — 404 (routes absentes).

- [ ] **Step 3: Implémenter les routes d'écriture**

Dans `apps/api/src/routes/stock.ts` :

3a. Compléter les imports :

```ts
import { adjustmentCreateSchema, minStockSchema } from "shared"
import { validerCorps } from "../lib/validation"
import { varianteScope } from "../lib/org-scope"
import { requireMembership, requireWarehouseRole } from "../middleware/permissions"
import {
  applyMovements,
  definirSeuil,
  ErreurStockInsuffisant,
} from "../services/stock"
import type { Context } from "hono"
import type { DrizzleD1Database } from "drizzle-orm/d1"
```

(fusionner avec l'import `requireMembership` existant ; garder un `import type` séparé pour les types.)

3b. Ajouter en fin de fichier :

```ts
// Enrichit l'erreur du service avec le SKU et le nom de variante pour un
// message actionnable côté écran.
async function reponseStockInsuffisant(
  c: Context,
  db: DrizzleD1Database<typeof schema>,
  err: ErreurStockInsuffisant
) {
  const variantIds = err.details.map((d) => d.variantId)
  const variantes =
    variantIds.length > 0
      ? await db
          .select({
            id: schema.productVariants.id,
            sku: schema.productVariants.sku,
            name: schema.productVariants.name,
          })
          .from(schema.productVariants)
          .where(inArray(schema.productVariants.id, variantIds))
      : []
  return c.json(
    {
      code: "STOCK_INSUFFISANT",
      message: "Stock insuffisant pour valider l'opération",
      details: err.details.map((d) => {
        const variante = variantes.find((v) => v.id === d.variantId)
        return {
          ...d,
          sku: variante?.sku ?? null,
          variantName: variante?.name ?? null,
        }
      }),
    },
    409
  )
}

stockRoute.post(
  "/warehouses/:warehouseId/adjustments",
  requireWarehouseRole(["manager"]),
  async (c) => {
    const corps = await validerCorps(c, adjustmentCreateSchema)
    if (!corps.ok) return corps.reponse
    const { organizationId } = c.get("membership")
    const db = drizzle(c.env.DB, { schema })
    const variante = await varianteScope(db, organizationId, corps.data.variantId)
    if (!variante) {
      return c.json(
        { code: "INTROUVABLE", message: "Variante introuvable" },
        404
      )
    }
    if (corps.data.lotId) {
      const lot = await db
        .select({ id: schema.lots.id })
        .from(schema.lots)
        .where(
          and(
            eq(schema.lots.id, corps.data.lotId),
            eq(schema.lots.variantId, variante.id)
          )
        )
        .limit(1)
      if (lot.length === 0) {
        return c.json({ code: "INTROUVABLE", message: "Lot introuvable" }, 404)
      }
    }
    try {
      const { movementIds } = await applyMovements(db, {
        organizationId,
        userId: c.get("user").id,
        mouvements: [
          {
            warehouseId: c.req.param("warehouseId"),
            variantId: variante.id,
            lotId: corps.data.lotId ?? null,
            delta: corps.data.delta,
            type: "adjustment",
            reason: corps.data.reason,
          },
        ],
      })
      return c.json({ id: movementIds[0] }, 201)
    } catch (err) {
      if (err instanceof ErreurStockInsuffisant) {
        return reponseStockInsuffisant(c, db, err)
      }
      throw err
    }
  }
)

stockRoute.patch(
  "/warehouses/:warehouseId/levels/:variantId",
  requireWarehouseRole(["manager"]),
  async (c) => {
    const corps = await validerCorps(c, minStockSchema)
    if (!corps.ok) return corps.reponse
    const { organizationId } = c.get("membership")
    const db = drizzle(c.env.DB, { schema })
    const variante = await varianteScope(
      db,
      organizationId,
      c.req.param("variantId")
    )
    if (!variante) {
      return c.json(
        { code: "INTROUVABLE", message: "Variante introuvable" },
        404
      )
    }
    await definirSeuil(db, {
      organizationId,
      warehouseId: c.req.param("warehouseId"),
      variantId: variante.id,
      minStock: corps.data.minStock,
    })
    return c.json({ ok: true })
  }
)
```

- [ ] **Step 4: Vérifier**

Run: `bun run --cwd apps/api test test/stock-adjustments.test.ts`
Expected: PASS — 6 tests.

Run: `bun run --cwd apps/api test && bun run typecheck && bun run lint`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/shared
git commit -m "feat: ajustements manuels tracés et seuil d'alerte par entrepôt (requireWarehouseRole)"
```

---

### Task 8: Réceptions fournisseur — brouillon (CRUD document et lignes)

`purchases` + `purchase_items` : création d'un brouillon, liste scoppée par portée de lecture, détail avec lignes, ajout/modification/suppression de lignes, suppression du brouillon. Les règles lot (`LOT_REQUIS` / `LOTS_NON_SUIVIS`) s'appliquent dès la saisie des lignes. La validation (`receive`) arrive en Task 9.

**Files:**
- Modify: `packages/shared/src/schemas/stock.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `apps/api/src/routes/purchases.ts`
- Modify: `apps/api/src/index.ts`
- Create: `apps/api/test/purchases-draft.test.ts`

**Interfaces:**
- Consumes: `verifierAccesEntrepot` (Task 6), `porteeLectureStock` (Task 6), `varianteScope`/`fournisseurExiste` (Task 1), `estErreurDeclencheur` (Task 3).
- Produces (schémas partagés) : `purchaseCreateSchema` `{ warehouseId, supplierId, reference? }`, `purchaseItemCreateSchema` `{ variantId, quantity (entier > 0), unitCost (entier ≥ 0), lotNumber?, expiryDate? (AAAA-MM-JJ) }`, `purchaseItemUpdateSchema` (tout optionnel, `lotNumber`/`expiryDate` nullables, au moins un champ).
- Produces (API, consommée par les Tasks 9 et 13) :
  - `GET /api/v1/purchases?statut=&warehouseId=` → `200 { purchases: Array<{ id, warehouseId, warehouseName, supplierId, supplierName, reference, status, createdAt, receivedAt, itemCount, totalCost }> }`
  - `POST /api/v1/purchases` → `201 { id }`
  - `GET /api/v1/purchases/:id` → `200 { purchase: { id, warehouseId, warehouseName, supplierId, supplierName, reference, status, createdAt, receivedAt, items: Array<{ id, variantId, productName, variantName, sku, trackLots, quantity, unitCost, lotNumber, expiryDate }> } }`
  - `POST /api/v1/purchases/:id/items` → `201 { id }` ; `PATCH /api/v1/purchases/:id/items/:itemId` → `200 { ok: true }` ; `DELETE /api/v1/purchases/:id/items/:itemId` → `200 { ok: true }` ; `DELETE /api/v1/purchases/:id` → `200 { ok: true }`
  - Toute écriture sur un document `received` → `409 RECEPTION_VALIDEE`.

- [ ] **Step 1: Compléter les schémas partagés**

Dans `packages/shared/src/schemas/stock.ts`, ajouter à la fin :

```ts
const MOTIF_JOUR = /^\d{4}-\d{2}-\d{2}$/

export const purchaseCreateSchema = z.object({
  warehouseId: z.string().min(1, "L'entrepôt est requis"),
  supplierId: z.string().min(1, "Le fournisseur est requis"),
  reference: z.string().trim().min(1).optional(),
})

export const purchaseItemCreateSchema = z.object({
  variantId: z.string().min(1, "La variante est requise"),
  quantity: z
    .number()
    .int("La quantité doit être un entier")
    .positive("La quantité doit être positive"),
  unitCost: z
    .number()
    .int("Le coût unitaire doit être un entier")
    .nonnegative("Le coût unitaire doit être positif ou nul"),
  lotNumber: z.string().trim().min(1).optional(),
  expiryDate: z
    .string()
    .regex(MOTIF_JOUR, "Date de péremption invalide (AAAA-MM-JJ)")
    .optional(),
})

export const purchaseItemUpdateSchema = z
  .object({
    quantity: z
      .number()
      .int("La quantité doit être un entier")
      .positive("La quantité doit être positive")
      .optional(),
    unitCost: z
      .number()
      .int("Le coût unitaire doit être un entier")
      .nonnegative("Le coût unitaire doit être positif ou nul")
      .optional(),
    lotNumber: z.string().trim().min(1).nullable().optional(),
    expiryDate: z
      .string()
      .regex(MOTIF_JOUR, "Date de péremption invalide (AAAA-MM-JJ)")
      .nullable()
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Aucun champ à modifier",
  })

export type PurchaseCreateInput = z.infer<typeof purchaseCreateSchema>
export type PurchaseItemCreateInput = z.infer<typeof purchaseItemCreateSchema>
export type PurchaseItemUpdateInput = z.infer<typeof purchaseItemUpdateSchema>
```

Dans `packages/shared/src/index.ts`, étendre l'export de `./schemas/stock` :

```ts
export {
  adjustmentCreateSchema,
  minStockSchema,
  purchaseCreateSchema,
  purchaseItemCreateSchema,
  purchaseItemUpdateSchema,
  type AdjustmentCreateInput,
  type MinStockInput,
  type PurchaseCreateInput,
  type PurchaseItemCreateInput,
  type PurchaseItemUpdateInput,
} from "./schemas/stock"
```

- [ ] **Step 2: Écrire les tests qui échouent**

Créer `apps/api/test/purchases-draft.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import app from "../src/index"
import {
  bootstrapOwner,
  createUserWithRole,
  creerEntrepot,
  creerProduitSimple,
  affecterEntrepot,
} from "./helpers"

function req(cookie: string, method: string, url: string, body?: unknown) {
  return app.request(
    url,
    {
      method,
      headers: { "content-type": "application/json", cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env
  )
}

async function creerFournisseur(cookie: string) {
  const res = await req(cookie, "POST", "/api/v1/suppliers", {
    name: "Sodeci Distribution",
  })
  return (await res.json<{ id: string }>()).id
}

async function seed() {
  const { organizationId, ownerCookie } = await bootstrapOwner()
  const warehouseId = await creerEntrepot(organizationId)
  const supplierId = await creerFournisseur(ownerCookie)
  const produit = await creerProduitSimple(organizationId)
  const produitLots = await creerProduitSimple(organizationId, {
    nom: "Yaourt nature",
    trackLots: true,
  })
  return { organizationId, ownerCookie, warehouseId, supplierId, produit, produitLots }
}

describe("réceptions fournisseur — brouillon", () => {
  it("cycle complet : création, lignes, modification, liste avec totaux, suppression", async () => {
    const { ownerCookie, warehouseId, supplierId, produit } = await seed()

    const creation = await req(ownerCookie, "POST", "/api/v1/purchases", {
      warehouseId,
      supplierId,
      reference: "BL-2026-001",
    })
    expect(creation.status).toBe(201)
    const { id } = await creation.json<{ id: string }>()

    const ajout = await req(ownerCookie, "POST", `/api/v1/purchases/${id}/items`, {
      variantId: produit.variantId,
      quantity: 10,
      unitCost: 150,
    })
    expect(ajout.status).toBe(201)
    const { id: itemId } = await ajout.json<{ id: string }>()

    expect(
      (
        await req(ownerCookie, "PATCH", `/api/v1/purchases/${id}/items/${itemId}`, {
          quantity: 12,
        })
      ).status
    ).toBe(200)

    const liste = await req(ownerCookie, "GET", "/api/v1/purchases?statut=draft")
    const corpsListe = await liste.json<{
      purchases: Array<{
        id: string
        status: string
        supplierName: string
        itemCount: number
        totalCost: number
      }>
    }>()
    expect(corpsListe.purchases).toHaveLength(1)
    expect(corpsListe.purchases[0]?.supplierName).toBe("Sodeci Distribution")
    expect(corpsListe.purchases[0]?.itemCount).toBe(1)
    expect(corpsListe.purchases[0]?.totalCost).toBe(12 * 150)

    const detail = await req(ownerCookie, "GET", `/api/v1/purchases/${id}`)
    const { purchase } = await detail.json<{
      purchase: { items: Array<{ quantity: number; unitCost: number }> }
    }>()
    expect(purchase.items[0]?.quantity).toBe(12)

    expect(
      (
        await req(
          ownerCookie,
          "DELETE",
          `/api/v1/purchases/${id}/items/${itemId}`
        )
      ).status
    ).toBe(200)
    expect(
      (await req(ownerCookie, "DELETE", `/api/v1/purchases/${id}`)).status
    ).toBe(200)
    expect(
      (await req(ownerCookie, "GET", `/api/v1/purchases/${id}`)).status
    ).toBe(404)
  })

  it("règles de lot à la saisie : LOT_REQUIS pour trackLots, LOTS_NON_SUIVIS sinon", async () => {
    const { ownerCookie, warehouseId, supplierId, produit, produitLots } = await seed()
    const creation = await req(ownerCookie, "POST", "/api/v1/purchases", {
      warehouseId,
      supplierId,
    })
    const { id } = await creation.json<{ id: string }>()

    const sansLot = await req(ownerCookie, "POST", `/api/v1/purchases/${id}/items`, {
      variantId: produitLots.variantId,
      quantity: 5,
      unitCost: 300,
    })
    expect(sansLot.status).toBe(400)
    expect((await sansLot.json<{ code: string }>()).code).toBe("LOT_REQUIS")

    const avecLot = await req(ownerCookie, "POST", `/api/v1/purchases/${id}/items`, {
      variantId: produitLots.variantId,
      quantity: 5,
      unitCost: 300,
      lotNumber: "LOT-2026-07",
      expiryDate: "2026-12-31",
    })
    expect(avecLot.status).toBe(201)

    const lotInterdit = await req(
      ownerCookie,
      "POST",
      `/api/v1/purchases/${id}/items`,
      {
        variantId: produit.variantId,
        quantity: 2,
        unitCost: 100,
        lotNumber: "LOT-X",
      }
    )
    expect(lotInterdit.status).toBe(400)
    expect((await lotInterdit.json<{ code: string }>()).code).toBe(
      "LOTS_NON_SUIVIS"
    )
  })

  it("permissions : manager de l'entrepôt crée, manager d'ailleurs/caissier/auditeur 403, staff ne voit que ses entrepôts", async () => {
    const { organizationId, ownerCookie, warehouseId, supplierId } = await seed()
    const autreEntrepot = await creerEntrepot(organizationId, "Annexe")
    const manager = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, manager.userId, warehouseId, "manager")
    const managerAilleurs = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      managerAilleurs.userId,
      autreEntrepot,
      "manager"
    )
    const caissier = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, caissier.userId, warehouseId, "cashier")

    const corps = { warehouseId, supplierId }
    expect((await req(manager.cookie, "POST", "/api/v1/purchases", corps)).status).toBe(201)
    expect(
      (await req(managerAilleurs.cookie, "POST", "/api/v1/purchases", corps)).status
    ).toBe(403)
    expect((await req(caissier.cookie, "POST", "/api/v1/purchases", corps)).status).toBe(403)

    // brouillon dans l'annexe, créé par l'owner
    await req(ownerCookie, "POST", "/api/v1/purchases", {
      warehouseId: autreEntrepot,
      supplierId,
    })
    // le manager du premier entrepôt ne voit que le sien dans la liste
    const liste = await req(manager.cookie, "GET", "/api/v1/purchases")
    const corpsListe = await liste.json<{
      purchases: Array<{ warehouseId: string }>
    }>()
    expect(corpsListe.purchases).toHaveLength(1)
    expect(corpsListe.purchases[0]?.warehouseId).toBe(warehouseId)
    // et pas le détail de celui de l'annexe
    const listeOwner = await req(ownerCookie, "GET", "/api/v1/purchases")
    const tous = await listeOwner.json<{
      purchases: Array<{ id: string; warehouseId: string }>
    }>()
    const idAnnexe = tous.purchases.find((p) => p.warehouseId === autreEntrepot)?.id
    expect(idAnnexe).toBeTruthy()
    expect(
      (await req(manager.cookie, "GET", `/api/v1/purchases/${String(idAnnexe)}`)).status
    ).toBe(403)
  })

  it("cross-org et introuvables : fournisseur inconnu 404, entrepôt d'une autre org 403, réception d'une autre org 404", async () => {
    const { ownerCookie, warehouseId } = await seed()
    expect(
      (
        await req(ownerCookie, "POST", "/api/v1/purchases", {
          warehouseId,
          supplierId: crypto.randomUUID(),
        })
      ).status
    ).toBe(404)
    expect(
      (await req(ownerCookie, "GET", `/api/v1/purchases/${crypto.randomUUID()}`)).status
    ).toBe(404)
  })
})
```

Run: `bun run --cwd apps/api test test/purchases-draft.test.ts`
Expected: FAIL — 404 (routes absentes).

- [ ] **Step 3: Implémenter les routes brouillon**

Créer `apps/api/src/routes/purchases.ts` :

```ts
import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import {
  purchaseCreateSchema,
  purchaseItemCreateSchema,
  purchaseItemUpdateSchema,
} from "shared"
import * as schema from "../db/schema"
import { validerCorps } from "../lib/validation"
import { estErreurDeclencheur } from "../lib/db-errors"
import { fournisseurExiste, varianteScope } from "../lib/org-scope"
import { porteeLectureStock } from "../lib/stock-acces"
import { requireAuth } from "../middleware/require-auth"
import {
  requireMembership,
  verifierAccesEntrepot,
} from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import type { Env } from "../env"

export const purchasesRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

purchasesRoute.use(requireAuth, requireMembership)

type Db = DrizzleD1Database<typeof schema>

// Retour annoté `| null` (piège eslint no-unnecessary-condition)
async function achatScope(
  db: Db,
  organizationId: string,
  id: string
): Promise<typeof schema.purchases.$inferSelect | null> {
  const rows = await db
    .select()
    .from(schema.purchases)
    .where(
      and(
        eq(schema.purchases.id, id),
        eq(schema.purchases.organizationId, organizationId)
      )
    )
    .limit(1)
  return rows[0] ?? null
}

const REPONSE_RECEPTION_VALIDEE = {
  code: "RECEPTION_VALIDEE",
  message: "Cette réception est validée et ne peut plus être modifiée",
} as const

// Règles de lot d'une ligne : lot exigé pour un produit trackLots,
// interdit sinon. Renvoie la réponse d'erreur à retourner, ou null si OK.
async function verifierReglesLot(
  db: Db,
  variantProductId: string,
  lotNumber: string | null,
  expiryDate: string | Date | null
): Promise<{ code: string; message: string; statut: 400 } | null> {
  const produits = await db
    .select({ trackLots: schema.products.trackLots })
    .from(schema.products)
    .where(eq(schema.products.id, variantProductId))
    .limit(1)
  const suitLots = produits[0]?.trackLots === true
  if (suitLots && !lotNumber) {
    return {
      code: "LOT_REQUIS",
      message: "Le numéro de lot est requis pour un produit suivi par lots",
      statut: 400,
    }
  }
  if (!suitLots && (lotNumber || expiryDate)) {
    return {
      code: "LOTS_NON_SUIVIS",
      message: "Le suivi par lots n'est pas activé pour ce produit",
      statut: 400,
    }
  }
  return null
}

purchasesRoute.get("/", async (c) => {
  const { organizationId, role } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const portee = await porteeLectureStock(
    db,
    organizationId,
    c.get("user").id,
    role
  )
  const statut = c.req.query("statut")
  const warehouseId = c.req.query("warehouseId")
  if (statut && !(schema.PURCHASE_STATUSES as readonly string[]).includes(statut)) {
    return c.json({ code: "VALIDATION", message: "Statut invalide" }, 400)
  }
  const conditions: SQL[] = [
    eq(schema.purchases.organizationId, organizationId),
  ]
  if (statut) {
    conditions.push(
      eq(
        schema.purchases.status,
        statut as (typeof schema.PURCHASE_STATUSES)[number]
      )
    )
  }
  if (warehouseId) {
    if (!portee.tous && !portee.warehouseIds.includes(warehouseId)) {
      return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
    }
    conditions.push(eq(schema.purchases.warehouseId, warehouseId))
  } else if (!portee.tous) {
    if (portee.warehouseIds.length === 0) {
      return c.json({ purchases: [] })
    }
    conditions.push(
      inArray(schema.purchases.warehouseId, portee.warehouseIds)
    )
  }

  const rows = await db
    .select({
      id: schema.purchases.id,
      warehouseId: schema.purchases.warehouseId,
      warehouseName: schema.warehouses.name,
      supplierId: schema.purchases.supplierId,
      supplierName: schema.suppliers.name,
      reference: schema.purchases.reference,
      status: schema.purchases.status,
      createdAt: schema.purchases.createdAt,
      receivedAt: schema.purchases.receivedAt,
    })
    .from(schema.purchases)
    .innerJoin(
      schema.warehouses,
      eq(schema.purchases.warehouseId, schema.warehouses.id)
    )
    .innerJoin(
      schema.suppliers,
      eq(schema.purchases.supplierId, schema.suppliers.id)
    )
    .where(and(...conditions))
    .orderBy(desc(schema.purchases.createdAt))

  const ids = rows.map((r) => r.id)
  const agregats =
    ids.length > 0
      ? await db
          .select({
            purchaseId: schema.purchaseItems.purchaseId,
            itemCount: sql<number>`COUNT(*)`,
            totalCost: sql<number>`COALESCE(SUM(${schema.purchaseItems.quantity} * ${schema.purchaseItems.unitCost}), 0)`,
          })
          .from(schema.purchaseItems)
          .where(inArray(schema.purchaseItems.purchaseId, ids))
          .groupBy(schema.purchaseItems.purchaseId)
      : []
  const purchases = rows.map((r) => {
    const agregat = agregats.find((a) => a.purchaseId === r.id)
    return {
      ...r,
      itemCount: agregat?.itemCount ?? 0,
      totalCost: agregat?.totalCost ?? 0,
    }
  })
  return c.json({ purchases })
})

purchasesRoute.post("/", async (c) => {
  const corps = await validerCorps(c, purchaseCreateSchema)
  if (!corps.ok) return corps.reponse
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  // Écriture : owner/admin/stock_manager (bypass) ou manager de l'entrepôt.
  // L'entrepôt vient du corps, pas du chemin → verifierAccesEntrepot direct
  // (couvre aussi le cross-tenant : 403).
  const refus = await verifierAccesEntrepot(c, corps.data.warehouseId, [
    "manager",
  ])
  if (refus) return refus
  if (!(await fournisseurExiste(db, organizationId, corps.data.supplierId))) {
    return c.json(
      { code: "INTROUVABLE", message: "Fournisseur introuvable" },
      404
    )
  }
  const id = crypto.randomUUID()
  const maintenant = new Date()
  await db.insert(schema.purchases).values({
    id,
    organizationId,
    warehouseId: corps.data.warehouseId,
    supplierId: corps.data.supplierId,
    reference: corps.data.reference ?? null,
    createdBy: c.get("user").id,
    createdAt: maintenant,
    updatedAt: maintenant,
  })
  return c.json({ id }, 201)
})

purchasesRoute.get("/:id", async (c) => {
  const { organizationId, role } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const achat = await achatScope(db, organizationId, c.req.param("id"))
  if (!achat) {
    return c.json({ code: "INTROUVABLE", message: "Réception introuvable" }, 404)
  }
  const portee = await porteeLectureStock(
    db,
    organizationId,
    c.get("user").id,
    role
  )
  if (!portee.tous && !portee.warehouseIds.includes(achat.warehouseId)) {
    return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
  }
  const entetes = await db
    .select({
      warehouseName: schema.warehouses.name,
      supplierName: schema.suppliers.name,
    })
    .from(schema.purchases)
    .innerJoin(
      schema.warehouses,
      eq(schema.purchases.warehouseId, schema.warehouses.id)
    )
    .innerJoin(
      schema.suppliers,
      eq(schema.purchases.supplierId, schema.suppliers.id)
    )
    .where(eq(schema.purchases.id, achat.id))
    .limit(1)
  const items = await db
    .select({
      id: schema.purchaseItems.id,
      variantId: schema.purchaseItems.variantId,
      productName: schema.products.name,
      variantName: schema.productVariants.name,
      sku: schema.productVariants.sku,
      trackLots: schema.products.trackLots,
      quantity: schema.purchaseItems.quantity,
      unitCost: schema.purchaseItems.unitCost,
      lotNumber: schema.purchaseItems.lotNumber,
      expiryDate: schema.purchaseItems.expiryDate,
    })
    .from(schema.purchaseItems)
    .innerJoin(
      schema.productVariants,
      eq(schema.purchaseItems.variantId, schema.productVariants.id)
    )
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id)
    )
    .where(eq(schema.purchaseItems.purchaseId, achat.id))
    .orderBy(asc(schema.products.name), asc(schema.productVariants.name))
  return c.json({
    purchase: {
      id: achat.id,
      warehouseId: achat.warehouseId,
      warehouseName: entetes[0]?.warehouseName ?? "",
      supplierId: achat.supplierId,
      supplierName: entetes[0]?.supplierName ?? "",
      reference: achat.reference,
      status: achat.status,
      createdAt: achat.createdAt,
      receivedAt: achat.receivedAt,
      items,
    },
  })
})

purchasesRoute.post("/:id/items", async (c) => {
  const corps = await validerCorps(c, purchaseItemCreateSchema)
  if (!corps.ok) return corps.reponse
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const achat = await achatScope(db, organizationId, c.req.param("id"))
  if (!achat) {
    return c.json({ code: "INTROUVABLE", message: "Réception introuvable" }, 404)
  }
  const refus = await verifierAccesEntrepot(c, achat.warehouseId, ["manager"])
  if (refus) return refus
  if (achat.status !== "draft") {
    return c.json(REPONSE_RECEPTION_VALIDEE, 409)
  }
  const variante = await varianteScope(db, organizationId, corps.data.variantId)
  if (!variante) {
    return c.json({ code: "INTROUVABLE", message: "Variante introuvable" }, 404)
  }
  const erreurLot = await verifierReglesLot(
    db,
    variante.productId,
    corps.data.lotNumber ?? null,
    corps.data.expiryDate ?? null
  )
  if (erreurLot) {
    return c.json(
      { code: erreurLot.code, message: erreurLot.message },
      erreurLot.statut
    )
  }
  const id = crypto.randomUUID()
  const maintenant = new Date()
  try {
    // Ligne + updatedAt du document, atomiquement. Si une validation
    // concurrente vient de passer, le trigger purchase_items_recu_insert
    // fait échouer le batch → 409 propre au lieu d'une ligne fantôme.
    await db.batch([
      db.insert(schema.purchaseItems).values({
        id,
        organizationId,
        purchaseId: achat.id,
        variantId: variante.id,
        quantity: corps.data.quantity,
        unitCost: corps.data.unitCost,
        lotNumber: corps.data.lotNumber ?? null,
        expiryDate: corps.data.expiryDate
          ? new Date(corps.data.expiryDate)
          : null,
        createdAt: maintenant,
      }),
      db
        .update(schema.purchases)
        .set({ updatedAt: maintenant })
        .where(eq(schema.purchases.id, achat.id)),
    ])
  } catch (err) {
    if (estErreurDeclencheur(err, "RECEPTION_VALIDEE")) {
      return c.json(REPONSE_RECEPTION_VALIDEE, 409)
    }
    throw err
  }
  return c.json({ id }, 201)
})

purchasesRoute.patch("/:id/items/:itemId", async (c) => {
  const corps = await validerCorps(c, purchaseItemUpdateSchema)
  if (!corps.ok) return corps.reponse
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const achat = await achatScope(db, organizationId, c.req.param("id"))
  if (!achat) {
    return c.json({ code: "INTROUVABLE", message: "Réception introuvable" }, 404)
  }
  const refus = await verifierAccesEntrepot(c, achat.warehouseId, ["manager"])
  if (refus) return refus
  if (achat.status !== "draft") {
    return c.json(REPONSE_RECEPTION_VALIDEE, 409)
  }
  const items = await db
    .select()
    .from(schema.purchaseItems)
    .where(
      and(
        eq(schema.purchaseItems.id, c.req.param("itemId")),
        eq(schema.purchaseItems.purchaseId, achat.id)
      )
    )
    .limit(1)
  const item = items[0]
  if (!item) {
    return c.json({ code: "INTROUVABLE", message: "Ligne introuvable" }, 404)
  }
  const variantes = await db
    .select({ productId: schema.productVariants.productId })
    .from(schema.productVariants)
    .where(eq(schema.productVariants.id, item.variantId))
    .limit(1)
  // Valeurs effectives après fusion : les règles de lot s'appliquent au
  // résultat, pas au seul payload.
  const lotEffectif =
    corps.data.lotNumber !== undefined ? corps.data.lotNumber : item.lotNumber
  const peremptionEffective =
    corps.data.expiryDate !== undefined
      ? corps.data.expiryDate
      : item.expiryDate
  const erreurLot = await verifierReglesLot(
    db,
    variantes[0]?.productId ?? "",
    lotEffectif,
    peremptionEffective
  )
  if (erreurLot) {
    return c.json(
      { code: erreurLot.code, message: erreurLot.message },
      erreurLot.statut
    )
  }
  const maintenant = new Date()
  try {
    await db.batch([
      db
        .update(schema.purchaseItems)
        .set({
          ...(corps.data.quantity !== undefined
            ? { quantity: corps.data.quantity }
            : {}),
          ...(corps.data.unitCost !== undefined
            ? { unitCost: corps.data.unitCost }
            : {}),
          ...(corps.data.lotNumber !== undefined
            ? { lotNumber: corps.data.lotNumber }
            : {}),
          ...(corps.data.expiryDate !== undefined
            ? {
                expiryDate: corps.data.expiryDate
                  ? new Date(corps.data.expiryDate)
                  : null,
              }
            : {}),
        })
        .where(eq(schema.purchaseItems.id, item.id)),
      db
        .update(schema.purchases)
        .set({ updatedAt: maintenant })
        .where(eq(schema.purchases.id, achat.id)),
    ])
  } catch (err) {
    if (estErreurDeclencheur(err, "RECEPTION_VALIDEE")) {
      return c.json(REPONSE_RECEPTION_VALIDEE, 409)
    }
    throw err
  }
  return c.json({ ok: true })
})

purchasesRoute.delete("/:id/items/:itemId", async (c) => {
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const achat = await achatScope(db, organizationId, c.req.param("id"))
  if (!achat) {
    return c.json({ code: "INTROUVABLE", message: "Réception introuvable" }, 404)
  }
  const refus = await verifierAccesEntrepot(c, achat.warehouseId, ["manager"])
  if (refus) return refus
  if (achat.status !== "draft") {
    return c.json(REPONSE_RECEPTION_VALIDEE, 409)
  }
  const maintenant = new Date()
  try {
    const result = await db.batch([
      db
        .delete(schema.purchaseItems)
        .where(
          and(
            eq(schema.purchaseItems.id, c.req.param("itemId")),
            eq(schema.purchaseItems.purchaseId, achat.id)
          )
        )
        .returning({ id: schema.purchaseItems.id }),
      db
        .update(schema.purchases)
        .set({ updatedAt: maintenant })
        .where(eq(schema.purchases.id, achat.id)),
    ])
    if (result[0].length === 0) {
      return c.json({ code: "INTROUVABLE", message: "Ligne introuvable" }, 404)
    }
  } catch (err) {
    if (estErreurDeclencheur(err, "RECEPTION_VALIDEE")) {
      return c.json(REPONSE_RECEPTION_VALIDEE, 409)
    }
    throw err
  }
  return c.json({ ok: true })
})

purchasesRoute.delete("/:id", async (c) => {
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const achat = await achatScope(db, organizationId, c.req.param("id"))
  if (!achat) {
    return c.json({ code: "INTROUVABLE", message: "Réception introuvable" }, 404)
  }
  const refus = await verifierAccesEntrepot(c, achat.warehouseId, ["manager"])
  if (refus) return refus
  if (achat.status !== "draft") {
    return c.json(REPONSE_RECEPTION_VALIDEE, 409)
  }
  // Les lignes suivent par FK ON DELETE CASCADE
  await db.delete(schema.purchases).where(eq(schema.purchases.id, achat.id))
  return c.json({ ok: true })
})
```

Dans `apps/api/src/index.ts`, ajouter l'import `import { purchasesRoute } from "./routes/purchases"` et, après le montage de `stockRoute` :

```ts
app.route("/api/v1/purchases", purchasesRoute)
```

- [ ] **Step 4: Vérifier**

Run: `bun run --cwd apps/api test test/purchases-draft.test.ts`
Expected: PASS — 4 tests.

Run: `bun run --cwd apps/api test && bun run typecheck && bun run lint`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/shared
git commit -m "feat: réceptions fournisseur — brouillon (document et lignes, règles de lot)"
```

---

### Task 9: Validation d'une réception — batch atomique, lots, CMP, immuabilité

`POST /purchases/:id/receive` : en UN batch — passage à `received` (sans filtre de statut : le trigger neutralise la double validation concurrente), création/réutilisation des lots, mouvements `purchase`, upsert des niveaux avec CMP. Un document validé est immuable.

**Files:**
- Modify: `apps/api/src/routes/purchases.ts`
- Create: `apps/api/test/purchases-receive.test.ts`

**Interfaces:**
- Consumes: `applyMovements` + `MouvementStock` + `InstructionBatch` (Task 5), `estErreurDeclencheur`/`estViolationUnicite` (Task 3), `verifierAccesEntrepot` (Task 6), `achatScope` (Task 8, même fichier).
- Produces: `POST /api/v1/purchases/:id/receive` → `200 { ok: true }` ; déjà validée → `409 { code: "STATUT_INVALIDE", message: "Cette réception a déjà été validée" }` ; sans ligne → `400 VALIDATION`. Consommé par la Task 13.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `apps/api/test/purchases-receive.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { and, eq } from "drizzle-orm"
import app from "../src/index"
import * as schema from "../src/db/schema"
import {
  bootstrapOwner,
  createUserWithRole,
  creerEntrepot,
  creerProduitSimple,
  affecterEntrepot,
} from "./helpers"

function req(cookie: string, method: string, url: string, body?: unknown) {
  return app.request(
    url,
    {
      method,
      headers: { "content-type": "application/json", cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env
  )
}

async function seed() {
  const { organizationId, ownerCookie } = await bootstrapOwner()
  const warehouseId = await creerEntrepot(organizationId)
  const fournisseur = await req(ownerCookie, "POST", "/api/v1/suppliers", {
    name: "Sodeci",
  })
  const supplierId = (await fournisseur.json<{ id: string }>()).id
  return { organizationId, ownerCookie, warehouseId, supplierId }
}

async function creerBrouillon(
  ownerCookie: string,
  warehouseId: string,
  supplierId: string,
  items: Array<Record<string, unknown>>
) {
  const creation = await req(ownerCookie, "POST", "/api/v1/purchases", {
    warehouseId,
    supplierId,
  })
  const { id } = await creation.json<{ id: string }>()
  for (const item of items) {
    const ajout = await req(ownerCookie, "POST", `/api/v1/purchases/${id}/items`, item)
    expect(ajout.status).toBe(201)
  }
  return id
}

async function lireNiveau(warehouseId: string, variantId: string) {
  const db = drizzle(env.DB, { schema })
  const rows = await db
    .select()
    .from(schema.stockLevels)
    .where(
      and(
        eq(schema.stockLevels.warehouseId, warehouseId),
        eq(schema.stockLevels.variantId, variantId)
      )
    )
    .limit(1)
  return rows[0] ?? null
}

describe("POST /api/v1/purchases/:id/receive", () => {
  it("valide : mouvements purchase référencés, niveau créé, CMP pondéré sur deux réceptions", async () => {
    const { organizationId, ownerCookie, warehouseId, supplierId } = await seed()
    const { variantId } = await creerProduitSimple(organizationId)

    const premier = await creerBrouillon(ownerCookie, warehouseId, supplierId, [
      { variantId, quantity: 10, unitCost: 100 },
    ])
    expect(
      (await req(ownerCookie, "POST", `/api/v1/purchases/${premier}/receive`)).status
    ).toBe(200)

    let niveau = await lireNiveau(warehouseId, variantId)
    expect(niveau?.quantity).toBe(10)
    expect(niveau?.avgCost).toBe(100)

    const db = drizzle(env.DB, { schema })
    const mouvements = await db
      .select()
      .from(schema.stockMovements)
      .where(eq(schema.stockMovements.refId, premier))
    expect(mouvements).toHaveLength(1)
    expect(mouvements[0]?.type).toBe("purchase")
    expect(mouvements[0]?.refType).toBe("purchase")
    expect(mouvements[0]?.delta).toBe(10)

    // Deuxième réception 5 à 160 → CMP round((10×100 + 5×160)/15) = 120
    const second = await creerBrouillon(ownerCookie, warehouseId, supplierId, [
      { variantId, quantity: 5, unitCost: 160 },
    ])
    await req(ownerCookie, "POST", `/api/v1/purchases/${second}/receive`)
    niveau = await lireNiveau(warehouseId, variantId)
    expect(niveau?.quantity).toBe(15)
    expect(niveau?.avgCost).toBe(120)

    // Le document est passé received, horodaté et attribué
    const detail = await req(ownerCookie, "GET", `/api/v1/purchases/${premier}`)
    const { purchase } = await detail.json<{
      purchase: { status: string; receivedAt: string | null }
    }>()
    expect(purchase.status).toBe("received")
    expect(purchase.receivedAt).not.toBeNull()
  })

  it("lots : créés à la validation pour trackLots, réutilisés si même numéro", async () => {
    const { organizationId, ownerCookie, warehouseId, supplierId } = await seed()
    const { variantId } = await creerProduitSimple(organizationId, {
      nom: "Yaourt",
      trackLots: true,
    })

    const premier = await creerBrouillon(ownerCookie, warehouseId, supplierId, [
      {
        variantId,
        quantity: 6,
        unitCost: 200,
        lotNumber: "LOT-A",
        expiryDate: "2026-12-31",
      },
    ])
    await req(ownerCookie, "POST", `/api/v1/purchases/${premier}/receive`)

    const db = drizzle(env.DB, { schema })
    let lots = await db
      .select()
      .from(schema.lots)
      .where(eq(schema.lots.variantId, variantId))
    expect(lots).toHaveLength(1)
    expect(lots[0]?.lotNumber).toBe("LOT-A")

    // Deuxième réception, même numéro de lot → PAS de doublon
    const second = await creerBrouillon(ownerCookie, warehouseId, supplierId, [
      { variantId, quantity: 4, unitCost: 200, lotNumber: "LOT-A" },
    ])
    await req(ownerCookie, "POST", `/api/v1/purchases/${second}/receive`)
    lots = await db
      .select()
      .from(schema.lots)
      .where(eq(schema.lots.variantId, variantId))
    expect(lots).toHaveLength(1)

    // Les mouvements pointent le lot
    const mouvements = await db
      .select()
      .from(schema.stockMovements)
      .where(eq(schema.stockMovements.variantId, variantId))
    expect(mouvements.every((m) => m.lotId === lots[0]?.id)).toBe(true)
  })

  it("immuabilité : re-valider → 409 STATUT_INVALIDE sans double stock ; modifier/supprimer → 409 RECEPTION_VALIDEE", async () => {
    const { organizationId, ownerCookie, warehouseId, supplierId } = await seed()
    const { variantId } = await creerProduitSimple(organizationId)
    const id = await creerBrouillon(ownerCookie, warehouseId, supplierId, [
      { variantId, quantity: 10, unitCost: 100 },
    ])
    await req(ownerCookie, "POST", `/api/v1/purchases/${id}/receive`)

    const revalidation = await req(ownerCookie, "POST", `/api/v1/purchases/${id}/receive`)
    expect(revalidation.status).toBe(409)
    expect((await revalidation.json<{ code: string }>()).code).toBe(
      "STATUT_INVALIDE"
    )
    // pas de double application
    expect((await lireNiveau(warehouseId, variantId))?.quantity).toBe(10)

    const ajout = await req(ownerCookie, "POST", `/api/v1/purchases/${id}/items`, {
      variantId,
      quantity: 1,
      unitCost: 100,
    })
    expect(ajout.status).toBe(409)
    expect((await ajout.json<{ code: string }>()).code).toBe("RECEPTION_VALIDEE")

    const suppression = await req(ownerCookie, "DELETE", `/api/v1/purchases/${id}`)
    expect(suppression.status).toBe(409)
    expect((await suppression.json<{ code: string }>()).code).toBe(
      "RECEPTION_VALIDEE"
    )
  })

  it("sans ligne → 400 ; auditeur d'entrepôt → 403 ; manager de l'entrepôt → 200", async () => {
    const { organizationId, ownerCookie, warehouseId, supplierId } = await seed()
    const { variantId } = await creerProduitSimple(organizationId)

    const vide = await creerBrouillon(ownerCookie, warehouseId, supplierId, [])
    const validationVide = await req(
      ownerCookie,
      "POST",
      `/api/v1/purchases/${vide}/receive`
    )
    expect(validationVide.status).toBe(400)

    const id = await creerBrouillon(ownerCookie, warehouseId, supplierId, [
      { variantId, quantity: 2, unitCost: 50 },
    ])
    const auditeur = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, auditeur.userId, warehouseId, "auditor")
    expect(
      (await req(auditeur.cookie, "POST", `/api/v1/purchases/${id}/receive`)).status
    ).toBe(403)

    const manager = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, manager.userId, warehouseId, "manager")
    expect(
      (await req(manager.cookie, "POST", `/api/v1/purchases/${id}/receive`)).status
    ).toBe(200)
  })
})
```

Run: `bun run --cwd apps/api test test/purchases-receive.test.ts`
Expected: FAIL — 404 sur `/receive`.

- [ ] **Step 2: Implémenter la validation**

Dans `apps/api/src/routes/purchases.ts`, compléter les imports :

```ts
import { applyMovements } from "../services/stock"
import type { InstructionBatch, MouvementStock } from "../services/stock"
import { estViolationUnicite } from "../lib/db-errors"
```

(fusionner `estViolationUnicite` avec l'import `estErreurDeclencheur` existant.)

Puis ajouter le handler, juste avant `purchasesRoute.delete("/:id", …)` :

```ts
purchasesRoute.post("/:id/receive", async (c) => {
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const achat = await achatScope(db, organizationId, c.req.param("id"))
  if (!achat) {
    return c.json({ code: "INTROUVABLE", message: "Réception introuvable" }, 404)
  }
  const refus = await verifierAccesEntrepot(c, achat.warehouseId, ["manager"])
  if (refus) return refus
  if (achat.status !== "draft") {
    return c.json(
      { code: "STATUT_INVALIDE", message: "Cette réception a déjà été validée" },
      409
    )
  }
  const items = await db
    .select()
    .from(schema.purchaseItems)
    .where(eq(schema.purchaseItems.purchaseId, achat.id))
  if (items.length === 0) {
    return c.json(
      {
        code: "VALIDATION",
        message: "Impossible de valider une réception sans ligne",
      },
      400
    )
  }

  const maintenant = new Date()

  // Lots : réutiliser le lot existant (variantId, lotNumber), sinon en créer
  // un DANS le même batch. Clé de map `${variantId} ${lotNumber}` : sans
  // ambiguïté, un variantId est un UUID qui ne contient jamais d'espace.
  type LotResolu = {
    id: string
    nouveau: boolean
    variantId: string
    lotNumber: string
    expiryDate: Date | null
  }
  const itemsAvecLot = items.filter((i) => i.lotNumber !== null)
  const variantIdsLots = [...new Set(itemsAvecLot.map((i) => i.variantId))]
  const lotsExistants =
    variantIdsLots.length > 0
      ? await db
          .select()
          .from(schema.lots)
          .where(inArray(schema.lots.variantId, variantIdsLots))
      : []
  const lotParCle = new Map<string, LotResolu>()
  for (const item of itemsAvecLot) {
    const lotNumber = item.lotNumber
    if (lotNumber === null) continue
    const cle = `${item.variantId} ${lotNumber}`
    if (lotParCle.has(cle)) continue
    const existant = lotsExistants.find(
      (l) => l.variantId === item.variantId && l.lotNumber === lotNumber
    )
    lotParCle.set(
      cle,
      existant
        ? {
            id: existant.id,
            nouveau: false,
            variantId: existant.variantId,
            lotNumber: existant.lotNumber,
            expiryDate: existant.expiryDate,
          }
        : {
            id: crypto.randomUUID(),
            nouveau: true,
            variantId: item.variantId,
            lotNumber,
            expiryDate: item.expiryDate,
          }
    )
  }
  const insertionsLots = [...lotParCle.values()]
    .filter((lot) => lot.nouveau)
    .map((lot) =>
      db.insert(schema.lots).values({
        id: lot.id,
        organizationId,
        variantId: lot.variantId,
        lotNumber: lot.lotNumber,
        expiryDate: lot.expiryDate,
        createdAt: maintenant,
      })
    )

  // Passage received SANS filtre de statut dans le WHERE : si une validation
  // concurrente est passée entre notre pré-contrôle et le batch, le trigger
  // purchases_recu_immuable (old.status = 'received') fait échouer CE batch
  // ENTIER — au lieu d'un UPDATE « 0 ligne » silencieux qui laisserait les
  // mouvements s'appliquer une seconde fois.
  const majStatut = db
    .update(schema.purchases)
    .set({
      status: "received",
      receivedAt: maintenant,
      receivedBy: c.get("user").id,
      updatedAt: maintenant,
    })
    .where(eq(schema.purchases.id, achat.id))

  const mouvements: MouvementStock[] = items.map((item) => ({
    warehouseId: achat.warehouseId,
    variantId: item.variantId,
    lotId:
      item.lotNumber !== null
        ? (lotParCle.get(`${item.variantId} ${item.lotNumber}`)?.id ?? null)
        : null,
    delta: item.quantity,
    type: "purchase",
    refType: "purchase",
    refId: achat.id,
    unitCost: item.unitCost,
  }))

  // Batch hétérogène construit directement (spread, pas de push + cast)
  const instructionsAvant: InstructionBatch[] = [majStatut, ...insertionsLots]
  try {
    await applyMovements(db, {
      organizationId,
      userId: c.get("user").id,
      mouvements,
      instructionsAvant,
      date: maintenant,
    })
  } catch (err) {
    if (estErreurDeclencheur(err, "RECEPTION_VALIDEE")) {
      return c.json(
        {
          code: "STATUT_INVALIDE",
          message: "Cette réception a déjà été validée",
        },
        409
      )
    }
    if (estViolationUnicite(err, "lots_variant_lot_uidx")) {
      // Course rarissime : un lot de même numéro créé entre notre lecture et
      // le batch. Rejouable sans risque : au retry, le lot sera réutilisé.
      return c.json(
        {
          code: "LOT_EXISTANT",
          message: "Conflit sur un numéro de lot, veuillez réessayer",
        },
        409
      )
    }
    throw err
  }
  return c.json({ ok: true })
})
```

- [ ] **Step 3: Vérifier**

Run: `bun run --cwd apps/api test test/purchases-receive.test.ts`
Expected: PASS — 4 tests.

Run: `bun run --cwd apps/api test && bun run typecheck && bun run lint`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/api
git commit -m "feat: validation de réception — batch atomique, lots réutilisés, CMP, immuabilité"
```

---

### Task 10: Réconciliation journal → niveaux (endpoint admin, dry-run par défaut)

Recalcule les QUANTITÉS de `stock_levels` depuis `stock_movements` (jamais le CMP), rapporte les écarts, et ne les applique que sur demande explicite (`?appliquer=true`). Vit dans le service pour préserver l'invariant « seul stockService écrit stock_levels ».

**Files:**
- Modify: `apps/api/src/services/stock.ts`
- Modify: `apps/api/src/routes/stock.ts`
- Create: `apps/api/test/stock-reconcile.test.ts`

**Interfaces:**
- Consumes: `requireRole` (Phase 2), tables Task 3.
- Produces: `reconcilier(db, params: { organizationId: string; appliquer: boolean }): Promise<{ ecarts: EcartReconciliation[]; applique: boolean }>` avec `type EcartReconciliation = { warehouseId: string; variantId: string; quantiteJournal: number; quantiteNiveaux: number; ecart: number; applicable: boolean }`.
- Produces: `POST /api/v1/stock/reconcile?appliquer=true` (owner/admin) → `200 { ecarts, applique }`. Pas d'écran web en v1 (commande d'exploitation, appelable via curl — documentée dans la vérification finale).

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `apps/api/test/stock-reconcile.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { and, eq } from "drizzle-orm"
import app from "../src/index"
import * as schema from "../src/db/schema"
import { applyMovements } from "../src/services/stock"
import {
  bootstrapOwner,
  createUserWithRole,
  creerEntrepot,
  creerProduitSimple,
} from "./helpers"

function reconcile(cookie: string, appliquer = false) {
  return app.request(
    `/api/v1/stock/reconcile${appliquer ? "?appliquer=true" : ""}`,
    { method: "POST", headers: { cookie } },
    env
  )
}

type Ecart = {
  warehouseId: string
  variantId: string
  quantiteJournal: number
  quantiteNiveaux: number
  ecart: number
  applicable: boolean
}

describe("POST /api/v1/stock/reconcile", () => {
  it("dry-run par défaut : rapporte l'écart sans corriger ; appliquer=true corrige la quantité sans toucher le CMP", async () => {
    const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
    const warehouseId = await creerEntrepot(organizationId)
    const { variantId } = await creerProduitSimple(organizationId)
    const db = drizzle(env.DB, { schema })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId, variantId, delta: 10, type: "purchase", unitCost: 150 },
      ],
    })

    // Sans écart : rapport vide
    const propre = await reconcile(ownerCookie)
    expect(propre.status).toBe(200)
    expect((await propre.json<{ ecarts: Ecart[] }>()).ecarts).toEqual([])

    // Corruption directe du niveau (stock_levels n'a pas de trigger : seule
    // la discipline applicative le protège — c'est exactement ce que la
    // réconciliation détecte)
    await db
      .update(schema.stockLevels)
      .set({ quantity: 99 })
      .where(
        and(
          eq(schema.stockLevels.warehouseId, warehouseId),
          eq(schema.stockLevels.variantId, variantId)
        )
      )

    const dryRun = await reconcile(ownerCookie)
    const corpsDryRun = await dryRun.json<{ ecarts: Ecart[]; applique: boolean }>()
    expect(corpsDryRun.applique).toBe(false)
    expect(corpsDryRun.ecarts).toEqual([
      {
        warehouseId,
        variantId,
        quantiteJournal: 10,
        quantiteNiveaux: 99,
        ecart: 89,
        applicable: true,
      },
    ])
    // dry-run : rien n'a bougé
    const niveauApresDryRun = await db
      .select({ quantity: schema.stockLevels.quantity })
      .from(schema.stockLevels)
      .where(eq(schema.stockLevels.variantId, variantId))
    expect(niveauApresDryRun[0]?.quantity).toBe(99)

    const application = await reconcile(ownerCookie, true)
    expect((await application.json<{ applique: boolean }>()).applique).toBe(true)
    const niveau = await db
      .select()
      .from(schema.stockLevels)
      .where(eq(schema.stockLevels.variantId, variantId))
    expect(niveau[0]?.quantity).toBe(10)
    // le CMP n'est JAMAIS recalculé par la réconciliation
    expect(niveau[0]?.avgCost).toBe(150)
  })

  it("recrée une ligne de niveau manquante depuis le journal", async () => {
    const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
    const warehouseId = await creerEntrepot(organizationId)
    const { variantId } = await creerProduitSimple(organizationId)
    const db = drizzle(env.DB, { schema })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId, variantId, delta: 7, type: "adjustment", reason: "init" },
      ],
    })
    await db
      .delete(schema.stockLevels)
      .where(eq(schema.stockLevels.variantId, variantId))

    const res = await reconcile(ownerCookie, true)
    const corps = await res.json<{ ecarts: Ecart[] }>()
    expect(corps.ecarts).toHaveLength(1)
    expect(corps.ecarts[0]?.quantiteJournal).toBe(7)
    expect(corps.ecarts[0]?.quantiteNiveaux).toBe(0)

    const niveau = await db
      .select({ quantity: schema.stockLevels.quantity })
      .from(schema.stockLevels)
      .where(eq(schema.stockLevels.variantId, variantId))
    expect(niveau[0]?.quantity).toBe(7)
  })

  it("réservé à owner/admin : stock_manager et staff → 403", async () => {
    const { organizationId } = await bootstrapOwner()
    const gestStock = await createUserWithRole(organizationId, "stock_manager")
    const staff = await createUserWithRole(organizationId, "staff")
    expect((await reconcile(gestStock.cookie)).status).toBe(403)
    expect((await reconcile(staff.cookie)).status).toBe(403)
  })
})
```

Run: `bun run --cwd apps/api test test/stock-reconcile.test.ts`
Expected: FAIL — 404 (route absente).

- [ ] **Step 2: Implémenter reconcilier dans le service**

À la fin de `apps/api/src/services/stock.ts`, ajouter (compléter l'import drizzle en tête : `import { eq, inArray, sql } from "drizzle-orm"`) :

```ts
export type EcartReconciliation = {
  warehouseId: string
  variantId: string
  quantiteJournal: number
  quantiteNiveaux: number
  ecart: number
  // false si la somme du journal est négative (données corrompues) : on la
  // rapporte mais on refuse de l'appliquer (le CHECK la rejetterait).
  applicable: boolean
}

// Recalcule les QUANTITÉS de stock_levels depuis le journal — jamais le CMP :
// rejouer la valorisation historique exigerait de rejouer chaque réception
// dans l'ordre, hors périmètre. Le CMP courant reste la référence.
// Dry-run par défaut ; l'application est demandée explicitement.
export async function reconcilier(
  db: Db,
  params: { organizationId: string; appliquer: boolean }
): Promise<{ ecarts: EcartReconciliation[]; applique: boolean }> {
  const sommes = await db
    .select({
      warehouseId: schema.stockMovements.warehouseId,
      variantId: schema.stockMovements.variantId,
      quantiteJournal: sql<number>`COALESCE(SUM(${schema.stockMovements.delta}), 0)`,
    })
    .from(schema.stockMovements)
    .where(eq(schema.stockMovements.organizationId, params.organizationId))
    .groupBy(
      schema.stockMovements.warehouseId,
      schema.stockMovements.variantId
    )
  const niveaux = await db
    .select({
      warehouseId: schema.stockLevels.warehouseId,
      variantId: schema.stockLevels.variantId,
      quantity: schema.stockLevels.quantity,
    })
    .from(schema.stockLevels)
    .where(eq(schema.stockLevels.organizationId, params.organizationId))

  const journalParCle = new Map(
    sommes.map((s) => [`${s.warehouseId}|${s.variantId}`, s.quantiteJournal])
  )
  const niveauParCle = new Map(
    niveaux.map((n) => [`${n.warehouseId}|${n.variantId}`, n.quantity])
  )
  const cles = new Set([...journalParCle.keys(), ...niveauParCle.keys()])

  const ecarts: EcartReconciliation[] = []
  for (const cle of cles) {
    const quantiteJournal = journalParCle.get(cle) ?? 0
    const quantiteNiveaux = niveauParCle.get(cle) ?? 0
    if (quantiteJournal === quantiteNiveaux) continue
    const [warehouseId = "", variantId = ""] = cle.split("|")
    ecarts.push({
      warehouseId,
      variantId,
      quantiteJournal,
      quantiteNiveaux,
      ecart: quantiteNiveaux - quantiteJournal,
      applicable: quantiteJournal >= 0,
    })
  }
  ecarts.sort((a, b) =>
    `${a.warehouseId}|${a.variantId}` < `${b.warehouseId}|${b.variantId}`
      ? -1
      : 1
  )

  const corrigeables = ecarts.filter((e) => e.applicable)
  if (!params.appliquer || corrigeables.length === 0) {
    return { ecarts, applique: false }
  }

  const maintenant = new Date()
  const corrections = corrigeables.map((e) =>
    db
      .insert(schema.stockLevels)
      .values({
        id: crypto.randomUUID(),
        organizationId: params.organizationId,
        warehouseId: e.warehouseId,
        variantId: e.variantId,
        quantity: e.quantiteJournal,
        avgCost: 0,
        minStock: null,
        updatedAt: maintenant,
      })
      .onConflictDoUpdate({
        target: [schema.stockLevels.warehouseId, schema.stockLevels.variantId],
        set: { quantity: e.quantiteJournal, updatedAt: maintenant },
      })
  )
  const [premiere, ...reste] = corrections
  if (premiere) {
    await db.batch([premiere, ...reste])
  }
  return { ecarts, applique: true }
}
```

- [ ] **Step 3: Exposer la route admin**

Dans `apps/api/src/routes/stock.ts` : ajouter `requireRole` à l'import de `../middleware/permissions` et `reconcilier` à l'import de `../services/stock`, puis ajouter en fin de fichier :

```ts
// Commande d'exploitation : recalcul des quantités depuis le journal.
// Dry-run par défaut ; POST /reconcile?appliquer=true pour corriger.
stockRoute.post("/reconcile", requireRole("owner", "admin"), async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const resultat = await reconcilier(db, {
    organizationId: c.get("membership").organizationId,
    appliquer: c.req.query("appliquer") === "true",
  })
  return c.json(resultat)
})
```

- [ ] **Step 4: Vérifier**

Run: `bun run --cwd apps/api test test/stock-reconcile.test.ts`
Expected: PASS — 3 tests.

Run: `bun run --cwd apps/api test && bun run typecheck && bun run lint`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat: réconciliation journal vers niveaux (dry-run par défaut, owner/admin)"
```

---

### Task 11: Web — navigation Stock, écran des niveaux, ajustement, seuil, badge d'alertes

Section « Stock » dans la sidebar (visible selon la portée de lecture), badge du nombre d'alertes à côté de « Niveaux », écran `/stock` : sélecteur d'entrepôt, recherche debouncée, filtre « alertes seulement », et pour les rôles autorisés dialogues « Ajuster » et « Seuil ».

**Files:**
- Modify: `apps/web/src/lib/permissions.ts`
- Create: `apps/web/src/lib/stock.ts`
- Modify: `apps/web/src/routes/_app.tsx`
- Create: `apps/web/src/routes/_app/stock/index.tsx`
- Create: `apps/web/src/routes/_app/stock/mouvements.tsx` (placeholder, remplacé en Task 12)
- Create: `apps/web/src/routes/_app/stock/receptions/index.tsx` (placeholder, remplacé en Task 13)

**Interfaces:**
- Consumes: `GET /api/v1/stock/levels`, `GET /api/v1/stock/alerts`, `POST /api/v1/stock/warehouses/:warehouseId/adjustments`, `PATCH /api/v1/stock/warehouses/:warehouseId/levels/:variantId` (Tasks 6-7) ; `GET /api/v1/warehouses` (Phase 2, réservé aux rôles d'entreprise) ; `me.assignments` du contexte `/_app` ; `usePeutEcrire` (Task 2, même fichier).
- Produces: `useAccesStock(): AccesStock` avec `type AccesStock = { lecture: boolean; lectureTous: boolean; entrepotsLecture: string[]; ecritureTous: boolean; entrepotsEcriture: string[] }` (`src/lib/permissions.ts`).
- Produces (`src/lib/stock.ts`, consommé par les Tasks 12 et 13) :
  - `useEntrepotsVisibles(): { options: EntrepotOption[]; isPending: boolean }` avec `type EntrepotOption = { id: string; name: string }`
  - `type NiveauStock = { variantId: string; productId: string; productName: string; variantName: string; sku: string; quantity: number; avgCost: number; minStock: number | null; seuilEffectif: number | null; enAlerte: boolean }`
  - `type MouvementJournal = { id: string; createdAt: string; warehouseId: string; warehouseName: string; variantId: string; productName: string; variantName: string; sku: string; delta: number; type: string; reason: string | null; refType: string | null; refId: string | null; userName: string; lotNumber: string | null }`
  - `LIBELLES_TYPE_MOUVEMENT: Record<string, string>`

- [ ] **Step 1: Étendre les helpers de permissions et créer lib/stock.ts**

À la fin de `apps/web/src/lib/permissions.ts`, ajouter :

```ts
export type AccesStock = {
  // au moins un entrepôt lisible
  lecture: boolean
  // owner/admin/auditor/stock_manager : tout voir
  lectureTous: boolean
  // entrepôts lisibles d'un staff (rôles locaux manager/auditor)
  entrepotsLecture: string[]
  // owner/admin/stock_manager : écrire partout
  ecritureTous: boolean
  // entrepôts où un staff est manager
  entrepotsEcriture: string[]
}

// Miroir front de la portée stock de l'API (matrice spec §4) — le front
// masque, l'API fait autorité.
export function useAccesStock(): AccesStock {
  const { me } = useRouteContext({ from: "/_app" })
  const role = me.membership?.role
  const lectureTous =
    role === "owner" ||
    role === "admin" ||
    role === "auditor" ||
    role === "stock_manager"
  const ecritureTous =
    role === "owner" || role === "admin" || role === "stock_manager"
  const entrepotsLecture = me.assignments
    .filter((a) => a.role === "manager" || a.role === "auditor")
    .map((a) => a.warehouseId)
  const entrepotsEcriture = me.assignments
    .filter((a) => a.role === "manager")
    .map((a) => a.warehouseId)
  return {
    lecture: lectureTous || entrepotsLecture.length > 0,
    lectureTous,
    entrepotsLecture,
    ecritureTous,
    entrepotsEcriture,
  }
}
```

Créer `apps/web/src/lib/stock.ts` :

```ts
import { useQuery } from "@tanstack/react-query"
import { useRouteContext } from "@tanstack/react-router"
import { apiFetch } from "./api"
import { useAccesStock } from "./permissions"

export type EntrepotOption = { id: string; name: string }

export type NiveauStock = {
  variantId: string
  productId: string
  productName: string
  variantName: string
  sku: string
  quantity: number
  avgCost: number
  minStock: number | null
  seuilEffectif: number | null
  enAlerte: boolean
}

export type MouvementJournal = {
  id: string
  createdAt: string
  warehouseId: string
  warehouseName: string
  variantId: string
  productName: string
  variantName: string
  sku: string
  delta: number
  type: string
  reason: string | null
  refType: string | null
  refId: string | null
  userName: string
  lotNumber: string | null
}

export const LIBELLES_TYPE_MOUVEMENT: Record<string, string> = {
  purchase: "Réception",
  sale: "Vente",
  transfer_out: "Transfert (sortie)",
  transfer_in: "Transfert (entrée)",
  adjustment: "Ajustement",
  count: "Inventaire",
}

// Entrepôts proposés dans les sélecteurs : les rôles d'entreprise chargent
// la liste complète (GET /warehouses leur est réservé) ; un staff se
// contente de ses affectations manager/auditor (déjà dans le contexte me).
export function useEntrepotsVisibles(): {
  options: EntrepotOption[]
  isPending: boolean
} {
  const acces = useAccesStock()
  const { me } = useRouteContext({ from: "/_app" })
  const entrepots = useQuery({
    queryKey: ["warehouses"],
    queryFn: () =>
      apiFetch<{ warehouses: Array<{ id: string; name: string }> }>(
        "/api/v1/warehouses"
      ),
    enabled: acces.lectureTous,
  })
  if (acces.lectureTous) {
    return {
      options: (entrepots.data?.warehouses ?? []).map((w) => ({
        id: w.id,
        name: w.name,
      })),
      isPending: entrepots.isPending,
    }
  }
  return {
    options: me.assignments
      .filter((a) => a.role === "manager" || a.role === "auditor")
      .map((a) => ({ id: a.warehouseId, name: a.warehouseName })),
    isPending: false,
  }
}
```

- [ ] **Step 2: Navigation Stock + badge d'alertes + placeholders de routes**

Dans `apps/web/src/routes/_app.tsx` :

2a. Compléter les imports en tête de fichier :

```tsx
import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { useAccesStock } from "@/lib/permissions"
import { Badge } from "@/components/ui/badge"
```

2b. Dans `AppLayout`, après la ligne `const estAdmin = …`, ajouter :

```tsx
  const accesStock = useAccesStock()
```

2c. Insérer le bloc Stock dans la `<nav>`, entre le lien « Fournisseurs » et le bloc `{estAdmin && (…)}` :

```tsx
            {accesStock.lecture && (
              <>
                <p className="mt-4 mb-1 px-2 text-[11px] font-medium tracking-widest text-gray-400 uppercase">
                  Stock
                </p>
                <Link to="/stock" className={lienClasses}>
                  <span className="flex items-center gap-2">
                    Niveaux
                    <BadgeAlertesStock />
                  </span>
                </Link>
                <Link to="/stock/mouvements" className={lienClasses}>
                  Mouvements
                </Link>
                <Link to="/stock/receptions" className={lienClasses}>
                  Réceptions
                </Link>
              </>
            )}
```

2d. Ajouter en fin de fichier :

```tsx
function BadgeAlertesStock() {
  const { data } = useQuery({
    queryKey: ["stock-alerts"],
    queryFn: () => apiFetch<{ total: number }>("/api/v1/stock/alerts"),
    refetchInterval: 60_000,
  })
  if (!data || data.total === 0) {
    return null
  }
  return <Badge variant="destructive">{data.total}</Badge>
}
```

2e. Les liens `/stock/mouvements` et `/stock/receptions` doivent exister pour le typecheck du router : créer des placeholders remplacés en Tasks 12-13.

Créer `apps/web/src/routes/_app/stock/mouvements.tsx` :

```tsx
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_app/stock/mouvements")({
  component: () => <p className="text-sm text-gray-500">Bientôt disponible.</p>,
})
```

Créer `apps/web/src/routes/_app/stock/receptions/index.tsx` :

```tsx
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_app/stock/receptions/")({
  component: () => <p className="text-sm text-gray-500">Bientôt disponible.</p>,
})
```

- [ ] **Step 3: Écran des niveaux**

Créer `apps/web/src/routes/_app/stock/index.tsx` :

```tsx
import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { formaterMontant } from "@/lib/format"
import { useAccesStock } from "@/lib/permissions"
import { useEntrepotsVisibles } from "@/lib/stock"
import type { NiveauStock } from "@/lib/stock"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const Route = createFileRoute("/_app/stock/")({
  component: NiveauxStockPage,
})

function NiveauxStockPage() {
  const acces = useAccesStock()
  const { options: entrepots, isPending: entrepotsEnCours } =
    useEntrepotsVisibles()
  const queryClient = useQueryClient()

  const [entrepotId, setEntrepotId] = useState("")
  // Présélectionne le premier entrepôt dès que la liste arrive
  useEffect(() => {
    if (!entrepotId && entrepots.length > 0) {
      setEntrepotId(entrepots[0]?.id ?? "")
    }
  }, [entrepots, entrepotId])

  const [recherche, setRecherche] = useState("")
  const [rechercheDebouncee, setRechercheDebouncee] = useState("")
  useEffect(() => {
    const timer = setTimeout(() => setRechercheDebouncee(recherche), 300)
    return () => clearTimeout(timer)
  }, [recherche])
  const [alertesSeules, setAlertesSeules] = useState(false)

  const niveaux = useQuery({
    queryKey: ["stock-levels", entrepotId, rechercheDebouncee, alertesSeules],
    queryFn: () => {
      const params = new URLSearchParams({ warehouseId: entrepotId })
      if (rechercheDebouncee) params.set("recherche", rechercheDebouncee)
      if (alertesSeules) params.set("alertes", "true")
      return apiFetch<{ levels: NiveauStock[] }>(
        `/api/v1/stock/levels?${params.toString()}`
      )
    },
    enabled: entrepotId !== "",
  })

  const peutEcrireIci =
    acces.ecritureTous || acces.entrepotsEcriture.includes(entrepotId)

  const invalider = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["stock-levels"] }),
      queryClient.invalidateQueries({ queryKey: ["stock-alerts"] }),
      queryClient.invalidateQueries({ queryKey: ["stock-movements"] }),
    ])

  // Dialogue d'ajustement
  const [ajustementPour, setAjustementPour] = useState<NiveauStock | null>(null)
  const [delta, setDelta] = useState("")
  const [motif, setMotif] = useState("")
  const [erreurAjustement, setErreurAjustement] = useState<string | null>(null)

  const ajuster = useMutation({
    mutationFn: (niveau: NiveauStock) =>
      apiFetch(`/api/v1/stock/warehouses/${entrepotId}/adjustments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          variantId: niveau.variantId,
          delta: Number(delta),
          reason: motif,
        }),
      }),
    onSuccess: async () => {
      await invalider()
      setAjustementPour(null)
      setDelta("")
      setMotif("")
      setErreurAjustement(null)
    },
    onError: (err) =>
      setErreurAjustement(err instanceof Error ? err.message : "Erreur"),
  })

  // Dialogue de seuil
  const [seuilPour, setSeuilPour] = useState<NiveauStock | null>(null)
  const [seuil, setSeuil] = useState("")
  const [erreurSeuil, setErreurSeuil] = useState<string | null>(null)

  const definirSeuil = useMutation({
    mutationFn: (niveau: NiveauStock) =>
      apiFetch(
        `/api/v1/stock/warehouses/${entrepotId}/levels/${niveau.variantId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            minStock: seuil === "" ? null : Number(seuil),
          }),
        }
      ),
    onSuccess: async () => {
      await invalider()
      setSeuilPour(null)
      setSeuil("")
      setErreurSeuil(null)
    },
    onError: (err) =>
      setErreurSeuil(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">Niveaux de stock</h1>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="n-entrepot">Entrepôt</Label>
          <select
            id="n-entrepot"
            value={entrepotId}
            onChange={(e) => setEntrepotId(e.target.value)}
            className="h-10 rounded-md border px-2 text-sm"
          >
            {entrepots.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="n-recherche">
            Recherche (produit, SKU, code-barres)
          </Label>
          <Input
            id="n-recherche"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            className="w-72"
          />
        </div>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={alertesSeules}
            onChange={(e) => setAlertesSeules(e.target.checked)}
          />
          Alertes seulement
        </label>
      </div>

      {entrepotsEnCours || niveaux.isPending ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produit</TableHead>
              <TableHead>Variante</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Quantité</TableHead>
              <TableHead>CMP</TableHead>
              <TableHead>Seuil</TableHead>
              {peutEcrireIci && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(niveaux.data?.levels ?? []).map((n) => (
              <TableRow key={n.variantId}>
                <TableCell className="font-medium">{n.productName}</TableCell>
                <TableCell>{n.variantName}</TableCell>
                <TableCell className="font-mono text-xs">{n.sku}</TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    {n.quantity}
                    {n.enAlerte && (
                      <Badge variant="destructive">Stock bas</Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell>{formaterMontant(n.avgCost)}</TableCell>
                <TableCell>
                  {n.seuilEffectif === null
                    ? "—"
                    : `${n.seuilEffectif}${n.minStock === null ? " (produit)" : ""}`}
                </TableCell>
                {peutEcrireIci && (
                  <TableCell>
                    <span className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setErreurAjustement(null)
                          setAjustementPour(n)
                        }}
                      >
                        Ajuster
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setErreurSeuil(null)
                          setSeuil(
                            n.minStock === null ? "" : String(n.minStock)
                          )
                          setSeuilPour(n)
                        }}
                      >
                        Seuil
                      </Button>
                    </span>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {niveaux.data?.levels.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={peutEcrireIci ? 7 : 6}
                  className="text-center text-sm text-gray-500"
                >
                  Aucun article en stock pour cet entrepôt.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      {ajustementPour !== null && (
        <Dialog
          open
          onOpenChange={(ouvert) => {
            if (!ouvert) setAjustementPour(null)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Ajuster — {ajustementPour.productName} (
                {ajustementPour.variantName})
              </DialogTitle>
            </DialogHeader>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                setErreurAjustement(null)
                ajuster.mutate(ajustementPour)
              }}
            >
              <p className="text-sm text-gray-500">
                Stock actuel : {ajustementPour.quantity}
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="a-delta">Delta (+ entrée, − sortie)</Label>
                <Input
                  id="a-delta"
                  type="number"
                  step={1}
                  required
                  value={delta}
                  onChange={(e) => setDelta(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="a-motif">Motif (obligatoire)</Label>
                <Input
                  id="a-motif"
                  required
                  value={motif}
                  onChange={(e) => setMotif(e.target.value)}
                />
              </div>
              {erreurAjustement && (
                <p role="alert" className="text-sm text-red-700">
                  {erreurAjustement}
                </p>
              )}
              <Button type="submit" disabled={ajuster.isPending}>
                {ajuster.isPending ? "Ajustement…" : "Ajuster le stock"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {seuilPour !== null && (
        <Dialog
          open
          onOpenChange={(ouvert) => {
            if (!ouvert) setSeuilPour(null)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Seuil d'alerte — {seuilPour.productName} ({seuilPour.variantName})
              </DialogTitle>
            </DialogHeader>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                setErreurSeuil(null)
                definirSeuil.mutate(seuilPour)
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="s-seuil">
                  Seuil pour cet entrepôt (vide = hériter du produit)
                </Label>
                <Input
                  id="s-seuil"
                  type="number"
                  min={0}
                  step={1}
                  value={seuil}
                  onChange={(e) => setSeuil(e.target.value)}
                />
              </div>
              {erreurSeuil && (
                <p role="alert" className="text-sm text-red-700">
                  {erreurSeuil}
                </p>
              )}
              <Button type="submit" disabled={definirSeuil.isPending}>
                {definirSeuil.isPending
                  ? "Enregistrement…"
                  : "Enregistrer le seuil"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
```

Note : `formaterMontant(n.avgCost)` utilise la devise par défaut XOF ; si l'écran doit suivre la devise de l'organisation, récupérer `GET /api/v1/organization` comme dans la fiche produit — hors périmètre ici, XOF est la devise v1.

- [ ] **Step 4: Vérifier**

Run: `bun run --cwd apps/web build`
Expected: build OK — le plugin TanStack Router régénère `routeTree.gen.ts` avec les routes `/stock`, `/stock/mouvements`, `/stock/receptions` (ne jamais l'éditer à la main).

Run: `bun run --cwd apps/web test && bun run typecheck && bun run lint`
Expected: exit 0.

Vérification manuelle (API : `cd apps/api && bun run db:migrate:local && bun run dev` ; web : `cd apps/web && bun run dev`) : connecté en owner, la section « Stock » apparaît ; après un ajustement +20 sur un produit, `/stock` affiche la quantité ; poser un seuil 30 → badge « Stock bas » sur la ligne et badge rouge dans la sidebar.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat: écran des niveaux de stock, ajustements, seuils et badge d'alertes"
```

---

### Task 12: Web — journal des mouvements filtrable

Écran `/stock/mouvements` : filtres entrepôt / type / recherche produit / période, deltas signés et colorés, libellés français des types, pagination Précédent/Suivant.

**Files:**
- Modify: `apps/web/src/routes/_app/stock/mouvements.tsx` (remplace le placeholder de la Task 11)

**Interfaces:**
- Consumes: `GET /api/v1/stock/movements` (Task 6) ; `useEntrepotsVisibles`, `MouvementJournal`, `LIBELLES_TYPE_MOUVEMENT` (Task 11).

- [ ] **Step 1: Implémenter l'écran**

Remplacer le contenu complet de `apps/web/src/routes/_app/stock/mouvements.tsx` par :

```tsx
import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { useEntrepotsVisibles, LIBELLES_TYPE_MOUVEMENT } from "@/lib/stock"
import type { MouvementJournal } from "@/lib/stock"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const Route = createFileRoute("/_app/stock/mouvements")({
  component: MouvementsPage,
})

const LIMITE = 50

function MouvementsPage() {
  const { options: entrepots } = useEntrepotsVisibles()

  const [entrepotId, setEntrepotId] = useState("")
  const [type, setType] = useState("")
  const [du, setDu] = useState("")
  const [au, setAu] = useState("")
  const [recherche, setRecherche] = useState("")
  const [rechercheDebouncee, setRechercheDebouncee] = useState("")
  useEffect(() => {
    const timer = setTimeout(() => setRechercheDebouncee(recherche), 300)
    return () => clearTimeout(timer)
  }, [recherche])
  const [page, setPage] = useState(1)
  // Tout changement de filtre revient page 1
  useEffect(() => {
    setPage(1)
  }, [entrepotId, type, du, au, rechercheDebouncee])

  const mouvements = useQuery({
    queryKey: [
      "stock-movements",
      entrepotId,
      type,
      du,
      au,
      rechercheDebouncee,
      page,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        limite: String(LIMITE),
      })
      if (entrepotId) params.set("warehouseId", entrepotId)
      if (type) params.set("type", type)
      if (du) params.set("du", du)
      if (au) params.set("au", au)
      if (rechercheDebouncee) params.set("recherche", rechercheDebouncee)
      return apiFetch<{ movements: MouvementJournal[]; total: number }>(
        `/api/v1/stock/movements?${params.toString()}`
      )
    },
  })

  const total = mouvements.data?.total ?? 0
  const dernierePage = Math.max(1, Math.ceil(total / LIMITE))

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">Journal des mouvements</h1>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="m-entrepot">Entrepôt</Label>
          <select
            id="m-entrepot"
            value={entrepotId}
            onChange={(e) => setEntrepotId(e.target.value)}
            className="h-10 rounded-md border px-2 text-sm"
          >
            <option value="">Tous</option>
            {entrepots.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="m-type">Type</Label>
          <select
            id="m-type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="h-10 rounded-md border px-2 text-sm"
          >
            <option value="">Tous</option>
            {Object.entries(LIBELLES_TYPE_MOUVEMENT).map(([valeur, libelle]) => (
              <option key={valeur} value={valeur}>
                {libelle}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="m-recherche">Produit (nom ou SKU)</Label>
          <Input
            id="m-recherche"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            className="w-56"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="m-du">Du</Label>
          <Input
            id="m-du"
            type="date"
            value={du}
            onChange={(e) => setDu(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="m-au">Au</Label>
          <Input
            id="m-au"
            type="date"
            value={au}
            onChange={(e) => setAu(e.target.value)}
          />
        </div>
      </div>

      {mouvements.isPending ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Entrepôt</TableHead>
                <TableHead>Article</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Delta</TableHead>
                <TableHead>Lot</TableHead>
                <TableHead>Motif</TableHead>
                <TableHead>Par</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(mouvements.data?.movements ?? []).map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {new Date(m.createdAt).toLocaleString("fr-FR")}
                  </TableCell>
                  <TableCell>{m.warehouseName}</TableCell>
                  <TableCell>
                    <span className="font-medium">{m.productName}</span>{" "}
                    <span className="text-sm text-gray-500">
                      {m.variantName} ({m.sku})
                    </span>
                  </TableCell>
                  <TableCell>
                    {LIBELLES_TYPE_MOUVEMENT[m.type] ?? m.type}
                  </TableCell>
                  <TableCell
                    className={
                      m.delta > 0
                        ? "font-medium text-green-700"
                        : "font-medium text-red-700"
                    }
                  >
                    {m.delta > 0 ? `+${m.delta}` : m.delta}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {m.lotNumber ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">{m.reason ?? "—"}</TableCell>
                  <TableCell className="text-sm">{m.userName}</TableCell>
                </TableRow>
              ))}
              {mouvements.data?.movements.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center text-sm text-gray-500"
                  >
                    Aucun mouvement.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <div className="mt-4 flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Précédent
            </Button>
            <span className="text-sm text-gray-500">
              Page {page} / {dernierePage} — {total} mouvement{total > 1 ? "s" : ""}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= dernierePage}
              onClick={() => setPage((p) => p + 1)}
            >
              Suivant
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Vérifier**

Run: `bun run --cwd apps/web build && bun run --cwd apps/web test && bun run typecheck && bun run lint`
Expected: exit 0.

Vérification manuelle : `/stock/mouvements` montre les mouvements créés dans les tâches précédentes, filtre par type « Ajustement », par entrepôt et par période ; les deltas positifs sont verts avec `+`, les négatifs rouges.

- [ ] **Step 3: Commit**

```bash
git add apps/web
git commit -m "feat: journal des mouvements de stock filtrable"
```

---

### Task 13: Web — réceptions (liste, brouillon éditable, validation)

Écrans `/stock/receptions` (liste + création) et `/stock/receptions/:purchaseId` (édition du brouillon : lignes avec recherche de variante, lot/péremption si `trackLots`, validation, suppression ; lecture seule une fois validée).

**Files:**
- Modify: `apps/web/src/routes/_app/stock/receptions/index.tsx` (remplace le placeholder de la Task 11)
- Create: `apps/web/src/routes/_app/stock/receptions/$purchaseId.tsx`

**Interfaces:**
- Consumes: toutes les routes `/api/v1/purchases*` (Tasks 8-9) ; `GET /api/v1/suppliers` (Phase 3) ; `GET /api/v1/products?recherche=&actifs=true` (Phase 3, les produits embarquent `variants` et `trackLots`) ; `useAccesStock` (Task 11) ; `useEntrepotsVisibles` (Task 11) ; `formaterMontant`.

- [ ] **Step 1: Écran liste + création**

Remplacer le contenu complet de `apps/web/src/routes/_app/stock/receptions/index.tsx` par :

```tsx
import { useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { formaterMontant } from "@/lib/format"
import { useAccesStock } from "@/lib/permissions"
import { useEntrepotsVisibles } from "@/lib/stock"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const Route = createFileRoute("/_app/stock/receptions/")({
  component: ReceptionsPage,
})

type ReceptionListe = {
  id: string
  warehouseId: string
  warehouseName: string
  supplierId: string
  supplierName: string
  reference: string | null
  status: "draft" | "received"
  createdAt: string
  receivedAt: string | null
  itemCount: number
  totalCost: number
}

type Fournisseur = { id: string; name: string; isActive: boolean }

function ReceptionsPage() {
  const acces = useAccesStock()
  const { options: entrepots } = useEntrepotsVisibles()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Entrepôts où l'utilisateur peut CRÉER une réception
  const entrepotsEcriture = acces.ecritureTous
    ? entrepots
    : entrepots.filter((w) => acces.entrepotsEcriture.includes(w.id))
  const peutCreer = entrepotsEcriture.length > 0

  const [statut, setStatut] = useState("")
  const receptions = useQuery({
    queryKey: ["purchases", statut],
    queryFn: () =>
      apiFetch<{ purchases: ReceptionListe[] }>(
        `/api/v1/purchases${statut ? `?statut=${statut}` : ""}`
      ),
  })
  const fournisseurs = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => apiFetch<{ suppliers: Fournisseur[] }>("/api/v1/suppliers"),
    enabled: peutCreer,
  })

  const [dialogOuvert, setDialogOuvert] = useState(false)
  const [entrepotId, setEntrepotId] = useState("")
  const [fournisseurId, setFournisseurId] = useState("")
  const [reference, setReference] = useState("")
  const [erreur, setErreur] = useState<string | null>(null)

  const creer = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string }>("/api/v1/purchases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          warehouseId: entrepotId,
          supplierId: fournisseurId,
          reference: reference || undefined,
        }),
      }),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ["purchases"] })
      setDialogOuvert(false)
      void navigate({
        to: "/stock/receptions/$purchaseId",
        params: { purchaseId: res.id },
      })
    },
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Réceptions fournisseur</h1>
        {peutCreer && (
          <Dialog open={dialogOuvert} onOpenChange={setDialogOuvert}>
            <DialogTrigger render={<Button />}>Nouvelle réception</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nouvelle réception</DialogTitle>
              </DialogHeader>
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  setErreur(null)
                  creer.mutate()
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="r-entrepot">Entrepôt</Label>
                  <select
                    id="r-entrepot"
                    required
                    value={entrepotId}
                    onChange={(e) => setEntrepotId(e.target.value)}
                    className="h-10 rounded-md border px-2 text-sm"
                  >
                    <option value="">— choisir —</option>
                    {entrepotsEcriture.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="r-fournisseur">Fournisseur</Label>
                  <select
                    id="r-fournisseur"
                    required
                    value={fournisseurId}
                    onChange={(e) => setFournisseurId(e.target.value)}
                    className="h-10 rounded-md border px-2 text-sm"
                  >
                    <option value="">— choisir —</option>
                    {(fournisseurs.data?.suppliers ?? [])
                      .filter((f) => f.isActive)
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="r-reference">
                    Référence (bon de livraison, optionnel)
                  </Label>
                  <Input
                    id="r-reference"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </div>
                {erreur && (
                  <p role="alert" className="text-sm text-red-700">
                    {erreur}
                  </p>
                )}
                <Button type="submit" disabled={creer.isPending}>
                  {creer.isPending ? "Création…" : "Créer le brouillon"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="mb-4 flex flex-col gap-1.5">
        <Label htmlFor="r-statut">Statut</Label>
        <select
          id="r-statut"
          value={statut}
          onChange={(e) => setStatut(e.target.value)}
          className="h-10 w-48 rounded-md border px-2 text-sm"
        >
          <option value="">Tous</option>
          <option value="draft">Brouillons</option>
          <option value="received">Validées</option>
        </select>
      </div>

      {receptions.isPending ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Entrepôt</TableHead>
              <TableHead>Fournisseur</TableHead>
              <TableHead>Référence</TableHead>
              <TableHead>Lignes</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Statut</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(receptions.data?.purchases ?? []).map((r) => (
              <TableRow
                key={r.id}
                className="cursor-pointer"
                onClick={() =>
                  void navigate({
                    to: "/stock/receptions/$purchaseId",
                    params: { purchaseId: r.id },
                  })
                }
              >
                <TableCell className="whitespace-nowrap text-sm">
                  {new Date(r.createdAt).toLocaleDateString("fr-FR")}
                </TableCell>
                <TableCell>{r.warehouseName}</TableCell>
                <TableCell className="font-medium">{r.supplierName}</TableCell>
                <TableCell className="font-mono text-xs">
                  {r.reference ?? "—"}
                </TableCell>
                <TableCell>{r.itemCount}</TableCell>
                <TableCell>{formaterMontant(r.totalCost)}</TableCell>
                <TableCell>
                  <Badge variant={r.status === "draft" ? "secondary" : "default"}>
                    {r.status === "draft" ? "Brouillon" : "Validée"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
            {receptions.data?.purchases.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-sm text-gray-500"
                >
                  Aucune réception.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Écran de détail / édition du brouillon**

Créer `apps/web/src/routes/_app/stock/receptions/$purchaseId.tsx` :

```tsx
import { useEffect, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { formaterMontant } from "@/lib/format"
import { useAccesStock } from "@/lib/permissions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const Route = createFileRoute("/_app/stock/receptions/$purchaseId")({
  component: ReceptionDetailPage,
})

type LigneReception = {
  id: string
  variantId: string
  productName: string
  variantName: string
  sku: string
  trackLots: boolean
  quantity: number
  unitCost: number
  lotNumber: string | null
  expiryDate: string | null
}

type Reception = {
  id: string
  warehouseId: string
  warehouseName: string
  supplierId: string
  supplierName: string
  reference: string | null
  status: "draft" | "received"
  createdAt: string
  receivedAt: string | null
  items: LigneReception[]
}

type VarianteCatalogue = {
  variantId: string
  libelle: string
  trackLots: boolean
}

type ProduitCatalogue = {
  id: string
  name: string
  trackLots: boolean
  variants: Array<{ id: string; name: string; sku: string; isActive: boolean }>
}

function ReceptionDetailPage() {
  const { purchaseId } = Route.useParams()
  const acces = useAccesStock()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: ["purchase", purchaseId],
    queryFn: () =>
      apiFetch<{ purchase: Reception }>(`/api/v1/purchases/${purchaseId}`),
  })

  const invalider = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["purchase", purchaseId] }),
      queryClient.invalidateQueries({ queryKey: ["purchases"] }),
      queryClient.invalidateQueries({ queryKey: ["stock-levels"] }),
      queryClient.invalidateQueries({ queryKey: ["stock-alerts"] }),
      queryClient.invalidateQueries({ queryKey: ["stock-movements"] }),
    ])

  // Recherche de variante pour l'ajout de ligne
  const [rechercheArticle, setRechercheArticle] = useState("")
  const [rechercheDebouncee, setRechercheDebouncee] = useState("")
  useEffect(() => {
    const timer = setTimeout(() => setRechercheDebouncee(rechercheArticle), 300)
    return () => clearTimeout(timer)
  }, [rechercheArticle])
  const catalogue = useQuery({
    queryKey: ["products", rechercheDebouncee, "actifs"],
    queryFn: () => {
      const params = new URLSearchParams({ actifs: "true" })
      if (rechercheDebouncee) params.set("recherche", rechercheDebouncee)
      return apiFetch<{ products: ProduitCatalogue[] }>(
        `/api/v1/products?${params.toString()}`
      )
    },
  })
  const variantes: VarianteCatalogue[] = (catalogue.data?.products ?? []).flatMap(
    (p) =>
      p.variants
        .filter((v) => v.isActive)
        .map((v) => ({
          variantId: v.id,
          libelle: `${p.name} — ${v.name} (${v.sku})`,
          trackLots: p.trackLots,
        }))
  )

  // Dialogue de ligne (création si ligneEditee === null, édition sinon)
  const [dialogLigne, setDialogLigne] = useState(false)
  const [ligneEditee, setLigneEditee] = useState<LigneReception | null>(null)
  const [variantId, setVariantId] = useState("")
  const [quantite, setQuantite] = useState("")
  const [cout, setCout] = useState("")
  const [numeroLot, setNumeroLot] = useState("")
  const [peremption, setPeremption] = useState("")
  const [erreurLigne, setErreurLigne] = useState<string | null>(null)

  const varianteChoisie = variantes.find((v) => v.variantId === variantId)
  const suitLots = ligneEditee
    ? ligneEditee.trackLots
    : (varianteChoisie?.trackLots ?? false)

  function ouvrirCreation() {
    setLigneEditee(null)
    setVariantId("")
    setQuantite("")
    setCout("")
    setNumeroLot("")
    setPeremption("")
    setErreurLigne(null)
    setDialogLigne(true)
  }

  function ouvrirEdition(ligne: LigneReception) {
    setLigneEditee(ligne)
    setVariantId(ligne.variantId)
    setQuantite(String(ligne.quantity))
    setCout(String(ligne.unitCost))
    setNumeroLot(ligne.lotNumber ?? "")
    setPeremption(ligne.expiryDate ? ligne.expiryDate.slice(0, 10) : "")
    setErreurLigne(null)
    setDialogLigne(true)
  }

  const enregistrerLigne = useMutation({
    mutationFn: () => {
      if (ligneEditee) {
        return apiFetch(
          `/api/v1/purchases/${purchaseId}/items/${ligneEditee.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              quantity: Number(quantite),
              unitCost: Number(cout),
              ...(ligneEditee.trackLots
                ? {
                    lotNumber: numeroLot || null,
                    expiryDate: peremption || null,
                  }
                : {}),
            }),
          }
        )
      }
      return apiFetch(`/api/v1/purchases/${purchaseId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          variantId,
          quantity: Number(quantite),
          unitCost: Number(cout),
          lotNumber: suitLots && numeroLot ? numeroLot : undefined,
          expiryDate: suitLots && peremption ? peremption : undefined,
        }),
      })
    },
    onSuccess: async () => {
      await invalider()
      setDialogLigne(false)
    },
    onError: (err) =>
      setErreurLigne(err instanceof Error ? err.message : "Erreur"),
  })

  const supprimerLigne = useMutation({
    mutationFn: (itemId: string) =>
      apiFetch(`/api/v1/purchases/${purchaseId}/items/${itemId}`, {
        method: "DELETE",
      }),
    onSuccess: invalider,
    onError: (err) => alert(err instanceof Error ? err.message : "Erreur"),
  })

  const [erreurValidation, setErreurValidation] = useState<string | null>(null)
  const valider = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/purchases/${purchaseId}/receive`, { method: "POST" }),
    onSuccess: invalider,
    onError: (err) =>
      setErreurValidation(err instanceof Error ? err.message : "Erreur"),
  })

  const supprimerBrouillon = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/purchases/${purchaseId}`, { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["purchases"] })
      void navigate({ to: "/stock/receptions" })
    },
    onError: (err) => alert(err instanceof Error ? err.message : "Erreur"),
  })

  if (!data) {
    return <p className="text-sm text-gray-500">Chargement…</p>
  }
  const reception = data.purchase
  const brouillon = reception.status === "draft"
  const peutEcrire =
    acces.ecritureTous || acces.entrepotsEcriture.includes(reception.warehouseId)
  const total = reception.items.reduce(
    (somme, item) => somme + item.quantity * item.unitCost,
    0
  )

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <h1 className="text-xl font-semibold">
          Réception — {reception.supplierName}
        </h1>
        <Badge variant={brouillon ? "secondary" : "default"}>
          {brouillon ? "Brouillon" : "Validée"}
        </Badge>
      </div>
      <p className="mb-6 text-sm text-gray-500">
        {reception.warehouseName}
        {reception.reference ? ` — réf. ${reception.reference}` : ""}
        {reception.receivedAt
          ? ` — validée le ${new Date(reception.receivedAt).toLocaleString("fr-FR")}`
          : ""}
      </p>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">
          Lignes — total {formaterMontant(total)}
        </h2>
        {brouillon && peutEcrire && (
          <Button variant="outline" size="sm" onClick={ouvrirCreation}>
            Ajouter une ligne
          </Button>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Article</TableHead>
            <TableHead>Quantité</TableHead>
            <TableHead>Coût unitaire</TableHead>
            <TableHead>Lot</TableHead>
            <TableHead>Péremption</TableHead>
            {brouillon && peutEcrire && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {reception.items.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <span className="font-medium">{item.productName}</span>{" "}
                <span className="text-sm text-gray-500">
                  {item.variantName} ({item.sku})
                </span>
              </TableCell>
              <TableCell>{item.quantity}</TableCell>
              <TableCell>{formaterMontant(item.unitCost)}</TableCell>
              <TableCell className="font-mono text-xs">
                {item.lotNumber ?? "—"}
              </TableCell>
              <TableCell className="text-sm">
                {item.expiryDate
                  ? new Date(item.expiryDate).toLocaleDateString("fr-FR")
                  : "—"}
              </TableCell>
              {brouillon && peutEcrire && (
                <TableCell>
                  <span className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => ouvrirEdition(item)}
                    >
                      Modifier
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => supprimerLigne.mutate(item.id)}
                    >
                      Retirer
                    </Button>
                  </span>
                </TableCell>
              )}
            </TableRow>
          ))}
          {reception.items.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={brouillon && peutEcrire ? 6 : 5}
                className="text-center text-sm text-gray-500"
              >
                Aucune ligne.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {brouillon && peutEcrire && (
        <div className="mt-6 flex items-center gap-3">
          <Button
            disabled={valider.isPending || reception.items.length === 0}
            onClick={() => {
              setErreurValidation(null)
              if (
                window.confirm(
                  "Valider la réception ? Le stock sera mis à jour et le document deviendra immuable."
                )
              ) {
                valider.mutate()
              }
            }}
          >
            {valider.isPending ? "Validation…" : "Valider la réception"}
          </Button>
          <Button
            variant="outline"
            disabled={supprimerBrouillon.isPending}
            onClick={() => {
              if (window.confirm("Supprimer ce brouillon ?")) {
                supprimerBrouillon.mutate()
              }
            }}
          >
            Supprimer le brouillon
          </Button>
          {erreurValidation && (
            <p role="alert" className="text-sm text-red-700">
              {erreurValidation}
            </p>
          )}
        </div>
      )}

      {dialogLigne && (
        <Dialog
          open
          onOpenChange={(ouvert) => {
            if (!ouvert) setDialogLigne(false)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {ligneEditee ? "Modifier la ligne" : "Ajouter une ligne"}
              </DialogTitle>
            </DialogHeader>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                setErreurLigne(null)
                enregistrerLigne.mutate()
              }}
            >
              {ligneEditee ? (
                <p className="text-sm font-medium">
                  {ligneEditee.productName} — {ligneEditee.variantName} (
                  {ligneEditee.sku})
                </p>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="l-recherche">Rechercher un article</Label>
                    <Input
                      id="l-recherche"
                      placeholder="nom, SKU ou code-barres"
                      value={rechercheArticle}
                      onChange={(e) => setRechercheArticle(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="l-variante">Article</Label>
                    <select
                      id="l-variante"
                      required
                      value={variantId}
                      onChange={(e) => setVariantId(e.target.value)}
                      className="h-10 rounded-md border px-2 text-sm"
                    >
                      <option value="">— choisir —</option>
                      {variantes.map((v) => (
                        <option key={v.variantId} value={v.variantId}>
                          {v.libelle}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              <div className="flex gap-3">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="l-quantite">Quantité</Label>
                  <Input
                    id="l-quantite"
                    type="number"
                    min={1}
                    step={1}
                    required
                    value={quantite}
                    onChange={(e) => setQuantite(e.target.value)}
                  />
                </div>
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="l-cout">Coût unitaire</Label>
                  <Input
                    id="l-cout"
                    type="number"
                    min={0}
                    step={1}
                    required
                    value={cout}
                    onChange={(e) => setCout(e.target.value)}
                  />
                </div>
              </div>
              {suitLots && (
                <div className="flex gap-3">
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor="l-lot">Numéro de lot</Label>
                    <Input
                      id="l-lot"
                      required
                      value={numeroLot}
                      onChange={(e) => setNumeroLot(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor="l-peremption">Péremption (optionnel)</Label>
                    <Input
                      id="l-peremption"
                      type="date"
                      value={peremption}
                      onChange={(e) => setPeremption(e.target.value)}
                    />
                  </div>
                </div>
              )}
              {erreurLigne && (
                <p role="alert" className="text-sm text-red-700">
                  {erreurLigne}
                </p>
              )}
              <Button type="submit" disabled={enregistrerLigne.isPending}>
                {enregistrerLigne.isPending
                  ? "Enregistrement…"
                  : ligneEditee
                    ? "Enregistrer"
                    : "Ajouter la ligne"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Vérifier**

Run: `bun run --cwd apps/web build && bun run --cwd apps/web test && bun run typecheck && bun run lint`
Expected: exit 0.

Vérification manuelle (API + web locaux) :
1. `/stock/receptions` → « Nouvelle réception » (entrepôt + fournisseur) → redirigé vers le brouillon.
2. Ajouter une ligne d'un produit simple (quantité 10, coût 150) ; ajouter une ligne d'un produit `trackLots` → les champs lot/péremption apparaissent et le lot est exigé.
3. Modifier une quantité, retirer une ligne, ré-ajouter.
4. « Valider la réception » → confirmation → statut « Validée », boutons d'édition disparus ; `/stock` montre les quantités et le CMP ; `/stock/mouvements` montre les mouvements « Réception ».
5. Rouvrir le document validé : lecture seule.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat: écrans réceptions — liste, brouillon éditable, validation"
```

---

### Task 14: Vérification complète de bout en bout, roadmap, PR

Suite complète, typecheck, lint, migration locale, scénario E2E manuel navigateur, mise à jour de la roadmap et du ledger, PR.

**Files:**
- Modify: `docs/superpowers/plans/2026-07-08-pos-stocks-roadmap.md` (cases Phase 4)
- Modify: `.superpowers/sdd/progress.md` (ledger Phase 4)

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: branche `feat/phase-4-moteur-de-stock` prête à merger, PR ouverte.

- [ ] **Step 1: Suite complète**

```bash
bun run --cwd apps/api test
bun run --cwd apps/web test
bun run typecheck
bun run lint
```

Expected: 0 échec partout. Ordre de grandeur attendu : ~112 tests api (71 hérités + ~41 nouveaux : 4 phase4-prep, 3 stock-guards, 4 barcodes, 7 stock-service, 6 stock-read, 6 stock-adjustments, 4 purchases-draft, 4 purchases-receive, 3 stock-reconcile) et 14 tests web. Le compte exact peut varier de un ou deux ; l'exigence ferme est **0 échec**.

- [ ] **Step 2: Migrations locales et démarrage**

```bash
cd apps/api && bun run db:migrate:local
```

Expected: `0004_*.sql` et `0005_stock_guards.sql` appliquées sans erreur (les 0000-0003 le sont déjà). Puis :

```bash
# Terminal 1
cd apps/api && bun run dev
# Terminal 2
cd apps/web && bun run dev
```

- [ ] **Step 3: E2E manuel navigateur (owner puis staff)**

En **owner** :
1. Catalogue : créer un produit « Coca 50cl » (prix 500, seuil par défaut 10) et un produit « Yaourt nature » avec « Suivre les lots » coché. Vérifier qu'un code-barres déjà pris sur un autre produit est refusé avec le message « Ce code-barres est déjà utilisé ».
2. Administration : créer un entrepôt « Dépôt central » (type réserve) et une boutique ; créer un employé staff et l'affecter en **manager** du dépôt.
3. `/stock/receptions` : créer un brouillon (Dépôt central + un fournisseur), ajouter « Coca 50cl » (qté 24, coût 150) et « Yaourt nature » (qté 6, coût 200, lot LOT-2026-07, péremption future). Valider → statut « Validée », document en lecture seule.
4. `/stock` : le dépôt montre Coca 24 (CMP 150 XOF) et Yaourt 6 (CMP 200 XOF). Faire un ajustement −20 sur Coca avec motif « casse » → quantité 4 et badge « Stock bas » (seuil 10) + badge rouge sur « Niveaux » dans la sidebar. Tenter un ajustement −10 → message « Stock insuffisant pour valider l'opération ».
5. `/stock/mouvements` : 3 mouvements (2 réceptions, 1 ajustement), filtres type/entrepôt/période opérationnels.
6. Réconciliation (curl avec le cookie de session owner) : `curl -X POST -b "<cookie>" http://localhost:8787/api/v1/stock/reconcile` renvoie `{"ecarts":[],"applique":false}`.

En **staff manager du dépôt** (mot de passe provisoire → changement forcé) :
7. La section « Stock » est visible ; `/stock` ne propose QUE « Dépôt central » dans le sélecteur ; l'ajustement et le seuil fonctionnent ; `/stock/receptions` ne liste que les réceptions du dépôt et permet d'en créer une.
8. Vérifier qu'un staff **sans affectation** (ou affecté seulement en caissier) ne voit pas la section « Stock ».

- [ ] **Step 4: Roadmap et ledger**

Dans `docs/superpowers/plans/2026-07-08-pos-stocks-roadmap.md` : cocher les 7 items de la section « Phase 4 — Moteur de stock », et renseigner la colonne « Plan détaillé » du tableau de suivi (`2026-07-10-phase-4-moteur-de-stock.md`). Dans `.superpowers/sdd/progress.md` : ajouter le ledger « # Ledger Phase 4 — feat/phase-4-moteur-de-stock » avec l'état des tasks (même format que les phases précédentes).

- [ ] **Step 5: Commit final et PR**

```bash
git add docs .superpowers
git commit -m "docs: roadmap et ledger Phase 4"
git push -u origin feat/phase-4-moteur-de-stock
gh pr create --title "Phase 4 — Moteur de stock" --body "$(cat <<'EOF'
## Contenu
- Dette Phase 3 soldée (helpers org-scopés, usePeutEcrire, décomposition fiche produit, LIKE échappé, etc.)
- Unicité des codes-barres par organisation (index partiels + vérification croisée, BARCODE_EXISTANT)
- stock_movements (journal append-only, triggers) + stock_levels (CHECK quantity >= 0, avgCost, minStock)
- stockService.applyMovements : batch D1 atomique, garde anti-négatif, CMP
- Réceptions fournisseur draft -> received (lots créés/réutilisés, immuabilité par trigger)
- Ajustements manuels tracés, seuils par entrepôt, alertes stock bas + badge
- Réconciliation journal -> niveaux (dry-run par défaut, owner/admin)
- Écrans /stock : niveaux, journal filtrable, réceptions

## Tests
Suite api + web verte, typecheck, lint ; E2E manuel navigateur validé (owner + staff manager).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR créée, CI verte. Note déploiement : le merge déclenche `deploy.yml` qui applique les migrations **en production** (dont la déduplication de codes-barres de `0005_stock_guards.sql` — sans effet sur une base quasi vide, défensive sinon).








