# Refonte fiche produit — Plan d'implémentation

> **Pour les agents :** SOUS-SKILL REQUIS — utiliser superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans pour exécuter ce plan tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`) pour le suivi.
>
> ## ⚠️ DOCUMENT DATÉ — NE PAS EXÉCUTER TEL QUEL
>
> Ce plan consigne l'état **avant exécution**. Il est conservé comme trace
> historique ; **le comportement livré fait foi**, pas ce document.

**Objectif :** Transformer `/catalogue/produits/$productId` en fiche « consulter d'abord » : synthèse chiffrée, stock par entrepôt (nouvel endpoint), identité à gauche, variantes avec lots imbriqués à droite, édition en place par section.

**Architecture :** Un endpoint API lecture seule `GET /products/:id/stock` filtré par `porteeLectureStock`/`filtrePortee` ; côté web, la page devient un assembleur (une requête produit + une requête stock) qui distribue à quatre sections : `SectionSynthese` et `SectionIdentite` (édition en place via PATCH partiel), `SectionStock` (présentationnelle), `SectionVariantes` (lots imbriqués — `section-lots.tsx` et `section-infos.tsx`/`section-image.tsx` disparaissent).

**Stack technique :** Hono 4 + Drizzle/D1 (tests intégration D1 réelle), React 19 + TanStack Query + Testing Library/jsdom, composants DS existants (Table, Combobox, Input, Badge).

**Spec de référence :** `docs/superpowers/specs/2026-07-22-fiche-produit-design.md`

## Contraintes globales

- UI et messages en **français** ; commentaires de code et JSDoc en **anglais** ; commits conventionnels en français, terminés par `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Enveloppe d'erreur API `{ code: "MAJUSCULES", message: "français" }` ; réutiliser `INTROUVABLE` (pas de nouveau code).
- Garde cross-tenant AVANT tout bypass de rôle ; `produitScope` pour résoudre le produit.
- Montants entiers XOF via `formaterMontant(x, devise)` ; chiffres `tabular-nums` ; assertions de montants dans les tests web via le helper regex `texteMontant` (espaces insécables U+202F).
- Lint : annoter `| null` les retours de lookups, types dans `import type` séparé, `<DialogTrigger render={…}>` jamais `asChild`.
- Aucune ombre portée ; profondeur par filet (`ring-1 ring-foreground/10`, `border`).
- Valeurs de test **recalculables à la main** — jamais dérivées de la sortie de l'implémentation.
- Tests API ciblés : `cd apps/api && bun run test -- <fichier>`. Tests web : `bun run --cwd apps/web test`. La suite complète locale peut saturer (workerd « Network connection lost ») : lancer les pushes avec `CI=1 git push` (mode `singleWorker`).
- Ne jamais éditer `apps/web/src/routeTree.gen.ts` ni `apps/api/src/db/schema/auth.ts`.

---

### Task 1 : API — `GET /api/v1/products/:id/stock`

**Fichiers :**
- Test (créer) : `apps/api/test/product-stock.test.ts`
- Modifier : `apps/api/src/routes/products.ts` (après le handler `GET /:id`, ~ligne 144)

**Interfaces :**
- Consomme : `produitScope(db, organizationId, id)` (`lib/org-scope.ts`), `porteeLectureStock(db, organizationId, userId, role)` et `filtrePortee(portee, colonne)` (`lib/stock-acces.ts`).
- Produit : réponse JSON `{ stock: Array<{ warehouseId: string; warehouseName: string; variantId: string; variantName: string; quantity: number; avgCost: number }> }`, triée entrepôt puis variante. La Task 6 (page web) consomme cette forme sous le nom `LigneStockProduit`.

- [ ] **Étape 1 : Écrire les tests (échec attendu)**

Créer `apps/api/test/product-stock.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import app from "../src/index"
import * as schema from "../src/db/schema"
import { applyMovements } from "../src/services/stock"
import {
  affecterEntrepot,
  bootstrapOwner,
  createUserWithRole,
  creerEntrepot,
  creerProduitSimple,
} from "./helpers"

function req(cookie: string, url: string) {
  return app.request(url, { headers: { cookie } }, env)
}

type LigneStock = {
  warehouseId: string
  warehouseName: string
  variantId: string
  variantName: string
  quantity: number
  avgCost: number
}
type Reponse = { stock: LigneStock[] }
type Erreur = { code: string }

// Seed : produit P en Dépôt (10 @ 200) et Boutique (4 @ 300) ; un produit
// tiers en Dépôt pour vérifier que la réponse est bien filtrée au produit.
async function seed() {
  const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
  const depotId = await creerEntrepot(organizationId, "Dépôt Central")
  const boutiqueId = await creerEntrepot(organizationId, "Boutique S", "store")
  const p = await creerProduitSimple(organizationId, { nom: "Article Stock" })
  const autre = await creerProduitSimple(organizationId, { nom: "Autre" })
  const db = drizzle(env.DB, { schema })
  await applyMovements(db, {
    organizationId,
    userId: ownerId,
    mouvements: [
      {
        warehouseId: depotId,
        variantId: p.variantId,
        delta: 10,
        type: "purchase",
        unitCost: 200,
      },
      {
        warehouseId: boutiqueId,
        variantId: p.variantId,
        delta: 4,
        type: "purchase",
        unitCost: 300,
      },
      {
        warehouseId: depotId,
        variantId: autre.variantId,
        delta: 7,
        type: "purchase",
        unitCost: 100,
      },
    ],
  })
  return { organizationId, ownerCookie, depotId, boutiqueId, p }
}

describe("GET /api/v1/products/:id/stock", () => {
  it("owner : toutes les lignes du produit, triées, CMP recalculable", async () => {
    const { ownerCookie, depotId, boutiqueId, p } = await seed()
    const res = await req(
      ownerCookie,
      `/api/v1/products/${p.productId}/stock`
    )
    expect(res.status).toBe(200)
    const body = await res.json<Reponse>()
    // Boutique S avant Dépôt Central (tri par nom d'entrepôt)
    expect(body.stock).toEqual([
      {
        warehouseId: boutiqueId,
        warehouseName: "Boutique S",
        variantId: p.variantId,
        variantName: "Standard",
        quantity: 4,
        avgCost: 300,
      },
      {
        warehouseId: depotId,
        warehouseName: "Dépôt Central",
        variantId: p.variantId,
        variantName: "Standard",
        quantity: 10,
        avgCost: 200,
      },
    ])
  })

  it("manager local : ne voit que SON entrepôt ; staff sans affectation : liste vide", async () => {
    const { organizationId, depotId, boutiqueId, p } = await seed()
    const manager = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, manager.userId, boutiqueId, "manager")
    const resManager = await req(
      manager.cookie,
      `/api/v1/products/${p.productId}/stock`
    )
    expect(resManager.status).toBe(200)
    const stockManager = (await resManager.json<Reponse>()).stock
    expect(stockManager).toHaveLength(1)
    expect(stockManager[0]?.warehouseId).toBe(boutiqueId)
    expect(stockManager.some((l) => l.warehouseId === depotId)).toBe(false)

    const sansAffectation = await createUserWithRole(organizationId, "staff")
    const resVide = await req(
      sansAffectation.cookie,
      `/api/v1/products/${p.productId}/stock`
    )
    expect(resVide.status).toBe(200)
    expect((await resVide.json<Reponse>()).stock).toEqual([])
  })

  it("cross-org : produit d'une autre organisation → 404 INTROUVABLE", async () => {
    const { p } = await seed()
    // Seconde organisation indépendante (bootstrapOwner réutilise le même
    // email : on crée l'orga via un owner dédié n'ayant PAS accès à p)
    const orgB = await bootstrapOwner()
    const res = await req(
      orgB.ownerCookie,
      `/api/v1/products/${p.productId}/stock`
    )
    expect(res.status).toBe(404)
    expect((await res.json<Erreur>()).code).toBe("INTROUVABLE")
  })
})
```

Note : si `bootstrapOwner()` refuse un second appel (setup déjà fait), suivre le motif du test cross-org existant — chercher `INTROUVABLE` dans `apps/api/test/products.test.ts` et copier sa façon de créer la seconde organisation ; adapter ce test en conséquence.

- [ ] **Étape 2 : Vérifier l'échec**

Run : `cd apps/api && bun run test -- test/product-stock.test.ts`
Attendu : FAIL — les trois tests reçoivent 404 (la route n'existe pas encore et Hono retombe sur `GET /:id` sans correspondance exacte) ou 500.

- [ ] **Étape 3 : Implémenter la route**

Dans `apps/api/src/routes/products.ts` :

Ajouter aux imports existants :

```ts
import { filtrePortee, porteeLectureStock } from "../lib/stock-acces"
```

Après le handler `productsRoute.get("/:id", …)` (il se termine vers la ligne 144), insérer :

```ts
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
```

`and`, `asc`, `eq` sont déjà importés en tête de fichier.

- [ ] **Étape 4 : Vérifier le passage**

Run : `cd apps/api && bun run test -- test/product-stock.test.ts`
Attendu : PASS (3 tests).

- [ ] **Étape 5 : Commit**

```bash
git add apps/api/test/product-stock.test.ts apps/api/src/routes/products.ts
git commit -m "feat(api): le stock d'un produit par entrepôt, borné à la portée du rôle"
```

---

### Task 2 : Web — `SectionSynthese` (bande de faits chiffrés, édition en place)

**Fichiers :**
- Créer : `apps/web/src/components/produit/section-synthese.tsx`
- Test (créer) : `apps/web/src/components/produit/section-synthese.test.tsx`

**Interfaces :**
- Consomme : `Produit` (`./types`), `formaterMontant` (`@/lib/format`), `apiFetch` (`@/lib/api`).
- Produit : `export function SectionSynthese(props: { produit: Produit; productId: string; peutEcrire: boolean; devise: string; stockTotal: number | null; onModifie: () => Promise<unknown> })`. `stockTotal: null` = pas de portée stock → le fait « Stock total » est omis. La Task 6 importe ce composant.

- [ ] **Étape 1 : Écrire les tests (échec attendu)**

Créer `apps/web/src/components/produit/section-synthese.test.tsx` :

```tsx
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { SectionSynthese } from "@/components/produit/section-synthese"
import { formaterMontant } from "@/lib/format"
import { apiFetch } from "@/lib/api"
import type { Produit } from "@/components/produit/types"

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(() => Promise.resolve({})),
  apiUrl: (chemin: string) => chemin,
}))

afterEach(() => vi.clearAllMocks())

// Amounts use narrow no-break spaces (U+202F): match via regex so Testing
// Library's normalizer applies to both sides (same motif as pos tests).
function texteMontant(montant: number): RegExp {
  const echappe = formaterMontant(montant)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+")
  return new RegExp(`^${echappe}$`)
}

const produit: Produit = {
  id: "p1",
  name: "Article",
  sku: "PRD-1",
  description: null,
  categoryId: null,
  barcode: null,
  price: 5000,
  minPrice: 4000,
  defaultMinStock: 10,
  isActive: true,
  trackLots: false,
  imageKey: null,
  variants: [],
}

function rendre(
  surcharges: Partial<Parameters<typeof SectionSynthese>[0]> = {}
) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SectionSynthese
        produit={produit}
        productId="p1"
        peutEcrire
        devise="XOF"
        stockTotal={14}
        onModifie={() => Promise.resolve()}
        {...surcharges}
      />
    </QueryClientProvider>
  )
}

describe("SectionSynthese", () => {
  it("affiche prix, plancher, seuil et stock total", () => {
    rendre()
    expect(screen.getByText(texteMontant(5000))).toBeTruthy()
    expect(screen.getByText(texteMontant(4000))).toBeTruthy()
    expect(screen.getByText("10")).toBeTruthy()
    expect(screen.getByText("14")).toBeTruthy()
  })

  it("omet le stock total sans portée (null) et masque Modifier sans écriture", () => {
    rendre({ stockTotal: null, peutEcrire: false })
    expect(screen.queryByText("Stock total")).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Modifier" })
    ).toBeNull()
  })

  it("édition en place : Modifier → PATCH partiel → onModifie", async () => {
    const onModifie = vi.fn(() => Promise.resolve())
    rendre({ onModifie })
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }))
    fireEvent.change(screen.getByLabelText("Prix de vente"), {
      target: { value: "6000" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }))
    await waitFor(() => expect(onModifie).toHaveBeenCalled())
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/products/p1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ price: 6000, minPrice: 4000, defaultMinStock: 10 }),
      })
    )
  })

  it("Annuler restaure l'affichage sans PATCH", () => {
    rendre()
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }))
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }))
    expect(apiFetch).not.toHaveBeenCalled()
    expect(screen.getByText(texteMontant(5000))).toBeTruthy()
  })
})
```

Si le type `Produit` de `./types` diffère (champs supplémentaires), compléter l'objet `produit` du test pour satisfaire le type — ne pas caster `as`.

- [ ] **Étape 2 : Vérifier l'échec**

Run : `bun run --cwd apps/web test -- section-synthese`
Attendu : FAIL — module `section-synthese` introuvable.

- [ ] **Étape 3 : Implémenter le composant**

Créer `apps/web/src/components/produit/section-synthese.tsx` :

```tsx
import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { formaterMontant } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Produit } from "./types"

type Props = {
  produit: Produit
  productId: string
  peutEcrire: boolean
  devise: string
  /** Sum of visible warehouse quantities; null = no stock reading scope. */
  stockTotal: number | null
  onModifie: () => Promise<unknown>
}

/** One dense fact of the summary line: pale label above a tabular figure. */
function Fait({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{libelle}</span>
      <span className="text-sm font-medium tabular-nums">{valeur}</span>
    </div>
  )
}

/**
 * Summary band: price, floor price, alert threshold and total stock as a
 * single dense line of figures (registre style, no KPI cards). "Modifier"
 * switches the three product numbers to inline inputs, saved via a
 * partial PATCH.
 */
export function SectionSynthese({
  produit,
  productId,
  peutEcrire,
  devise,
  stockTotal,
  onModifie,
}: Props) {
  const [edition, setEdition] = useState(false)
  const [prix, setPrix] = useState(String(produit.price))
  const [plancher, setPlancher] = useState(
    produit.minPrice === null ? "" : String(produit.minPrice)
  )
  const [seuil, setSeuil] = useState(
    produit.defaultMinStock === null ? "" : String(produit.defaultMinStock)
  )
  const [erreur, setErreur] = useState<string | null>(null)

  const ouvrir = () => {
    setPrix(String(produit.price))
    setPlancher(produit.minPrice === null ? "" : String(produit.minPrice))
    setSeuil(
      produit.defaultMinStock === null ? "" : String(produit.defaultMinStock)
    )
    setErreur(null)
    setEdition(true)
  }

  const enregistrer = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/products/${productId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          price: Number(prix),
          minPrice: plancher === "" ? null : Number(plancher),
          defaultMinStock: seuil === "" ? null : Number(seuil),
        }),
      }),
    onSuccess: async () => {
      await onModifie()
      setEdition(false)
    },
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })

  if (edition) {
    return (
      <form
        className="flex flex-wrap items-end gap-3 border-y py-3"
        onSubmit={(e) => {
          e.preventDefault()
          setErreur(null)
          enregistrer.mutate()
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sy-prix">Prix de vente</Label>
          <Input
            id="sy-prix"
            type="number"
            min={1}
            step={1}
            required
            className="w-32"
            value={prix}
            onChange={(e) => setPrix(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sy-plancher">Prix plancher</Label>
          <Input
            id="sy-plancher"
            type="number"
            min={1}
            step={1}
            className="w-32"
            value={plancher}
            onChange={(e) => setPlancher(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sy-seuil">Seuil d'alerte</Label>
          <Input
            id="sy-seuil"
            type="number"
            min={0}
            step={1}
            className="w-32"
            value={seuil}
            onChange={(e) => setSeuil(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={enregistrer.isPending}>
            {enregistrer.isPending ? "Enregistrement…" : "Enregistrer"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setEdition(false)}
          >
            Annuler
          </Button>
        </div>
        {erreur && (
          <p role="alert" className="w-full text-sm text-destructive">
            {erreur}
          </p>
        )}
      </form>
    )
  }

  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-2 border-y py-3">
      <Fait libelle="Prix de vente" valeur={formaterMontant(produit.price, devise)} />
      <Fait
        libelle="Prix plancher"
        valeur={
          produit.minPrice === null
            ? "—"
            : formaterMontant(produit.minPrice, devise)
        }
      />
      <Fait
        libelle="Seuil d'alerte"
        valeur={
          produit.defaultMinStock === null
            ? "—"
            : String(produit.defaultMinStock)
        }
      />
      {stockTotal !== null && (
        <Fait libelle="Stock total" valeur={String(stockTotal)} />
      )}
      {peutEcrire && (
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={ouvrir}
        >
          Modifier
        </Button>
      )}
    </div>
  )
}
```

- [ ] **Étape 4 : Vérifier le passage**

Run : `bun run --cwd apps/web test -- section-synthese`
Attendu : PASS (4 tests).

- [ ] **Étape 5 : Commit**

```bash
git add apps/web/src/components/produit/section-synthese.tsx apps/web/src/components/produit/section-synthese.test.tsx
git commit -m "feat(web): la bande de synthèse chiffrée de la fiche produit, éditable en place"
```

---

### Task 3 : Web — `SectionIdentite` (image + identité, édition en place)

**Fichiers :**
- Créer : `apps/web/src/components/produit/section-identite.tsx`
- Test (créer) : `apps/web/src/components/produit/section-identite.test.tsx`
- Supprimer (à la Task 6, après bascule de la page) : `section-infos.tsx`, `section-image.tsx`

**Interfaces :**
- Consomme : `Produit` (`./types`), `apiFetch`/`apiUrl`, `Combobox` DS (`@/components/ui/combobox`), la mécanique d'upload existante de `section-image.tsx` (à transplanter telle quelle : reset de l'input après tentative, version d'URL anti-cache).
- Produit : `export function SectionIdentite(props: { produit: Produit; productId: string; peutEcrire: boolean; onModifie: () => Promise<unknown> })`. Montée avec `key={produit.id}` par la page (re-seed du formulaire à la navigation).

- [ ] **Étape 1 : Écrire les tests (échec attendu)**

Créer `apps/web/src/components/produit/section-identite.test.tsx` :

```tsx
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { SectionIdentite } from "@/components/produit/section-identite"
import { apiFetch } from "@/lib/api"
import type { Produit } from "@/components/produit/types"

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn((url: string) =>
    url === "/api/v1/categories"
      ? Promise.resolve({ categories: [{ id: "c1", name: "Outillage" }] })
      : Promise.resolve({})
  ),
  apiUrl: (chemin: string) => chemin,
}))

afterEach(() => vi.clearAllMocks())

const produit: Produit = {
  id: "p1",
  name: "Article",
  sku: "PRD-1",
  description: "Une description",
  categoryId: "c1",
  barcode: "123456",
  price: 5000,
  minPrice: null,
  defaultMinStock: null,
  isActive: true,
  trackLots: false,
  imageKey: null,
  variants: [],
}

function rendre(
  surcharges: Partial<Parameters<typeof SectionIdentite>[0]> = {}
) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SectionIdentite
        produit={produit}
        productId="p1"
        peutEcrire
        onModifie={() => Promise.resolve()}
        {...surcharges}
      />
    </QueryClientProvider>
  )
}

describe("SectionIdentite", () => {
  it("affiche catégorie, code-barres et description en lecture", async () => {
    rendre()
    expect(await screen.findByText("Outillage")).toBeTruthy()
    expect(screen.getByText("123456")).toBeTruthy()
    expect(screen.getByText("Une description")).toBeTruthy()
  })

  it("sans écriture : ni Modifier ni upload d'image", () => {
    rendre({ peutEcrire: false })
    expect(
      screen.queryByRole("button", { name: "Modifier" })
    ).toBeNull()
    expect(screen.queryByText(/Choisir une image/)).toBeNull()
  })

  it("édition : PATCH partiel avec champs vides normalisés à null", async () => {
    const onModifie = vi.fn(() => Promise.resolve())
    rendre({ onModifie })
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }))
    fireEvent.change(screen.getByLabelText("Code-barres"), {
      target: { value: "" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }))
    await waitFor(() => expect(onModifie).toHaveBeenCalled())
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/products/p1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          name: "Article",
          description: "Une description",
          categoryId: "c1",
          barcode: null,
          isActive: true,
        }),
      })
    )
  })
})
```

- [ ] **Étape 2 : Vérifier l'échec**

Run : `bun run --cwd apps/web test -- section-identite`
Attendu : FAIL — module introuvable.

- [ ] **Étape 3 : Implémenter le composant**

Créer `apps/web/src/components/produit/section-identite.tsx`. Contenu :
en lecture, l'image (ou le cadre « Aucune image ») au-dessus d'une liste de
définition dense ; en édition, les champs nom / catégorie (Combobox DS) /
code-barres / description / interrupteur « Produit actif ».

```tsx
import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Upload } from "lucide-react"
import { apiFetch, apiUrl } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"
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
import type { Produit } from "./types"

type Categorie = { id: string; name: string }

type Props = {
  produit: Produit
  productId: string
  peutEcrire: boolean
  onModifie: () => Promise<unknown>
}

/** Read-mode definition row: pale label above the value ("—" when absent). */
function Definition({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{libelle}</span>
      <span className="text-sm">{valeur || "—"}</span>
    </div>
  )
}

// Mounted with key={produit.id} by the page: edit state re-seeds when
// navigating to another product.
/**
 * Identity column: product image (upload preserved from the former image
 * section: input reset after each attempt, URL versioning) above a dense
 * definition list; "Modifier" switches name/category/barcode/description
 * and the active toggle to inline editing (partial PATCH).
 */
export function SectionIdentite({
  produit,
  productId,
  peutEcrire,
  onModifie,
}: Props) {
  const [edition, setEdition] = useState(false)
  const [nom, setNom] = useState(produit.name)
  const [categorieId, setCategorieId] = useState(produit.categoryId ?? "")
  const [codeBarres, setCodeBarres] = useState(produit.barcode ?? "")
  const [description, setDescription] = useState(produit.description ?? "")
  const [actif, setActif] = useState(produit.isActive)
  const [erreur, setErreur] = useState<string | null>(null)
  const [erreurImage, setErreurImage] = useState<string | null>(null)
  const [versionImage, setVersionImage] = useState(0)

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<{ categories: Categorie[] }>("/api/v1/categories"),
  })
  const listeCategories = categories.data?.categories ?? []
  const idsCategories = listeCategories.map((c) => c.id)
  const nomCategorie = (id: string) =>
    listeCategories.find((c) => c.id === id)?.name ?? id

  const ouvrir = () => {
    setNom(produit.name)
    setCategorieId(produit.categoryId ?? "")
    setCodeBarres(produit.barcode ?? "")
    setDescription(produit.description ?? "")
    setActif(produit.isActive)
    setErreur(null)
    setEdition(true)
  }

  const enregistrer = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/products/${productId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: nom,
          description: description === "" ? null : description,
          categoryId: categorieId === "" ? null : categorieId,
          barcode: codeBarres === "" ? null : codeBarres,
          isActive: actif,
        }),
      }),
    onSuccess: async () => {
      await onModifie()
      setEdition(false)
    },
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })

  const envoyerImage = useMutation({
    mutationFn: (fichier: File) => {
      const donnees = new FormData()
      donnees.append("image", fichier)
      // no content-type header: the browser sets the multipart boundary
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
      setErreurImage(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <section className="flex flex-col gap-4">
      {produit.imageKey ? (
        <img
          src={`${apiUrl(`/api/v1/files/${produit.imageKey}`)}?v=${versionImage}`}
          alt={produit.name}
          width={128}
          height={128}
          crossOrigin="use-credentials"
          className="h-32 w-32 rounded-md border object-cover"
        />
      ) : (
        <div className="flex h-32 w-32 items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">
          Aucune image
        </div>
      )}
      {peutEcrire && (
        <div className="flex flex-col gap-2">
          <label
            htmlFor="p-image"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "w-fit cursor-pointer",
              envoyerImage.isPending && "pointer-events-none opacity-50"
            )}
          >
            <Upload />
            {envoyerImage.isPending ? "Envoi…" : "Choisir une image…"}
          </label>
          <p className="text-xs text-muted-foreground">
            JPEG, PNG, WebP — 2 Mo max
          </p>
          <input
            id="p-image"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={envoyerImage.isPending}
            onChange={(e) => {
              // e.target.files is nullable (FileList | null): the optional
              // chain is legitimate for no-unnecessary-condition
              const input = e.target
              const fichier = input.files?.[0]
              if (!fichier) return
              // Reset after each attempt (success or failure): otherwise
              // re-selecting the SAME file does not fire onChange.
              envoyerImage.mutate(fichier, {
                onSettled: () => {
                  input.value = ""
                },
              })
            }}
            className="sr-only"
          />
          {erreurImage && (
            <p role="alert" className="text-sm text-destructive">
              {erreurImage}
            </p>
          )}
        </div>
      )}

      {edition ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            setErreur(null)
            enregistrer.mutate()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="id-nom">Nom</Label>
            <Input
              id="id-nom"
              required
              autoComplete="off"
              value={nom}
              onChange={(e) => setNom(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="id-categorie">Catégorie</Label>
            <Combobox
              items={idsCategories}
              itemToStringLabel={nomCategorie}
              autoHighlight
              value={categorieId || null}
              onValueChange={(valeur) => setCategorieId(valeur ?? "")}
            >
              <ComboboxInput
                id="id-categorie"
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
            <Label htmlFor="id-barcode">Code-barres</Label>
            <Input
              id="id-barcode"
              autoComplete="off"
              spellCheck={false}
              value={codeBarres}
              onChange={(e) => setCodeBarres(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="id-description">Description</Label>
            <Textarea
              id="id-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="id-actif"
              checked={actif}
              onCheckedChange={(valeur) => setActif(valeur === true)}
            />
            <Label htmlFor="id-actif">Produit actif</Label>
          </div>
          {erreur && (
            <p role="alert" className="text-sm text-destructive">
              {erreur}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={enregistrer.isPending}>
              {enregistrer.isPending ? "Enregistrement…" : "Enregistrer"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEdition(false)}
            >
              Annuler
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <Definition
            libelle="Catégorie"
            valeur={
              produit.categoryId === null ? "" : nomCategorie(produit.categoryId)
            }
          />
          <Definition libelle="Code-barres" valeur={produit.barcode ?? ""} />
          <Definition
            libelle="Description"
            valeur={produit.description ?? ""}
          />
          {peutEcrire && (
            <Button variant="ghost" size="sm" className="w-fit" onClick={ouvrir}>
              Modifier
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Étape 4 : Vérifier le passage**

Run : `bun run --cwd apps/web test -- section-identite`
Attendu : PASS (3 tests).

- [ ] **Étape 5 : Commit**

```bash
git add apps/web/src/components/produit/section-identite.tsx apps/web/src/components/produit/section-identite.test.tsx
git commit -m "feat(web): la colonne identité de la fiche produit — image et champs éditables en place"
```

---

### Task 4 : Web — `SectionStock` (table présentationnelle)

**Fichiers :**
- Créer : `apps/web/src/components/produit/section-stock.tsx`
- Test (créer) : `apps/web/src/components/produit/section-stock.test.tsx`
- Modifier : `apps/web/src/components/produit/types.ts` (ajouter `LigneStockProduit`)

**Interfaces :**
- Consomme : `Table`/`TableFooter` DS, `formaterMontant`.
- Produit : `export type LigneStockProduit = { warehouseId: string; warehouseName: string; variantId: string; variantName: string; quantity: number; avgCost: number }` (dans `types.ts`) et `export function SectionStock(props: { lignes: LigneStockProduit[]; enChargement: boolean; devise: string })`. Présentationnel : la requête vit dans la page (Task 6). La colonne « Variante » n'apparaît que si les lignes portent plus d'une variante distincte.

- [ ] **Étape 1 : Ajouter le type dans `types.ts`**

À la fin de `apps/web/src/components/produit/types.ts` :

```ts
/** One row of GET /products/:id/stock — per warehouse and variant. */
export type LigneStockProduit = {
  warehouseId: string
  warehouseName: string
  variantId: string
  variantName: string
  quantity: number
  avgCost: number
}
```

- [ ] **Étape 2 : Écrire les tests (échec attendu)**

Créer `apps/web/src/components/produit/section-stock.test.tsx` :

```tsx
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { SectionStock } from "@/components/produit/section-stock"
import { formaterMontant } from "@/lib/format"
import type { LigneStockProduit } from "@/components/produit/types"

function texteMontant(montant: number): RegExp {
  const echappe = formaterMontant(montant)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+")
  return new RegExp(`^${echappe}$`)
}

const lignes: LigneStockProduit[] = [
  {
    warehouseId: "w1",
    warehouseName: "Boutique S",
    variantId: "v1",
    variantName: "Standard",
    quantity: 4,
    avgCost: 300,
  },
  {
    warehouseId: "w2",
    warehouseName: "Dépôt Central",
    variantId: "v1",
    variantName: "Standard",
    quantity: 10,
    avgCost: 200,
  },
]

describe("SectionStock", () => {
  it("liste entrepôts, quantités, CMP et total ; une seule variante → pas de colonne Variante", () => {
    render(<SectionStock lignes={lignes} enChargement={false} devise="XOF" />)
    expect(screen.getByText("Boutique S")).toBeTruthy()
    expect(screen.getByText("10")).toBeTruthy()
    expect(screen.getByText(texteMontant(200))).toBeTruthy()
    // Total : 14
    expect(screen.getByText("14")).toBeTruthy()
    expect(screen.queryByText("Variante")).toBeNull()
  })

  it("plusieurs variantes → colonne Variante visible", () => {
    render(
      <SectionStock
        lignes={[
          ...lignes,
          {
            warehouseId: "w1",
            warehouseName: "Boutique S",
            variantId: "v2",
            variantName: "Grand",
            quantity: 2,
            avgCost: 500,
          },
        ]}
        enChargement={false}
        devise="XOF"
      />
    )
    expect(screen.getByText("Variante")).toBeTruthy()
    expect(screen.getByText("Grand")).toBeTruthy()
  })

  it("liste vide → état vide", () => {
    render(<SectionStock lignes={[]} enChargement={false} devise="XOF" />)
    expect(
      screen.getByText("Aucun stock visible pour ce produit.")
    ).toBeTruthy()
  })
})
```

- [ ] **Étape 3 : Vérifier l'échec**

Run : `bun run --cwd apps/web test -- section-stock`
Attendu : FAIL — module introuvable.

- [ ] **Étape 4 : Implémenter le composant**

Créer `apps/web/src/components/produit/section-stock.tsx` :

```tsx
import { formaterMontant } from "@/lib/format"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TableSkeleton } from "@/components/ui/table-skeleton"
import type { LigneStockProduit } from "./types"

type Props = {
  lignes: LigneStockProduit[]
  enChargement: boolean
  devise: string
}

/**
 * "Stock par entrepôt" table: warehouse · variant (only when several
 * variants are present) · quantity · average cost, with a total row.
 * Presentational: the page owns the query.
 */
export function SectionStock({ lignes, enChargement, devise }: Props) {
  const plusieursVariantes =
    new Set(lignes.map((l) => l.variantId)).size > 1
  const total = lignes.reduce((somme, l) => somme + l.quantity, 0)
  const colonnes = plusieursVariantes ? 4 : 3

  return (
    <section>
      <h2 className="mb-3 text-base font-semibold">Stock par entrepôt</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Entrepôt</TableHead>
            {plusieursVariantes && <TableHead>Variante</TableHead>}
            <TableHead numeric>Quantité</TableHead>
            <TableHead numeric>CMP</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {enChargement ? (
            <TableSkeleton colonnes={colonnes} />
          ) : lignes.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={colonnes}
                className="text-muted-foreground"
              >
                Aucun stock visible pour ce produit.
              </TableCell>
            </TableRow>
          ) : (
            lignes.map((l) => (
              <TableRow key={`${l.warehouseId}-${l.variantId}`}>
                <TableCell>{l.warehouseName}</TableCell>
                {plusieursVariantes && <TableCell>{l.variantName}</TableCell>}
                <TableCell numeric>{l.quantity}</TableCell>
                <TableCell numeric>
                  {formaterMontant(l.avgCost, devise)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
        {lignes.length > 0 && (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={colonnes - 2}>Total</TableCell>
              <TableCell numeric>{total}</TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </section>
  )
}
```

- [ ] **Étape 5 : Vérifier le passage**

Run : `bun run --cwd apps/web test -- section-stock`
Attendu : PASS (3 tests).

- [ ] **Étape 6 : Commit**

```bash
git add apps/web/src/components/produit/section-stock.tsx apps/web/src/components/produit/section-stock.test.tsx apps/web/src/components/produit/types.ts
git commit -m "feat(web): la table de stock par entrepôt de la fiche produit"
```

---

### Task 5 : Web — lots imbriqués dans `SectionVariantes`

**Fichiers :**
- Modifier : `apps/web/src/components/produit/section-variantes.tsx`
- Test (créer) : `apps/web/src/components/produit/section-variantes.test.tsx`
- Aucune suppression à cette task : la page importe encore `section-lots.tsx`. Cette task ajoute l'imbrication SANS supprimer le fichier ; la Task 6 supprime `section-lots.tsx`, `section-infos.tsx` et `section-image.tsx` une fois la page basculée.

**Interfaces :**
- Consomme : `estDateExpiree`, `formatDateJour` (`@/lib/dates`) ; dialog « Nouveau lot » transplanté depuis `section-lots.tsx` (mêmes champs : numéro requis, péremption optionnelle).
- Produit : la signature de `SectionVariantes` est inchangée (`produit, productId, peutEcrire, devise, onModifie`). Sous chaque ligne de variante, quand `produit.trackLots` est vrai : une ligne pleine largeur listant les lots (numéro mono, péremption ou « sans péremption », badge Expiré) + bouton « Ajouter un lot » (si `peutEcrire`).

- [ ] **Étape 1 : Écrire les tests (échec attendu)**

Créer `apps/web/src/components/produit/section-variantes.test.tsx` :

```tsx
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { SectionVariantes } from "@/components/produit/section-variantes"
import type { Produit } from "@/components/produit/types"

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(() => Promise.resolve({})),
  apiUrl: (chemin: string) => chemin,
}))

afterEach(() => vi.clearAllMocks())

function produitAvec(trackLots: boolean): Produit {
  return {
    id: "p1",
    name: "Article",
    sku: "PRD-1",
    description: null,
    categoryId: null,
    barcode: null,
    price: 5000,
    minPrice: null,
    defaultMinStock: null,
    isActive: true,
    trackLots,
    imageKey: null,
    variants: [
      {
        id: "v1",
        name: "Standard",
        sku: "PRD-1-STD",
        attributes: "{}",
        barcode: null,
        priceOverride: null,
        minPriceOverride: null,
        isActive: true,
        lots: [
          { id: "l1", lotNumber: "LOT-A", expiryDate: "2020-01-01" },
          { id: "l2", lotNumber: "LOT-B", expiryDate: null },
        ],
      },
    ],
  }
}

function rendre(produit: Produit) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SectionVariantes
        produit={produit}
        productId="p1"
        peutEcrire
        devise="XOF"
        onModifie={() => Promise.resolve()}
      />
    </QueryClientProvider>
  )
}

describe("SectionVariantes — lots imbriqués", () => {
  it("trackLots : les lots s'affichent sous leur variante, avec badge Expiré", () => {
    rendre(produitAvec(true))
    expect(screen.getByText("LOT-A")).toBeTruthy()
    expect(screen.getByText("LOT-B")).toBeTruthy()
    expect(screen.getByText("Expiré")).toBeTruthy()
    expect(screen.getByText("sans péremption")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Ajouter un lot" })
    ).toBeTruthy()
  })

  it("sans trackLots : aucune ligne de lots", () => {
    rendre(produitAvec(false))
    expect(screen.queryByText("LOT-A")).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Ajouter un lot" })
    ).toBeNull()
  })
})
```

Si les champs de `Variante`/`Lot` dans `./types` diffèrent, ajuster les
objets du test au type réel (sans cast).

- [ ] **Étape 2 : Vérifier l'échec**

Run : `bun run --cwd apps/web test -- section-variantes`
Attendu : FAIL — « LOT-A » introuvable (les lots ne sont pas rendus par la section actuelle).

- [ ] **Étape 3 : Implémenter l'imbrication**

Dans `section-variantes.tsx` :

1. Ajouter aux imports :

```tsx
import { estDateExpiree, formatDateJour } from "@/lib/dates"
```

2. Ajouter les états et la mutation du dialog lot (transplantés depuis `section-lots.tsx`) au début du composant :

```tsx
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
```

3. Dans le `TableBody`, remplacer le map `produit.variants.map((v) => (<TableRow…/>))` par un map retournant un Fragment `variante + ligne de lots` (importer `Fragment` de react) :

```tsx
{produit.variants.map((v) => (
  <Fragment key={v.id}>
    <TableRow>
      {/* cellules existantes inchangées : nom, SKU, attributs, prix, statut, bascule */}
    </TableRow>
    {produit.trackLots && v.isActive && (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={peutEcrire ? 6 : 5} className="py-1.5 pl-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-xs text-muted-foreground">Lots :</span>
            {v.lots.length === 0 ? (
              <span className="text-xs text-muted-foreground">aucun</span>
            ) : (
              v.lots.map((lot) => (
                <span key={lot.id} className="flex items-center gap-1.5 text-xs">
                  <span className="font-mono">{lot.lotNumber}</span>
                  <span className="text-muted-foreground">
                    {lot.expiryDate
                      ? formatDateJour(lot.expiryDate)
                      : "sans péremption"}
                  </span>
                  {estDateExpiree(lot.expiryDate) && (
                    <Badge variant="destructive">Expiré</Badge>
                  )}
                </span>
              ))
            )}
            {peutEcrire && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDialogLotPour(v.id)}
              >
                Ajouter un lot
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>
    )}
  </Fragment>
))}
```

4. Après la `</Table>`, ajouter le dialog « Nouveau lot » (transplanté tel quel depuis `section-lots.tsx`, lignes 95-145 : `Dialog open onOpenChange`, champs `l-numero` requis et `l-peremption` date, erreur `role="alert"`, bouton `Ajouter le lot`).

- [ ] **Étape 4 : Vérifier le passage**

Run : `bun run --cwd apps/web test -- section-variantes`
Attendu : PASS (2 tests).

- [ ] **Étape 5 : Commit**

```bash
git add apps/web/src/components/produit/section-variantes.tsx apps/web/src/components/produit/section-variantes.test.tsx
git commit -m "feat(web): les lots se lisent sous leur variante dans la fiche produit"
```

---

### Task 6 : Page — assemblage deux colonnes et bascule

**Fichiers :**
- Modifier : `apps/web/src/routes/_app/catalogue/produits/$productId.tsx` (réécriture)
- Supprimer : `apps/web/src/components/produit/section-infos.tsx`, `section-image.tsx`, `section-lots.tsx`
- Test (créer) : `apps/web/src/components/produit/fiche-produit.test.tsx`

**Interfaces :**
- Consomme : `SectionSynthese` (Task 2), `SectionIdentite` (Task 3), `SectionStock` + `LigneStockProduit` (Task 4), `SectionVariantes` (Task 5).
- Produit : `export function FicheProduit({ productId }: { productId: string })` dans le fichier de route (exporté pour le test) ; le composant de route ne fait que `const { productId } = Route.useParams()` → `<FicheProduit productId={productId} />`.

- [ ] **Étape 1 : Écrire le test de page (échec attendu)**

Créer `apps/web/src/components/produit/fiche-produit.test.tsx` :

```tsx
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { FicheProduit } from "@/routes/_app/catalogue/produits/$productId"

const produit = {
  id: "p1",
  name: "Article Fiche",
  sku: "PRD-1",
  description: null,
  categoryId: null,
  barcode: null,
  price: 5000,
  minPrice: null,
  defaultMinStock: null,
  isActive: true,
  trackLots: false,
  imageKey: null,
  variants: [],
}

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn((url: string) => {
    if (url === "/api/v1/products/p1") return Promise.resolve({ product: produit })
    if (url === "/api/v1/products/p1/stock")
      return Promise.resolve({
        stock: [
          {
            warehouseId: "w1",
            warehouseName: "Dépôt",
            variantId: "v1",
            variantName: "Standard",
            quantity: 14,
            avgCost: 200,
          },
        ],
      })
    if (url === "/api/v1/organization")
      return Promise.resolve({ currency: "XOF" })
    if (url === "/api/v1/categories")
      return Promise.resolve({ categories: [] })
    return Promise.resolve({})
  }),
  apiUrl: (chemin: string) => chemin,
}))

vi.mock("@/lib/permissions", () => ({ usePeutEcrire: () => true }))
// The route file's Link needs a router context: mock the bare minimum.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-router")>()
  return {
    ...original,
    Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
    createFileRoute: () => () => ({ useParams: () => ({ productId: "p1" }) }),
  }
})

afterEach(() => vi.clearAllMocks())

describe("FicheProduit", () => {
  it("affiche en-tête, synthèse, stock et variantes", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <FicheProduit productId="p1" />
      </QueryClientProvider>
    )
    expect(await screen.findByText("Article Fiche")).toBeTruthy()
    expect(screen.getByText("PRD-1")).toBeTruthy()
    expect(await screen.findByText("Stock par entrepôt")).toBeTruthy()
    expect(await screen.findByText("14")).toBeTruthy()
    expect(screen.getByText("Variantes")).toBeTruthy()
  })
})
```

Si le mock de `createFileRoute` casse au chargement du module route,
préférer extraire `FicheProduit` dans
`apps/web/src/components/produit/fiche-produit.tsx` (le fichier de route
n'exporte alors que la Route) et tester ce module-là — ajuster les imports
du test en conséquence.

- [ ] **Étape 2 : Vérifier l'échec**

Run : `bun run --cwd apps/web test -- fiche-produit`
Attendu : FAIL — `FicheProduit` n'existe pas.

- [ ] **Étape 3 : Réécrire la page**

`apps/web/src/routes/_app/catalogue/produits/$productId.tsx` :

```tsx
import { createFileRoute, Link } from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft } from "lucide-react"
import { apiFetch } from "@/lib/api"
import { usePeutEcrire } from "@/lib/permissions"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { SectionSynthese } from "@/components/produit/section-synthese"
import { SectionIdentite } from "@/components/produit/section-identite"
import { SectionStock } from "@/components/produit/section-stock"
import { SectionVariantes } from "@/components/produit/section-variantes"
import type { LigneStockProduit, Produit } from "@/components/produit/types"

export const Route = createFileRoute("/_app/catalogue/produits/$productId")({
  component: FicheProduitPage,
})

function FicheProduitPage() {
  const { productId } = Route.useParams()
  return <FicheProduit productId={productId} />
}

/**
 * Product sheet, read-first: header with back link, summary band of
 * figures, identity column (1/3) and living data column (2/3): stock per
 * warehouse then variants with their nested lots. Sections edit in place.
 */
export function FicheProduit({ productId }: { productId: string }) {
  const peutEcrire = usePeutEcrire()
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: ["product", productId],
    queryFn: () =>
      apiFetch<{ product: Produit }>(`/api/v1/products/${productId}`),
  })
  const stock = useQuery({
    queryKey: ["product-stock", productId],
    queryFn: () =>
      apiFetch<{ stock: LigneStockProduit[] }>(
        `/api/v1/products/${productId}/stock`
      ),
  })
  const organisation = useQuery({
    queryKey: ["organization"],
    queryFn: () => apiFetch<{ currency: string }>("/api/v1/organization"),
  })
  const devise = organisation.data?.currency ?? "XOF"

  const invalider = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["product", productId] }),
      queryClient.invalidateQueries({ queryKey: ["product-stock", productId] }),
    ])

  if (!data) {
    return (
      <div>
        <div className="mb-6 flex items-center gap-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
        <Skeleton className="mb-6 h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  const produit = data.product
  const lignesStock = stock.data?.stock ?? []
  // Stock total shown only when at least one warehouse is visible: an
  // empty list means either no scope or no stock — both hide the figure.
  const stockTotal =
    lignesStock.length > 0
      ? lignesStock.reduce((somme, l) => somme + l.quantity, 0)
      : null

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          to="/catalogue/produits"
          className="mb-2 inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 [&>svg]:size-3.5"
        >
          <ArrowLeft />
          Produits
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{produit.name}</h1>
          <span className="font-mono text-xs text-muted-foreground">
            {produit.sku}
          </span>
          <Badge variant={produit.isActive ? "success" : "secondary"}>
            {produit.isActive ? "Actif" : "Inactif"}
          </Badge>
        </div>
      </div>

      <SectionSynthese
        key={`synthese-${produit.id}`}
        produit={produit}
        productId={productId}
        peutEcrire={peutEcrire}
        devise={devise}
        stockTotal={stockTotal}
        onModifie={invalider}
      />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <SectionIdentite
          key={`identite-${produit.id}`}
          produit={produit}
          productId={productId}
          peutEcrire={peutEcrire}
          onModifie={invalider}
        />
        <div className="flex flex-col gap-8 lg:col-span-2">
          <SectionStock
            lignes={lignesStock}
            enChargement={stock.isPending}
            devise={devise}
          />
          <SectionVariantes
            produit={produit}
            productId={productId}
            peutEcrire={peutEcrire}
            devise={devise}
            onModifie={invalider}
          />
        </div>
      </div>
    </div>
  )
}
```

Puis supprimer les fichiers devenus orphelins :

```bash
rm apps/web/src/components/produit/section-infos.tsx apps/web/src/components/produit/section-image.tsx apps/web/src/components/produit/section-lots.tsx
```

- [ ] **Étape 4 : Vérifier le passage et l'absence de références mortes**

Run : `bun run --cwd apps/web test -- fiche-produit && bun run typecheck && bun run lint`
Attendu : PASS partout (le typecheck échouerait si un import des fichiers supprimés subsistait).

- [ ] **Étape 5 : Commit**

```bash
git add -A apps/web/src/components/produit apps/web/src/routes/_app/catalogue/produits/\$productId.tsx
git commit -m "feat(web): la fiche produit devient une page de consultation en deux colonnes"
```

---

### Task 7 : E2E navigateur et vérification finale

**Fichiers :** aucun nouveau — vérification.

- [ ] **Étape 1 : Suites complètes**

Run : `bun run typecheck && bun run lint && bun run --cwd apps/web test`
puis `cd apps/api && bun run test -- test/product-stock.test.ts`
Attendu : tout PASS.

- [ ] **Étape 2 : E2E navigateur (agent-browser, serveurs dev lancés)**

1. Se connecter en owner (`owner@exemple.com` / `OwnerLocal!2026`).
2. Ouvrir un produit depuis `/catalogue/produits` : vérifier en-tête (retour « ← Produits », nom, SKU, badge), bande de synthèse, colonnes (identité gauche, stock + variantes droite), lots sous variantes si produit `trackLots`.
3. Cliquer « Modifier » sur la synthèse, changer le prix, Enregistrer : le chiffre affiché se met à jour (invalidation) ; Annuler ne modifie rien.
4. Idem sur l'identité (description).
5. `agent-browser set viewport 900 700` : la grille replie en une colonne, aucun débordement horizontal du document.
6. Se connecter en caissier (« Boutique Centre » / `Caissier!2026`) : la fiche s'affiche sans aucun bouton Modifier, table de stock en état vide ou bornée à sa portée selon l'affectation.

- [ ] **Étape 3 : Captures avant/après pour la PR**

Screenshot de la fiche à ≥ 1280 px et à 900 px dans le scratchpad, à joindre au descriptif de PR.

- [ ] **Étape 4 : Commit final éventuel**

Uniquement si l'E2E a exigé des retouches ; sinon rien à commiter.

---

## Auto-revue (faite à la rédaction)

- **Couverture spec :** en-tête + retour (T6) · synthèse et son édition (T2) · identité et son édition + image (T3) · stock par entrepôt + endpoint + portée (T1, T4, T6) · lots imbriqués et disparition de la section Lots (T5, T6) · deux colonnes + repli (T6) · critères de test API/web/E2E (T1–T7). Non-objectifs respectés (aucune task d'historique ni d'édition d'attributs).
- **Placeholders :** aucun TBD ; chaque étape code porte son code.
- **Cohérence des types :** `LigneStockProduit` défini en T4, consommé en T6 ; signatures des sections identiques entre leur task de création et T6 ; `FicheProduit({ productId })` exporté en T6 et testé.
