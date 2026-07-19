# Pagination serveur des listes non bornées — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter la pagination serveur (`page`/`limite`) à six endpoints de liste non bornés, harmoniser les deux endpoints déjà paginés sur un helper partagé, et brancher le composant `Pagination` front déjà livré.

**Architecture:** Un helper `lirePagination(c)` (nouveau `apps/api/src/lib/pagination.ts`) parse et valide `page`/`limite` (400 sur invalide). Chaque endpoint paginé calcule `total` via un `COUNT(*)` scopé à l'identique, applique `.limit(limite).offset((page-1)*limite)`, et renvoie `{ <clé>, total, page, limite }`. Le front branche le composant `Pagination` existant sur chaque écran.

**Tech Stack:** Hono 4, Drizzle ORM, D1 (SQLite), vitest + `@cloudflare/vitest-pool-workers` (tests d'intégration sur D1 réelle) ; React 19, TanStack Query/Router, Testing Library.

## Global Constraints

- **Convention** : `page` (entier ≥ 1, défaut 1), `limite` (entier 1..200, défaut 50). Réponse `{ <clé>, total, page, limite }`.
- **Validation** : `400` avec `{ code: "VALIDATION", message: "français" }` si `page < 1`, `limite < 1`, `limite > 200`, ou non-entier. Pas de clamp silencieux.
- **Isolation multi-tenant** : le `COUNT(*)` du `total` et la requête de page utilisent le **même** `WHERE` (organizationId + portée de rôle + filtres). Le `total` ne compte jamais hors périmètre.
- **Endpoints paginés (6)** : `products`, `stock/levels`, `purchases`, `transfers`, `inventory-counts`, `users`.
- **Migrés sur le helper (2)** : `sales` (`parPage → limite`), `stock/movements` (déjà `page`/`limite`).
- **Hors périmètre** : `categories`, `suppliers` (déroulants — besoin de la liste entière).
- UI/messages/commits en **français** ; commentaires de code et JSDoc en **anglais**.
- Montants entiers XOF ; jamais `db.run(sql)` en batch ; `import type` séparé ; annoter `| null` les lookups. Jamais `--no-verify`.
- Front : la taille de page se lit dans la réponse (`limite`), jamais codée en dur ; tout changement de filtre appelle `setPage(1)` (motif `/ventes`).
- Le composant `Pagination` (`apps/web/src/components/ui/pagination.tsx`) prend `{ page, total, pageSize, onPageChange, element: { un, plusieurs }, className? }` et calcule lui-même `pageCount` ; ne jamais recalculer le nombre de pages côté appelant.

---

### Task 1: Helper `lirePagination` + test unitaire

**Files:**
- Create: `apps/api/src/lib/pagination.ts`
- Test: couverture du helper par le harnais D1 réel (voir amendement ci-dessous)

> **Amendement (revue CodeRabbit)** : le test unitaire à `Context` factice décrit
> ci-dessous (`apps/api/test/pagination.test.ts`) a été **retiré** au profit de la
> convention du dépôt (tests d'intégration sur D1 réelle, sans cast `as`). Les cas
> de bord du helper (`page < 1`, `limite` hors bornes, non-entiers) sont désormais
> vérifiés via de vraies requêtes dans `apps/api/test/products.test.ts`, et chaque
> endpoint paginé teste son propre `limite=0 → 400`. Le bloc de code ci-dessous est
> conservé à titre historique.

**Interfaces:**
- Produces:
  ```ts
  export type Pagination = { page: number; limite: number }
  // Retourne { page, limite } si valides, sinon une Response 400 à renvoyer telle quelle.
  export function lirePagination(c: Context): Pagination | Response
  ```

- [ ] **Step 1: Écrire le test qui échoue**

Create `apps/api/test/pagination.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import type { Context } from "hono"
import { lirePagination } from "../src/lib/pagination"

// Contexte minimal : lirePagination n'utilise que c.req.query() et c.json().
function contexteFactice(query: Record<string, string>): Context {
  return {
    req: { query: (cle: string) => query[cle] },
    json: (corps: unknown, statut?: number) =>
      new Response(JSON.stringify(corps), { status: statut ?? 200 }),
  } as unknown as Context
}

describe("lirePagination", () => {
  it("défauts : page 1, limite 50 quand absents", () => {
    expect(lirePagination(contexteFactice({}))).toEqual({ page: 1, limite: 50 })
  })

  it("valeurs explicites valides", () => {
    expect(lirePagination(contexteFactice({ page: "3", limite: "20" }))).toEqual(
      { page: 3, limite: 20 }
    )
  })

  it("page < 1 → Response 400", async () => {
    const r = lirePagination(contexteFactice({ page: "0" }))
    expect(r).toBeInstanceOf(Response)
    expect((r as Response).status).toBe(400)
    expect(await (r as Response).json()).toMatchObject({ code: "VALIDATION" })
  })

  it("limite hors bornes → Response 400", () => {
    expect(lirePagination(contexteFactice({ limite: "0" }))).toBeInstanceOf(
      Response
    )
    expect(lirePagination(contexteFactice({ limite: "201" }))).toBeInstanceOf(
      Response
    )
  })

  it("non-entier → Response 400", () => {
    expect(lirePagination(contexteFactice({ page: "1.5" }))).toBeInstanceOf(
      Response
    )
    expect(lirePagination(contexteFactice({ limite: "abc" }))).toBeInstanceOf(
      Response
    )
  })
})
```

- [ ] **Step 2: Lancer le test → échec**

Run: `bun run --cwd apps/api test -- pagination.test.ts`
Expected: FAIL (module `../src/lib/pagination` introuvable).

- [ ] **Step 3: Implémenter le helper**

Create `apps/api/src/lib/pagination.ts` :

```ts
import type { Context } from "hono"

export type Pagination = { page: number; limite: number }

// Parses and validates the page/limite query params shared by every paginated
// list endpoint. Returns { page, limite } when valid, or a 400 VALIDATION
// Response to return as-is. Defaults: page 1, limite 50. Bounds: page >= 1,
// 1 <= limite <= 200.
export function lirePagination(c: Context): Pagination | Response {
  const page = Number(c.req.query("page") ?? "1")
  const limite = Number(c.req.query("limite") ?? "50")
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(limite) ||
    limite < 1 ||
    limite > 200
  ) {
    return c.json(
      {
        code: "VALIDATION",
        message: "Pagination invalide (page ≥ 1, limite entre 1 et 200)",
      },
      400
    )
  }
  return { page, limite }
}
```

- [ ] **Step 4: Lancer le test → succès + typecheck**

Run: `bun run --cwd apps/api test -- pagination.test.ts`
Expected: PASS (5 tests).
Run: `bun run --cwd apps/api typecheck`
Expected: aucune erreur.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/pagination.ts apps/api/test/pagination.test.ts
git commit -m "feat(api): helper lirePagination (page/limite) partagé (issue #13)"
```

---

### Task 2: Migration `/sales` — `parPage` → `limite` + helper

**Files:**
- Modify: `apps/api/src/routes/sales.ts` (bloc pagination lignes ~592-609, et `return c.json` ligne ~666)
- Modify: `apps/web/src/lib/pos-api.ts` (type `PageVentes`, `fetchVentesDuJour`)
- Modify: `apps/web/src/lib/rapports.ts` (`fetchVentesPeriode`)
- Modify: `apps/web/src/routes/_app/ventes/index.tsx` (lecture `parPage`)
- Test: `apps/api/test/sales-pagination.test.ts`, `apps/api/test/sales-lecture.test.ts` (assertions `parPage` → `limite`)

**Interfaces:**
- Consumes: `lirePagination` (Task 1).
- Produces: `GET /api/v1/sales` répond `{ sales, total, page, limite }` (param `limite`).

- [ ] **Step 1: Mettre à jour les tests API existants (parPage → limite)**

Dans `apps/api/test/sales-pagination.test.ts`, remplacer partout le paramètre d'URL `parPage=` par `limite=` et le champ de réponse `parPage` par `limite`. Exemple :

```ts
// AVANT
`/api/v1/sales?storeId=${storeId}&jour=${JOUR}&page=1&parPage=2`
// APRÈS
`/api/v1/sales?storeId=${storeId}&jour=${JOUR}&page=1&limite=2`
```
Et le type de corps `Page` (chercher `parPage: number`) :
```ts
// AVANT : type Page = { ...; parPage: number }
// APRÈS : type Page = { ...; limite: number }
```
Et les assertions `expect(corps1.parPage).toBe(2)` → `expect(corps1.limite).toBe(2)`.
Dans le test « valide du/au ensemble, dates calendaires, pagination bornée », le cas `parPage=500` devient `limite=500`.

- [ ] **Step 2: Lancer → échec (l'API renvoie encore parPage)**

Run: `bun run --cwd apps/api test -- sales-pagination`
Expected: FAIL (réponse contient `parPage`, pas `limite` ; l'URL `limite=2` est ignorée → défaut 50).

- [ ] **Step 3: Migrer le handler `/sales`**

Dans `apps/api/src/routes/sales.ts`, ajouter l'import (à côté des autres imports de lib) :
```ts
import { lirePagination } from "../lib/pagination"
```
Remplacer le bloc de parsing/validation (lignes ~592-609) :
```ts
  // Pagination (différé P6 : limite fixe 200 sans pagination)
  const page = Number(c.req.query("page") ?? "1")
  const parPage = Number(c.req.query("parPage") ?? "50")
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(parPage) ||
    parPage < 1 ||
    parPage > 200
  ) {
    return c.json(
      {
        code: "VALIDATION",
        message: "Pagination invalide (page ≥ 1, parPage entre 1 et 200)",
      },
      400
    )
  }
```
par :
```ts
  const pagination = lirePagination(c)
  if (pagination instanceof Response) return pagination
  const { page, limite } = pagination
```
Remplacer `.limit(parPage).offset((page - 1) * parPage)` par `.limit(limite).offset((page - 1) * limite)`.
Remplacer `return c.json({ sales: ventes, total, page, parPage })` par `return c.json({ sales: ventes, total, page, limite })`.

- [ ] **Step 4: Lancer les tests API → succès**

Run: `bun run --cwd apps/api test -- sales-pagination sales-lecture`
Expected: PASS. (Si `sales-lecture.test.ts` asserte `parPage`, l'ajuster en `limite` de la même façon.)

- [ ] **Step 5: Migrer les appels web**

Dans `apps/web/src/lib/pos-api.ts`, le type `PageVentes` :
```ts
// AVANT
export type PageVentes = {
  sales: VenteListe[]
  total: number
  page: number
  parPage: number
}
// APRÈS
export type PageVentes = {
  sales: VenteListe[]
  total: number
  page: number
  limite: number
}
```
Et `fetchVentesDuJour` : remplacer `&parPage=50` par `&limite=50` dans l'URL.

Dans `apps/web/src/lib/rapports.ts`, `fetchVentesPeriode` : remplacer `&parPage=50` par `&limite=50`.

Dans `apps/web/src/routes/_app/ventes/index.tsx` (ligne ~76) :
```ts
// AVANT
  const parPage = ventes.data?.parPage ?? 50
// APRÈS
  const parPage = ventes.data?.limite ?? 50
```
(On garde le nom de variable local `parPage` côté React — seule la source `.limite` change ; le composant reçoit `pageSize={parPage}`.)

- [ ] **Step 6: Typecheck + tests web + commit**

Run: `bun run typecheck` → clean.
Run: `bun run --cwd apps/web test` → PASS.

```bash
git add apps/api/src/routes/sales.ts apps/api/test/sales-pagination.test.ts apps/api/test/sales-lecture.test.ts apps/web/src/lib/pos-api.ts apps/web/src/lib/rapports.ts apps/web/src/routes/_app/ventes/index.tsx
git commit -m "refactor(api): /sales sur lirePagination, parPage→limite (issue #13)"
```

---

### Task 3: Migration `/stock/movements` sur le helper

**Files:**
- Modify: `apps/api/src/routes/stock.ts` (parsing `page`/`limite` lignes ~698-702, early-return ligne ~734)
- Test: `apps/api/test/stock-read.test.ts` (ajouter un cas `limite` invalide → 400)

**Interfaces:**
- Consumes: `lirePagination` (Task 1). Réponse inchangée : `{ movements, total, page, limite }`.

- [ ] **Step 1: Écrire le test qui échoue (400 sur limite invalide)**

Dans `apps/api/test/stock-read.test.ts` (qui couvre déjà `/stock/movements`), ajouter un cas `limite` invalide en réutilisant le seed d'un mouvement existant du fichier :

```ts
it("movements : limite invalide → 400 VALIDATION", async () => {
  // Réutiliser le helper de seed existant du fichier qui expose un cookie et un
  // warehouseId (voir les tests /movements existants). Ci-dessous, adapter les
  // noms au helper local.
  const { ownerCookie, warehouseId } = await seedMouvements()
  const res = await req(
    ownerCookie,
    "GET",
    `/api/v1/stock/movements?warehouseId=${warehouseId}&limite=500`
  )
  expect(res.status).toBe(400)
  expect((await res.json<{ code: string }>()).code).toBe("VALIDATION")
})
```

- [ ] **Step 2: Lancer → échec (clamp actuel, pas de 400)**

Run: `bun run --cwd apps/api test -- stock-read`
Expected: FAIL (l'API clampe `limite=500` à 200, renvoie 200 au lieu de 400).

- [ ] **Step 3: Migrer le parsing**

Dans `apps/api/src/routes/stock.ts`, ajouter l'import :
```ts
import { lirePagination } from "../lib/pagination"
```
Remplacer (lignes ~698-702) :
```ts
  const page = Math.max(1, Number(c.req.query("page") ?? "1") || 1)
  const limite = Math.min(
    200,
    Math.max(1, Number(c.req.query("limite") ?? "50") || 50)
  )
```
par :
```ts
  const pagination = lirePagination(c)
  if (pagination instanceof Response) return pagination
  const { page, limite } = pagination
```
(Le reste du handler — `total`, `.limit(limite).offset((page - 1) * limite)`, `return c.json({ movements, total, page, limite })`, et l'early-return `return c.json({ movements: [], total: 0, page, limite })` — reste inchangé, `page`/`limite` sont désormais fournis par le helper.)

- [ ] **Step 4: Lancer → succès**

Run: `bun run --cwd apps/api test -- stock-read`
Expected: PASS.
Run: `bun run --cwd apps/api typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/stock.ts apps/api/test/stock-read.test.ts
git commit -m "refactor(api): /stock/movements sur lirePagination (issue #13)"
```

---

### Task 4: Pagination `GET /products` (API + front)

**Files:**
- Modify: `apps/api/src/routes/products.ts` (handler liste lignes ~29-82)
- Modify: `apps/web/src/routes/_app/catalogue/produits/index.tsx` (useQuery + render)
- Test: `apps/api/test/products.test.ts`

**Interfaces:**
- Consumes: `lirePagination` (Task 1), composant `Pagination`.
- Produces: `GET /api/v1/products` → `{ products, total, page, limite }`.

- [ ] **Step 1: Écrire le test API qui échoue**

Dans `apps/api/test/products.test.ts`, ajouter (le fichier importe déjà `bootstrapOwner`, `creerProduitSimple`, `drizzle`, `env`, `schema`, `app`) :

```ts
describe("GET /api/v1/products — pagination", () => {
  it("borne la page et renvoie total/page/limite", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    for (let i = 0; i < 3; i++) {
      await creerProduitSimple(organizationId, {
        nom: `Produit ${String(i).padStart(2, "0")}`,
      })
    }
    const page1 = await app.request(
      "/api/v1/products?page=1&limite=2",
      { headers: { cookie: ownerCookie } },
      env
    )
    expect(page1.status).toBe(200)
    const c1 = await page1.json<{
      products: unknown[]
      total: number
      page: number
      limite: number
    }>()
    expect(c1.total).toBe(3)
    expect(c1.page).toBe(1)
    expect(c1.limite).toBe(2)
    expect(c1.products).toHaveLength(2)

    const page2 = await app.request(
      "/api/v1/products?page=2&limite=2",
      { headers: { cookie: ownerCookie } },
      env
    )
    const c2 = await page2.json<{ products: unknown[]; total: number }>()
    expect(c2.products).toHaveLength(1)
    expect(c2.total).toBe(3)

    const page3 = await app.request(
      "/api/v1/products?page=3&limite=2",
      { headers: { cookie: ownerCookie } },
      env
    )
    const c3 = await page3.json<{ products: unknown[]; total: number }>()
    expect(c3.products).toEqual([])
    expect(c3.total).toBe(3)

    const invalide = await app.request(
      "/api/v1/products?limite=0",
      { headers: { cookie: ownerCookie } },
      env
    )
    expect(invalide.status).toBe(400)
  })

  it("isolation : le total ne compte pas les produits d'une autre organisation", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    await creerProduitSimple(organizationId, { nom: "Mien" })
    // Seconde organisation avec son propre produit (insert direct, motif de
    // permissions.test.ts).
    const db = drizzle(env.DB, { schema })
    const autreOrgId = crypto.randomUUID()
    await db.insert(schema.organization).values({
      id: autreOrgId,
      name: "Autre Société",
      slug: "autre-org",
      createdAt: new Date(),
    })
    await creerProduitSimple(autreOrgId, { nom: "Autre" })
    const res = await app.request(
      "/api/v1/products",
      { headers: { cookie: ownerCookie } },
      env
    )
    const corps = await res.json<{ products: unknown[]; total: number }>()
    expect(corps.total).toBe(1)
    expect(corps.products).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Lancer → échec**

Run: `bun run --cwd apps/api test -- products`
Expected: FAIL (réponse sans `total`, non bornée).

- [ ] **Step 3: Modifier le handler**

Dans `apps/api/src/routes/products.ts`, ajouter l'import :
```ts
import { lirePagination } from "../lib/pagination"
```
Après la construction de `conditions` (juste avant `const produits = await db`), insérer :
```ts
  const pagination = lirePagination(c)
  if (pagination instanceof Response) return pagination
  const { page, limite } = pagination
  const totalRows = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(schema.products)
    .where(and(...conditions))
  const total = totalRows[0]?.total ?? 0
```
Ajouter `.limit(limite).offset((page - 1) * limite)` à la requête `produits` (après `.orderBy(asc(schema.products.name))`).
Remplacer `return c.json({ products })` par `return c.json({ products, total, page, limite })`.
(Vérifier que `sql` est déjà importé de `drizzle-orm` dans ce fichier ; sinon l'ajouter à l'import existant.)

- [ ] **Step 4: Lancer les tests API → succès**

Run: `bun run --cwd apps/api test -- products`
Expected: PASS.

- [ ] **Step 5: Brancher le front**

Dans `apps/web/src/routes/_app/catalogue/produits/index.tsx` :
- Ajouter l'import : `import { Pagination } from "@/components/ui/pagination"`.
- Ajouter l'état page et le reset sur filtre : après les états existants, `const [page, setPage] = useState(1)`, et un `useEffect(() => setPage(1), [rechercheDebouncee, categorie])` (importer `useEffect` si besoin).
- Modifier le useQuery :
```tsx
  const produits = useQuery({
    queryKey: ["products", rechercheDebouncee, categorie, page],
    queryFn: () => {
      const params = new URLSearchParams()
      if (rechercheDebouncee) params.set("recherche", rechercheDebouncee)
      if (categorie) params.set("categorie", categorie)
      params.set("page", String(page))
      return apiFetch<{
        products: Produit[]
        total: number
        page: number
        limite: number
      }>(`/api/v1/products?${params.toString()}`)
    },
  })
```
- Après la fermeture du `</Table>`, ajouter :
```tsx
      {(produits.data?.products.length ?? 0) > 0 && (
        <Pagination
          className="mt-3"
          page={page}
          total={produits.data?.total ?? 0}
          pageSize={produits.data?.limite ?? 50}
          onPageChange={setPage}
          element={{ un: "produit", plusieurs: "produits" }}
        />
      )}
```

- [ ] **Step 6: Typecheck + tests web + commit**

Run: `bun run typecheck` → clean. Run: `bun run --cwd apps/web test` → PASS.
```bash
git add apps/api/src/routes/products.ts apps/api/test/products.test.ts apps/web/src/routes/_app/catalogue/produits/index.tsx
git commit -m "feat(api): pagination serveur GET /products + front (issue #13)"
```

---

### Task 5: Pagination `GET /stock/levels` (API + front)

**Files:**
- Modify: `apps/api/src/routes/stock.ts` (handler `/levels` lignes ~115-166)
- Modify: `apps/web/src/routes/_app/stock/index.tsx` (useQuery + render)
- Test: `apps/api/test/stock-read.test.ts`

**Interfaces:**
- Consumes: `lirePagination`, composant `Pagination`.
- Produces: `GET /api/v1/stock/levels` → `{ levels, total, page, limite }`.

- [ ] **Step 1: Écrire le test API qui échoue**

Dans `apps/api/test/stock-read.test.ts`, ajouter un test de pagination des niveaux :
- Seed **3 variantes** en stock sur un entrepôt (via `creerProduitSimple` + `applyMovements` direct, motif existant du fichier) et **1 variante en stock sur un SECOND entrepôt** du même owner.
- `GET /api/v1/stock/levels?warehouseId=<entrepot1>&page=1&limite=2` → statut 200, `total = 3`, `levels` de longueur 2, `page = 1`, `limite = 2`.
- `page=2&limite=2` → `levels` longueur 1 ; `page=3&limite=2` → `levels` égal `[]`, `total` toujours 3.
- `limite=0` → statut 400, `code = "VALIDATION"`.
- **Isolation** : le `total` de l'entrepôt 1 vaut 3 (jamais 4) — les niveaux du second entrepôt ne sont pas comptés (le scoping `warehouseId` s'applique au count comme aux pages).

- [ ] **Step 2: Lancer → échec**

Run: `bun run --cwd apps/api test -- stock-read`
Expected: FAIL (réponse `{ levels }` sans `total`, non bornée).

- [ ] **Step 3: Modifier le handler `/levels`**

Dans `apps/api/src/routes/stock.ts` (import `lirePagination` déjà ajouté en Task 3).
Après la construction de `conditions` (juste avant `const rows = await db`), insérer le COUNT — **avec les mêmes innerJoins** que la requête de liste, car `recherche` filtre sur les noms joints :
```ts
  const pagination = lirePagination(c)
  if (pagination instanceof Response) return pagination
  const { page, limite } = pagination
  const totalRows = await db
    .select({ total: sql<number>`COUNT(*)` })
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
  const total = totalRows[0]?.total ?? 0
```
Ajouter `.limit(limite).offset((page - 1) * limite)` après le `.orderBy(...)` de la requête `rows`.
Remplacer `return c.json({ levels })` par `return c.json({ levels, total, page, limite })`.

- [ ] **Step 4: Lancer → succès**

Run: `bun run --cwd apps/api test -- stock-read`
Expected: PASS.

- [ ] **Step 5: Brancher le front**

Dans `apps/web/src/routes/_app/stock/index.tsx` :
- `import { Pagination } from "@/components/ui/pagination"`.
- `const [page, setPage] = useState(1)` + `useEffect(() => setPage(1), [entrepotId, rechercheDebouncee, alertesSeules])`.
- useQuery :
```tsx
  const niveaux = useQuery({
    queryKey: ["stock-levels", entrepotId, rechercheDebouncee, alertesSeules, page],
    queryFn: () => {
      const params = new URLSearchParams({ warehouseId: entrepotId })
      if (rechercheDebouncee) params.set("recherche", rechercheDebouncee)
      if (alertesSeules) params.set("alertes", "true")
      params.set("page", String(page))
      return apiFetch<{
        levels: NiveauStock[]
        total: number
        page: number
        limite: number
      }>(`/api/v1/stock/levels?${params.toString()}`)
    },
    enabled: entrepotId !== "",
  })
```
- Après la table des niveaux, ajouter le `<Pagination>` gardé par `(niveaux.data?.levels.length ?? 0) > 0`, avec `element={{ un: "ligne", plusieurs: "lignes" }}`, `page={page}`, `total={niveaux.data?.total ?? 0}`, `pageSize={niveaux.data?.limite ?? 50}`, `onPageChange={setPage}`, `className="mt-3"`.

- [ ] **Step 6: Typecheck + tests web + commit**

Run: `bun run typecheck` → clean. Run: `bun run --cwd apps/web test` → PASS.
```bash
git add apps/api/src/routes/stock.ts apps/api/test/stock-read.test.ts apps/web/src/routes/_app/stock/index.tsx
git commit -m "feat(api): pagination serveur GET /stock/levels + front (issue #13)"
```

---

### Task 6: Pagination `GET /purchases` (API + front)

**Files:**
- Modify: `apps/api/src/routes/purchases.ts` (handler liste lignes ~91-176)
- Modify: `apps/web/src/routes/_app/stock/receptions/index.tsx`
- Test: `apps/api/test/purchases-draft.test.ts`

**Interfaces:**
- Consumes: `lirePagination`, composant `Pagination`.
- Produces: `GET /api/v1/purchases` → `{ purchases, total, page, limite }`.

- [ ] **Step 1: Écrire le test API qui échoue**

Dans `apps/api/test/purchases-draft.test.ts`, ajouter un test : seed **3 réceptions** (motif du test « liste à grande échelle » existant, mais 3 suffisent), `GET /api/v1/purchases?page=1&limite=2` → `total=3`, `purchases` longueur 2, `page=2` → 1, `page=3` → `[]`, `limite=0` → 400. **Isolation** : ajouter une réception sur un entrepôt hors de la portée du demandeur (ou d'une autre organisation, motif cross-tenant du fichier) et vérifier qu'elle n'est comptée ni dans `total` ni dans les pages.

- [ ] **Step 2: Lancer → échec**

Run: `bun run --cwd apps/api test -- purchases-draft`
Expected: FAIL.

- [ ] **Step 3: Modifier le handler**

Dans `apps/api/src/routes/purchases.ts`, ajouter `import { lirePagination } from "../lib/pagination"`.
**Lire la pagination AVANT l'early-return de portée vide.** Juste après le bloc de validation `statut` (avant la construction de `conditions`), insérer :
```ts
  const pagination = lirePagination(c)
  if (pagination instanceof Response) return pagination
  const { page, limite } = pagination
```
Remplacer l'early-return `return c.json({ purchases: [] })` par `return c.json({ purchases: [], total: 0, page, limite })`.
Après la construction de `conditions` (avant `const rows = await db`), insérer le COUNT (sans les joins d'affichage — les conditions ne portent que sur `purchases`) :
```ts
  const totalRows = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(schema.purchases)
    .where(and(...conditions))
  const total = totalRows[0]?.total ?? 0
```
Ajouter `.limit(limite).offset((page - 1) * limite)` après le `.orderBy(desc(schema.purchases.createdAt))` de la requête `rows`.
Remplacer `return c.json({ purchases })` par `return c.json({ purchases, total, page, limite })`.

- [ ] **Step 4: Lancer → succès**

Run: `bun run --cwd apps/api test -- purchases-draft`
Expected: PASS.

- [ ] **Step 5: Brancher le front**

Dans `apps/web/src/routes/_app/stock/receptions/index.tsx` :
- `import { Pagination } from "@/components/ui/pagination"`.
- `const [page, setPage] = useState(1)` + `useEffect(() => setPage(1), [statut])`.
- useQuery :
```tsx
  const receptions = useQuery({
    queryKey: ["purchases", statut, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) })
      if (statut) params.set("statut", statut)
      return apiFetch<{
        purchases: ReceptionListe[]
        total: number
        page: number
        limite: number
      }>(`/api/v1/purchases?${params.toString()}`)
    },
  })
```
- Après la table, ajouter le `<Pagination>` gardé par `(receptions.data?.purchases.length ?? 0) > 0`, `element={{ un: "réception", plusieurs: "réceptions" }}`, `total={receptions.data?.total ?? 0}`, `pageSize={receptions.data?.limite ?? 50}`.

- [ ] **Step 6: Typecheck + tests web + commit**

Run: `bun run typecheck` → clean. Run: `bun run --cwd apps/web test` → PASS.
```bash
git add apps/api/src/routes/purchases.ts apps/api/test/purchases-draft.test.ts apps/web/src/routes/_app/stock/receptions/index.tsx
git commit -m "feat(api): pagination serveur GET /purchases + front (issue #13)"
```

---

### Task 7: Pagination `GET /transfers` (remplace le cap `limit`) + tableau de bord

**Files:**
- Modify: `apps/api/src/routes/transfers.ts` (handler liste lignes ~105-216)
- Modify: `apps/web/src/routes/_app/stock/transferts/index.tsx`
- Modify: `apps/web/src/routes/_app/index.tsx` (BlocTransferts : appels `?statut=…&limit=50`)
- Test: `apps/api/test/transfers-draft.test.ts`

**Interfaces:**
- Consumes: `lirePagination`, composant `Pagination`.
- Produces: `GET /api/v1/transfers` → `{ transfers, total, page, limite }`. Le param `limit` (cap) est **supprimé**.

- [ ] **Step 1: Écrire le test API qui échoue**

Dans `apps/api/test/transfers-draft.test.ts`, ajouter : seed **3 transferts**, `GET /api/v1/transfers?page=1&limite=2` → `total=3`, `transfers` longueur 2, `page=2` → 1, `page=3` → `[]`, `limite=0` → 400. **Isolation** : ajouter un transfert impliquant uniquement des entrepôts hors portée du demandeur (ou d'une autre organisation) et vérifier qu'il n'est compté ni dans `total` ni dans les pages.

- [ ] **Step 2: Lancer → échec**

Run: `bun run --cwd apps/api test -- transfers-draft`
Expected: FAIL.

- [ ] **Step 3: Modifier le handler**

Dans `apps/api/src/routes/transfers.ts`, ajouter `import { lirePagination } from "../lib/pagination"`.
**Supprimer** tout le bloc du cap `limit` (lignes ~296-309) :
```ts
  const limiteBrute = c.req.query("limit")
  let limite: number | undefined
  if (limiteBrute !== undefined) {
    limite = Number(limiteBrute)
    if (!Number.isInteger(limite) || limite < 1 || limite > 200) {
      return c.json(
        {
          code: "VALIDATION",
          message: "limit doit être un entier entre 1 et 200",
        },
        400
      )
    }
  }
```
et le remplacer par :
```ts
  const pagination = lirePagination(c)
  if (pagination instanceof Response) return pagination
  const { page, limite } = pagination
```
Remplacer l'early-return `return c.json({ transfers: [] })` par `return c.json({ transfers: [], total: 0, page, limite })`.
Après la construction de `conditions` (avant `const origine = alias(...)`), insérer le COUNT :
```ts
  const totalRows = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(schema.transfers)
    .where(and(...conditions))
  const total = totalRows[0]?.total ?? 0
```
Remplacer la construction dynamique de `rows` :
```ts
    .orderBy(desc(schema.transfers.createdAt))
    .$dynamic()
  const rows = await (limite === undefined ? requete : requete.limit(limite))
```
par un tri simple + limit/offset directs :
```ts
    .orderBy(desc(schema.transfers.createdAt))
    .limit(limite)
    .offset((page - 1) * limite)
  const rows = await requete
```
(Supprimer le `.$dynamic()` devenu inutile.)
Remplacer `return c.json({ transfers })` par `return c.json({ transfers, total, page, limite })`.

- [ ] **Step 4: Lancer → succès**

Run: `bun run --cwd apps/api test -- transfers-draft`
Expected: PASS.

- [ ] **Step 5: Brancher le front + corriger le tableau de bord**

Dans `apps/web/src/routes/_app/stock/transferts/index.tsx` : même patron que Task 6 Step 5 (état `page`, reset sur `statut`, `page` dans la query, `<Pagination>` `element={{ un: "transfert", plusieurs: "transferts" }}`, lecture `total`/`limite`).

Dans `apps/web/src/routes/_app/index.tsx` (BlocTransferts) : le composant appelle aujourd'hui `/api/v1/transfers?statut=pending&limit=50` et `?statut=sent&limit=50`. Le param `limit` n'existe plus. Remplacer `&limit=50` par `&limite=50` dans les deux URL (la réponse `{ transfers }` reste lisible ; le bloc n'affiche que les premiers). Vérifier qu'il lit `.transfers` (non le `total`) — aucun autre changement requis.

- [ ] **Step 6: Typecheck + tests web + commit**

Run: `bun run typecheck` → clean. Run: `bun run --cwd apps/web test` → PASS.
```bash
git add apps/api/src/routes/transfers.ts apps/api/test/transfers-draft.test.ts apps/web/src/routes/_app/stock/transferts/index.tsx apps/web/src/routes/_app/index.tsx
git commit -m "feat(api): pagination serveur GET /transfers + front (issue #13)"
```

---

### Task 8: Pagination `GET /inventory-counts` (API + front)

**Files:**
- Modify: `apps/api/src/routes/inventory-counts.ts` (handler liste lignes ~63-142)
- Modify: `apps/web/src/routes/_app/stock/inventaires/index.tsx`
- Test: `apps/api/test/inventory-draft.test.ts`

**Interfaces:**
- Consumes: `lirePagination`, composant `Pagination`.
- Produces: `GET /api/v1/inventory-counts` → `{ counts, total, page, limite }`.

- [ ] **Step 1: Écrire le test API qui échoue**

Dans `apps/api/test/inventory-draft.test.ts` : seed ≥ 3 inventaires (motif de seed existant du fichier), `GET /api/v1/inventory-counts?page=1&limite=2` → `total=3`, `counts` longueur 2, page 2 → 1, page 3 → `[]`, `limite=0` → 400. Ajouter aussi un inventaire sur un entrepôt hors portée du demandeur (ou d'une autre organisation) et vérifier qu'il n'apparaît **ni dans `total` ni dans les pages** (réutiliser le motif cross-tenant/hors-portée déjà présent dans le fichier).

- [ ] **Step 2: Lancer → échec**

Run: `bun run --cwd apps/api test -- inventory-draft`
Expected: FAIL.

- [ ] **Step 3: Modifier le handler**

Dans `apps/api/src/routes/inventory-counts.ts`, ajouter `import { lirePagination } from "../lib/pagination"`.
Après la validation `statut` (avant la construction de `conditions`), insérer le read pagination :
```ts
  const pagination = lirePagination(c)
  if (pagination instanceof Response) return pagination
  const { page, limite } = pagination
```
Remplacer l'early-return `return c.json({ counts: [] })` par `return c.json({ counts: [], total: 0, page, limite })`.
Après la construction de `conditions` (avant `const rows = await db`), insérer :
```ts
  const totalRows = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(schema.inventoryCounts)
    .where(and(...conditions))
  const total = totalRows[0]?.total ?? 0
```
Ajouter `.limit(limite).offset((page - 1) * limite)` après `.orderBy(desc(schema.inventoryCounts.openedAt))`.
Remplacer `return c.json({ counts })` par `return c.json({ counts, total, page, limite })`.

- [ ] **Step 4: Lancer → succès**

Run: `bun run --cwd apps/api test -- inventory-draft`
Expected: PASS.

- [ ] **Step 5: Brancher le front**

Dans `apps/web/src/routes/_app/stock/inventaires/index.tsx` : même patron que la Task 6 Step 5 — `import { Pagination }`, `const [page, setPage] = useState(1)`, `useEffect(() => setPage(1), [statut])`, ajouter `params.set("page", String(page))` et `page` à la `queryKey`, élargir le type de réponse avec `total`/`page`/`limite`, puis après la table le `<Pagination>` gardé par `(inventaires.data?.counts.length ?? 0) > 0`, `element={{ un: "inventaire", plusieurs: "inventaires" }}`, `total={inventaires.data?.total ?? 0}`, `pageSize={inventaires.data?.limite ?? 50}`, `onPageChange={setPage}`, `className="mt-3"`.

- [ ] **Step 6: Typecheck + tests web + commit**

Run: `bun run typecheck` → clean. Run: `bun run --cwd apps/web test` → PASS.
```bash
git add apps/api/src/routes/inventory-counts.ts apps/api/test/inventory-draft.test.ts apps/web/src/routes/_app/stock/inventaires/index.tsx
git commit -m "feat(api): pagination serveur GET /inventory-counts + front (issue #13)"
```

---

### Task 9: Pagination `GET /users` (API + front)

**Files:**
- Modify: `apps/api/src/routes/users.ts` (handler liste lignes ~121-164)
- Modify: `apps/web/src/routes/_app/administration/utilisateurs.tsx`
- Test: `apps/api/test/users.test.ts` (ou le fichier couvrant `GET /users`)

**Interfaces:**
- Consumes: `lirePagination`, `requeterParLots` (helper existant de `../lib/db-batch`), composant `Pagination`.
- Produces: `GET /api/v1/users` → `{ users, total, page, limite }`.

- [ ] **Step 1: Écrire le test API qui échoue**

Dans `apps/api/test/users.test.ts`, ajouter : bootstrap owner (1 user), créer 3 users supplémentaires via `createUserWithRole` (total 4), `GET /api/v1/users?page=1&limite=2` avec le cookie owner → `total=4`, `users` longueur 2, `page=2` → 2, `page=3` → `[]`, `limite=0` → 400. **Isolation** : insérer une seconde organisation avec son propre user (insert direct `schema.organization` + `createUserWithRole(autreOrgId, …)`) et vérifier que le `total` de l'owner vaut 4, jamais 5.

- [ ] **Step 2: Lancer → échec**

Run: `bun run --cwd apps/api test -- users`
Expected: FAIL (réponse `{ users }` non bornée).

- [ ] **Step 3: Modifier le handler**

Dans `apps/api/src/routes/users.ts`, ajouter :
```ts
import { lirePagination } from "../lib/pagination"
import { requeterParLots } from "../lib/db-batch"
```
Après `const organizationId = c.get("membership").organizationId`, insérer :
```ts
  const pagination = lirePagination(c)
  if (pagination instanceof Response) return pagination
  const { page, limite } = pagination
  const totalRows = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(schema.member)
    .where(eq(schema.member.organizationId, organizationId))
  const total = totalRows[0]?.total ?? 0
```
Ajouter `.limit(limite).offset((page - 1) * limite)` après `.orderBy(asc(schema.user.name))` de la requête `rows`.
Scoper la requête `affectations` aux users de la page (au lieu de toute l'organisation) via le helper de lots :
```ts
  const idsUsers = rows.map((u) => u.id)
  const affectations = await requeterParLots(idsUsers, (lot) =>
    db
      .select({
        id: schema.warehouseMembers.id,
        userId: schema.warehouseMembers.userId,
        warehouseId: schema.warehouseMembers.warehouseId,
        warehouseName: schema.warehouses.name,
        role: schema.warehouseMembers.role,
      })
      .from(schema.warehouseMembers)
      .innerJoin(
        schema.warehouses,
        eq(schema.warehouseMembers.warehouseId, schema.warehouses.id)
      )
      .where(
        and(
          eq(schema.warehouseMembers.organizationId, organizationId),
          inArray(schema.warehouseMembers.userId, lot)
        )
      )
  )
```
Remplacer `return c.json({ users })` par `return c.json({ users, total, page, limite })`.
(Vérifier les imports drizzle du fichier : `and`, `inArray`, `sql` doivent être importés de `drizzle-orm` ; les ajouter à l'import existant si absents.)

- [ ] **Step 4: Lancer → succès**

Run: `bun run --cwd apps/api test -- users`
Expected: PASS.

- [ ] **Step 5: Brancher le front**

Dans `apps/web/src/routes/_app/administration/utilisateurs.tsx` :
- `import { Pagination } from "@/components/ui/pagination"`, `useState`/`useEffect` si besoin.
- `const [page, setPage] = useState(1)`.
- useQuery :
```tsx
  const utilisateurs = useQuery({
    queryKey: ["users", page],
    queryFn: () =>
      apiFetch<{
        users: Utilisateur[]
        total: number
        page: number
        limite: number
      }>(`/api/v1/users?page=${page}`),
  })
```
- Après la table, ajouter le `<Pagination>` gardé par `(utilisateurs.data?.users.length ?? 0) > 0`, `element={{ un: "utilisateur", plusieurs: "utilisateurs" }}`, `total={utilisateurs.data?.total ?? 0}`, `pageSize={utilisateurs.data?.limite ?? 50}`, `onPageChange={setPage}`.

- [ ] **Step 6: Typecheck + suite complète + commit**

Run: `bun run typecheck` → clean.
Run: `bun run --cwd apps/web test` → PASS.
Run: `CI=1 bun run --cwd apps/api test` → tous les fichiers passent (mode fiable).
```bash
git add apps/api/src/routes/users.ts apps/api/test/users.test.ts apps/web/src/routes/_app/administration/utilisateurs.tsx
git commit -m "feat(api): pagination serveur GET /users + front (issue #13)"
```

---

## Notes de vérification finale

Après la Task 9, les 6 endpoints renvoient `{ <clé>, total, page, limite }`, `/sales` et `/stock/movements` partagent `lirePagination`, et les 6 écrans affichent le composant `Pagination`. `categories`/`suppliers` restent non paginés (déroulants). État attendu : suite API complète verte (mode fiable `CI=1`), suite web verte, `bun run typecheck` et `bunx eslint` propres sur les fichiers touchés.
