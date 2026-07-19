# Recréation magasins + inventaire Supabase — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruire en prod pos-stocks, depuis Supabase, les 3 magasins et le stock par magasin (le catalogue est déjà scripté), via l'API et des réceptions valorisées.

**Architecture:** Deux nouveaux scripts dans le worktree `scripts/import-produits-supabase`, réutilisant `http-client.ts`. Lecture Supabase via `supabase db query --linked`. Écriture prod via l'API (jamais D1 direct). Testé en local d'abord (l'API dev a déjà les 720 produits).

**Tech Stack:** Bun + TypeScript, `node:util` parseArgs, `node:child_process` (execFileSync) pour la CLI Supabase, zod, `bun test`, schémas `shared`.

**Spec :** `docs/superpowers/specs/2026-07-19-recreation-magasins-inventaire-supabase-design.md`

## Global Constraints

- Écriture prod **uniquement via l'API** (invariant #1) — jamais de write D1 direct.
- Montants en **entiers XOF** : tout `numeric` Supabase → `Math.round`.
- Réception (`purchase`) chunkée en **≤ 100 lignes** par document (limite batch D1).
- **Idempotence + reprise** : journaux de progression atomiques ; re-lancer ne duplique rien.
- Lignes non mappables (SKU absent, `cost` nul→0) : **rapportées, jamais bloquantes**.
- Identifiants prod jamais en dur/en chat : `IMPORT_EMAIL`/`IMPORT_PASSWORD` en env, `--api-url`/`--web-origin` en args.
- Langue : commentaires/JSDoc en **anglais**, messages console en français.
- Répertoire de travail : `scripts/import-produits-supabase/`. Tests `bun test`. Jamais `--no-verify`.

## Contrats API vérifiés

- `POST /api/v1/warehouses` `{name, type:"store", address?}` → `{id}` 201 ; 409 `NOM_EXISTANT` si nom dupliqué.
- `GET /api/v1/warehouses` → `{warehouses:[{id,name,type}]}` (actifs).
- `POST /api/v1/suppliers` `{name}` → `{id}` 201 ; 409 si nom dupliqué. `GET /api/v1/suppliers` → `{suppliers:[{id,name,…}]}`.
- `GET /api/v1/products?page=&limite=200` → `{products:[{id,sku,variants:[{id,sku,…}]}], total, page, limite}`.
- `POST /api/v1/purchases` `{warehouseId, supplierId, reference?}` → `{id}` 201.
- `POST /api/v1/purchases/:id/items` `{variantId, quantity(>0), unitCost(≥0)}` → `{id}` 201 ; 404 `INTROUVABLE` variante ; 409 si déjà validée.
- `POST /api/v1/purchases/:id/receive` → 200 ; 409 `STATUT_INVALIDE` si déjà reçue ; 409/400 `VALIDATION` si sans ligne.

## File Structure

- Create `supabase-source.ts` — lecture Supabase (`stores`, inventaire) : exec CLI + parse zod. Responsabilité : fournir des tableaux typés.
- Create `supabase-source.test.ts` — parsing pur sur fixtures.
- Create `journal-simple.ts` — lecture/écriture atomique d'un objet JSON de progression (générique).
- Create `magasins.ts` — logique pure : mapping `store → warehouseCreateInput`, résolution idempotente nom→id.
- Create `magasins.test.ts`.
- Create `creer-magasins.ts` — script CLI (crée magasins + fournisseur, journal `data/magasins-<cible>.json`).
- Create `inventaire.ts` — logique pure : `sku→variantId` depuis pages produits, mapping ligne→item, arrondi, chunking ≤100.
- Create `inventaire.test.ts`.
- Create `semer-inventaire.ts` — script CLI (réceptions chunkées + receive, journal `data/inventaire-<cible>.json`).
- Modify `README.md` — documenter les 2 scripts + l'ordre d'exécution.

---

### Task 1: Lecture Supabase (`supabase-source.ts`)

**Files:**
- Create: `scripts/import-produits-supabase/supabase-source.ts`
- Test: `scripts/import-produits-supabase/supabase-source.test.ts`

**Interfaces:**
- Produces:
  - `interface StoreSource { id: string; name: string; address: string | null }`
  - `interface LigneInventaireSource { sku: string; storeId: string; quantity: number; cost: number | null }`
  - `parseStores(json: string): StoreSource[]`
  - `parseInventaire(json: string): LigneInventaireSource[]`
  - `lireStores(projet?: string): StoreSource[]` (exec `supabase db query --linked`)
  - `lireInventaire(projet?: string): LigneInventaireSource[]`

**Notes :** `supabase db query --linked "<sql>"` imprime une ligne parasite (`Initialising login role...`) puis un JSON `{boundary, rows:[…]}`. Le parse doit isoler le JSON à partir du **premier `{`** (`raw.slice(raw.indexOf("{"))`). Exec via `execFileSync("supabase", [...], {encoding:"utf-8", maxBuffer})`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test"
import { parseStores, parseInventaire } from "./supabase-source"

const STORES_JSON = `Initialising login role...
{"boundary":"x","rows":[
  {"id":"s1","name":"Quincaillerie","address":"Abidjan"},
  {"id":"s2","name":"Symo","address":null}
]}`

test("parseStores isole le JSON et mappe les colonnes", () => {
  const r = parseStores(STORES_JSON)
  expect(r).toEqual([
    { id: "s1", name: "Quincaillerie", address: "Abidjan" },
    { id: "s2", name: "Symo", address: null },
  ])
})

const INV_JSON = `{"rows":[
  {"sku":"PRD-1","store_id":"s1","quantity":10,"cost":3500.3},
  {"sku":"PRD-2","store_id":"s1","quantity":5,"cost":null}
]}`

test("parseInventaire mappe store_id/cost et garde les décimaux bruts", () => {
  const r = parseInventaire(INV_JSON)
  expect(r).toEqual([
    { sku: "PRD-1", storeId: "s1", quantity: 10, cost: 3500.3 },
    { sku: "PRD-2", storeId: "s1", quantity: 5, cost: null },
  ])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts/import-produits-supabase && bun test supabase-source.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Write minimal implementation**

```ts
import { execFileSync } from "node:child_process"
import { z } from "zod"

export interface StoreSource {
  id: string
  name: string
  address: string | null
}

export interface LigneInventaireSource {
  sku: string
  storeId: string
  quantity: number
  cost: number | null
}

const storeRow = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  address: z.string().nullable(),
})
const inventaireRow = z.object({
  sku: z.string().min(1),
  store_id: z.string().min(1),
  quantity: z.number(),
  cost: z.number().nullable(),
})
const enveloppe = z.object({ rows: z.array(z.unknown()) })

/** Extract the JSON object printed after the CLI's login banner. */
function extraireJson(raw: string): unknown {
  const debut = raw.indexOf("{")
  if (debut < 0) throw new Error(`Sortie Supabase sans JSON : ${raw.slice(0, 200)}`)
  return JSON.parse(raw.slice(debut))
}

export function parseStores(raw: string): StoreSource[] {
  const rows = enveloppe.parse(extraireJson(raw)).rows
  return rows.map((r) => {
    const v = storeRow.parse(r)
    return { id: v.id, name: v.name, address: v.address }
  })
}

export function parseInventaire(raw: string): LigneInventaireSource[] {
  const rows = enveloppe.parse(extraireJson(raw)).rows
  return rows.map((r) => {
    const v = inventaireRow.parse(r)
    return { sku: v.sku, storeId: v.store_id, quantity: v.quantity, cost: v.cost }
  })
}

function requeter(sql: string, projet?: string): string {
  const args = ["db", "query", "--linked", sql]
  if (projet) args.push("--project-ref", projet)
  return execFileSync("supabase", args, {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  })
}

export function lireStores(projet?: string): StoreSource[] {
  return parseStores(
    requeter("select id, name, address from stores order by created_at", projet)
  )
}

export function lireInventaire(projet?: string): LigneInventaireSource[] {
  return parseInventaire(
    requeter(
      "select pt.sku as sku, pi.store_id as store_id, pi.quantity as quantity, pt.cost as cost " +
        "from product_inventory pi join product_templates pt on pt.id = pi.product_id " +
        "where pi.quantity > 0",
      projet
    )
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test supabase-source.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/import-produits-supabase/supabase-source.ts scripts/import-produits-supabase/supabase-source.test.ts
git commit -m "feat(import): lecture Supabase des magasins et de l'inventaire"
```

---

### Task 2: Journal générique (`journal-simple.ts`)

**Files:**
- Create: `scripts/import-produits-supabase/journal-simple.ts`
- Test: `scripts/import-produits-supabase/journal-simple.test.ts`

**Interfaces:**
- Produces:
  - `chargerJson<T>(chemin: string, defaut: T): T`
  - `ecrireJsonAtomique(chemin: string, valeur: unknown): void` (tmp + rename, comme `progress.ts`)

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { chargerJson, ecrireJsonAtomique } from "./journal-simple"

test("chargerJson renvoie le défaut si absent, relit après écriture", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "jrnl-"))
  const f = path.join(dir, "j.json")
  expect(chargerJson(f, { a: 1 })).toEqual({ a: 1 })
  ecrireJsonAtomique(f, { a: 2, b: [3] })
  expect(chargerJson(f, { a: 1 })).toEqual({ a: 2, b: [3] })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test journal-simple.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Write minimal implementation**

```ts
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"

export function chargerJson<T>(chemin: string, defaut: T): T {
  if (!existsSync(chemin)) return defaut
  return JSON.parse(readFileSync(chemin, "utf-8")) as T
}

/** Atomic write (temp file + rename) so an interrupted run never corrupts the journal. */
export function ecrireJsonAtomique(chemin: string, valeur: unknown): void {
  const temp = `${chemin}.tmp`
  writeFileSync(temp, JSON.stringify(valeur, null, 2))
  renameSync(temp, chemin)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test journal-simple.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/import-produits-supabase/journal-simple.ts scripts/import-produits-supabase/journal-simple.test.ts
git commit -m "feat(import): journal de progression JSON générique atomique"
```

---

### Task 3: Logique magasins + fournisseur (`magasins.ts`)

**Files:**
- Create: `scripts/import-produits-supabase/magasins.ts`
- Test: `scripts/import-produits-supabase/magasins.test.ts`

**Interfaces:**
- Consumes: `StoreSource` (Task 1).
- Produces:
  - `const NOM_FOURNISSEUR = "Stock initial (import Supabase)"`
  - `construireMagasinCible(source: StoreSource): { name: string; type: "store"; address?: string }` — valide contre `warehouseCreateSchema`, omet `address` si null/vide.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test"
import { construireMagasinCible } from "./magasins"

test("mappe store → warehouse type store, address optionnelle", () => {
  expect(construireMagasinCible({ id: "s1", name: "Quincaillerie", address: "Abidjan" }))
    .toEqual({ name: "Quincaillerie", type: "store", address: "Abidjan" })
  expect(construireMagasinCible({ id: "s2", name: "Symo", address: null }))
    .toEqual({ name: "Symo", type: "store" })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test magasins.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```ts
import { warehouseCreateSchema } from "shared"
import type { WarehouseCreateInput } from "shared"
import type { StoreSource } from "./supabase-source"

export const NOM_FOURNISSEUR = "Stock initial (import Supabase)"

export function construireMagasinCible(source: StoreSource): WarehouseCreateInput {
  const adresse = source.address?.trim()
  const payload: WarehouseCreateInput = {
    name: source.name,
    type: "store",
    ...(adresse ? { address: adresse } : {}),
  }
  // Validate against the real target schema: a mapping regression fails here
  // rather than confusingly against the API during the real prod run.
  return warehouseCreateSchema.parse(payload)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test magasins.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/import-produits-supabase/magasins.ts scripts/import-produits-supabase/magasins.test.ts
git commit -m "feat(import): mapping magasin Supabase → warehouse cible"
```

---

### Task 4: Script `creer-magasins.ts`

**Files:**
- Create: `scripts/import-produits-supabase/creer-magasins.ts`

**Interfaces:**
- Consumes: `lireStores` (Task 1), `chargerJson`/`ecrireJsonAtomique` (Task 2), `construireMagasinCible`/`NOM_FOURNISSEUR` (Task 3), `connecter`/`requeteJson` (`http-client.ts`).
- Produces (journal `data/magasins-<cible>.json`):
  - `interface JournalMagasins { warehousesByName: Record<string,string>; supplierId?: string }`

**Behaviour :** CLI args `--api-url`, `--web-origin`, `--journal` (défaut `data/magasins-local.json`), `--projet` (project-ref Supabase optionnel), `--dry-run`. Auth via `IMPORT_EMAIL`/`IMPORT_PASSWORD` (comme `run.ts`).

Logique idempotente :
1. Charger le journal. Lire les magasins Supabase.
2. `GET /warehouses` → set des noms existants + leurs ids ; fusionner dans le journal.
3. Pour chaque store non présent : `POST /warehouses` ; si 409 `NOM_EXISTANT`, relire `GET /warehouses` pour récupérer l'id. Enregistrer `warehousesByName[name]=id` (écriture journal après chaque création).
4. Fournisseur : si `supplierId` absent, `GET /suppliers` (chercher `NOM_FOURNISSEUR`) sinon `POST /suppliers {name:NOM_FOURNISSEUR}` (409 → relire). Enregistrer `supplierId`.
5. Rapport : magasins créés vs réutilisés, fournisseur.

- [ ] **Step 1: Écrire le script** (pas de test unitaire — orchestration I/O ; couvert par l'E2E local Task 7)

Structure attendue (implémenter en entier, pas de placeholder) :

```ts
import { parseArgs } from "node:util"
import path from "node:path"
import { connecter, requeteJson } from "./http-client"
import type { ClientApi } from "./http-client"
import { lireStores } from "./supabase-source"
import { chargerJson, ecrireJsonAtomique } from "./journal-simple"
import { construireMagasinCible, NOM_FOURNISSEUR } from "./magasins"

interface JournalMagasins {
  warehousesByName: Record<string, string>
  supplierId?: string
}

// parseArgs (--api-url default http://localhost:8787, --web-origin default
// http://localhost:3000, --journal default data/magasins-local.json,
// --projet string optionnel, --dry-run bool), obtenirClient identique à run.ts
// (IMPORT_EMAIL/IMPORT_PASSWORD, court-circuit dry-run).
// main() : implémente les étapes 1→5 ci-dessus avec GET/POST + gestion 409
// NOM_EXISTANT (relecture), en écrivant le journal via ecrireJsonAtomique
// après chaque mutation, et en imprimant un rapport final en français.
```

- [ ] **Step 2: Typecheck**

Run: `cd scripts/import-produits-supabase && bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Dry-run (sans réseau)**

Run: `bun run creer-magasins.ts --dry-run`
Expected: liste des magasins qui seraient créés (lecture Supabase réelle, aucune écriture API).

- [ ] **Step 4: Commit**

```bash
git add scripts/import-produits-supabase/creer-magasins.ts
git commit -m "feat(import): script de création des magasins et du fournisseur"
```

---

### Task 5: Logique inventaire (`inventaire.ts`)

**Files:**
- Create: `scripts/import-produits-supabase/inventaire.ts`
- Test: `scripts/import-produits-supabase/inventaire.test.ts`

**Interfaces:**
- Consumes: `LigneInventaireSource` (Task 1).
- Produces:
  - `interface ProduitApi { id: string; sku: string; variants: Array<{ id: string; sku: string }> }`
  - `carteSkuVariante(produits: ProduitApi[]): Map<string,string>` — `product.sku → variants[0].id` (variante Standard unique).
  - `interface ItemReception { variantId: string; quantity: number; unitCost: number }`
  - `interface LigneIgnoree { sku: string; raison: "sku_absent" }`
  - `interface ResultatMapping { itemsParMagasin: Map<string, ItemReception[]>; ignorees: LigneIgnoree[] }`
  - `mapperInventaire(lignes: LigneInventaireSource[], skuVersVariante: Map<string,string>, storeIdVersWarehouse: Map<string,string>): ResultatMapping` — `unitCost = Math.round(cost ?? 0)` ; SKU absent → `ignorees` ; storeId sans warehouse → **throw** (erreur de config, pas une ligne à ignorer).
  - `chunk<T>(items: T[], taille: number): T[][]`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test"
import { carteSkuVariante, mapperInventaire, chunk } from "./inventaire"

test("carteSkuVariante mappe sku produit → 1ère variante", () => {
  const m = carteSkuVariante([
    { id: "p1", sku: "PRD-1", variants: [{ id: "v1", sku: "PRD-1" }] },
  ])
  expect(m.get("PRD-1")).toBe("v1")
})

test("mapperInventaire arrondit le coût, ignore les SKU absents, groupe par magasin", () => {
  const sku = new Map([["PRD-1", "v1"]])
  const wh = new Map([["s1", "w1"]])
  const r = mapperInventaire(
    [
      { sku: "PRD-1", storeId: "s1", quantity: 10, cost: 3500.3 },
      { sku: "PRD-2", storeId: "s1", quantity: 5, cost: 100 },
    ],
    sku,
    wh
  )
  expect(r.itemsParMagasin.get("w1")).toEqual([{ variantId: "v1", quantity: 10, unitCost: 3500 }])
  expect(r.ignorees).toEqual([{ sku: "PRD-2", raison: "sku_absent" }])
})

test("mapperInventaire : cost null → unitCost 0", () => {
  const r = mapperInventaire(
    [{ sku: "PRD-1", storeId: "s1", quantity: 2, cost: null }],
    new Map([["PRD-1", "v1"]]),
    new Map([["s1", "w1"]])
  )
  expect(r.itemsParMagasin.get("w1")).toEqual([{ variantId: "v1", quantity: 2, unitCost: 0 }])
})

test("mapperInventaire : storeId sans warehouse → throw", () => {
  expect(() =>
    mapperInventaire(
      [{ sku: "PRD-1", storeId: "sX", quantity: 1, cost: 0 }],
      new Map([["PRD-1", "v1"]]),
      new Map()
    )
  ).toThrow()
})

test("chunk découpe en lots de taille max avec reste", () => {
  expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test inventaire.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { LigneInventaireSource } from "./supabase-source"

export interface ProduitApi {
  id: string
  sku: string
  variants: Array<{ id: string; sku: string }>
}

export interface ItemReception {
  variantId: string
  quantity: number
  unitCost: number
}

export interface LigneIgnoree {
  sku: string
  raison: "sku_absent"
}

export interface ResultatMapping {
  itemsParMagasin: Map<string, ItemReception[]>
  ignorees: LigneIgnoree[]
}

/** sku → its sole "Standard" variant id (imported products have no variants). */
export function carteSkuVariante(produits: ProduitApi[]): Map<string, string> {
  const carte = new Map<string, string>()
  for (const p of produits) {
    const v = p.variants[0] as { id: string; sku: string } | undefined
    if (v) carte.set(p.sku, v.id)
  }
  return carte
}

export function mapperInventaire(
  lignes: LigneInventaireSource[],
  skuVersVariante: Map<string, string>,
  storeIdVersWarehouse: Map<string, string>
): ResultatMapping {
  const itemsParMagasin = new Map<string, ItemReception[]>()
  const ignorees: LigneIgnoree[] = []
  for (const ligne of lignes) {
    const warehouseId = storeIdVersWarehouse.get(ligne.storeId)
    if (warehouseId === undefined) {
      throw new Error(`Magasin Supabase ${ligne.storeId} sans warehouse cible`)
    }
    const variantId = skuVersVariante.get(ligne.sku)
    if (variantId === undefined) {
      ignorees.push({ sku: ligne.sku, raison: "sku_absent" })
      continue
    }
    const item: ItemReception = {
      variantId,
      quantity: ligne.quantity,
      unitCost: Math.round(ligne.cost ?? 0),
    }
    const liste = itemsParMagasin.get(warehouseId) ?? []
    liste.push(item)
    itemsParMagasin.set(warehouseId, liste)
  }
  return { itemsParMagasin, ignorees }
}

export function chunk<T>(items: T[], taille: number): T[][] {
  const lots: T[][] = []
  for (let i = 0; i < items.length; i += taille) {
    lots.push(items.slice(i, i + taille))
  }
  return lots
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test inventaire.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/import-produits-supabase/inventaire.ts scripts/import-produits-supabase/inventaire.test.ts
git commit -m "feat(import): mapping et chunking de l'inventaire par magasin"
```

---

### Task 6: Script `semer-inventaire.ts`

**Files:**
- Create: `scripts/import-produits-supabase/semer-inventaire.ts`

**Interfaces:**
- Consumes: `lireInventaire` (Task 1), `chargerJson`/`ecrireJsonAtomique` (Task 2), `JournalMagasins` (Task 4, dupliquer l'interface localement ou l'importer depuis un module partagé — ici la relire depuis le fichier journal `--journal-magasins`), `carteSkuVariante`/`mapperInventaire`/`chunk` (Task 5), `lireStores` (Task 1), `connecter`/`requeteJson` (`http-client.ts`).

**Behaviour :** CLI args `--api-url`, `--web-origin`, `--journal-magasins` (défaut `data/magasins-local.json`), `--journal` (défaut `data/inventaire-local.json`), `--projet`, `--taille-lot` (défaut `100`), `--dry-run`. Auth env comme `run.ts`.

Logique :
1. Charger `JournalMagasins` (échec clair si absent → il faut créer les magasins d'abord). Construire `storeId → warehouseId` : lire `stores` Supabase (`storeId→name`) puis `name→warehouseId` via le journal.
2. `GET /products?page=&limite=200` en boucle jusqu'à couvrir `total` → `carteSkuVariante`.
3. `mapperInventaire` → `itemsParMagasin` + `ignorees`.
4. Charger le journal inventaire : `Record<warehouseId, number>` = nombre de chunks déjà validés pour ce magasin (reprise).
5. Pour chaque `(warehouseId, items)` : `chunk(items, tailleLot)` ; pour chaque chunk d'index `k` ≥ chunks déjà faits : `POST /purchases {warehouseId, supplierId, reference:"Stock initial Supabase (lot k+1)"}` → `POST /purchases/:id/items` par item → `POST /purchases/:id/receive` ; à la réussite du `receive`, incrémenter le compteur du magasin dans le journal (écriture atomique). Sur item 404 `INTROUVABLE` (variante), abandonner le chunk avec message clair.
6. Rapport final : par magasin — items semés, quantité totale, nb réceptions ; total lignes ignorées (SKU absent).

- [ ] **Step 1: Écrire le script** (couvert par l'E2E local Task 7 ; pas de test unitaire d'orchestration)

Implémenter en entier selon la logique 1→6 ci-dessus, en réutilisant le pattern `lireOptions`/`obtenirClient` de `run.ts`. `--dry-run` : n'appelle aucun POST, imprime le plan (nb chunks/items par magasin, lignes ignorées).

- [ ] **Step 2: Typecheck**

Run: `cd scripts/import-produits-supabase && bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Dry-run**

Run: `bun run semer-inventaire.ts --dry-run`
Expected (après magasins+catalogue en place localement) : plan par magasin, lignes ignorées listées, aucune écriture.

- [ ] **Step 4: Commit**

```bash
git add scripts/import-produits-supabase/semer-inventaire.ts
git commit -m "feat(import): script de peuplement de l'inventaire par réceptions valorisées"
```

---

### Task 7: Validation E2E locale + README

**Files:**
- Modify: `scripts/import-produits-supabase/README.md`

**Préalables locaux :** API dev sur `http://localhost:8787` avec les 720 produits déjà importés (état actuel). Si le catalogue local a été purgé, relancer `run.ts` d'abord.

- [ ] **Step 1: Créer les magasins en local**

Run:
```bash
cd scripts/import-produits-supabase
IMPORT_EMAIL='owner@exemple.com' IMPORT_PASSWORD='OwnerLocal!2026' \
  bun run creer-magasins.ts --journal data/magasins-local.json
```
Expected : 3 magasins créés (ou réutilisés), 1 fournisseur. `GET /warehouses` en montre 3.

- [ ] **Step 2: Semer l'inventaire en local**

Run:
```bash
IMPORT_EMAIL='owner@exemple.com' IMPORT_PASSWORD='OwnerLocal!2026' \
  bun run semer-inventaire.ts --journal-magasins data/magasins-local.json --journal data/inventaire-local.json
```
Expected : réceptions validées ; rapport par magasin.

- [ ] **Step 2b: Vérifier reprise/idempotence**

Re-lancer la commande du Step 2 : aucune nouvelle réception (tous les chunks déjà faits), rapport identique.

- [ ] **Step 3: Vérifier stock + CMP contre Supabase**

Choisir 2-3 SKU présents dans l'inventaire Supabase (via `supabase db query --linked`), récupérer leur `productId` local (`GET /products?recherche=<sku>`), puis vérifier via l'UI stock ou `GET /stock/levels` que la quantité = `product_inventory.quantity` et le CMP = `Math.round(cost)`. Valeurs **recalculées à la main**, jamais dérivées de la sortie du script.

- [ ] **Step 4: Mettre à jour le README**

Documenter les 2 nouveaux scripts, leurs options, l'ordre d'exécution (magasins → catalogue → inventaire), les env vars, et la note prod (lancer via `!`, `--web-origin` = domaine web prod, `--journal*` dédiés prod).

- [ ] **Step 5: Commit**

```bash
git add scripts/import-produits-supabase/README.md
git commit -m "docs(import): guide magasins + inventaire, validation E2E locale"
```

---

## Notes d'exécution prod (après validation locale)

Ordre, lancé par l'utilisateur via `!` avec identifiants owner prod (jamais en chat), `--api-url https://pos-stocks-api.koffiz2110.workers.dev`, `--web-origin https://pos-stocks-web.koffiz2110.workers.dev`, journaux dédiés `*-prod.json` :
1. `creer-magasins.ts --journal data/magasins-prod.json`
2. `run.ts --progression data/progress-prod.json` (catalogue)
3. `semer-inventaire.ts --journal-magasins data/magasins-prod.json --journal data/inventaire-prod.json`
