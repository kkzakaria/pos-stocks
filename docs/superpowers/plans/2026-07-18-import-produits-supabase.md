# Import du catalogue produits Supabase — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Écrire un script Bun/TS ponctuel qui importe les 744 produits d'un ancien backend Supabase (déjà exportés en snapshot JSON local) dans pos-stocks, via les vrais endpoints HTTP de l'API (`POST /categories`, `POST /products`, `POST /products/:id/image`), avec reprise sur erreur.

**Architecture:** Package Bun autonome `scripts/import-produits-supabase/`, hors de `apps/api` et `apps/web` pour ne jamais être ramassé par leurs configurations vitest respectives. Modules purs et testés (mapping, progression, concurrence, conversion d'image, parsing du cookie de session) + un script d'orchestration `run.ts` non testé automatiquement (dépend du réseau et d'un serveur `wrangler dev` vivant) mais vérifié manuellement en local avant tout rejeu en prod.

**Tech Stack:** Bun (runtime + `bun:test`), TypeScript, `sharp` (conversion AVIF → WebP), `shared` (schémas Zod `productCreateSchema`/`categoryCreateSchema` du monorepo), `fetch`/`FormData` natifs (pas de client HTTP tiers).

## Global Constraints

- Référence design : `docs/superpowers/specs/2026-07-18-import-produits-supabase-design.md`.
- Le script est un import **catalogue uniquement** : nom, description, prix, prix plancher, seuil de stock, image, catégorie. **Jamais** de stock/quantité/CMP (`stockService.applyMovements` reste l'unique point d'écriture de stock — hors périmètre ici, aucun code de ce plan n'y touche).
- `apps/api/vitest.config.ts` est **intouchable** et son test runner (`vitest run`) ramasse par défaut tout `*.test.ts` sous `apps/api/`, en l'exécutant dans le sandbox `workerd` — qui ne peut pas charger le binaire natif de `sharp`. **Aucun fichier de ce plan ne doit être créé sous `apps/api/` ou `apps/web/`.**
- Tous les tests de ce plan tournent avec `bun test` (le test runner intégré de Bun), jamais `vitest`.
- Commentaires de code en anglais, noms de variables/fonctions en français si le fichier suit déjà cette convention locale (le reste du repo mélange : ici on garde le français pour rester cohérent avec `apps/api/src`, cf. CLAUDE.md — langue des commentaires/JSDoc en anglais, mais le repo existant a des identifiants en français ; ce plan suit le même style que `apps/api/src/routes/*.ts`).
- Aucun identifiant Supabase (mot de passe, service key, connection string) dans le script : le snapshot `scripts/import-produits-supabase/data/produits-supabase.json` est déjà exporté et figé (744 lignes, vérifié : SKU tous uniques, noms non vides, 2 `image_url` nulles, catégories déjà étiquetées par mots-clés).
- Identifiants du compte propriétaire cible (local ou prod) : jamais en argument CLI (visible dans l'historique shell/process list), toujours via les variables d'environnement `IMPORT_EMAIL` / `IMPORT_PASSWORD`.

---

## État déjà en place (avant Task 1)

Ces changements ont déjà été appliqués dans le worktree pendant le brainstorming — Task 1 les vérifie plutôt que de les refaire :
- `scripts/import-produits-supabase/data/produits-supabase.json` existe (744 produits, catégorie incluse).
- Racine `.gitignore` contient `scripts/import-produits-supabase/data/`.
- Racine `package.json` → `"workspaces": ["apps/*", "packages/*", "scripts/*"]`.

---

### Task 1: Scaffold du package + chargeur/validateur de snapshot

**Files:**
- Create: `scripts/import-produits-supabase/package.json`
- Create: `scripts/import-produits-supabase/tsconfig.json`
- Create: `scripts/import-produits-supabase/snapshot.ts`
- Test: `scripts/import-produits-supabase/snapshot.test.ts`

**Interfaces:**
- Produces: `produitSourceSchema` (Zod), `type ProduitSource`, `chargerSnapshot(cheminFichier: string): ProduitSource[]` — utilisés par toutes les tâches suivantes.

- [ ] **Step 1: Vérifier l'état préalable**

```bash
test -f scripts/import-produits-supabase/data/produits-supabase.json && echo OK
grep -q 'scripts/import-produits-supabase/data/' .gitignore && echo OK
grep -q '"scripts/\*"' package.json && echo OK
```
Expected: trois `OK`. Si l'un manque, le recréer avant de continuer (voir section « État déjà en place »).

- [ ] **Step 2: Créer `scripts/import-produits-supabase/package.json`**

```json
{
  "name": "import-produits-supabase",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "import": "bun run run.ts"
  },
  "dependencies": {
    "shared": "workspace:*",
    "sharp": "^0.35.3"
  },
  "devDependencies": {
    "@types/bun": "^1.3.0",
    "typescript": "^5.9.0"
  }
}
```

- [ ] **Step 3: Créer `scripts/import-produits-supabase/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["bun-types"]
  },
  "include": ["*.ts"]
}
```

- [ ] **Step 4: Installer les dépendances depuis la racine du monorepo**

```bash
bun install
```
Expected: `sharp` et `@types/bun` apparaissent dans `bun.lock` ; `node_modules/shared` est un lien vers `packages/shared` accessible depuis `scripts/import-produits-supabase/node_modules/shared` (workspace bun).

- [ ] **Step 5: Écrire le test (échoue d'abord, le module n'existe pas encore)**

Create `scripts/import-produits-supabase/snapshot.test.ts`:

```ts
import { describe, test, expect } from "bun:test"
import { writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { chargerSnapshot } from "./snapshot"

const LIGNE_VALIDE = {
  id: "a1",
  sku: "SKU-1",
  name: "Produit 1",
  description: null,
  price: 1000,
  min_price: null,
  max_price: null,
  min_stock_level: 5,
  image_url: null,
  is_active: true,
  category: "Divers / à classer",
}

function ecrireSnapshotTemporaire(produits: unknown[]): string {
  const dossier = mkdtempSync(path.join(tmpdir(), "snapshot-test-"))
  const fichier = path.join(dossier, "produits.json")
  writeFileSync(fichier, JSON.stringify(produits))
  return fichier
}

describe("chargerSnapshot", () => {
  test("charge un snapshot valide", () => {
    const fichier = ecrireSnapshotTemporaire([LIGNE_VALIDE])
    const produits = chargerSnapshot(fichier)
    expect(produits).toHaveLength(1)
    expect(produits[0]?.sku).toBe("SKU-1")
  })

  test("rejette un SKU dupliqué", () => {
    const fichier = ecrireSnapshotTemporaire([LIGNE_VALIDE, { ...LIGNE_VALIDE, id: "a2" }])
    expect(() => chargerSnapshot(fichier)).toThrow("SKU dupliqué")
  })

  test("rejette une ligne invalide (prix manquant)", () => {
    const fichier = ecrireSnapshotTemporaire([{ id: "a1", sku: "SKU-1", name: "x" }])
    expect(() => chargerSnapshot(fichier)).toThrow()
  })

  test("charge le vrai snapshot exporté (744 produits)", () => {
    const cheminReel = path.join(import.meta.dir, "data", "produits-supabase.json")
    const produits = chargerSnapshot(cheminReel)
    expect(produits).toHaveLength(744)
  })
})
```

- [ ] **Step 6: Lancer les tests pour vérifier l'échec**

```bash
cd scripts/import-produits-supabase && bun test snapshot.test.ts
```
Expected: FAIL — `Cannot find module './snapshot'` (le fichier n'existe pas encore).

- [ ] **Step 7: Implémenter `scripts/import-produits-supabase/snapshot.ts`**

```ts
import { readFileSync } from "node:fs"
import { z } from "zod"

export const produitSourceSchema = z.object({
  id: z.string().min(1),
  sku: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).nullable(),
  price: z.number(),
  min_price: z.number().nullable(),
  max_price: z.number().nullable(),
  min_stock_level: z.number().nullable(),
  image_url: z.string().min(1).nullable(),
  is_active: z.boolean(),
  category: z.string().min(1),
})

export type ProduitSource = z.infer<typeof produitSourceSchema>

export function chargerSnapshot(cheminFichier: string): ProduitSource[] {
  const contenu = readFileSync(cheminFichier, "utf-8")
  const brut: unknown = JSON.parse(contenu)
  const produits = z.array(produitSourceSchema).parse(brut)

  const skusVus = new Set<string>()
  for (const produit of produits) {
    if (skusVus.has(produit.sku)) {
      throw new Error(`SKU dupliqué dans le snapshot : ${produit.sku}`)
    }
    skusVus.add(produit.sku)
  }

  return produits
}
```

- [ ] **Step 8: Lancer les tests pour vérifier le succès**

```bash
cd scripts/import-produits-supabase && bun test snapshot.test.ts
```
Expected: `4 pass, 0 fail`.

- [ ] **Step 9: Typecheck**

```bash
cd scripts/import-produits-supabase && bun run typecheck
```
Expected: exit code 0, aucune erreur.

- [ ] **Step 10: Commit**

```bash
git add scripts/import-produits-supabase/package.json scripts/import-produits-supabase/tsconfig.json \
  scripts/import-produits-supabase/snapshot.ts scripts/import-produits-supabase/snapshot.test.ts \
  package.json bun.lock .gitignore
git commit -m "feat(import): scaffold du package + chargeur de snapshot validé"
```

---

### Task 2: Mapping snapshot → payload API cible

**Files:**
- Create: `scripts/import-produits-supabase/mapping.ts`
- Test: `scripts/import-produits-supabase/mapping.test.ts`

**Interfaces:**
- Consumes: `type ProduitSource` (Task 1).
- Produces: `construireProduitCible(source: ProduitSource, categoryId: string): ProductCreateInput`, `extraireNomsCategories(produits: ProduitSource[]): string[]` — utilisés par Task 7 (`run.ts`).

- [ ] **Step 1: Écrire le test (échoue d'abord)**

Create `scripts/import-produits-supabase/mapping.test.ts`:

```ts
import { describe, test, expect } from "bun:test"
import { construireProduitCible, extraireNomsCategories } from "./mapping"
import type { ProduitSource } from "./snapshot"

function produit(overrides: Partial<ProduitSource> = {}): ProduitSource {
  return {
    id: "a1",
    sku: "SKU-1",
    name: "Produit test",
    description: null,
    price: 1000,
    min_price: null,
    max_price: null,
    min_stock_level: 5,
    image_url: null,
    is_active: true,
    category: "Divers / à classer",
    ...overrides,
  }
}

describe("construireProduitCible", () => {
  test("arrondit le prix et omet minPrice quand absent", () => {
    const resultat = construireProduitCible(produit({ price: 3500.3 }), "cat-1")
    expect(resultat.price).toBe(3500)
    expect(resultat.minPrice).toBeUndefined()
  })

  test("inclut minPrice arrondi quand strictement inférieur au prix", () => {
    const resultat = construireProduitCible(
      produit({ price: 5000, min_price: 4000.6 }),
      "cat-1"
    )
    expect(resultat.minPrice).toBe(4001)
  })

  test("omet minPrice quand égal au prix (prix fixe côté cible)", () => {
    const resultat = construireProduitCible(
      produit({ price: 2000, min_price: 2000 }),
      "cat-1"
    )
    expect(resultat.minPrice).toBeUndefined()
  })

  test("omet description quand nulle côté source", () => {
    const resultat = construireProduitCible(produit({ description: null }), "cat-1")
    expect(resultat.description).toBeUndefined()
  })

  test("conserve description quand présente", () => {
    const resultat = construireProduitCible(
      produit({ description: "Un vrai texte" }),
      "cat-1"
    )
    expect(resultat.description).toBe("Un vrai texte")
  })

  test("reporte categoryId, sku et defaultMinStock tels quels", () => {
    const resultat = construireProduitCible(
      produit({ sku: "PRD-1", min_stock_level: 12 }),
      "cat-42"
    )
    expect(resultat.categoryId).toBe("cat-42")
    expect(resultat.sku).toBe("PRD-1")
    expect(resultat.defaultMinStock).toBe(12)
  })

  test("rejette un prix invalide (0) via le schéma cible", () => {
    expect(() => construireProduitCible(produit({ price: 0 }), "cat-1")).toThrow()
  })
})

describe("extraireNomsCategories", () => {
  test("dédoublonne et trie les catégories", () => {
    const noms = extraireNomsCategories([
      produit({ category: "B" }),
      produit({ category: "A" }),
      produit({ category: "B" }),
    ])
    expect(noms).toEqual(["A", "B"])
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier l'échec**

```bash
cd scripts/import-produits-supabase && bun test mapping.test.ts
```
Expected: FAIL — `Cannot find module './mapping'`.

- [ ] **Step 3: Implémenter `scripts/import-produits-supabase/mapping.ts`**

```ts
import { productCreateSchema, type ProductCreateInput } from "shared"
import type { ProduitSource } from "./snapshot"

export function construireProduitCible(
  source: ProduitSource,
  categoryId: string
): ProductCreateInput {
  const prix = Math.round(source.price)
  const prixPlancherArrondi =
    source.min_price !== null ? Math.round(source.min_price) : null
  const minPrice =
    prixPlancherArrondi !== null && prixPlancherArrondi > 0 && prixPlancherArrondi < prix
      ? prixPlancherArrondi
      : undefined

  const payload: ProductCreateInput = {
    name: source.name,
    sku: source.sku,
    price: prix,
    categoryId,
    ...(source.description !== null ? { description: source.description } : {}),
    ...(minPrice !== undefined ? { minPrice } : {}),
    ...(source.min_stock_level !== null
      ? { defaultMinStock: source.min_stock_level }
      : {}),
  }

  // Valide contre le vrai schéma cible : une régression de mapping casse ce
  // test plutôt que d'échouer silencieusement (ou de manière confuse) côté
  // API pendant l'import réel des 744 produits.
  return productCreateSchema.parse(payload)
}

export function extraireNomsCategories(produits: ProduitSource[]): string[] {
  return [...new Set(produits.map((p) => p.category))].sort()
}
```

- [ ] **Step 4: Lancer les tests pour vérifier le succès**

```bash
cd scripts/import-produits-supabase && bun test mapping.test.ts
```
Expected: `8 pass, 0 fail`.

- [ ] **Step 5: Typecheck puis commit**

```bash
cd scripts/import-produits-supabase && bun run typecheck
git add scripts/import-produits-supabase/mapping.ts scripts/import-produits-supabase/mapping.test.ts
git commit -m "feat(import): mapping snapshot -> payload API produits/categories"
```

---

### Task 3: Journal de progression (reprise sur erreur)

**Files:**
- Create: `scripts/import-produits-supabase/progress.ts`
- Test: `scripts/import-produits-supabase/progress.test.ts`

**Interfaces:**
- Produces: `type StatutEntree`, `type EntreeProgression`, `type JournalProgression`, `chargerProgression(chemin: string): JournalProgression`, `enregistrerEntree(chemin: string, journal: JournalProgression, sourceId: string, entree: EntreeProgression): JournalProgression`, `dejaImporte(journal: JournalProgression, sourceId: string): boolean` — utilisés par Task 7.

- [ ] **Step 1: Écrire le test (échoue d'abord)**

Create `scripts/import-produits-supabase/progress.test.ts`:

```ts
import { describe, test, expect } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  chargerProgression,
  enregistrerEntree,
  dejaImporte,
  type JournalProgression,
} from "./progress"

function cheminTemporaire(): string {
  const dossier = mkdtempSync(path.join(tmpdir(), "progress-test-"))
  return path.join(dossier, "progress.json")
}

describe("progress", () => {
  test("retourne un journal vide si le fichier n'existe pas", () => {
    expect(chargerProgression(cheminTemporaire())).toEqual({})
  })

  test("enregistre puis relit une entrée", () => {
    const chemin = cheminTemporaire()
    let journal = chargerProgression(chemin)
    journal = enregistrerEntree(chemin, journal, "src-1", {
      statut: "produit_cree",
      productId: "p1",
      sku: "SKU-1",
    })
    const relu = chargerProgression(chemin)
    expect(relu["src-1"]).toEqual({
      statut: "produit_cree",
      productId: "p1",
      sku: "SKU-1",
    })
  })

  test("dejaImporte reconnaît produit_cree et image_ok, pas echec", () => {
    const journal: JournalProgression = {
      a: { statut: "produit_cree", sku: "A" },
      b: { statut: "image_ok", sku: "B" },
      c: { statut: "echec", sku: "C", erreur: "boom" },
    }
    expect(dejaImporte(journal, "a")).toBe(true)
    expect(dejaImporte(journal, "b")).toBe(true)
    expect(dejaImporte(journal, "c")).toBe(false)
    expect(dejaImporte(journal, "inconnu")).toBe(false)
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier l'échec**

```bash
cd scripts/import-produits-supabase && bun test progress.test.ts
```
Expected: FAIL — `Cannot find module './progress'`.

- [ ] **Step 3: Implémenter `scripts/import-produits-supabase/progress.ts`**

```ts
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"

export type StatutEntree = "produit_cree" | "image_ok" | "echec"

export interface EntreeProgression {
  statut: StatutEntree
  productId?: string
  sku: string
  erreur?: string
}

export type JournalProgression = Record<string, EntreeProgression>

export function chargerProgression(chemin: string): JournalProgression {
  if (!existsSync(chemin)) return {}
  return JSON.parse(readFileSync(chemin, "utf-8")) as JournalProgression
}

export function enregistrerEntree(
  chemin: string,
  journal: JournalProgression,
  sourceId: string,
  entree: EntreeProgression
): JournalProgression {
  const suivant = { ...journal, [sourceId]: entree }
  // Écriture atomique (fichier temporaire + rename) : une interruption du
  // script en plein milieu de l'écriture ne doit jamais corrompre le
  // journal sur lequel repose la reprise.
  const cheminTemp = `${chemin}.tmp`
  writeFileSync(cheminTemp, JSON.stringify(suivant, null, 2))
  renameSync(cheminTemp, chemin)
  return suivant
}

export function dejaImporte(journal: JournalProgression, sourceId: string): boolean {
  const entree = journal[sourceId] as EntreeProgression | undefined
  return entree?.statut === "produit_cree" || entree?.statut === "image_ok"
}
```

- [ ] **Step 4: Lancer les tests pour vérifier le succès**

```bash
cd scripts/import-produits-supabase && bun test progress.test.ts
```
Expected: `3 pass, 0 fail`.

- [ ] **Step 5: Typecheck puis commit**

```bash
cd scripts/import-produits-supabase && bun run typecheck
git add scripts/import-produits-supabase/progress.ts scripts/import-produits-supabase/progress.test.ts
git commit -m "feat(import): journal de progression pour reprise sur erreur"
```

---

### Task 4: Limiteur de concurrence

**Files:**
- Create: `scripts/import-produits-supabase/concurrency.ts`
- Test: `scripts/import-produits-supabase/concurrency.test.ts`

**Interfaces:**
- Produces: `executerAvecConcurrence<T>(items: T[], limite: number, tache: (item: T, index: number) => Promise<void>): Promise<void>` — utilisé par Task 7.

- [ ] **Step 1: Écrire le test (échoue d'abord)**

Create `scripts/import-produits-supabase/concurrency.test.ts`:

```ts
import { describe, test, expect } from "bun:test"
import { executerAvecConcurrence } from "./concurrency"

function attendre(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("executerAvecConcurrence", () => {
  test("traite tous les éléments exactement une fois", async () => {
    const traites: number[] = []
    await executerAvecConcurrence([1, 2, 3, 4, 5], 2, async (item) => {
      traites.push(item)
    })
    expect(traites.slice().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  test("ne dépasse jamais la limite de concurrence", async () => {
    let enCours = 0
    let maxObserve = 0
    await executerAvecConcurrence(
      Array.from({ length: 10 }, (_, i) => i),
      3,
      async () => {
        enCours += 1
        maxObserve = Math.max(maxObserve, enCours)
        await attendre(5)
        enCours -= 1
      }
    )
    expect(maxObserve).toBeLessThanOrEqual(3)
  })

  test("propage une erreur issue d'une tâche", async () => {
    await expect(
      executerAvecConcurrence([1, 2, 3], 2, async (item) => {
        if (item === 2) throw new Error("boom")
      })
    ).rejects.toThrow("boom")
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier l'échec**

```bash
cd scripts/import-produits-supabase && bun test concurrency.test.ts
```
Expected: FAIL — `Cannot find module './concurrency'`.

- [ ] **Step 3: Implémenter `scripts/import-produits-supabase/concurrency.ts`**

```ts
export async function executerAvecConcurrence<T>(
  items: T[],
  limite: number,
  tache: (item: T, index: number) => Promise<void>
): Promise<void> {
  let curseur = 0

  async function travailleur(): Promise<void> {
    while (curseur < items.length) {
      const index = curseur
      curseur += 1
      const item = items[index]
      await tache(item, index)
    }
  }

  const nbTravailleurs = Math.min(limite, items.length)
  const travailleurs = Array.from({ length: nbTravailleurs }, () => travailleur())
  await Promise.all(travailleurs)
}
```

- [ ] **Step 4: Lancer les tests pour vérifier le succès**

```bash
cd scripts/import-produits-supabase && bun test concurrency.test.ts
```
Expected: `3 pass, 0 fail`.

- [ ] **Step 5: Typecheck puis commit**

```bash
cd scripts/import-produits-supabase && bun run typecheck
git add scripts/import-produits-supabase/concurrency.ts scripts/import-produits-supabase/concurrency.test.ts
git commit -m "feat(import): limiteur de concurrence pour l'import"
```

---

### Task 5: Téléchargement + conversion d'image (AVIF → WebP)

**Files:**
- Create: `scripts/import-produits-supabase/image.ts`
- Test: `scripts/import-produits-supabase/image.test.ts`

**Interfaces:**
- Produces: `convertirEnWebp(entree: Buffer): Promise<Buffer>`, `interface ImageTelechargee { buffer: Buffer; contentType: "image/webp"; nomFichier: string }`, `telechargerEtConvertir(url: string, sourceId: string): Promise<ImageTelechargee | null>` — utilisé par Task 7.

- [ ] **Step 1: Écrire le test (échoue d'abord)**

Create `scripts/import-produits-supabase/image.test.ts`:

```ts
import { describe, test, expect } from "bun:test"
import sharp from "sharp"
import { convertirEnWebp } from "./image"

describe("convertirEnWebp", () => {
  test("convertit une image PNG en buffer WebP valide", async () => {
    const pngSource = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: { r: 200, g: 50, b: 10 },
      },
    })
      .png()
      .toBuffer()

    const webp = await convertirEnWebp(pngSource)

    expect(webp.subarray(0, 4).toString("ascii")).toBe("RIFF")
    expect(webp.subarray(8, 12).toString("ascii")).toBe("WEBP")
  })

  test("rejette un buffer qui n'est pas une image", async () => {
    await expect(convertirEnWebp(Buffer.from("pas une image"))).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier l'échec**

```bash
cd scripts/import-produits-supabase && bun test image.test.ts
```
Expected: FAIL — `Cannot find module './image'`.

- [ ] **Step 3: Implémenter `scripts/import-produits-supabase/image.ts`**

```ts
import sharp from "sharp"

const TAILLE_MAX_OCTETS = 2 * 1024 * 1024

export async function convertirEnWebp(entree: Buffer): Promise<Buffer> {
  return sharp(entree).webp({ quality: 82 }).toBuffer()
}

export interface ImageTelechargee {
  buffer: Buffer
  contentType: "image/webp"
  nomFichier: string
}

export async function telechargerEtConvertir(
  url: string,
  sourceId: string
): Promise<ImageTelechargee | null> {
  const reponse = await fetch(url)
  if (!reponse.ok) {
    console.warn(`image ${sourceId} : téléchargement échoué (${reponse.status})`)
    return null
  }

  const original = Buffer.from(await reponse.arrayBuffer())

  let webp: Buffer
  try {
    webp = await convertirEnWebp(original)
  } catch (err) {
    console.warn(`image ${sourceId} : conversion WebP échouée (${String(err)})`)
    return null
  }

  if (webp.byteLength > TAILLE_MAX_OCTETS) {
    console.warn(`image ${sourceId} : ${webp.byteLength} octets > limite de 2 Mo`)
    return null
  }

  return { buffer: webp, contentType: "image/webp", nomFichier: `${sourceId}.webp` }
}
```

- [ ] **Step 4: Lancer les tests pour vérifier le succès**

```bash
cd scripts/import-produits-supabase && bun test image.test.ts
```
Expected: `2 pass, 0 fail`.

- [ ] **Step 5: Typecheck puis commit**

```bash
cd scripts/import-produits-supabase && bun run typecheck
git add scripts/import-produits-supabase/image.ts scripts/import-produits-supabase/image.test.ts
git commit -m "feat(import): conversion AVIF/PNG -> WebP via sharp"
```

---

### Task 6: Client HTTP (session + requêtes JSON + upload multipart)

**Files:**
- Create: `scripts/import-produits-supabase/http-client.ts`
- Test: `scripts/import-produits-supabase/http-client.test.ts`

**Interfaces:**
- Produces: `analyserCookieSession(enteteSetCookie: string): string`, `interface ClientApi { baseUrl: string; cookie: string }`, `connecter(baseUrl: string, email: string, password: string): Promise<ClientApi>`, `requeteJson<T>(client: ClientApi, method: "GET" | "POST", chemin: string, corps?: unknown): Promise<{ status: number; donnees: T }>`, `televerserImage(client: ClientApi, productId: string, buffer: Buffer, nomFichier: string, contentType: string): Promise<{ status: number; donnees: { imageKey?: string; code?: string; message?: string } }>` — utilisés par Task 7.

- [ ] **Step 1: Écrire le test (échoue d'abord)**

Create `scripts/import-produits-supabase/http-client.test.ts`:

```ts
import { describe, test, expect } from "bun:test"
import { analyserCookieSession } from "./http-client"

describe("analyserCookieSession", () => {
  test("extrait le nom=valeur avant les attributs", () => {
    const entete = "better-auth.session_token=abc123; Path=/; HttpOnly; SameSite=Lax"
    expect(analyserCookieSession(entete)).toBe("better-auth.session_token=abc123")
  })

  test("gère un en-tête sans attribut supplémentaire", () => {
    expect(analyserCookieSession("session=xyz")).toBe("session=xyz")
  })

  test("lève une erreur sur un en-tête vide", () => {
    expect(() => analyserCookieSession("")).toThrow()
  })

  test("lève une erreur si aucun signe = n'est présent", () => {
    expect(() => analyserCookieSession("valeur-sans-egal")).toThrow()
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier l'échec**

```bash
cd scripts/import-produits-supabase && bun test http-client.test.ts
```
Expected: FAIL — `Cannot find module './http-client'`.

- [ ] **Step 3: Implémenter `scripts/import-produits-supabase/http-client.ts`**

```ts
export function analyserCookieSession(enteteSetCookie: string): string {
  // Ne garder que le nom=valeur (avant le premier `;` de chaque paire, et
  // avant la première `,` s'il y a plusieurs cookies posés) : Path,
  // HttpOnly, SameSite… ne doivent pas être renvoyés dans `Cookie`.
  const pairePart = enteteSetCookie.split(",")[0].split(";")[0].trim()
  if (!pairePart.includes("=")) {
    throw new Error(`En-tête Set-Cookie inattendu : ${enteteSetCookie}`)
  }
  return pairePart
}

export interface ClientApi {
  baseUrl: string
  cookie: string
}

export async function connecter(
  baseUrl: string,
  email: string,
  password: string
): Promise<ClientApi> {
  const reponse = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Le seul WEB_ORIGIN de confiance en dev local (auth.ts trustedOrigins).
      origin: "http://localhost:3000",
    },
    body: JSON.stringify({ email, password }),
  })
  if (!reponse.ok) {
    throw new Error(`Échec de connexion (${reponse.status}) : ${await reponse.text()}`)
  }
  const enteteSetCookie = reponse.headers.get("set-cookie")
  if (enteteSetCookie === null) {
    throw new Error("Aucun cookie de session reçu à la connexion")
  }
  return { baseUrl, cookie: analyserCookieSession(enteteSetCookie) }
}

export async function requeteJson<T>(
  client: ClientApi,
  method: "GET" | "POST",
  chemin: string,
  corps?: unknown
): Promise<{ status: number; donnees: T }> {
  const reponse = await fetch(`${client.baseUrl}${chemin}`, {
    method,
    headers: {
      "content-type": "application/json",
      cookie: client.cookie,
    },
    body: corps !== undefined ? JSON.stringify(corps) : undefined,
  })
  const donnees = (await reponse.json()) as T
  return { status: reponse.status, donnees }
}

export async function televerserImage(
  client: ClientApi,
  productId: string,
  buffer: Buffer,
  nomFichier: string,
  contentType: string
): Promise<{
  status: number
  donnees: { imageKey?: string; code?: string; message?: string }
}> {
  const formulaire = new FormData()
  formulaire.append(
    "image",
    new Blob([new Uint8Array(buffer)], { type: contentType }),
    nomFichier
  )
  const reponse = await fetch(`${client.baseUrl}/api/v1/products/${productId}/image`, {
    method: "POST",
    headers: { cookie: client.cookie },
    body: formulaire,
  })
  const donnees = (await reponse.json()) as {
    imageKey?: string
    code?: string
    message?: string
  }
  return { status: reponse.status, donnees }
}
```

- [ ] **Step 4: Lancer les tests pour vérifier le succès**

```bash
cd scripts/import-produits-supabase && bun test http-client.test.ts
```
Expected: `4 pass, 0 fail`.

- [ ] **Step 5: Typecheck puis commit**

```bash
cd scripts/import-produits-supabase && bun run typecheck
git add scripts/import-produits-supabase/http-client.ts scripts/import-produits-supabase/http-client.test.ts
git commit -m "feat(import): client HTTP (session cookie, requêtes JSON, upload image)"
```

---

### Task 7: Orchestration (`run.ts`) + vérification manuelle locale

**Files:**
- Create: `scripts/import-produits-supabase/run.ts`
- Create: `scripts/import-produits-supabase/README.md`

**Interfaces:**
- Consumes: tout ce qui précède — `chargerSnapshot`/`ProduitSource` (Task 1), `construireProduitCible`/`extraireNomsCategories` (Task 2), `chargerProgression`/`enregistrerEntree`/`dejaImporte`/`JournalProgression`/`EntreeProgression` (Task 3), `executerAvecConcurrence` (Task 4), `telechargerEtConvertir` (Task 5), `connecter`/`requeteJson`/`televerserImage`/`ClientApi` (Task 6), `type CategoryCreateInput` (`shared`).
- Produces: point d'entrée CLI exécutable (`bun run run.ts`), pas de nouvelle interface consommée ailleurs.

Cette tâche n'a pas de test automatisé unitaire (elle orchestre du réseau contre un serveur `wrangler dev` vivant et un compte réel — hors périmètre des tests automatisés selon la spec §7). Elle se termine par une vérification manuelle documentée aux steps 3 et 4.

- [ ] **Step 1: Implémenter `scripts/import-produits-supabase/run.ts`**

```ts
import { parseArgs } from "node:util"
import path from "node:path"
import type { CategoryCreateInput } from "shared"
import { chargerSnapshot, type ProduitSource } from "./snapshot"
import { construireProduitCible, extraireNomsCategories } from "./mapping"
import {
  chargerProgression,
  enregistrerEntree,
  dejaImporte,
  type EntreeProgression,
  type JournalProgression,
} from "./progress"
import { executerAvecConcurrence } from "./concurrency"
import { telechargerEtConvertir } from "./image"
import { connecter, requeteJson, televerserImage, type ClientApi } from "./http-client"

interface OptionsCli {
  apiUrl: string
  snapshot: string
  progression: string
  concurrence: number
  dryRun: boolean
}

function lireOptions(argv: string[]): OptionsCli {
  const { values } = parseArgs({
    args: argv,
    options: {
      "api-url": { type: "string", default: "http://localhost:8787" },
      snapshot: {
        type: "string",
        default: path.join(import.meta.dir, "data", "produits-supabase.json"),
      },
      progression: {
        type: "string",
        default: path.join(import.meta.dir, "data", "progress.json"),
      },
      concurrence: { type: "string", default: "5" },
      "dry-run": { type: "boolean", default: false },
    },
  })
  return {
    apiUrl: values["api-url"] as string,
    snapshot: values.snapshot as string,
    progression: values.progression as string,
    concurrence: Number(values.concurrence),
    dryRun: values["dry-run"] as boolean,
  }
}

async function obtenirClient(options: OptionsCli): Promise<ClientApi> {
  if (options.dryRun) {
    return { baseUrl: options.apiUrl, cookie: "" }
  }
  const email = process.env.IMPORT_EMAIL
  const password = process.env.IMPORT_PASSWORD
  if (!email || !password) {
    throw new Error(
      "Variables d'environnement IMPORT_EMAIL et IMPORT_PASSWORD requises (sauf en --dry-run)"
    )
  }
  return connecter(options.apiUrl, email, password)
}

function creerJournal(cheminProgression: string, etatInitial: JournalProgression) {
  let etat = etatInitial
  return {
    dejaImporte: (sourceId: string): boolean => dejaImporte(etat, sourceId),
    marquer: (sourceId: string, entree: EntreeProgression): void => {
      etat = enregistrerEntree(cheminProgression, etat, sourceId, entree)
    },
  }
}

async function assurerCategories(
  client: ClientApi,
  noms: string[],
  dryRun: boolean
): Promise<Map<string, string>> {
  if (dryRun) {
    const carte = new Map<string, string>()
    for (const nom of noms) {
      console.log(`[dry-run] créerait (ou réutiliserait) la catégorie « ${nom} »`)
      carte.set(nom, `dry-run-${nom}`)
    }
    return carte
  }

  const { donnees } = await requeteJson<{
    categories: Array<{ id: string; name: string }>
  }>(client, "GET", "/api/v1/categories")
  const parNom = new Map(donnees.categories.map((c) => [c.name, c.id]))

  for (const nom of noms) {
    if (parNom.has(nom)) continue
    const payload: CategoryCreateInput = { name: nom }
    const reponse = await requeteJson<{ id: string; code?: string }>(
      client,
      "POST",
      "/api/v1/categories",
      payload
    )
    if (reponse.status === 201) {
      parNom.set(nom, reponse.donnees.id)
      console.log(`catégorie créée : ${nom}`)
      continue
    }
    if (reponse.status === 409 && reponse.donnees.code === "NOM_EXISTANT") {
      const relecture = await requeteJson<{
        categories: Array<{ id: string; name: string }>
      }>(client, "GET", "/api/v1/categories")
      const trouvee = relecture.donnees.categories.find((c) => c.name === nom)
      if (!trouvee) {
        throw new Error(
          `Catégorie « ${nom} » en conflit mais introuvable à la relecture`
        )
      }
      parNom.set(nom, trouvee.id)
      continue
    }
    throw new Error(
      `Échec de création de la catégorie « ${nom} » (${reponse.status}) : ${JSON.stringify(reponse.donnees)}`
    )
  }
  return parNom
}

interface Rapport {
  crees: number
  imagesOk: number
  imagesEchouees: number
  echecs: Array<{ sku: string; erreur: string }>
}

async function importerUnProduit(
  client: ClientApi,
  source: ProduitSource,
  categorieId: string,
  journal: ReturnType<typeof creerJournal>,
  rapport: Rapport,
  dryRun: boolean
): Promise<void> {
  if (journal.dejaImporte(source.id)) return

  const payload = construireProduitCible(source, categorieId)

  if (dryRun) {
    console.log(`[dry-run] créerait le produit ${payload.sku} — ${payload.name}`)
    rapport.crees += 1
    return
  }

  const creation = await requeteJson<{
    id: string
    sku: string
    code?: string
    message?: string
  }>(client, "POST", "/api/v1/products", payload)

  if (creation.status !== 201) {
    const erreur = `${creation.status} ${creation.donnees.code ?? ""} ${creation.donnees.message ?? ""}`.trim()
    journal.marquer(source.id, { statut: "echec", sku: source.sku, erreur })
    rapport.echecs.push({ sku: source.sku, erreur })
    return
  }

  const productId = creation.donnees.id
  journal.marquer(source.id, { statut: "produit_cree", productId, sku: source.sku })
  rapport.crees += 1

  if (source.image_url === null) return

  const image = await telechargerEtConvertir(source.image_url, source.id)
  if (image === null) {
    rapport.imagesEchouees += 1
    return
  }

  const televersement = await televerserImage(
    client,
    productId,
    image.buffer,
    image.nomFichier,
    image.contentType
  )
  if (televersement.status === 200) {
    journal.marquer(source.id, { statut: "image_ok", productId, sku: source.sku })
    rapport.imagesOk += 1
  } else {
    rapport.imagesEchouees += 1
    console.warn(
      `image ${source.sku} : échec du téléversement (${televersement.status}) ${JSON.stringify(televersement.donnees)}`
    )
  }
}

async function main(): Promise<void> {
  const options = lireOptions(process.argv.slice(2))

  const produits = chargerSnapshot(options.snapshot)
  console.log(`${produits.length} produits chargés depuis ${options.snapshot}`)

  const client = await obtenirClient(options)

  const noms = extraireNomsCategories(produits)
  const categoriesParNom = await assurerCategories(client, noms, options.dryRun)

  const journal = creerJournal(
    options.progression,
    chargerProgression(options.progression)
  )
  const rapport: Rapport = { crees: 0, imagesOk: 0, imagesEchouees: 0, echecs: [] }

  await executerAvecConcurrence(produits, options.concurrence, async (source) => {
    const categorieId = categoriesParNom.get(source.category)
    if (categorieId === undefined) {
      rapport.echecs.push({
        sku: source.sku,
        erreur: `Catégorie « ${source.category} » non résolue`,
      })
      return
    }
    try {
      await importerUnProduit(
        client,
        source,
        categorieId,
        journal,
        rapport,
        options.dryRun
      )
    } catch (err) {
      rapport.echecs.push({ sku: source.sku, erreur: String(err) })
    }
  })

  console.log("\n--- Rapport ---")
  console.log(`Produits créés : ${rapport.crees}`)
  console.log(`Images téléversées : ${rapport.imagesOk}`)
  console.log(`Images en échec : ${rapport.imagesEchouees}`)
  console.log(`Échecs produit : ${rapport.echecs.length}`)
  for (const echec of rapport.echecs) {
    console.log(`  - ${echec.sku} : ${echec.erreur}`)
  }
}

await main()
```

- [ ] **Step 2: Typecheck**

```bash
cd scripts/import-produits-supabase && bun run typecheck
```
Expected: exit code 0, aucune erreur (types `shared`, `bun-types`, tous les modules précédents résolus).

- [ ] **Step 3: Dry-run contre une URL factice (pas de serveur requis)**

```bash
cd scripts/import-produits-supabase && bun run run.ts --dry-run --api-url http://localhost:9 --concurrence 8
```
Expected: aucune erreur réseau (le `--dry-run` court-circuite tout `fetch`), la sortie liste ~13 lignes `[dry-run] créerait (ou réutiliserait) la catégorie…` puis 744 lignes `[dry-run] créerait le produit…`, et le rapport final affiche `Produits créés : 744`, `Échecs produit : 0`.

- [ ] **Step 4: Run réel contre la D1 locale de dev**

Prérequis : `bun run --cwd apps/api dev` tourne dans un autre terminal (sert sur `http://localhost:8787`), et le compte owner local existe déjà (`owner@exemple.com`, cf. CLAUDE.md — sinon appeler `POST /api/v1/setup` d'abord, voir `apps/api/test/helpers.ts` pour le corps exact de la requête).

```bash
cd scripts/import-produits-supabase
IMPORT_EMAIL=owner@exemple.com IMPORT_PASSWORD='OwnerLocal!2026' bun run run.ts
```
Expected: le rapport final affiche `Produits créés : 744` (ou moins si des erreurs sont journalisées — les examiner une à une dans la sortie), `Images téléversées :` proche de 742 (les 2 produits sans `image_url` n'en ont pas). Vérifier ensuite manuellement dans l'app locale (`bun run --cwd apps/web dev`, se connecter avec le compte owner) : la liste des catégories affiche les ~13 catégories attendues, quelques produits au hasard ont bien leur image et leur prix.

- [ ] **Step 5: Vérifier la reprise (relance idempotente)**

```bash
cd scripts/import-produits-supabase
IMPORT_EMAIL=owner@exemple.com IMPORT_PASSWORD='OwnerLocal!2026' bun run run.ts
```
Expected: le rapport final affiche `Produits créés : 0` (tous les `sourceId` sont déjà marqués `produit_cree`/`image_ok` dans `data/progress.json`, donc `journal.dejaImporte` les saute) — confirme que relancer le script après une interruption ne recrée pas de doublons.

- [ ] **Step 6: Créer `scripts/import-produits-supabase/README.md`**

```md
# Import du catalogue Supabase vers pos-stocks

Script ponctuel — voir `docs/superpowers/specs/2026-07-18-import-produits-supabase-design.md`
pour le contexte complet (mapping des champs, classification en catégories,
périmètre exclu).

## Prérequis

- `data/produits-supabase.json` présent (snapshot déjà exporté, 744 produits).
- Un serveur pos-stocks API accessible (local `wrangler dev` ou prod).
- Un compte owner/admin/stock_manager sur l'organisation cible.

## Utilisation

```bash
cd scripts/import-produits-supabase

# 1. Aperçu sans aucun appel réseau
bun run run.ts --dry-run

# 2. Contre la D1 locale (par défaut http://localhost:8787)
IMPORT_EMAIL=owner@exemple.com IMPORT_PASSWORD='OwnerLocal!2026' bun run run.ts

# 3. Contre la prod, une fois le résultat local validé
IMPORT_EMAIL=<owner-prod> IMPORT_PASSWORD='<mot-de-passe-prod>' \
  bun run run.ts --api-url https://pos-stocks-api.koffiz2110.workers.dev \
  --progression data/progress-prod.json
```

Le script est **reprenable** : `data/progress.json` (ou le chemin passé à
`--progression`) journalise chaque produit importé ; une relance saute les
produits déjà créés au lieu d'échouer sur SKU dupliqué. Utiliser un fichier
de progression **différent** par environnement (local vs prod) — sinon la
relance en prod sauterait tout, croyant l'import déjà fait.

## Options

| Option | Défaut | Description |
|---|---|---|
| `--api-url` | `http://localhost:8787` | Base URL de l'API cible |
| `--snapshot` | `data/produits-supabase.json` | Chemin du snapshot source |
| `--progression` | `data/progress.json` | Chemin du journal de reprise |
| `--concurrence` | `5` | Nombre d'imports en parallèle |
| `--dry-run` | `false` | N'effectue aucun appel réseau, affiche ce qui serait fait |
```

- [ ] **Step 7: Commit**

```bash
git add scripts/import-produits-supabase/run.ts scripts/import-produits-supabase/README.md
git commit -m "feat(import): orchestration du script d'import + guide d'utilisation"
```

---

## Après ce plan

1. Revue de l'utilisateur sur le résultat du run local (Task 7, Step 4) — catégories, échantillon de produits, images.
2. Rejeu de `run.ts` contre la prod avec les identifiants prod (Task 7, README section 3), avec un `--progression` dédié.
3. Le catalogue source contenant ~307 produits en catégorie « Divers / à classer » (aucune règle de mots-clés fiable ne les couvre, cf. spec §3), un reclassement manuel ultérieur reste à faire dans l'app — hors périmètre de ce script.
