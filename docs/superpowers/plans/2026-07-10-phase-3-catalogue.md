# Phase 3 — Catalogue : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'équipe gère un catalogue complet : catégories (hiérarchie simple), fournisseurs, produits avec SKU auto-généré et variante implicite unique, variantes explicites (attributs, SKU, code-barres, surcharges de prix), images stockées dans R2 servies avec contrôle d'accès, et lots activables par produit (`trackLots`). Tous les membres consultent le catalogue ; seuls owner/admin/stock_manager le modifient.

**Architecture:** On étend l'API Hono existante (`apps/api`) avec cinq tables Drizzle (`categories`, `suppliers`, `products`, `product_variants`, `lots`), un bucket R2 (`IMAGES`) pour les images produits avec une route de service authentifiée (`/api/v1/files/*`), une génération de SKU séquentielle par organisation (`PRD-0001`, suffixes de variantes slugifiés), et des routes REST guardées par les middlewares de permissions de la Phase 2. Le front (`apps/web`) reçoit une section « Catalogue » dans la sidebar (visible par tous les membres), un écran liste produits (recherche debouncée, filtre catégorie, prix formatés `Intl` avec la devise de l'organisation), une fiche produit (édition, upload d'image, variantes, lots) et deux écrans simples catégories/fournisseurs. La Task 1 solde d'abord la dette de la Phase 2 (helper `validerCorps`, `autoSignIn: false`, plafond `.max(128)`, discrimination d'`APIError`, garde de rôle front, profondeur de `.cause`).

**Tech Stack:** existant (Hono, Better Auth 1.6.23, Drizzle/D1, vitest-pool-workers, React/Vite/TanStack Router + Query, composants shadcn base-mira sur @base-ui/react, Tailwind 4) + Cloudflare R2 (nouveau binding `IMAGES`).

## Global Constraints

- Interface et messages d'erreur en **français** ; codes d'erreur stables en MAJUSCULES (`ACCES_REFUSE`, `SKU_EXISTANT`, `DERNIERE_VARIANTE`, `LOTS_NON_SUIVIS`, `LOT_EXISTANT`, `IMAGE_TROP_LOURDE`, `FORMAT_IMAGE`, …)
- IDs texte via `crypto.randomUUID()` ; horodatages UTC ; **montants en entiers** (XOF, pas de décimales)
- **Le schéma Better Auth est GÉNÉRÉ** : toute modif passe par `auth-cli.ts` + `bunx @better-auth/cli generate` — jamais d'édition manuelle de `src/db/schema/auth.ts`. Les tables métier (dont celles du catalogue) vivent dans des fichiers séparés (`domain.ts`, `catalog.ts`)
- Les tables métier portent `organizationId` (préparation SaaS) ; toute requête est scoppée `organizationId` ; `404 INTROUVABLE` sur les ressources hors organisation
- **Matrice catalogue (spec §4)** : écriture catalogue = `owner`, `admin`, `stock_manager` ; lecture = **TOUS** les rôles authentifiés membres (y compris `staff`/caissier qui consulte le catalogue)
- Enveloppe d'erreur : `{ code: MAJUSCULES, message: FR, details? }` ; `VALIDATION 400` via `safeParse` ; `ACCES_REFUSE 403`
- TDD : test d'abord pour chaque comportement d'API ; commits fréquents ; hooks husky actifs (pas de `--no-verify`)
- Toute écriture DB multi-lignes = `db.batch()` atomique (tableau construit **directement**, pas de push + cast : le typage D1 des batchs hétérogènes le refuse)
- Validation Zod dans `packages/shared` pour tout payload, messages français, exports via `src/index.ts`
- Gestionnaire de paquets : bun ; travailler sur la branche `feat/phase-3-catalogue`

**Pièges récurrents du dépôt** (rappelés aux endroits concernés) :
- eslint `no-unnecessary-condition` rejette les optional-chains sur des types DOM non nuls ; annoter explicitement `| null` les retours de helpers indexés (cf. `membershipCible` dans `users.ts`)
- imports de types scindés (`import type { X } from "..."` séparé des imports de valeurs — règle `import/consistent-type-specifier-style`)
- dans les tests, typer les corps avec `res.json<T>()` (pas de cast `as`)
- base-ui Dialog : **PAS** de `asChild` → `<DialogTrigger render={<Button />}>libellé</DialogTrigger>` ; `DialogContent` accepte `showCloseButton={false}`
- drizzle-kit : les migrations custom restent HORS snapshots — ne jamais reporter à la main des index dans `drizzle/meta/*.json`, sinon le prochain `db:generate` émet des `DROP`

**Prérequis exécutant** : dépôt sur `main` à jour ; `bun install` déjà fait ; les tests existants passent (`bun run test` : **39 api + 10 web**). Créer la branche :

```bash
git checkout -b feat/phase-3-catalogue
```

**État de départ (fin Phase 2)** : API — middlewares `requireAuth` (`AuthVariables`, gère `COMPTE_DESACTIVE` et `MOT_DE_PASSE_A_CHANGER` avec allowlist), `requireMembership`/`requireRole`/`requireWarehouseRole` + `PermissionVariables` (`src/middleware/permissions.ts`) ; helpers de test `bootstrapOwner()`, `createUserWithRole(organizationId, role)`, `MDP` (`test/helpers.ts`) ; `estViolationUnicite` (`src/lib/db-errors.ts`, remonte la chaîne `.cause` des `DrizzleQueryError`) ; migrations de test auto via `readD1Migrations` + binding `TEST_MIGRATIONS` (`vitest.config.ts`). Web — layout `_app` avec contexte `me`, TanStack Query, `apiFetch` (`src/lib/api.ts`), composants `src/components/ui/*`, écrans administration. `wrangler.jsonc` api : binding `DB` (D1), `vars`, `observability` — **pas encore de R2**.

---

### Task 1: Reprise dette Phase 2

**Files:**
- Create: `apps/api/src/lib/validation.ts` (helper `validerCorps`)
- Modify: `apps/api/src/routes/setup.ts`, `warehouses.ts`, `users.ts`, `warehouse-members.ts`, `organization.ts`, `mon-compte.ts` (remplacement du bloc de validation dupliqué)
- Modify: `apps/api/auth-cli.ts` et `apps/api/src/lib/auth.ts` (`autoSignIn: false`)
- Modify: `packages/shared/src/schemas/account.ts` (`.max(128)`)
- Modify: `apps/api/src/lib/db-errors.ts` (plafond de profondeur)
- Modify: `apps/api/test/mon-compte.test.ts` (nouveau test)
- Modify: `apps/web/src/routes/_app/administration/entrepots.tsx`, `utilisateurs.tsx`, `parametres.tsx` (garde `beforeLoad` + colSpan)

**Interfaces:**
- Produces: `validerCorps<S extends z.ZodType>(c: Context, schema: S): Promise<{ ok: true; data: z.infer<S> } | { ok: false; reponse: Response }>` (`src/lib/validation.ts`) — fait le `json().catch(null)` + `safeParse` + enveloppe `VALIDATION 400`
- Produces: `POST /api/v1/mon-compte/mot-de-passe` → `400 { code: 'VALIDATION' }` si `newPassword` > 128 caractères (Zod), `400 { code: 'MOT_DE_PASSE_INCORRECT' }` uniquement quand Better Auth signale `INVALID_PASSWORD`
- Produces: inscriptions Better Auth sans session auto (`emailAndPassword.autoSignIn: false`)
- Produces: routes front `/administration/*` redirigées vers `/` pour les rôles non admin

- [ ] **Step 1: Test — un mot de passe de 200 caractères donne VALIDATION, pas MOT_DE_PASSE_INCORRECT**

Ajouter au `describe("mon compte")` de `apps/api/test/mon-compte.test.ts` :

```ts
it("refuse un nouveau mot de passe de plus de 128 caractères avec le code VALIDATION", async () => {
  const { ownerCookie } = await bootstrapOwner()
  const res = await changer(ownerCookie, {
    currentPassword: MDP,
    newPassword: "A".repeat(200),
  })
  expect(res.status).toBe(400)
  expect((await res.json<{ code: string }>()).code).toBe("VALIDATION")
})
```

Run: `bun run --cwd apps/api test`
Expected: FAIL — Better Auth rejette (`PASSWORD_TOO_LONG`) et le `catch` actuel de `mon-compte.ts` répond `MOT_DE_PASSE_INCORRECT`.

- [ ] **Step 2: Plafond `.max(128)` et discrimination d'APIError**

`packages/shared/src/schemas/account.ts` — le schéma devient :

```ts
import { z } from "zod"

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Le mot de passe actuel est requis"),
  newPassword: z
    .string()
    .min(12, "Le nouveau mot de passe doit contenir au moins 12 caractères")
    .max(128, "Le nouveau mot de passe ne doit pas dépasser 128 caractères"),
})

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
```

Dans `apps/api/src/routes/mon-compte.ts`, remplacer le bloc `catch` par (l'`APIError` de better-auth 1.6.23 porte `body?: { message?: string; code?: string }` — `APIError.from` pose `body.code`, et le mauvais mot de passe actuel émet `INVALID_PASSWORD`) :

```ts
  } catch (err) {
    if (err instanceof APIError) {
      if (err.body?.code === "INVALID_PASSWORD") {
        return c.json(
          {
            code: "MOT_DE_PASSE_INCORRECT",
            message: "Mot de passe actuel incorrect",
          },
          400
        )
      }
      return c.json(
        {
          code: "VALIDATION",
          message: "Données invalides",
          details: err.body?.message ?? err.message,
        },
        400
      )
    }
    throw err
  }
```

Run: `bun run --cwd apps/api test`
Expected: PASS (40 api) — le mot de passe de 200 caractères est arrêté par Zod avant Better Auth ; le test existant « mauvais mot de passe actuel → MOT_DE_PASSE_INCORRECT » reste vert (chemin `INVALID_PASSWORD`).

- [ ] **Step 3: Helper `validerCorps` + dé-duplication des 6 routes**

Create `apps/api/src/lib/validation.ts` :

```ts
import type { Context } from "hono"
import type { z } from "zod"

// Factorise le motif répété dans toutes les routes :
// lecture JSON tolérante + safeParse + enveloppe VALIDATION 400.
export async function validerCorps<S extends z.ZodType>(
  c: Context,
  schema: S
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; reponse: Response }> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return {
      ok: false,
      reponse: c.json(
        {
          code: "VALIDATION",
          message: "Données invalides",
          details: parsed.error.flatten(),
        },
        400
      ),
    }
  }
  return { ok: true, data: parsed.data }
}
```

Dans chacun des 9 handlers suivants, remplacer le bloc

```ts
const parsed = xSchema.safeParse(await c.req.json().catch(() => null))
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
```

par

```ts
const corps = await validerCorps(c, xSchema)
if (!corps.ok) return corps.reponse
```

puis renommer `parsed.data` → `corps.data` dans le reste du handler, et ajouter `import { validerCorps } from "../lib/validation"` :

1. `setup.ts` — `POST /` (`setupSchema`)
2. `warehouses.ts` — `POST /` (`warehouseCreateSchema`)
3. `warehouses.ts` — `PATCH /:id` (`warehouseUpdateSchema`)
4. `users.ts` — `POST /` (`userCreateSchema`)
5. `users.ts` — `PATCH /:id/role` (`userRoleSchema`)
6. `users.ts` — `PATCH /:id/statut` (`userStatusSchema`)
7. `warehouse-members.ts` — `POST /` (`assignmentCreateSchema`)
8. `organization.ts` — `PATCH /` (`organizationSettingsSchema`)
9. `mon-compte.ts` — `POST /mot-de-passe` (`changePasswordSchema`)

Les 40 tests existants servent de filet : **aucun ne doit bouger**.

Run: `bun run --cwd apps/api test && bun run typecheck`
Expected: PASS (40 api), typecheck vert.

- [ ] **Step 4: `autoSignIn: false` dans les deux configs Better Auth**

Dans `apps/api/src/lib/auth.ts` **ET** `apps/api/auth-cli.ts`, remplacer :

```ts
emailAndPassword: { enabled: true },
```

par :

```ts
emailAndPassword: { enabled: true, autoSignIn: false },
```

(option vérifiée dans les types installés : `@better-auth/core@1.6.23`, `init-options.d.mts` → `autoSignIn?: boolean`, défaut `true`. Rien dans l'app ne consomme le cookie de `signUpEmail` — les tests `setup`/`users` passent par un `sign-in` explicite.)

Run: `bun run --cwd apps/api test`
Expected: PASS (40 api).

- [ ] **Step 5: Plafond de profondeur dans estViolationUnicite**

`apps/api/src/lib/db-errors.ts` — la boucle devient :

```ts
export function estViolationUnicite(err: unknown): boolean {
  let current: unknown = err
  let profondeur = 0
  // Plafond défensif : une chaîne `cause` cyclique ou pathologiquement
  // profonde ne doit pas bloquer le worker.
  while (current instanceof Error && profondeur < 10) {
    if (current.message.includes("UNIQUE constraint failed")) {
      return true
    }
    current = current.cause
    profondeur += 1
  }
  return false
}
```

(conserver le commentaire d'en-tête existant du fichier)

- [ ] **Step 6: Front — garde de rôle sur les 3 routes administration + colSpan dynamique**

Dans `apps/web/src/routes/_app/administration/entrepots.tsx`, ajouter `redirect` à l'import TanStack Router et remplacer la définition de la Route par :

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_app/administration/entrepots")({
  beforeLoad: ({ context }) => {
    const role = context.me.membership?.role
    if (role !== "owner" && role !== "admin" && role !== "auditor") {
      throw redirect({ to: "/" })
    }
  },
  component: EntrepotsPage,
})
```

Dans `apps/web/src/routes/_app/administration/utilisateurs.tsx` :

```tsx
export const Route = createFileRoute("/_app/administration/utilisateurs")({
  beforeLoad: ({ context }) => {
    const role = context.me.membership?.role
    if (role !== "owner" && role !== "admin" && role !== "auditor") {
      throw redirect({ to: "/" })
    }
  },
  component: UtilisateursPage,
})
```

Dans `apps/web/src/routes/_app/administration/parametres.tsx` :

```tsx
export const Route = createFileRoute("/_app/administration/parametres")({
  beforeLoad: ({ context }) => {
    const role = context.me.membership?.role
    if (role !== "owner" && role !== "admin" && role !== "auditor") {
      throw redirect({ to: "/" })
    }
  },
  component: ParametresPage,
})
```

(le contexte `me` vient du `beforeLoad` de la route parente `_app` ; pas de test web requis — la garde est couverte par l'E2E final de la Task 12)

Toujours dans `entrepots.tsx`, corriger l'état vide du tableau (5 colonnes seulement quand la colonne d'actions existe) :

```tsx
<TableCell
  colSpan={peutEcrire ? 5 : 4}
  className="text-center text-sm text-gray-500"
>
  Aucun entrepôt — créez le premier pour démarrer.
</TableCell>
```

- [ ] **Step 7: Vérifier et committer**

```bash
bun run test && bun run typecheck && bun run lint
git add -A && git commit -m "chore: reprise dette Phase 2 (validerCorps, autoSignIn, max mdp, APIError, gardes front)"
```

Expected: 40 api + 10 web verts.

---

### Task 2: Bucket R2 + binding IMAGES

**Files:**
- Modify: `apps/api/wrangler.jsonc` (`r2_buckets`)
- Modify: `apps/api/src/env.ts` (`IMAGES: R2Bucket`)
- Modify: `apps/api/vitest.config.ts` (miniflare `r2Buckets`)
- Modify: `apps/api/test/health.test.ts` (roundtrip put/get)

**Interfaces:**
- Produces: binding `env.IMAGES: R2Bucket` disponible en prod (bucket `pos-stocks-images`), en dev et dans les tests (bucket miniflare en mémoire)

- [ ] **Step 1: Créer le bucket Cloudflare**

```bash
cd apps/api
bunx wrangler r2 bucket create pos-stocks-images
```

Expected: `Created bucket 'pos-stocks-images'...`. **Cette commande exige le compte Cloudflare (login/token)** : en cas d'échec réseau ou d'authentification, STOP — signaler la tâche BLOCKED, ne pas contourner.

- [ ] **Step 2: Test roundtrip (échec)**

Ajouter au `describe` de `apps/api/test/health.test.ts` :

```ts
it("le binding R2 IMAGES fonctionne (put/get)", async () => {
  await env.IMAGES.put("test/cle.txt", "bonjour")
  const objet = await env.IMAGES.get("test/cle.txt")
  expect(objet).not.toBeNull()
  expect(await objet?.text()).toBe("bonjour")
})
```

Run: `bun run --cwd apps/api test`
Expected: FAIL — typecheck/exécution : `IMAGES` n'existe pas sur `env`.

- [ ] **Step 3: Déclarer le binding partout**

`apps/api/wrangler.jsonc` — ajouter après le bloc `d1_databases` :

```jsonc
  "r2_buckets": [
    {
      "binding": "IMAGES",
      "bucket_name": "pos-stocks-images"
    }
  ]
```

`apps/api/src/env.ts` :

```ts
export type Env = {
  DB: D1Database
  IMAGES: R2Bucket
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  WEB_ORIGIN: string
  COOKIE_DOMAIN?: string
  SETUP_TOKEN: string
}
```

`apps/api/vitest.config.ts` — dans `poolOptions.workers.miniflare`, ajouter `r2Buckets` à côté de `bindings` :

```ts
          miniflare: {
            r2Buckets: ["IMAGES"],
            bindings: {
              TEST_MIGRATIONS: migrations,
              BETTER_AUTH_SECRET: "secret-de-test-secret-de-test-32c",
              BETTER_AUTH_URL: "http://localhost:8787",
              WEB_ORIGIN: "http://localhost:3000",
              SETUP_TOKEN: "jeton-de-setup-test",
            },
          },
```

(`test/env.d.ts` étend déjà `Env`, rien à y changer)

- [ ] **Step 4: Vérifier et committer**

Run: `bun run --cwd apps/api test && bun run typecheck`
Expected: PASS (**41 api**).

```bash
git add -A && git commit -m "feat(api): bucket R2 pos-stocks-images + binding IMAGES"
```

---
### Task 3: Schéma catalogue + migration 0003

**Files:**
- Create: `apps/api/src/db/schema/catalog.ts`
- Modify: `apps/api/src/db/schema/index.ts`
- Create: migration `apps/api/drizzle/0003_*.sql` (générée)
- Modify: `apps/api/test/health.test.ts`

**Interfaces:**
- Produces: tables Drizzle exportées par `src/db/schema` :
  - `categories` (id, organizationId, name, parentId auto-référent nullable, createdAt)
  - `suppliers` (id, organizationId, name, contact?, phone?, isActive défaut true, createdAt)
  - `products` (id, organizationId, categoryId FK `set null` nullable, name, description?, sku notNull, barcode?, price int notNull, minPrice int?, defaultMinStock int?, hasVariants défaut false, trackLots défaut false, imageKey?, isActive défaut true, createdAt, updatedAt ; unique (organizationId, sku))
  - `productVariants` (id, organizationId, productId FK cascade, name, attributes text JSON défaut `'{}'`, sku notNull, barcode?, priceOverride int?, minPriceOverride int?, isActive défaut true, createdAt ; unique (organizationId, sku))
  - `lots` (id, organizationId, variantId FK cascade, lotNumber, expiryDate timestamp?, createdAt ; unique (variantId, lotNumber))

- [ ] **Step 1: Test des tables (échec)**

Ajouter au `describe` de `apps/api/test/health.test.ts` :

```ts
it("les tables du catalogue (Phase 3) existent", async () => {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('categories','suppliers','products','product_variants','lots')"
  ).all()
  expect(results).toHaveLength(5)
})
```

Run: `bun run --cwd apps/api test`
Expected: FAIL — 0 table trouvée.

- [ ] **Step 2: Écrire le schéma**

Create `apps/api/src/db/schema/catalog.ts` :

```ts
import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core"
import { organization } from "./auth"

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // Auto-référence : le type de retour explicite AnySQLiteColumn est requis
  // par TypeScript pour casser la circularité.
  parentId: text("parent_id").references((): AnySQLiteColumn => categories.id, {
    onDelete: "set null",
  }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
})

export const suppliers = sqliteTable("suppliers", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  contact: text("contact"),
  phone: text("phone"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
})

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    categoryId: text("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    description: text("description"),
    sku: text("sku").notNull(),
    barcode: text("barcode"),
    price: integer("price").notNull(),
    minPrice: integer("min_price"),
    defaultMinStock: integer("default_min_stock"),
    hasVariants: integer("has_variants", { mode: "boolean" })
      .notNull()
      .default(false),
    trackLots: integer("track_lots", { mode: "boolean" })
      .notNull()
      .default(false),
    imageKey: text("image_key"),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("products_org_sku_uidx").on(t.organizationId, t.sku)]
)

export const productVariants = sqliteTable(
  "product_variants",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    // « Standard » pour la variante implicite, sinon p. ex. « M / Rouge »
    name: text("name").notNull(),
    attributes: text("attributes").notNull().default("{}"),
    sku: text("sku").notNull(),
    barcode: text("barcode"),
    priceOverride: integer("price_override"),
    minPriceOverride: integer("min_price_override"),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    uniqueIndex("product_variants_org_sku_uidx").on(t.organizationId, t.sku),
  ]
)

export const lots = sqliteTable(
  "lots",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    lotNumber: text("lot_number").notNull(),
    expiryDate: integer("expiry_date", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("lots_variant_lot_uidx").on(t.variantId, t.lotNumber)]
)
```

`apps/api/src/db/schema/index.ts` :

```ts
export * from "./auth"
export * from "./domain"
export * from "./catalog"
```

- [ ] **Step 3: Générer et appliquer la migration**

```bash
cd apps/api
bun run db:generate
bun run db:migrate:local
```

Expected: `drizzle/0003_*.sql` créé (5 `CREATE TABLE` + 3 `CREATE UNIQUE INDEX`), migration appliquée localement. **Piège drizzle-kit** : la 0003 est générée par la CLI donc son snapshot est correct — ne jamais ajouter à la main des index de migrations custom dans `drizzle/meta/*.json` (drizzle-kit émettrait des `DROP` au prochain generate).

Run: `bun run test` (depuis `apps/api`)
Expected: PASS (**42 api**) — `readD1Migrations` lit tout le dossier `drizzle/`, la migration de test est automatique.

- [ ] **Step 4: Typecheck et commit**

```bash
cd ../.. && bun run typecheck
git add -A && git commit -m "feat(api): schéma catalogue — categories, suppliers, products, product_variants, lots"
```

---

### Task 4: Génération de SKU

**Files:**
- Create: `apps/api/src/lib/sku.ts`
- Create: `apps/api/test/sku.test.ts`

**Interfaces:**
- Consumes: schéma catalogue (Task 3), `bootstrapOwner` (helpers de test)
- Produces:
  - `genererSkuProduit(db: DrizzleD1Database<typeof schema>, organizationId: string): Promise<string>` → `PRD-0001` (max numérique des SKU `PRD-\d+` existants de l'organisation + 1, zero-pad 4)
  - `genererSkuVariante(skuProduit: string, attributes: Record<string, string>): string` → suffixe des **valeurs** d'attributs upper-slugifiées (accents retirés, non-alphanumériques → `-`) jointes par `-` (ex. `PRD-0001-M-ROUGE`) ; objet vide (variante implicite) → `PRD-0001-STD`

- [ ] **Step 1: Tests unitaires (échec)**

Create `apps/api/test/sku.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import * as schema from "../src/db/schema"
import { genererSkuProduit, genererSkuVariante } from "../src/lib/sku"
import { bootstrapOwner } from "./helpers"

async function insererProduit(organizationId: string, sku: string) {
  const db = drizzle(env.DB, { schema })
  await db.insert(schema.products).values({
    id: crypto.randomUUID(),
    organizationId,
    name: `Produit ${sku}`,
    sku,
    price: 1000,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

describe("génération de SKU", () => {
  it("génère PRD-0001 pour le premier produit de l'organisation", async () => {
    const { organizationId } = await bootstrapOwner()
    const db = drizzle(env.DB, { schema })
    expect(await genererSkuProduit(db, organizationId)).toBe("PRD-0001")
  })

  it("incrémente le max numérique existant avec zero-pad sur 4", async () => {
    const { organizationId } = await bootstrapOwner()
    const db = drizzle(env.DB, { schema })
    await insererProduit(organizationId, "PRD-0007")
    await insererProduit(organizationId, "PRD-0002")
    await insererProduit(organizationId, "REF-CUSTOM")
    expect(await genererSkuProduit(db, organizationId)).toBe("PRD-0008")
  })

  it("suffixe la variante avec les valeurs d'attributs upper-slugifiées", () => {
    expect(
      genererSkuVariante("PRD-0001", { taille: "M", couleur: "Rouge" })
    ).toBe("PRD-0001-M-ROUGE")
    expect(genererSkuVariante("PRD-0001", { couleur: "Rouge foncé" })).toBe(
      "PRD-0001-ROUGE-FONCE"
    )
  })

  it("suffixe -STD pour la variante implicite sans attributs", () => {
    expect(genererSkuVariante("PRD-0001", {})).toBe("PRD-0001-STD")
  })
})
```

Run: `bun run --cwd apps/api test`
Expected: FAIL — module `../src/lib/sku` introuvable.

- [ ] **Step 2: Implémenter**

Create `apps/api/src/lib/sku.ts` :

```ts
import { and, eq, like } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import * as schema from "../db/schema"

const MOTIF_SKU_AUTO = /^PRD-(\d+)$/

export async function genererSkuProduit(
  db: DrizzleD1Database<typeof schema>,
  organizationId: string
): Promise<string> {
  const rows = await db
    .select({ sku: schema.products.sku })
    .from(schema.products)
    .where(
      and(
        eq(schema.products.organizationId, organizationId),
        like(schema.products.sku, "PRD-%")
      )
    )
  let max = 0
  for (const { sku } of rows) {
    const correspondance = MOTIF_SKU_AUTO.exec(sku)
    if (correspondance) {
      max = Math.max(max, Number(correspondance[1]))
    }
  }
  return `PRD-${String(max + 1).padStart(4, "0")}`
}

export function genererSkuVariante(
  skuProduit: string,
  attributes: Record<string, string>
): string {
  const suffixe = Object.values(attributes)
    .map((valeur) =>
      valeur
        // « Rouge foncé » → « ROUGE-FONCE » : accents décomposés puis retirés
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    )
    .filter((valeur) => valeur.length > 0)
    .join("-")
  return suffixe ? `${skuProduit}-${suffixe}` : `${skuProduit}-STD`
}
```

- [ ] **Step 3: Vérifier et committer**

Run: `bun run --cwd apps/api test && bun run typecheck`
Expected: PASS (**46 api**).

```bash
git add -A && git commit -m "feat(api): génération de SKU produits (PRD-0001) et variantes (suffixes slugifiés)"
```

---

### Task 5: API catégories & fournisseurs

**Files:**
- Create: `packages/shared/src/schemas/catalog.ts` (+ export dans `packages/shared/src/index.ts`)
- Create: `apps/api/src/routes/categories.ts`
- Create: `apps/api/src/routes/suppliers.ts`
- Modify: `apps/api/src/index.ts` (montage)
- Create: `apps/api/test/categories.test.ts`
- Create: `apps/api/test/suppliers.test.ts`

**Interfaces:**
- Consumes: middlewares de permissions, `validerCorps` (Task 1), schéma (Task 3)
- Produces:
  - Schémas Zod : `categoryCreateSchema { name, parentId? }`, `categoryUpdateSchema { name?, parentId?: string | null }` (refine non-vide), `supplierCreateSchema { name, contact?, phone? }`, `supplierUpdateSchema` (partiel + `isActive?`, refine non-vide)
  - `GET /api/v1/categories` (**tous les membres**) → `{ categories: [...] }` triées par nom ; `POST /` (owner/admin/stock_manager) → `201 { id }` ; `PATCH /:id` → `200` ; `400 VALIDATION` « Une catégorie ne peut pas être son propre parent » si `parentId === id` ; `404 INTROUVABLE` cross-org, y compris pour un `parentId` inexistant dans l'organisation
  - `GET /api/v1/suppliers` (**tous les membres**) → `{ suppliers: [...] }` triés par nom ; `POST /` et `PATCH /:id` (dont `isActive`) pour owner/admin/stock_manager

- [ ] **Step 1: Schémas Zod partagés**

Create `packages/shared/src/schemas/catalog.ts` :

```ts
import { z } from "zod"

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis"),
  parentId: z.string().min(1).optional(),
})

export const categoryUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "Le nom est requis").optional(),
    parentId: z.string().min(1).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Aucun champ à modifier",
  })

export const supplierCreateSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis"),
  contact: z.string().trim().min(1).optional(),
  phone: z.string().trim().min(1).optional(),
})

export const supplierUpdateSchema = supplierCreateSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Aucun champ à modifier",
  })

export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>
export type SupplierCreateInput = z.infer<typeof supplierCreateSchema>
export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>
```

Ajouter à `packages/shared/src/index.ts` :

```ts
export {
  categoryCreateSchema,
  categoryUpdateSchema,
  supplierCreateSchema,
  supplierUpdateSchema,
  type CategoryCreateInput,
  type CategoryUpdateInput,
  type SupplierCreateInput,
  type SupplierUpdateInput,
} from "./schemas/catalog"
```

- [ ] **Step 2: Tests (échec)**

Create `apps/api/test/categories.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import app from "../src/index"
import * as schema from "../src/db/schema"
import { bootstrapOwner, createUserWithRole } from "./helpers"

function post(cookie: string, body: unknown) {
  return app.request(
    "/api/v1/categories",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

function patch(cookie: string, id: string, body: unknown) {
  return app.request(
    `/api/v1/categories/${id}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

describe("API catégories", () => {
  it("owner et stock_manager écrivent, tous les membres lisent, staff n'écrit pas", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const gestionnaire = await createUserWithRole(
      organizationId,
      "stock_manager"
    )
    const staff = await createUserWithRole(organizationId, "staff")

    expect((await post(ownerCookie, { name: "Boissons" })).status).toBe(201)
    expect((await post(gestionnaire.cookie, { name: "Snacks" })).status).toBe(
      201
    )
    expect((await post(staff.cookie, { name: "Interdit" })).status).toBe(403)

    const liste = await app.request(
      "/api/v1/categories",
      { headers: { cookie: staff.cookie } },
      env
    )
    expect(liste.status).toBe(200)
    const { categories } = await liste.json<{
      categories: Array<{ name: string }>
    }>()
    expect(categories.map((cat) => cat.name)).toEqual(["Boissons", "Snacks"])
  })

  it("PATCH : renomme et reparente ; refuse le parent auto-référent et le parent inconnu", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const { id: parentId } = await (
      await post(ownerCookie, { name: "Boissons" })
    ).json<{ id: string }>()
    const { id } = await (
      await post(ownerCookie, { name: "Sodas" })
    ).json<{ id: string }>()

    expect(
      (await patch(ownerCookie, id, { name: "Sodas & jus", parentId })).status
    ).toBe(200)

    const auto = await patch(ownerCookie, id, { parentId: id })
    expect(auto.status).toBe(400)
    const corpsAuto = await auto.json<{ code: string; message: string }>()
    expect(corpsAuto.code).toBe("VALIDATION")
    expect(corpsAuto.message).toBe(
      "Une catégorie ne peut pas être son propre parent"
    )

    expect(
      (await patch(ownerCookie, id, { parentId: crypto.randomUUID() })).status
    ).toBe(404)
  })

  it("cross-org : une catégorie d'une autre organisation est introuvable (404)", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const db = drizzle(env.DB, { schema })
    const autreOrgId = crypto.randomUUID()
    await db.insert(schema.organization).values({
      id: autreOrgId,
      name: "Autre Société",
      slug: "autre",
      createdAt: new Date(),
    })
    const categorieId = crypto.randomUUID()
    await db.insert(schema.categories).values({
      id: categorieId,
      organizationId: autreOrgId,
      name: "Cachée",
      createdAt: new Date(),
    })
    expect(
      (await patch(ownerCookie, categorieId, { name: "Piratée" })).status
    ).toBe(404)
  })
})
```

Create `apps/api/test/suppliers.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import app from "../src/index"
import { bootstrapOwner, createUserWithRole } from "./helpers"

function post(cookie: string, body: unknown) {
  return app.request(
    "/api/v1/suppliers",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

function patch(cookie: string, id: string, body: unknown) {
  return app.request(
    `/api/v1/suppliers/${id}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

describe("API fournisseurs", () => {
  it("owner crée, la liste est triée, staff lit mais n'écrit pas", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const staff = await createUserWithRole(organizationId, "staff")

    expect(
      (
        await post(ownerCookie, {
          name: "Sodeci Distribution",
          contact: "M. Kouassi",
          phone: "+225 07 00 00 00 01",
        })
      ).status
    ).toBe(201)
    expect((await post(ownerCookie, { name: "Abidjan Boissons" })).status).toBe(
      201
    )
    expect((await post(staff.cookie, { name: "Interdit" })).status).toBe(403)

    const liste = await app.request(
      "/api/v1/suppliers",
      { headers: { cookie: staff.cookie } },
      env
    )
    expect(liste.status).toBe(200)
    const { suppliers } = await liste.json<{
      suppliers: Array<{ name: string; isActive: boolean }>
    }>()
    expect(suppliers.map((s) => s.name)).toEqual([
      "Abidjan Boissons",
      "Sodeci Distribution",
    ])
    expect(suppliers[0]?.isActive).toBe(true)
  })

  it("PATCH modifie le contact et bascule isActive ; 404 sur id inconnu", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const { id } = await (
      await post(ownerCookie, { name: "Sodeci Distribution" })
    ).json<{ id: string }>()

    expect(
      (
        await patch(ownerCookie, id, {
          contact: "Mme Traoré",
          isActive: false,
        })
      ).status
    ).toBe(200)

    const liste = await app.request(
      "/api/v1/suppliers",
      { headers: { cookie: ownerCookie } },
      env
    )
    const { suppliers } = await liste.json<{
      suppliers: Array<{ contact: string | null; isActive: boolean }>
    }>()
    expect(suppliers[0]?.contact).toBe("Mme Traoré")
    expect(suppliers[0]?.isActive).toBe(false)

    expect(
      (await patch(ownerCookie, crypto.randomUUID(), { name: "X" })).status
    ).toBe(404)
  })
})
```

Run: `bun run --cwd apps/api test`
Expected: FAIL — 404 sur les routes.

- [ ] **Step 3: Implémenter les routes**

Create `apps/api/src/routes/categories.ts` :

```ts
import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, asc, eq } from "drizzle-orm"
import { categoryCreateSchema, categoryUpdateSchema } from "shared"
import * as schema from "../db/schema"
import { validerCorps } from "../lib/validation"
import { requireAuth } from "../middleware/require-auth"
import { requireMembership, requireRole } from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import type { Env } from "../env"

export const categoriesRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

categoriesRoute.use(requireAuth, requireMembership)

async function categorieExiste(
  env: Env,
  organizationId: string,
  id: string
): Promise<boolean> {
  const db = drizzle(env.DB, { schema })
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

// Lecture : TOUS les membres (le staff consulte le catalogue)
categoriesRoute.get("/", async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const categories = await db
    .select()
    .from(schema.categories)
    .where(
      eq(schema.categories.organizationId, c.get("membership").organizationId)
    )
    .orderBy(asc(schema.categories.name))
  return c.json({ categories })
})

categoriesRoute.post(
  "/",
  requireRole("owner", "admin", "stock_manager"),
  async (c) => {
    const corps = await validerCorps(c, categoryCreateSchema)
    if (!corps.ok) return corps.reponse
    const { organizationId } = c.get("membership")
    if (
      corps.data.parentId &&
      !(await categorieExiste(c.env, organizationId, corps.data.parentId))
    ) {
      return c.json(
        { code: "INTROUVABLE", message: "Catégorie parente introuvable" },
        404
      )
    }
    const db = drizzle(c.env.DB, { schema })
    const id = crypto.randomUUID()
    await db.insert(schema.categories).values({
      id,
      organizationId,
      name: corps.data.name,
      parentId: corps.data.parentId ?? null,
      createdAt: new Date(),
    })
    return c.json({ id }, 201)
  }
)

categoriesRoute.patch(
  "/:id",
  requireRole("owner", "admin", "stock_manager"),
  async (c) => {
    const corps = await validerCorps(c, categoryUpdateSchema)
    if (!corps.ok) return corps.reponse
    const id = c.req.param("id")
    const { organizationId } = c.get("membership")
    if (corps.data.parentId === id) {
      return c.json(
        {
          code: "VALIDATION",
          message: "Une catégorie ne peut pas être son propre parent",
        },
        400
      )
    }
    if (
      typeof corps.data.parentId === "string" &&
      !(await categorieExiste(c.env, organizationId, corps.data.parentId))
    ) {
      return c.json(
        { code: "INTROUVABLE", message: "Catégorie parente introuvable" },
        404
      )
    }
    const db = drizzle(c.env.DB, { schema })
    const result = await db
      .update(schema.categories)
      .set({
        ...(corps.data.name !== undefined ? { name: corps.data.name } : {}),
        ...(corps.data.parentId !== undefined
          ? { parentId: corps.data.parentId }
          : {}),
      })
      .where(
        and(
          eq(schema.categories.id, id),
          eq(schema.categories.organizationId, organizationId)
        )
      )
      .returning({ id: schema.categories.id })
    if (result.length === 0) {
      return c.json(
        { code: "INTROUVABLE", message: "Catégorie introuvable" },
        404
      )
    }
    return c.json({ ok: true })
  }
)
```

Create `apps/api/src/routes/suppliers.ts` :

```ts
import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, asc, eq } from "drizzle-orm"
import { supplierCreateSchema, supplierUpdateSchema } from "shared"
import * as schema from "../db/schema"
import { validerCorps } from "../lib/validation"
import { requireAuth } from "../middleware/require-auth"
import { requireMembership, requireRole } from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import type { Env } from "../env"

export const suppliersRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

suppliersRoute.use(requireAuth, requireMembership)

// Lecture : TOUS les membres
suppliersRoute.get("/", async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const suppliers = await db
    .select()
    .from(schema.suppliers)
    .where(
      eq(schema.suppliers.organizationId, c.get("membership").organizationId)
    )
    .orderBy(asc(schema.suppliers.name))
  return c.json({ suppliers })
})

suppliersRoute.post(
  "/",
  requireRole("owner", "admin", "stock_manager"),
  async (c) => {
    const corps = await validerCorps(c, supplierCreateSchema)
    if (!corps.ok) return corps.reponse
    const db = drizzle(c.env.DB, { schema })
    const id = crypto.randomUUID()
    await db.insert(schema.suppliers).values({
      id,
      organizationId: c.get("membership").organizationId,
      name: corps.data.name,
      contact: corps.data.contact ?? null,
      phone: corps.data.phone ?? null,
      createdAt: new Date(),
    })
    return c.json({ id }, 201)
  }
)

suppliersRoute.patch(
  "/:id",
  requireRole("owner", "admin", "stock_manager"),
  async (c) => {
    const corps = await validerCorps(c, supplierUpdateSchema)
    if (!corps.ok) return corps.reponse
    const db = drizzle(c.env.DB, { schema })
    const result = await db
      .update(schema.suppliers)
      .set(corps.data)
      .where(
        and(
          eq(schema.suppliers.id, c.req.param("id")),
          eq(
            schema.suppliers.organizationId,
            c.get("membership").organizationId
          )
        )
      )
      .returning({ id: schema.suppliers.id })
    if (result.length === 0) {
      return c.json(
        { code: "INTROUVABLE", message: "Fournisseur introuvable" },
        404
      )
    }
    return c.json({ ok: true })
  }
)
```

Dans `apps/api/src/index.ts`, ajouter les imports et montages :

```ts
import { categoriesRoute } from "./routes/categories"
import { suppliersRoute } from "./routes/suppliers"

app.route("/api/v1/categories", categoriesRoute)

app.route("/api/v1/suppliers", suppliersRoute)
```

- [ ] **Step 4: Vérifier et committer**

Run: `bun run --cwd apps/api test && bun run typecheck`
Expected: PASS (**51 api**).

```bash
git add -A && git commit -m "feat(api): CRUD catégories (hiérarchie simple) et fournisseurs"
```

---
### Task 6: API produits

**Files:**
- Modify: `packages/shared/src/schemas/catalog.ts` (+ exports index)
- Create: `apps/api/src/routes/products.ts`
- Modify: `apps/api/src/index.ts`
- Create: `apps/api/test/products.test.ts`

**Interfaces:**
- Consumes: `genererSkuProduit` (Task 4), `estViolationUnicite`, `validerCorps`, middlewares
- Produces:
  - Schémas Zod : `productCreateSchema { name, description?, categoryId?, barcode?, price: int > 0, minPrice?: int > 0, defaultMinStock?, trackLots?, sku? }` avec refine `minPrice <= price` (message « Le prix plancher doit être inférieur ou égal au prix de vente ») ; `productUpdateSchema` partiel + `isActive?` + même refine quand les deux champs sont présents
  - `POST /api/v1/products` (owner/admin/stock_manager) → `201 { id, sku }` — batch atomique [insert produit (SKU auto si absent, retry ×3 sur violation d'unicité avec re-génération), insert variante implicite `{ name: 'Standard', attributes: '{}', sku: sku + '-STD' }`] ; `409 SKU_EXISTANT` si un SKU fourni est en conflit
  - `GET /api/v1/products?recherche=&categorie=&actifs=` (**tous les membres**) → `{ products: [...] }` triés par nom, avec `variants` imbriquées ; recherche LIKE sur name/sku/barcode du produit **et** sku/barcode des variantes (sous-requête `IN`)
  - `GET /api/v1/products/:id` (**tous les membres**) → `{ product }` fiche complète : variantes triées par nom, chacune avec ses `lots`
  - `PATCH /api/v1/products/:id` (owner/admin/stock_manager) — dont `isActive` ; si un seul de `price`/`minPrice` est modifié, l'autre est relu en base pour valider la cohérence

- [ ] **Step 1: Schémas Zod**

Ajouter à `packages/shared/src/schemas/catalog.ts` :

```ts
export const productCreateSchema = z
  .object({
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
  .refine((v) => v.minPrice === undefined || v.minPrice <= v.price, {
    message: "Le prix plancher doit être inférieur ou égal au prix de vente",
    path: ["minPrice"],
  })

export const productUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "Le nom est requis").optional(),
    description: z.string().trim().min(1).nullable().optional(),
    categoryId: z.string().min(1).nullable().optional(),
    barcode: z.string().trim().min(1).nullable().optional(),
    price: z
      .number()
      .int("Le prix doit être un entier")
      .positive("Le prix doit être positif")
      .optional(),
    minPrice: z
      .number()
      .int("Le prix plancher doit être un entier")
      .positive("Le prix plancher doit être positif")
      .nullable()
      .optional(),
    defaultMinStock: z.number().int().nonnegative().nullable().optional(),
    trackLots: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Aucun champ à modifier",
  })
  .refine(
    (v) =>
      v.price === undefined ||
      v.minPrice === undefined ||
      v.minPrice === null ||
      v.minPrice <= v.price,
    {
      message: "Le prix plancher doit être inférieur ou égal au prix de vente",
      path: ["minPrice"],
    }
  )

export type ProductCreateInput = z.infer<typeof productCreateSchema>
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>
```

Ajouter au bloc d'export catalogue de `packages/shared/src/index.ts` :

```ts
  productCreateSchema,
  productUpdateSchema,
  type ProductCreateInput,
  type ProductUpdateInput,
```

- [ ] **Step 2: Tests (échec)**

Create `apps/api/test/products.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import app from "../src/index"
import * as schema from "../src/db/schema"
import { bootstrapOwner, createUserWithRole } from "./helpers"

function post(cookie: string, body: unknown) {
  return app.request(
    "/api/v1/products",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

function patch(cookie: string, id: string, body: unknown) {
  return app.request(
    `/api/v1/products/${id}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

function fiche(cookie: string, id: string) {
  return app.request(`/api/v1/products/${id}`, { headers: { cookie } }, env)
}

type Fiche = {
  product: {
    sku: string
    isActive: boolean
    hasVariants: boolean
    variants: Array<{ id: string; name: string; sku: string; isActive: boolean }>
  }
}

describe("API produits", () => {
  it("crée avec SKU auto séquentiel et variante implicite -STD", async () => {
    const { ownerCookie } = await bootstrapOwner()

    const premier = await post(ownerCookie, { name: "Coca 33cl", price: 500 })
    expect(premier.status).toBe(201)
    const corps1 = await premier.json<{ id: string; sku: string }>()
    expect(corps1.sku).toBe("PRD-0001")

    const second = await post(ownerCookie, { name: "Fanta 33cl", price: 500 })
    const corps2 = await second.json<{ id: string; sku: string }>()
    expect(corps2.sku).toBe("PRD-0002")

    const detail = await (await fiche(ownerCookie, corps1.id)).json<Fiche>()
    expect(detail.product.hasVariants).toBe(false)
    expect(detail.product.variants).toHaveLength(1)
    expect(detail.product.variants[0]?.name).toBe("Standard")
    expect(detail.product.variants[0]?.sku).toBe("PRD-0001-STD")
  })

  it("refuse un prix plancher supérieur au prix (400 VALIDATION)", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const res = await post(ownerCookie, {
      name: "Coca 33cl",
      price: 500,
      minPrice: 600,
    })
    expect(res.status).toBe(400)
    expect((await res.json<{ code: string }>()).code).toBe("VALIDATION")
  })

  it("409 SKU_EXISTANT si le SKU fourni existe déjà", async () => {
    const { ownerCookie } = await bootstrapOwner()
    expect(
      (await post(ownerCookie, { name: "A", price: 100, sku: "REF-UNIQUE" }))
        .status
    ).toBe(201)
    const doublon = await post(ownerCookie, {
      name: "B",
      price: 100,
      sku: "REF-UNIQUE",
    })
    expect(doublon.status).toBe(409)
    expect((await doublon.json<{ code: string }>()).code).toBe("SKU_EXISTANT")
  })

  it("recherche par code-barres d'une variante", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const { id } = await (
      await post(ownerCookie, { name: "Coca 33cl", price: 500 })
    ).json<{ id: string }>()

    const db = drizzle(env.DB, { schema })
    await db.insert(schema.productVariants).values({
      id: crypto.randomUUID(),
      organizationId,
      productId: id,
      name: "Pack de 6",
      attributes: JSON.stringify({ format: "Pack de 6" }),
      sku: "PRD-0001-PACK-DE-6",
      barcode: "3057640257123",
      createdAt: new Date(),
    })

    const res = await app.request(
      "/api/v1/products?recherche=3057640257123",
      { headers: { cookie: ownerCookie } },
      env
    )
    expect(res.status).toBe(200)
    const { products } = await res.json<{
      products: Array<{ name: string; variants: Array<unknown> }>
    }>()
    expect(products).toHaveLength(1)
    expect(products[0]?.name).toBe("Coca 33cl")
    expect(products[0]?.variants).toHaveLength(2)
  })

  it("permissions : staff lit, staff n'écrit pas, stock_manager écrit", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    await post(ownerCookie, { name: "Coca 33cl", price: 500 })
    const gestionnaire = await createUserWithRole(
      organizationId,
      "stock_manager"
    )
    const staff = await createUserWithRole(organizationId, "staff")

    expect(
      (
        await app.request(
          "/api/v1/products",
          { headers: { cookie: staff.cookie } },
          env
        )
      ).status
    ).toBe(200)
    expect((await post(staff.cookie, { name: "X", price: 100 })).status).toBe(
      403
    )
    expect(
      (await post(gestionnaire.cookie, { name: "Y", price: 100 })).status
    ).toBe(201)
  })

  it("PATCH revalide le plancher quand le prix change, et bascule isActive", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const { id } = await (
      await post(ownerCookie, { name: "Coca 33cl", price: 1000, minPrice: 800 })
    ).json<{ id: string }>()

    const tropBas = await patch(ownerCookie, id, { price: 500 })
    expect(tropBas.status).toBe(400)
    expect((await tropBas.json<{ code: string }>()).code).toBe("VALIDATION")

    expect((await patch(ownerCookie, id, { price: 900 })).status).toBe(200)
    expect((await patch(ownerCookie, id, { isActive: false })).status).toBe(200)
    const detail = await (await fiche(ownerCookie, id)).json<Fiche>()
    expect(detail.product.isActive).toBe(false)
  })
})
```

Run: `bun run --cwd apps/api test`
Expected: FAIL — 404 sur les routes.

- [ ] **Step 3: Implémenter la route**

Create `apps/api/src/routes/products.ts` :

```ts
import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, asc, eq, inArray, like, or } from "drizzle-orm"
import { productCreateSchema, productUpdateSchema } from "shared"
import * as schema from "../db/schema"
import { validerCorps } from "../lib/validation"
import { estViolationUnicite } from "../lib/db-errors"
import { genererSkuProduit } from "../lib/sku"
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
  const produit = produits[0]
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
    const produit = produits[0]
    if (!produit) {
      return c.json(
        { code: "INTROUVABLE", message: "Produit introuvable" },
        404
      )
    }
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
```

Dans `apps/api/src/index.ts` :

```ts
import { productsRoute } from "./routes/products"

app.route("/api/v1/products", productsRoute)
```

- [ ] **Step 4: Vérifier et committer**

Run: `bun run --cwd apps/api test && bun run typecheck`
Expected: PASS (**57 api**).

```bash
git add -A && git commit -m "feat(api): produits — SKU auto, variante implicite, recherche, fiche, permissions"
```

---

### Task 7: API variantes & lots

**Files:**
- Modify: `packages/shared/src/schemas/catalog.ts` (+ exports index)
- Modify: `apps/api/src/routes/products.ts` (`POST /:id/variants`)
- Create: `apps/api/src/routes/variants.ts`
- Modify: `apps/api/src/index.ts`
- Create: `apps/api/test/variants.test.ts`

**Interfaces:**
- Consumes: `genererSkuVariante` (Task 4), `estViolationUnicite`, `validerCorps`, middlewares
- Produces:
  - Schémas Zod : `variantCreateSchema { name, attributes: Record<string,string> (défaut {}), barcode?, priceOverride?, minPriceOverride?, sku? }` ; `variantUpdateSchema { barcode?: string|null, priceOverride?: int|null, minPriceOverride?: int|null, isActive? }` (refine non-vide) ; `lotCreateSchema { lotNumber, expiryDate?: 'AAAA-MM-JJ' }`
  - `POST /api/v1/products/:id/variants` (owner/admin/stock_manager) → `201 { id, sku }` ; à la **première** variante explicite d'un produit `hasVariants=false` : batch atomique [désactiver la variante implicite `-STD`, insérer la nouvelle, `hasVariants=true`] ; sinon simple insert ; SKU auto via `genererSkuVariante` ; `400 VALIDATION` si `minPriceOverride > (priceOverride ?? product.price)` ; `409 SKU_EXISTANT` sur conflit
  - `PATCH /api/v1/variants/:id` — overrides, barcode, `isActive` ; `409 DERNIERE_VARIANTE` si on désactive la dernière variante active d'un produit actif
  - `POST /api/v1/variants/:id/lots` → `201 { id }` ; `400 LOTS_NON_SUIVIS` si `product.trackLots = false` ; `409 LOT_EXISTANT` sur doublon (variantId, lotNumber) — la lecture des lots passe par la fiche produit (Task 6)

- [ ] **Step 1: Schémas Zod**

Ajouter à `packages/shared/src/schemas/catalog.ts` :

```ts
export const variantCreateSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis"),
  attributes: z.record(z.string(), z.string().trim().min(1)).default({}),
  barcode: z.string().trim().min(1).optional(),
  priceOverride: z
    .number()
    .int("Le prix doit être un entier")
    .positive("Le prix doit être positif")
    .optional(),
  minPriceOverride: z
    .number()
    .int("Le prix plancher doit être un entier")
    .positive("Le prix plancher doit être positif")
    .optional(),
  sku: z.string().trim().min(1).optional(),
})

export const variantUpdateSchema = z
  .object({
    barcode: z.string().trim().min(1).nullable().optional(),
    priceOverride: z.number().int().positive().nullable().optional(),
    minPriceOverride: z.number().int().positive().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Aucun champ à modifier",
  })

export const lotCreateSchema = z.object({
  lotNumber: z.string().trim().min(1, "Le numéro de lot est requis"),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date de péremption invalide (AAAA-MM-JJ)")
    .optional(),
})

export type VariantCreateInput = z.infer<typeof variantCreateSchema>
export type VariantUpdateInput = z.infer<typeof variantUpdateSchema>
export type LotCreateInput = z.infer<typeof lotCreateSchema>
```

Ajouter au bloc d'export catalogue de `packages/shared/src/index.ts` :

```ts
  variantCreateSchema,
  variantUpdateSchema,
  lotCreateSchema,
  type VariantCreateInput,
  type VariantUpdateInput,
  type LotCreateInput,
```

- [ ] **Step 2: Tests (échec)**

Create `apps/api/test/variants.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import app from "../src/index"
import { bootstrapOwner } from "./helpers"

async function creerProduit(cookie: string, body: Record<string, unknown>) {
  const res = await app.request(
    "/api/v1/products",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
  return res.json<{ id: string; sku: string }>()
}

function ajouterVariante(cookie: string, productId: string, body: unknown) {
  return app.request(
    `/api/v1/products/${productId}/variants`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

function patchVariante(cookie: string, id: string, body: unknown) {
  return app.request(
    `/api/v1/variants/${id}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

function ajouterLot(cookie: string, variantId: string, body: unknown) {
  return app.request(
    `/api/v1/variants/${variantId}/lots`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env
  )
}

async function fiche(cookie: string, id: string) {
  const res = await app.request(
    `/api/v1/products/${id}`,
    { headers: { cookie } },
    env
  )
  return res.json<{
    product: {
      hasVariants: boolean
      variants: Array<{
        id: string
        name: string
        sku: string
        isActive: boolean
        lots: Array<{ lotNumber: string }>
      }>
    }
  }>()
}

describe("API variantes & lots", () => {
  it("première variante explicite : désactive l'implicite, bascule hasVariants, SKU auto", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const { id } = await creerProduit(ownerCookie, {
      name: "T-shirt",
      price: 5000,
    })

    const res = await ajouterVariante(ownerCookie, id, {
      name: "M / Rouge",
      attributes: { taille: "M", couleur: "Rouge" },
    })
    expect(res.status).toBe(201)
    const corps = await res.json<{ id: string; sku: string }>()
    expect(corps.sku).toBe("PRD-0001-M-ROUGE")

    const detail = await fiche(ownerCookie, id)
    expect(detail.product.hasVariants).toBe(true)
    const implicite = detail.product.variants.find(
      (v) => v.name === "Standard"
    )
    expect(implicite?.isActive).toBe(false)
    const explicite = detail.product.variants.find(
      (v) => v.name === "M / Rouge"
    )
    expect(explicite?.isActive).toBe(true)
  })

  it("refuse un plancher de variante supérieur au prix effectif (400 VALIDATION)", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const { id } = await creerProduit(ownerCookie, {
      name: "T-shirt",
      price: 5000,
    })
    const res = await ajouterVariante(ownerCookie, id, {
      name: "L",
      attributes: { taille: "L" },
      minPriceOverride: 6000,
    })
    expect(res.status).toBe(400)
    expect((await res.json<{ code: string }>()).code).toBe("VALIDATION")
  })

  it("refuse de désactiver la dernière variante active d'un produit actif (409 DERNIERE_VARIANTE)", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const { id } = await creerProduit(ownerCookie, {
      name: "Coca 33cl",
      price: 500,
    })
    const detail = await fiche(ownerCookie, id)
    const implicite = detail.product.variants[0]
    expect(implicite).toBeDefined()

    const res = await patchVariante(ownerCookie, implicite?.id ?? "", {
      isActive: false,
    })
    expect(res.status).toBe(409)
    expect((await res.json<{ code: string }>()).code).toBe(
      "DERNIERE_VARIANTE"
    )
  })

  it("lots : création puis doublon → 409 LOT_EXISTANT", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const { id } = await creerProduit(ownerCookie, {
      name: "Yaourt nature",
      price: 300,
      trackLots: true,
    })
    const detail = await fiche(ownerCookie, id)
    const variante = detail.product.variants[0]

    const ok = await ajouterLot(ownerCookie, variante?.id ?? "", {
      lotNumber: "LOT-2026-01",
      expiryDate: "2026-12-31",
    })
    expect(ok.status).toBe(201)

    const doublon = await ajouterLot(ownerCookie, variante?.id ?? "", {
      lotNumber: "LOT-2026-01",
    })
    expect(doublon.status).toBe(409)
    expect((await doublon.json<{ code: string }>()).code).toBe("LOT_EXISTANT")

    const apres = await fiche(ownerCookie, id)
    expect(apres.product.variants[0]?.lots).toHaveLength(1)
  })

  it("lots refusés si le produit ne suit pas les lots (400 LOTS_NON_SUIVIS)", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const { id } = await creerProduit(ownerCookie, {
      name: "Coca 33cl",
      price: 500,
    })
    const detail = await fiche(ownerCookie, id)
    const variante = detail.product.variants[0]

    const res = await ajouterLot(ownerCookie, variante?.id ?? "", {
      lotNumber: "LOT-X",
    })
    expect(res.status).toBe(400)
    expect((await res.json<{ code: string }>()).code).toBe("LOTS_NON_SUIVIS")
  })
})
```

Run: `bun run --cwd apps/api test`
Expected: FAIL — 404 sur les routes.

- [ ] **Step 3: Implémenter**

Ajouter à `apps/api/src/routes/products.ts` (imports supplémentaires : `variantCreateSchema` depuis `shared`, `genererSkuVariante` depuis `../lib/sku`) :

```ts
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
    const produit = produits[0]
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
```

Create `apps/api/src/routes/variants.ts` :

```ts
import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, eq, ne } from "drizzle-orm"
import { variantUpdateSchema, lotCreateSchema } from "shared"
import * as schema from "../db/schema"
import { validerCorps } from "../lib/validation"
import { estViolationUnicite } from "../lib/db-errors"
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

// Retour explicitement nullable : sans l'annotation, TS élide `| null`
// (indexation de tableau) et eslint no-unnecessary-condition se déclenche
// chez les appelants (même piège que membershipCible dans users.ts).
async function varianteScopee(
  env: Env,
  organizationId: string,
  id: string
): Promise<typeof schema.productVariants.$inferSelect | null> {
  const db = drizzle(env.DB, { schema })
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

variantsRoute.patch("/:id", async (c) => {
  const corps = await validerCorps(c, variantUpdateSchema)
  if (!corps.ok) return corps.reponse
  const { organizationId } = c.get("membership")
  const variante = await varianteScopee(c.env, organizationId, c.req.param("id"))
  if (!variante) {
    return c.json({ code: "INTROUVABLE", message: "Variante introuvable" }, 404)
  }
  const db = drizzle(c.env.DB, { schema })
  const produits = await db
    .select({
      price: schema.products.price,
      isActive: schema.products.isActive,
    })
    .from(schema.products)
    .where(eq(schema.products.id, variante.productId))
    .limit(1)
  const produit = produits[0]
  if (!produit) {
    return c.json({ code: "INTROUVABLE", message: "Produit introuvable" }, 404)
  }

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

  if (corps.data.isActive === false && variante.isActive && produit.isActive) {
    const autresActives = await db
      .select({ id: schema.productVariants.id })
      .from(schema.productVariants)
      .where(
        and(
          eq(schema.productVariants.productId, variante.productId),
          eq(schema.productVariants.isActive, true),
          ne(schema.productVariants.id, variante.id)
        )
      )
    if (autresActives.length === 0) {
      return c.json(
        {
          code: "DERNIERE_VARIANTE",
          message:
            "Impossible de désactiver la dernière variante active d'un produit actif",
        },
        409
      )
    }
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
  const variante = await varianteScopee(c.env, organizationId, c.req.param("id"))
  if (!variante) {
    return c.json({ code: "INTROUVABLE", message: "Variante introuvable" }, 404)
  }
  const db = drizzle(c.env.DB, { schema })
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

Dans `apps/api/src/index.ts` :

```ts
import { variantsRoute } from "./routes/variants"

app.route("/api/v1/variants", variantsRoute)
```

- [ ] **Step 4: Vérifier et committer**

Run: `bun run --cwd apps/api test && bun run typecheck`
Expected: PASS (**62 api**).

```bash
git add -A && git commit -m "feat(api): variantes explicites (bascule implicite→explicites) et lots"
```

---

### Task 8: API images produits (R2)

**Files:**
- Modify: `apps/api/src/routes/products.ts` (`POST /:id/image`)
- Create: `apps/api/src/routes/files.ts`
- Modify: `apps/api/src/index.ts`
- Create: `apps/api/test/images.test.ts`

**Interfaces:**
- Consumes: binding `IMAGES` (Task 2), middlewares
- Produces:
  - `POST /api/v1/products/:id/image` (owner/admin/stock_manager, multipart form-data champ `image`) → `200 { imageKey }` ; `400 IMAGE_TROP_LOURDE` « L'image dépasse 2 Mo » au-delà de 2 Mo ; `400 FORMAT_IMAGE` « Formats acceptés : JPEG, PNG, WebP » hors image/jpeg|png|webp ; clé `produits/<productId>.<ext>` ; supprime l'ancienne clé si différente ; met à jour `product.imageKey`
  - `GET /api/v1/files/produits/:fichier` (authentifié + membre) : vérifie que `imageKey` appartient à un produit de **l'organisation de l'appelant** (sinon `404`), streame depuis R2 avec le bon `Content-Type`

- [ ] **Step 1: Tests (échec)**

Create `apps/api/test/images.test.ts` :

```ts
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
```

Run: `bun run --cwd apps/api test`
Expected: FAIL — 404 sur les routes.

- [ ] **Step 2: Implémenter**

Ajouter à `apps/api/src/routes/products.ts` :

```ts
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
    const produit = produits[0]
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
```

Create `apps/api/src/routes/files.ts` :

```ts
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
```

Dans `apps/api/src/index.ts` :

```ts
import { filesRoute } from "./routes/files"

app.route("/api/v1/files", filesRoute)
```

- [ ] **Step 3: Vérifier et committer**

Run: `bun run --cwd apps/api test && bun run typecheck`
Expected: PASS (**66 api**).

```bash
git add -A && git commit -m "feat(api): images produits sur R2 (upload contrôlé + service authentifié)"
```

---
### Task 9: Front — navigation Catalogue + écran produits (liste)

**Files:**
- Create: `apps/web/src/lib/format.ts` et `apps/web/src/lib/format.test.ts`
- Modify: `apps/web/src/lib/api.ts` (helper `apiUrl`)
- Modify: `apps/web/src/routes/_app.tsx` (section « Catalogue » pour tous les membres)
- Create: `apps/web/src/routes/_app/catalogue/produits/index.tsx` (écran complet)
- Create: `apps/web/src/routes/_app/catalogue/produits/$productId.tsx` (squelette, remplacé en Task 10)
- Create: `apps/web/src/routes/_app/catalogue/categories.tsx` (squelette, remplacé en Task 11)
- Create: `apps/web/src/routes/_app/catalogue/fournisseurs.tsx` (squelette, remplacé en Task 11)

**Interfaces:**
- Consumes: `GET /api/v1/products`, `GET /api/v1/categories`, `GET /api/v1/organization` (devise), `GET /api/v1/files/*` (miniatures), `POST /api/v1/products`, contexte `me`
- Produces: `formaterMontant(montant: number, devise?: string): string` (`src/lib/format.ts`, Intl fr-FR, devise par défaut `XOF`, 0 décimale) ; `apiUrl(path: string): string` (`src/lib/api.ts`) ; sidebar avec section « Catalogue » (Produits / Catégories / Fournisseurs) visible par **tous** les membres ; écran liste produits : recherche debouncée 300 ms, filtre catégorie, tableau (miniature 40 px ou placeholder, nom, SKU mono, prix formaté avec la devise de l'organisation, badge nombre de variantes actives, badge Actif/Inactif), dialog « Nouveau produit » (owner/admin/stock_manager) qui navigue vers la fiche à la création

- [ ] **Step 1: Test du formatage de montant (échec)**

Create `apps/web/src/lib/format.test.ts` :

```tsx
import { describe, it, expect } from "vitest"
import { formaterMontant } from "./format"

// Intl insère des espaces insécables (U+202F pour les milliers, U+00A0 avant
// la devise) : on normalise pour asserter le contenu réel sans dépendre du
// type d'espace.
const normaliser = (s: string) =>
  s.replace(/[\u202f\u00a0]/g, " ")

describe("formaterMontant", () => {
  it("formate 22000 XOF en « 22 000 F CFA »", () => {
    expect(normaliser(formaterMontant(22000))).toBe("22 000 F CFA")
  })

  it("formate un petit montant sans décimales", () => {
    expect(normaliser(formaterMontant(500))).toBe("500 F CFA")
  })
})
```

Run: `bun run --cwd apps/web test`
Expected: FAIL — module `./format` introuvable.

- [ ] **Step 2: Implémenter format.ts et apiUrl**

Create `apps/web/src/lib/format.ts` :

```ts
// Montants entiers (XOF) : jamais de décimales à l'affichage.
export function formaterMontant(montant: number, devise = "XOF"): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: devise,
    maximumFractionDigits: 0,
  }).format(montant)
}
```

Dans `apps/web/src/lib/api.ts`, ajouter à la fin :

```ts
// URL absolue vers l'API (les <img> ne passent pas par apiFetch)
export function apiUrl(path: string): string {
  return `${base}${path}`
}
```

Run: `bun run --cwd apps/web test`
Expected: PASS (**12 web**).

- [ ] **Step 3: Sidebar Catalogue + squelettes de routes**

Dans `apps/web/src/routes/_app.tsx`, insérer la section Catalogue dans la `<nav>`, entre le lien « Tableau de bord » et le bloc `{estAdmin && (...)}` — visible par **tous** les membres :

```tsx
            <p className="mt-4 mb-1 px-2 text-[11px] font-medium tracking-widest text-gray-400 uppercase">
              Catalogue
            </p>
            <Link to="/catalogue/produits" className={lienClasses}>
              Produits
            </Link>
            <Link to="/catalogue/categories" className={lienClasses}>
              Catégories
            </Link>
            <Link to="/catalogue/fournisseurs" className={lienClasses}>
              Fournisseurs
            </Link>
```

Créer les squelettes (TypeScript refuse les `<Link>`/`navigate` vers des routes inexistantes ; le plugin TanStack Router régénère `routeTree.gen.ts` au prochain `dev`/`build`) :

`apps/web/src/routes/_app/catalogue/produits/$productId.tsx` :

```tsx
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_app/catalogue/produits/$productId")({
  component: () => <p>À venir</p>,
})
```

`apps/web/src/routes/_app/catalogue/categories.tsx` :

```tsx
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_app/catalogue/categories")({
  component: () => <p>À venir</p>,
})
```

`apps/web/src/routes/_app/catalogue/fournisseurs.tsx` :

```tsx
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_app/catalogue/fournisseurs")({
  component: () => <p>À venir</p>,
})
```

- [ ] **Step 4: Écran liste produits**

Create `apps/web/src/routes/_app/catalogue/produits/index.tsx` :

```tsx
import { useEffect, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery } from "@tanstack/react-query"
import { apiFetch, apiUrl } from "@/lib/api"
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

export const Route = createFileRoute("/_app/catalogue/produits/")({
  component: ProduitsPage,
})

type Variante = { id: string; isActive: boolean }
type Produit = {
  id: string
  name: string
  sku: string
  price: number
  imageKey: string | null
  isActive: boolean
  variants: Variante[]
}
type Categorie = { id: string; name: string }
type Reglages = { currency: string }

function ProduitsPage() {
  const { me } = Route.useRouteContext()
  const navigate = useNavigate()
  const role = me.membership?.role
  const peutEcrire =
    role === "owner" || role === "admin" || role === "stock_manager"

  const [recherche, setRecherche] = useState("")
  const [rechercheDebouncee, setRechercheDebouncee] = useState("")
  const [categorie, setCategorie] = useState("")

  // Debounce 300 ms : la requête ne part qu'une fois la saisie stabilisée
  useEffect(() => {
    const timer = setTimeout(() => setRechercheDebouncee(recherche), 300)
    return () => clearTimeout(timer)
  }, [recherche])

  const produits = useQuery({
    queryKey: ["products", rechercheDebouncee, categorie],
    queryFn: () => {
      const params = new URLSearchParams()
      if (rechercheDebouncee) params.set("recherche", rechercheDebouncee)
      if (categorie) params.set("categorie", categorie)
      const qs = params.toString()
      return apiFetch<{ products: Produit[] }>(
        `/api/v1/products${qs ? `?${qs}` : ""}`
      )
    },
  })
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () =>
      apiFetch<{ categories: Categorie[] }>("/api/v1/categories"),
  })
  const organisation = useQuery({
    queryKey: ["organization"],
    queryFn: () => apiFetch<Reglages>("/api/v1/organization"),
  })
  const devise = organisation.data?.currency ?? "XOF"

  const [dialogOuvert, setDialogOuvert] = useState(false)
  const [nom, setNom] = useState("")
  const [prix, setPrix] = useState("")
  const [plancher, setPlancher] = useState("")
  const [categorieProduit, setCategorieProduit] = useState("")
  const [codeBarres, setCodeBarres] = useState("")
  const [description, setDescription] = useState("")
  const [suiviLots, setSuiviLots] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const creer = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string; sku: string }>("/api/v1/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: nom,
          price: Number(prix),
          minPrice: plancher ? Number(plancher) : undefined,
          categoryId: categorieProduit || undefined,
          barcode: codeBarres || undefined,
          description: description || undefined,
          trackLots: suiviLots,
        }),
      }),
    onSuccess: (res) => {
      setDialogOuvert(false)
      void navigate({
        to: "/catalogue/produits/$productId",
        params: { productId: res.id },
      })
    },
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Produits</h1>
        {peutEcrire && (
          <Dialog open={dialogOuvert} onOpenChange={setDialogOuvert}>
            <DialogTrigger render={<Button />}>Nouveau produit</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nouveau produit</DialogTitle>
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
                  <Label htmlFor="p-nom">Nom</Label>
                  <Input
                    id="p-nom"
                    required
                    value={nom}
                    onChange={(e) => setNom(e.target.value)}
                  />
                </div>
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
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="p-categorie">Catégorie</Label>
                  <select
                    id="p-categorie"
                    value={categorieProduit}
                    onChange={(e) => setCategorieProduit(e.target.value)}
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
                  <Label htmlFor="p-barcode">Code-barres (optionnel)</Label>
                  <Input
                    id="p-barcode"
                    value={codeBarres}
                    onChange={(e) => setCodeBarres(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="p-description">Description (optionnel)</Label>
                  <textarea
                    id="p-description"
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="rounded-md border px-3 py-2 text-sm"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={suiviLots}
                    onChange={(e) => setSuiviLots(e.target.checked)}
                  />
                  Suivre les lots (péremption)
                </label>
                {erreur && (
                  <p role="alert" className="text-sm text-red-700">
                    {erreur}
                  </p>
                )}
                <Button type="submit" disabled={creer.isPending}>
                  {creer.isPending ? "Création…" : "Créer le produit"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-recherche">Recherche (nom, SKU, code-barres)</Label>
          <Input
            id="p-recherche"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            className="w-72"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-filtre-categorie">Catégorie</Label>
          <select
            id="p-filtre-categorie"
            value={categorie}
            onChange={(e) => setCategorie(e.target.value)}
            className="h-10 rounded-md border px-2 text-sm"
          >
            <option value="">Toutes</option>
            {(categories.data?.categories ?? []).map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {produits.isPending ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead />
              <TableHead>Nom</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Prix</TableHead>
              <TableHead>Variantes</TableHead>
              <TableHead>Statut</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(produits.data?.products ?? []).map((p) => (
              <TableRow
                key={p.id}
                className="cursor-pointer"
                onClick={() =>
                  void navigate({
                    to: "/catalogue/produits/$productId",
                    params: { productId: p.id },
                  })
                }
              >
                <TableCell>
                  {p.imageKey ? (
                    <img
                      src={apiUrl(`/api/v1/files/${p.imageKey}`)}
                      alt=""
                      crossOrigin="use-credentials"
                      className="h-10 w-10 rounded object-cover"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded bg-gray-100" />
                  )}
                </TableCell>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                <TableCell>{formaterMontant(p.price, devise)}</TableCell>
                <TableCell>
                  <Badge variant="secondary">
                    {p.variants.filter((v) => v.isActive).length}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={p.isActive ? "default" : "secondary"}>
                    {p.isActive ? "Actif" : "Inactif"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
            {produits.data?.products.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-sm text-gray-500"
                >
                  Aucun produit trouvé.
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

Rappel des pièges : base-ui Dialog → `<DialogTrigger render={<Button />}>` (pas de `asChild`) ; imports de types scindés si un type est importé.

- [ ] **Step 5: Vérifier et committer**

```bash
bun run --cwd apps/web test && bun run typecheck && bun run --cwd apps/web build
git add -A && git commit -m "feat(web): navigation catalogue + écran liste produits (recherche, filtre, création)"
```

Expected: 12 web verts, typecheck et build OK (`routeTree.gen.ts` régénéré par le build).

---

### Task 10: Front — fiche produit

**Files:**
- Modify: `apps/web/src/routes/_app/catalogue/produits/$productId.tsx` (remplace le squelette)

**Interfaces:**
- Consumes: `GET/PATCH /api/v1/products/:id`, `POST /api/v1/products/:id/image`, `GET /api/v1/files/*`, `POST /api/v1/products/:id/variants`, `PATCH /api/v1/variants/:id`, `POST /api/v1/variants/:id/lots`, `GET /api/v1/categories`, `GET /api/v1/organization`
- Produces: fiche produit — infos éditables (nom, prix, plancher, catégorie, code-barres, description, actif), upload d'image (aperçu via `/api/v1/files`, erreurs `IMAGE_TROP_LOURDE`/`FORMAT_IMAGE` affichées `role="alert"`), section variantes (tableau + dialog d'ajout avec attributs clé/valeur dynamiques et overrides), section lots par variante si `trackLots` (dialog lotNumber + date de péremption, badge rouge si expiré). `peutEcrire` masque toute écriture.

- [ ] **Step 1: Implémenter la page**

Remplacer `apps/web/src/routes/_app/catalogue/produits/$productId.tsx` par :

```tsx
import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch, apiUrl } from "@/lib/api"
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

export const Route = createFileRoute("/_app/catalogue/produits/$productId")({
  component: FicheProduitPage,
})

type Lot = { id: string; lotNumber: string; expiryDate: string | null }
type Variante = {
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
type Produit = {
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

function lireAttributs(brut: string): Record<string, string> {
  try {
    return JSON.parse(brut) as Record<string, string>
  } catch {
    return {}
  }
}

function estExpire(lot: Lot): boolean {
  return lot.expiryDate !== null && new Date(lot.expiryDate) < new Date()
}

function FicheProduitPage() {
  const { me } = Route.useRouteContext()
  const { productId } = Route.useParams()
  const role = me.membership?.role
  const peutEcrire =
    role === "owner" || role === "admin" || role === "stock_manager"
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: ["product", productId],
    queryFn: () =>
      apiFetch<{ product: Produit }>(`/api/v1/products/${productId}`),
  })
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () =>
      apiFetch<{ categories: Categorie[] }>("/api/v1/categories"),
  })
  const organisation = useQuery({
    queryKey: ["organization"],
    queryFn: () => apiFetch<{ currency: string }>("/api/v1/organization"),
  })
  const devise = organisation.data?.currency ?? "XOF"

  const [form, setForm] = useState<FormulaireProduit | null>(null)
  useEffect(() => {
    if (data && !form) {
      const p = data.product
      setForm({
        name: p.name,
        description: p.description ?? "",
        categoryId: p.categoryId ?? "",
        barcode: p.barcode ?? "",
        price: String(p.price),
        minPrice: p.minPrice === null ? "" : String(p.minPrice),
        isActive: p.isActive,
      })
    }
  }, [data, form])

  const [message, setMessage] = useState<string | null>(null)
  const [erreurImage, setErreurImage] = useState<string | null>(null)
  const [versionImage, setVersionImage] = useState(0)

  const invalider = () =>
    queryClient.invalidateQueries({ queryKey: ["product", productId] })

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
      await invalider()
      setMessage("Produit enregistré")
    },
    onError: (err) =>
      setMessage(err instanceof Error ? err.message : "Erreur"),
  })

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
      await invalider()
      setVersionImage((v) => v + 1)
      setErreurImage(null)
    },
    onError: (err) =>
      // Les messages IMAGE_TROP_LOURDE / FORMAT_IMAGE arrivent déjà en
      // français via apiFetch (body.message)
      setErreurImage(err instanceof Error ? err.message : "Erreur"),
  })

  // Dialog variante
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
      await invalider()
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
    onSuccess: invalider,
    onError: (err) => alert(err instanceof Error ? err.message : "Erreur"),
  })

  // Dialog lot
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
      await invalider()
      setDialogLotPour(null)
      setNumeroLot("")
      setDatePeremption("")
      setErreurLot(null)
    },
    onError: (err) =>
      setErreurLot(err instanceof Error ? err.message : "Erreur"),
  })

  if (!data || !form) {
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
                onChange={(e) =>
                  setForm({ ...form, minPrice: e.target.value })
                }
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="f-categorie">Catégorie</Label>
            <select
              id="f-categorie"
              disabled={!peutEcrire}
              value={form.categoryId}
              onChange={(e) =>
                setForm({ ...form, categoryId: e.target.value })
              }
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
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
          {peutEcrire && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) =>
                  setForm({ ...form, isActive: e.target.checked })
                }
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

      {produit.trackLots && (
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
                      <li
                        key={lot.id}
                        className="flex items-center gap-3 text-sm"
                      >
                        <span className="font-mono">{lot.lotNumber}</span>
                        <span className="text-gray-500">
                          {lot.expiryDate
                            ? new Date(lot.expiryDate).toLocaleDateString(
                                "fr-FR"
                              )
                            : "sans péremption"}
                        </span>
                        {estExpire(lot) && (
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
        </section>
      )}

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
    </div>
  )
}
```

- [ ] **Step 2: Vérifier et committer**

```bash
bun run typecheck && bun run --cwd apps/web test && bun run --cwd apps/web build
git add -A && git commit -m "feat(web): fiche produit (édition, image, variantes, lots)"
```

Expected: 12 web verts, typecheck et build OK.

---

### Task 11: Front — écrans catégories & fournisseurs

**Files:**
- Modify: `apps/web/src/routes/_app/catalogue/categories.tsx` (remplace le squelette)
- Modify: `apps/web/src/routes/_app/catalogue/fournisseurs.tsx` (remplace le squelette)

**Interfaces:**
- Consumes: `GET/POST/PATCH /api/v1/categories`, `GET/POST/PATCH /api/v1/suppliers`, contexte `me`
- Produces: écran catégories (tableau avec affichage « Parent > Enfant », dialog création/édition avec select parent optionnel) ; écran fournisseurs (nom/contact/téléphone, badge actif, bascule). Lecture seule sans `peutEcrire` (owner/admin/stock_manager).

- [ ] **Step 1: Écran catégories**

Remplacer `apps/web/src/routes/_app/catalogue/categories.tsx` par :

```tsx
import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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

export const Route = createFileRoute("/_app/catalogue/categories")({
  component: CategoriesPage,
})

type Categorie = { id: string; name: string; parentId: string | null }

function CategoriesPage() {
  const { me } = Route.useRouteContext()
  const role = me.membership?.role
  const peutEcrire =
    role === "owner" || role === "admin" || role === "stock_manager"
  const queryClient = useQueryClient()

  const { data, isPending } = useQuery({
    queryKey: ["categories"],
    queryFn: () =>
      apiFetch<{ categories: Categorie[] }>("/api/v1/categories"),
  })
  const parents = new Map(
    (data?.categories ?? []).map((cat) => [cat.id, cat.name])
  )

  const [dialogOuvert, setDialogOuvert] = useState(false)
  const [enEdition, setEnEdition] = useState<Categorie | null>(null)
  const [nom, setNom] = useState("")
  const [parentId, setParentId] = useState("")
  const [erreur, setErreur] = useState<string | null>(null)

  function ouvrirCreation() {
    setEnEdition(null)
    setNom("")
    setParentId("")
    setErreur(null)
    setDialogOuvert(true)
  }

  function ouvrirEdition(cat: Categorie) {
    setEnEdition(cat)
    setNom(cat.name)
    setParentId(cat.parentId ?? "")
    setErreur(null)
    setDialogOuvert(true)
  }

  const enregistrer = useMutation({
    mutationFn: () =>
      enEdition
        ? apiFetch(`/api/v1/categories/${enEdition.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: nom, parentId: parentId || null }),
          })
        : apiFetch("/api/v1/categories", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: nom,
              parentId: parentId || undefined,
            }),
          }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["categories"] })
      setDialogOuvert(false)
    },
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Catégories</h1>
        {peutEcrire && (
          <Button onClick={ouvrirCreation}>Nouvelle catégorie</Button>
        )}
      </div>

      <Dialog open={dialogOuvert} onOpenChange={setDialogOuvert}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {enEdition ? "Modifier la catégorie" : "Nouvelle catégorie"}
            </DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              setErreur(null)
              enregistrer.mutate()
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-nom">Nom</Label>
              <Input
                id="c-nom"
                required
                value={nom}
                onChange={(e) => setNom(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-parent">Catégorie parente (optionnel)</Label>
              <select
                id="c-parent"
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className="h-10 rounded-md border px-2 text-sm"
              >
                <option value="">— aucune —</option>
                {(data?.categories ?? [])
                  .filter((cat) => cat.id !== enEdition?.id)
                  .map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
              </select>
            </div>
            {erreur && (
              <p role="alert" className="text-sm text-red-700">
                {erreur}
              </p>
            )}
            <Button type="submit" disabled={enregistrer.isPending}>
              {enregistrer.isPending ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {isPending ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Catégorie</TableHead>
              {peutEcrire && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.categories ?? []).map((cat) => (
              <TableRow key={cat.id}>
                <TableCell className="font-medium">
                  {cat.parentId
                    ? `${parents.get(cat.parentId) ?? "?"} > ${cat.name}`
                    : cat.name}
                </TableCell>
                {peutEcrire && (
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => ouvrirEdition(cat)}
                    >
                      Modifier
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {data?.categories.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={peutEcrire ? 2 : 1}
                  className="text-center text-sm text-gray-500"
                >
                  Aucune catégorie.
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

- [ ] **Step 2: Écran fournisseurs**

Remplacer `apps/web/src/routes/_app/catalogue/fournisseurs.tsx` par :

```tsx
import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
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

export const Route = createFileRoute("/_app/catalogue/fournisseurs")({
  component: FournisseursPage,
})

type Fournisseur = {
  id: string
  name: string
  contact: string | null
  phone: string | null
  isActive: boolean
}

function FournisseursPage() {
  const { me } = Route.useRouteContext()
  const role = me.membership?.role
  const peutEcrire =
    role === "owner" || role === "admin" || role === "stock_manager"
  const queryClient = useQueryClient()

  const { data, isPending } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () =>
      apiFetch<{ suppliers: Fournisseur[] }>("/api/v1/suppliers"),
  })

  const [dialogOuvert, setDialogOuvert] = useState(false)
  const [nom, setNom] = useState("")
  const [contact, setContact] = useState("")
  const [telephone, setTelephone] = useState("")
  const [erreur, setErreur] = useState<string | null>(null)

  const invalider = () =>
    queryClient.invalidateQueries({ queryKey: ["suppliers"] })

  const creer = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/suppliers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: nom,
          contact: contact || undefined,
          phone: telephone || undefined,
        }),
      }),
    onSuccess: async () => {
      await invalider()
      setDialogOuvert(false)
      setNom("")
      setContact("")
      setTelephone("")
      setErreur(null)
    },
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })

  const basculer = useMutation({
    mutationFn: (f: Fournisseur) =>
      apiFetch(`/api/v1/suppliers/${f.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !f.isActive }),
      }),
    onSuccess: invalider,
    onError: (err) => alert(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Fournisseurs</h1>
        {peutEcrire && (
          <Dialog open={dialogOuvert} onOpenChange={setDialogOuvert}>
            <DialogTrigger render={<Button />}>Nouveau fournisseur</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nouveau fournisseur</DialogTitle>
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
                  <Label htmlFor="s-nom">Nom</Label>
                  <Input
                    id="s-nom"
                    required
                    value={nom}
                    onChange={(e) => setNom(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="s-contact">Contact (optionnel)</Label>
                  <Input
                    id="s-contact"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="s-telephone">Téléphone (optionnel)</Label>
                  <Input
                    id="s-telephone"
                    value={telephone}
                    onChange={(e) => setTelephone(e.target.value)}
                  />
                </div>
                {erreur && (
                  <p role="alert" className="text-sm text-red-700">
                    {erreur}
                  </p>
                )}
                <Button type="submit" disabled={creer.isPending}>
                  {creer.isPending ? "Création…" : "Créer"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {isPending ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nom</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Téléphone</TableHead>
              <TableHead>Statut</TableHead>
              {peutEcrire && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.suppliers ?? []).map((f) => (
              <TableRow key={f.id}>
                <TableCell className="font-medium">{f.name}</TableCell>
                <TableCell>{f.contact ?? "—"}</TableCell>
                <TableCell>{f.phone ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={f.isActive ? "default" : "secondary"}>
                    {f.isActive ? "Actif" : "Inactif"}
                  </Badge>
                </TableCell>
                {peutEcrire && (
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => basculer.mutate(f)}
                    >
                      {f.isActive ? "Désactiver" : "Réactiver"}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {data?.suppliers.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={peutEcrire ? 5 : 4}
                  className="text-center text-sm text-gray-500"
                >
                  Aucun fournisseur.
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

- [ ] **Step 3: Vérifier et committer**

```bash
bun run typecheck && bun run --cwd apps/web test && bun run --cwd apps/web build
git add -A && git commit -m "feat(web): écrans catégories (hiérarchie) et fournisseurs"
```

Expected: 12 web verts, typecheck et build OK.

---

### Task 12: Finalisation — vérification bout-en-bout, roadmap, PR

**Files:**
- Modify: `docs/superpowers/plans/2026-07-08-pos-stocks-roadmap.md`

- [ ] **Step 1: Suite complète**

```bash
bun run typecheck && bun run lint && bun run test
```

Expected: tout vert — **66 api + 12 web**.

- [ ] **Step 2: Vérification bout-en-bout dans le navigateur**

```bash
# Terminal 1 : cd apps/api && bun run db:migrate:local && bun run dev
# Terminal 2 : cd apps/web && bun run dev
```

Parcours à valider (http://localhost:3000) :
1. Connexion owner → section « Catalogue » visible (Produits / Catégories / Fournisseurs)
2. Créer la catégorie « Boissons », puis le fournisseur « Sodeci Distribution » (contact + téléphone) → visibles dans leurs listes
3. Créer le produit « Coca 33cl », prix 500, plancher 400, catégorie « Boissons », **« Suivre les lots » coché** → redirection sur la fiche, SKU `PRD-0001` affiché, prix « 500 F CFA »
4. Uploader une image JPEG → aperçu affiché ; tenter un fichier > 2 Mo → message « L'image dépasse 2 Mo » en `role="alert"`
5. Ajouter la variante « Pack de 6 » (attribut format = Pack de 6) → SKU `PRD-0001-PACK-DE-6` ; la variante « Standard » passe Inactive
6. Section Lots : ajouter le lot `LOT-2026-01` avec une date passée (ex. 2025-01-01) → badge rouge « Expiré » ; ajouter un second lot à date future → pas de badge
7. Recherche « coca » et filtre par catégorie « Boissons » dans la liste → le produit ressort ; recherche par le code-barres de la variante → le produit ressort
8. Créer un employé « staff » (Administration), se connecter avec → la section Catalogue est visible en **lecture seule** (pas de bouton « Nouveau produit », pas d'upload, pas de bascule) ; l'URL `/administration/entrepots` redirige vers `/`

- [ ] **Step 3: Roadmap**

Dans `docs/superpowers/plans/2026-07-08-pos-stocks-roadmap.md` :
- cocher les 5 items de la section « Phase 3 — Catalogue » (catégories/fournisseurs, produits + variantes, images R2, lots, écrans)
- ligne 3 du tableau « Suivi global » : colonne « Plan détaillé » → `2026-07-10-phase-3-catalogue.md`, colonne « Statut » → « en cours », puis « ✅ terminée » une fois la PR mergée

```bash
git add -A && git commit -m "docs: roadmap Phase 3 cochée"
```

- [ ] **Step 4: PR**

```bash
git push -u origin feat/phase-3-catalogue
gh pr create --title "Phase 3 — Catalogue : catégories, fournisseurs, produits, variantes, images R2, lots" --body "## Résumé

- Dette Phase 2 soldée : helper \`validerCorps\` (dé-duplication de la validation), \`autoSignIn: false\`, \`.max(128)\` sur le nouveau mot de passe + discrimination d'APIError (\`INVALID_PASSWORD\`), plafond de profondeur dans \`estViolationUnicite\`, gardes de rôle \`beforeLoad\` sur les écrans d'administration
- Schéma : \`categories\` (hiérarchie simple), \`suppliers\`, \`products\` (SKU unique par organisation), \`product_variants\` (variante implicite « Standard », bascule automatique vers les variantes explicites), \`lots\` (unique par variante) — migration 0003
- R2 : bucket \`pos-stocks-images\` + binding \`IMAGES\`, upload d'images produits (2 Mo max, JPEG/PNG/WebP) et service authentifié \`/api/v1/files/*\` scoppé par organisation
- API : CRUD catégories/fournisseurs, produits (SKU auto \`PRD-0001\` avec retry, recherche nom/SKU/code-barres y compris variantes, fiche complète), variantes (overrides de prix, protection \`DERNIERE_VARIANTE\`), lots (\`trackLots\`, \`LOT_EXISTANT\`) — écriture owner/admin/stock_manager, lecture tous les membres
- Front : section Catalogue pour tous les membres, liste produits (recherche debouncée, filtre catégorie, prix \`Intl\` avec la devise de l'organisation), fiche produit (édition, image, variantes à attributs dynamiques, lots avec badge d'expiration), écrans catégories et fournisseurs — lecture seule sans rôle d'écriture

## Tests

- API : 66 tests sur D1 réelle + R2 miniflare (permissions par rôle, SKU auto, bascule implicite→explicites, lots, images, cross-org)
- Web : 12 tests composants (dont formatage XOF) — typecheck + lint + build verts
- Parcours manuel bout-en-bout validé en local (8 étapes, voir plan Task 12)

Le merge déclenchera migrations D1 + déploiement automatiques (le bucket R2 \`pos-stocks-images\` existe déjà côté Cloudflare).

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```
