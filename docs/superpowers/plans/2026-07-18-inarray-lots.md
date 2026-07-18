# Découpage en lots des `inArray` non bornés — Implementation Plan

**Amendement (reprise du fix)** — corrections postérieures à ce plan, synchronisées ci-dessous avec `apps/api/src/lib/db-batch.ts` et le spec `docs/superpowers/specs/2026-07-18-inarray-lots-design.md` : `products.ts:88` (source réelle du crash) est désormais **inclus** dans le périmètre (l'hypothèse « PR #17 le couvre » était fausse — PR #17 était web-only, sans pagination serveur), et la taille de lot est **90** et non 100 (D1 plafonne à 100 paramètres liés ; `inArray(100)` + `eq(organizationId)` = 101 crashait encore).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corriger le crash `D1_ERROR: too many SQL variables` sur les listes non bornées de réceptions, transferts et inventaires en découpant leurs `inArray(...)` en lots sûrs, via un helper générique réutilisable.

**Architecture:** Un helper pur `requeterParLots` (`apps/api/src/lib/db-batch.ts`) découpe un tableau d'ids en lots ≤ 90, exécute la requête fournie par lot, concatène les résultats. Appliqué à 5 emplacements dans 4 routes (`purchases.ts`, `transfers.ts`, `inventory-counts.ts` ×2, `products.ts:88`).

**Tech Stack:** Hono, Drizzle ORM, D1 (SQLite), vitest + `@cloudflare/vitest-pool-workers` (tests d'intégration sur D1 réelle, convention existante du repo).

## Global Constraints

- Référence design : `docs/superpowers/specs/2026-07-18-inarray-lots-design.md`.
- **`products.ts:88` est dans le périmètre** (source réelle du crash) ; les sites `products.ts` 51 (sous-requête `IN (SELECT …)`) et 118 (borné par les variantes d'un seul produit) sont sûrs et non touchés.
- Taille de lot : **90**. D1 plafonne une requête à 100 paramètres liés ; le lot est capé sous 100 pour laisser de la place aux autres paramètres liés (`GET /products` lie un `organizationId` en plus de l'`inArray` → 100 + 1 = 101 crasherait). 90 laisse 10 de marge.
- Batch D1 hétérogène et de taille dynamique : toujours construire via déstructuration `const [premiere, ...reste] = instructions; await db.batch([premiere, ...reste])` — jamais `push()` + cast, jamais passer directement le résultat d'un `.flatMap()`/`.map()` à `db.batch()` (ne satisfait pas le type tuple `[BatchItem, ...BatchItem[]]` exigé par Drizzle — vérifié empiriquement, `tsc` rejette `db.batch(array.flatMap(...))` avec « Source provides no match for required element at position 0 »).
- `apps/api/vitest.config.ts` est intouchable (cf. CLAUDE.md) ; les tests de ce plan suivent les conventions existantes du dossier `apps/api/test/` (D1 réelle via `cloudflare:test`, helpers de `test/helpers.ts`), pas de nouvelle configuration.
- Commentaires de code en français, cohérent avec le reste de `apps/api/src`.

---

### Task 1: Helper `requeterParLots` + tests unitaires

**Files:**
- Create: `apps/api/src/lib/db-batch.ts`
- Test: `apps/api/test/db-batch.test.ts`

**Interfaces:**
- Produces: `requeterParLots<T>(ids: string[], requete: (lot: string[]) => Promise<T[]>): Promise<T[]>` — utilisé par Task 2 dans `purchases.ts`, `transfers.ts`, `inventory-counts.ts`.

- [ ] **Step 1: Écrire le test (échoue d'abord)**

Create `apps/api/test/db-batch.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { requeterParLots } from "../src/lib/db-batch"

describe("requeterParLots", () => {
  it("retourne un tableau vide sans appeler requete si ids est vide", async () => {
    let appels = 0
    const resultat = await requeterParLots<number>([], async () => {
      appels += 1
      return []
    })
    expect(resultat).toEqual([])
    expect(appels).toBe(0)
  })

  it("fait un seul appel quand ids tient dans un lot", async () => {
    const lotsRecus: string[][] = []
    const resultat = await requeterParLots(["a", "b", "c"], async (lot) => {
      lotsRecus.push(lot)
      return lot.map((id) => ({ id }))
    })
    expect(lotsRecus).toEqual([["a", "b", "c"]])
    expect(resultat).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }])
  })

  it("découpe en lots de 90 au maximum et concatène les résultats dans l'ordre", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`)
    const taillesLots: number[] = []
    const resultat = await requeterParLots(ids, async (lot) => {
      taillesLots.push(lot.length)
      return lot.map((id) => ({ id }))
    })
    expect(taillesLots).toEqual([90, 90, 70])
    expect(resultat).toEqual(ids.map((id) => ({ id })))
  })

  it("gère exactement un multiple de la taille de lot sans lot vide final", async () => {
    const ids = Array.from({ length: 180 }, (_, i) => `id-${i}`)
    const taillesLots: number[] = []
    await requeterParLots(ids, async (lot) => {
      taillesLots.push(lot.length)
      return []
    })
    expect(taillesLots).toEqual([90, 90])
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

```bash
cd apps/api && bunx vitest run test/db-batch.test.ts
```
Expected: FAIL — `Cannot find module '../src/lib/db-batch'`.

- [ ] **Step 3: Implémenter `apps/api/src/lib/db-batch.ts`**

```ts
// D1 caps a query at 100 bound parameters ("too many SQL variables", observed
// crashing GET /products at 720 rows). An inArray() fed by an unbounded list can
// exceed that cap. This helper splits the call into safe batches. The batch is
// capped BELOW 100 so the surrounding query keeps room for its own bound
// parameters (e.g. GET /products binds an extra organizationId, so 100 ids would
// total 101 and still crash); 90 leaves 10 of headroom.
const TAILLE_LOT_MAX = 90

export async function requeterParLots<T>(
  ids: string[],
  requete: (lot: string[]) => Promise<T[]>
): Promise<T[]> {
  if (ids.length === 0) return []
  const resultats: T[] = []
  for (let i = 0; i < ids.length; i += TAILLE_LOT_MAX) {
    const lot = ids.slice(i, i + TAILLE_LOT_MAX)
    resultats.push(...(await requete(lot)))
  }
  return resultats
}
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

```bash
cd apps/api && bunx vitest run test/db-batch.test.ts
```
Expected: `4 passed`.

- [ ] **Step 5: Typecheck**

```bash
cd apps/api && bun run typecheck
```
Expected: exit code 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/db-batch.ts apps/api/test/db-batch.test.ts
git commit -m "feat(api): helper requeterParLots pour les inArray non bornés"
```

---

### Task 2: Application aux emplacements + test de régression

**Files:**
- Modify: `apps/api/src/routes/purchases.ts:154-166`
- Modify: `apps/api/src/routes/transfers.ts:194-206`
- Modify: `apps/api/src/routes/inventory-counts.ts:120-132` et `:533-556`
- Test: `apps/api/test/purchases-draft.test.ts` (nouveau test de régression)

**Interfaces:**
- Consumes: `requeterParLots<T>` (Task 1).

- [ ] **Step 1: `purchases.ts` — remplacer le ternaire par `requeterParLots`**

Modify `apps/api/src/routes/purchases.ts`. D'abord, ajouter l'import (à côté des autres imports de `../lib/*`) :

```ts
import { requeterParLots } from "../lib/db-batch"
```

Puis remplacer (lignes 154-166) :

```ts
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
```

par :

```ts
  const ids = rows.map((r) => r.id)
  const agregats = await requeterParLots(ids, (lot) =>
    db
      .select({
        purchaseId: schema.purchaseItems.purchaseId,
        itemCount: sql<number>`COUNT(*)`,
        totalCost: sql<number>`COALESCE(SUM(${schema.purchaseItems.quantity} * ${schema.purchaseItems.unitCost}), 0)`,
      })
      .from(schema.purchaseItems)
      .where(inArray(schema.purchaseItems.purchaseId, lot))
      .groupBy(schema.purchaseItems.purchaseId)
  )
```

- [ ] **Step 2: `transfers.ts` — même correctif**

Modify `apps/api/src/routes/transfers.ts`. Ajouter l'import :

```ts
import { requeterParLots } from "../lib/db-batch"
```

Remplacer (lignes 194-206) :

```ts
  const ids = rows.map((r) => r.id)
  const agregats =
    ids.length > 0
      ? await db
          .select({
            transferId: schema.transferItems.transferId,
            itemCount: sql<number>`COUNT(*)`,
            totalQuantity: sql<number>`COALESCE(SUM(${schema.transferItems.quantity}), 0)`,
          })
          .from(schema.transferItems)
          .where(inArray(schema.transferItems.transferId, ids))
          .groupBy(schema.transferItems.transferId)
      : []
```

par :

```ts
  const ids = rows.map((r) => r.id)
  const agregats = await requeterParLots(ids, (lot) =>
    db
      .select({
        transferId: schema.transferItems.transferId,
        itemCount: sql<number>`COUNT(*)`,
        totalQuantity: sql<number>`COALESCE(SUM(${schema.transferItems.quantity}), 0)`,
      })
      .from(schema.transferItems)
      .where(inArray(schema.transferItems.transferId, lot))
      .groupBy(schema.transferItems.transferId)
  )
```

- [ ] **Step 3: `inventory-counts.ts` — deux emplacements**

Modify `apps/api/src/routes/inventory-counts.ts`. Ajouter l'import :

```ts
import { requeterParLots } from "../lib/db-batch"
```

Premier emplacement — remplacer (lignes 120-132) :

```ts
  const ids = rows.map((r) => r.id)
  const agregats =
    ids.length > 0
      ? await db
          .select({
            countId: schema.inventoryCountItems.countId,
            itemCount: sql<number>`COUNT(*)`,
            countedCount: sql<number>`SUM(CASE WHEN ${schema.inventoryCountItems.countedQuantity} IS NOT NULL THEN 1 ELSE 0 END)`,
          })
          .from(schema.inventoryCountItems)
          .where(inArray(schema.inventoryCountItems.countId, ids))
          .groupBy(schema.inventoryCountItems.countId)
      : []
```

par :

```ts
  const ids = rows.map((r) => r.id)
  const agregats = await requeterParLots(ids, (lot) =>
    db
      .select({
        countId: schema.inventoryCountItems.countId,
        itemCount: sql<number>`COUNT(*)`,
        countedCount: sql<number>`SUM(CASE WHEN ${schema.inventoryCountItems.countedQuantity} IS NOT NULL THEN 1 ELSE 0 END)`,
      })
      .from(schema.inventoryCountItems)
      .where(inArray(schema.inventoryCountItems.countId, lot))
      .groupBy(schema.inventoryCountItems.countId)
  )
```

Deuxième emplacement — remplacer (lignes 533-556, dans le bloc `try/catch` après la clôture d'inventaire) :

```ts
  const variantIds = ecarts.map((e) => e.variantId)
  let variantes: Array<{
    id: string
    sku: string
    variantName: string
    productName: string
  }> = []
  try {
    variantes = await db
      .select({
        id: schema.productVariants.id,
        sku: schema.productVariants.sku,
        variantName: schema.productVariants.name,
        productName: schema.products.name,
      })
      .from(schema.productVariants)
      .innerJoin(
        schema.products,
        eq(schema.productVariants.productId, schema.products.id)
      )
      .where(inArray(schema.productVariants.id, variantIds))
  } catch {
    variantes = []
  }
```

par (le `try/catch` global autour de `requeterParLots` est conservé à l'identique — cf. Global Constraints et design §3, le comportement de repli existant n'est pas modifié) :

```ts
  const variantIds = ecarts.map((e) => e.variantId)
  let variantes: Array<{
    id: string
    sku: string
    variantName: string
    productName: string
  }> = []
  try {
    variantes = await requeterParLots(variantIds, (lot) =>
      db
        .select({
          id: schema.productVariants.id,
          sku: schema.productVariants.sku,
          variantName: schema.productVariants.name,
          productName: schema.products.name,
        })
        .from(schema.productVariants)
        .innerJoin(
          schema.products,
          eq(schema.productVariants.productId, schema.products.id)
        )
        .where(inArray(schema.productVariants.id, lot))
    )
  } catch {
    variantes = []
  }
```

- [ ] **Step 4: Typecheck**

```bash
cd apps/api && bun run typecheck
```
Expected: exit code 0.

- [ ] **Step 5: Écrire le test de régression (échoue d'abord contre l'ancien code — vérifier en amont, voir note)**

Note : ce test est un test de RÉGRESSION écrit APRÈS le correctif (Steps 1-3 déjà appliqués) — il ne suit pas le cycle RED/GREEN classique sur ce fichier précis, mais valide que le correctif résout bien le crash à l'échelle réelle. Si vous voulez une preuve RED authentique, `git stash` temporairement les Steps 1-3, lancer ce test (il doit échouer avec `D1_ERROR: too many SQL variables`), puis `git stash pop` et relancer (il doit passer).

Append to `apps/api/test/purchases-draft.test.ts` (après le `describe` existant, avant la fin du fichier — utilise `bootstrapOwner`, `creerEntrepot`, `creerProduitSimple` déjà importés en haut du fichier, et `creerFournisseur` déjà défini plus haut dans le même fichier) :

```ts
describe("réceptions fournisseur — liste à grande échelle", () => {
  it("GET / ne plante pas au-delà d'un lot de 90 (régression inArray, 150 réceptions)", async () => {
    const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
    const warehouseId = await creerEntrepot(organizationId)
    const supplierId = await creerFournisseur(ownerCookie)
    const produit = await creerProduitSimple(organizationId)

    const db = drizzle(env.DB, { schema })
    const maintenant = new Date()
    const NB_RECEPTIONS = 150
    const TAILLE_LOT_SEED = 50
    const purchaseIds = Array.from({ length: NB_RECEPTIONS }, () =>
      crypto.randomUUID()
    )

    for (
      let debut = 0;
      debut < purchaseIds.length;
      debut += TAILLE_LOT_SEED
    ) {
      const lot = purchaseIds.slice(debut, debut + TAILLE_LOT_SEED)
      const instructions = lot.flatMap((purchaseId, indexLot) => {
        const index = debut + indexLot
        return [
          db.insert(schema.purchases).values({
            id: purchaseId,
            organizationId,
            warehouseId,
            supplierId,
            status: "draft" as const,
            reference: `BL-VOL-${index}`,
            createdBy: ownerId,
            createdAt: maintenant,
            updatedAt: maintenant,
          }),
          db.insert(schema.purchaseItems).values({
            id: crypto.randomUUID(),
            organizationId,
            purchaseId,
            variantId: produit.variantId,
            quantity: 5,
            unitCost: 100,
            createdAt: maintenant,
          }),
        ]
      })
      const [premiere, ...reste] = instructions
      await db.batch([premiere, ...reste])
    }

    const liste = await req(ownerCookie, "GET", "/api/v1/purchases")
    expect(liste.status).toBe(200)
    const { purchases } = await liste.json<{
      purchases: Array<{ id: string; itemCount: number; totalCost: number }>
    }>()
    expect(purchases).toHaveLength(NB_RECEPTIONS)
    const echantillon = purchases.find((p) => p.id === purchaseIds[0])
    expect(echantillon?.itemCount).toBe(1)
    expect(echantillon?.totalCost).toBe(500)
  })
})
```

- [ ] **Step 6: Lancer le test de régression**

```bash
cd apps/api && bunx vitest run test/purchases-draft.test.ts
```
Expected: tous les tests du fichier passent (le test existant « cycle complet » + le nouveau test à grande échelle). Le nouveau test peut prendre plusieurs secondes (150 réceptions + 150 lignes insérées via 3 batches de 100 statements) — reste largement sous le `testTimeout` de 20000 ms.

- [ ] **Step 7: Suite complète de `apps/api` (vérifier l'absence de régression ailleurs)**

```bash
cd apps/api && bun run test
```
Expected: aucun nouvel échec attribuable à ce changement. (Le repo a une flakiness locale déjà documentée — pool `workerd` saturé hors CI sur ~50+ fichiers de test, cf. CLAUDE.md « Pièges vérifiés empiriquement » — un échec isolé et non reproductible sur un fichier sans rapport avec `purchases`/`transfers`/`inventory-counts`/`db-batch` n'est pas une régression de ce changement ; relancer ce fichier seul pour confirmer avant de conclure à un vrai problème.)

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/purchases.ts apps/api/src/routes/transfers.ts \
  apps/api/src/routes/inventory-counts.ts apps/api/test/purchases-draft.test.ts
git commit -m "fix(api): découpe en lots les inArray non bornés (réceptions, transferts, inventaires)"
```

---

## Après ce plan

- `products.ts:88` est corrigé par ce même helper (cf. amendement en tête). La pagination serveur de `GET /products` reste l'objet de l'issue #13 (sous-projet B, non démarré) ; le découpage en lots reste utile en défense en profondeur même après pagination.
- `inventory-counts.ts:553` est maintenant protégé, mais reste borné par le SKU total d'UN entrepôt — si un entrepôt dépasse ~10 000 SKU (≈110 lots de 90), le temps de réponse de cette lecture post-commit croît linéairement ; non bloquant pour ce plan, à surveiller si l'organisation grandit fortement.
