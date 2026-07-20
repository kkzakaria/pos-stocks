# Persistance du panier POS — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Note (2026-07-20) — document daté.** Ce plan reflète l'état *avant exécution*.
> Le durcissement issu des revues a fait diverger deux points : `charger` ne
> supprime plus l'entrée invalide (c'est la purge verrouillée suivante qui la
> récupère), et la forme persistée porte un champ `proprietaire` sur lequel
> s'appuie la garde multi-onglets. Le comportement livré fait foi : voir
> `docs/superpowers/specs/2026-07-19-persistance-panier-pos-design.md` et
> `apps/web/src/lib/panier-persistance.test.ts`.

**Goal:** Persister localement le panier de l'écran de vente pour qu'il survive à un rafraîchissement ou à une fermeture d'onglet, sans compromettre les garanties d'idempotence existantes.

**Architecture:** Un module pur `lib/panier-persistance.ts` encapsule `localStorage` (sérialisation versionnée, lecture tolérante aux pannes) et la revalidation catalogue. `pos/ecran-vente.tsx` ne gagne que l'initialisation paresseuse de trois états, deux `useEffect` et un bandeau.

**Tech Stack:** React 19, TypeScript, `localStorage`, Vitest + Testing Library (jsdom), Tailwind 4.

**Spec :** `docs/superpowers/specs/2026-07-19-persistance-panier-pos-design.md`
**Issue :** #14 — **Branche :** `feat/persistance-panier-issue-14`

## Global Constraints

- Clé de stockage : **`pos:panier:<boutiqueId>:<sessionId>`** (portée boutique + session de caisse).
- Format persisté versionné : `{ v: 1, lignes, requestId, verrouille, majA }`. Un `v` inconnu ou un JSON illisible → **purge + départ à zéro**, jamais d'exception.
- **`prixUnitaire` n'est JAMAIS écrasé** par la revalidation (il peut contenir un prix négocié / dépannage).
- `requestId` et `verrouille` sont restaurés **tels quels** (garantie anti-doublon).
- Tout accès à `localStorage` est encadré par `try/catch` : indisponible ou en quota dépassé → **dégradation silencieuse**, jamais de crash de l'écran de vente.
- Restauration **silencieuse** (aucune modale de confirmation).
- Langue : commentaires de code et JSDoc en **anglais** ; UI et messages en **français**.
- Pièges eslint du dépôt : types dans un `import type` séparé ; `no-unnecessary-condition`.
- Hooks husky actifs (pre-commit lint-staged + typecheck). **Jamais `--no-verify`.**

## Commandes

```bash
bun run --cwd apps/web test                                    # suite web
bun run --cwd apps/web test -- src/lib/panier-persistance.test.ts   # ciblé
bun run typecheck
```

## File Structure

- **Create** `apps/web/src/lib/panier-persistance.ts` — accès `localStorage` + revalidation catalogue. Fonctions **pures** (aucun React, aucun DOM hors `localStorage`).
- **Create** `apps/web/src/lib/panier-persistance.test.ts` — tests unitaires du module.
- **Modify** `apps/web/src/lib/pos.ts` — ajout du champ `prixModifie?: boolean` sur `LignePanier`.
- **Modify** `apps/web/src/pos/ecran-vente.tsx` — init paresseuse, effet d'écriture, effet de revalidation, bandeau.
- **Modify** `apps/web/src/pos/panier.tsx` — marquage visuel d'une ligne `prixModifie`.
- **Modify** `apps/web/src/pos/ecran-vente.test.tsx` — tests composant de restauration/purge.

---

### Task 1 : Module de persistance (`charger` / `enregistrer` / `purger`)

**Files:**
- Create: `apps/web/src/lib/panier-persistance.ts`
- Create: `apps/web/src/lib/panier-persistance.test.ts`
- Modify: `apps/web/src/lib/pos.ts` (type `LignePanier`)

**Interfaces:**
- Produces:
  - `interface PanierPersiste { v: 1; lignes: LignePanier[]; requestId: string; verrouille: boolean; majA: string }`
  - `clePanier(boutiqueId: string, sessionId: string): string`
  - `charger(cle: string): PanierPersiste | null`
  - `enregistrer(cle: string, etat: PanierPersiste): void`
  - `purger(cle: string): void`

- [ ] **Step 1 : Ajouter le champ `prixModifie` à `LignePanier`**

Dans `apps/web/src/lib/pos.ts`, à l'intérieur de `export type LignePanier = {`, juste après la ligne `enAlerte: boolean` (dernière propriété), ajouter :

```ts
  // posé par la revalidation d'un panier restauré : le prix catalogue a
  // changé depuis la mise au panier (prixUnitaire, lui, est préservé)
  prixModifie?: boolean
```

- [ ] **Step 2 : Écrire le test qui échoue**

Créer `apps/web/src/lib/panier-persistance.test.ts` :

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import {
  clePanier,
  charger,
  enregistrer,
  purger,
} from "@/lib/panier-persistance"
import type { PanierPersiste } from "@/lib/panier-persistance"
import type { LignePanier } from "@/lib/pos"

const ligne: LignePanier = {
  variantId: "v1",
  nom: "Coca 50cl",
  sku: "SKU1",
  imageKey: null,
  quantite: 2,
  prixUnitaire: 450, // prix négocié, sous le prix catalogue
  prixCatalogue: 500,
  prixPlancher: 400,
  sourceWarehouseId: "wh2", // dépannage
  sourceNom: "Dépôt central",
  enAlerte: false,
}

const etat: PanierPersiste = {
  v: 1,
  lignes: [ligne],
  requestId: "req-1",
  verrouille: true,
  majA: "2026-07-19T10:00:00.000Z",
}

describe("panier-persistance", () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it("compose une clé scopée boutique + session", () => {
    expect(clePanier("store1", "sess1")).toBe("pos:panier:store1:sess1")
  })

  it("round-trip : prix négocié et dépannage survivent à l'identique", () => {
    enregistrer("k", etat)
    expect(charger("k")).toEqual(etat)
  })

  it("renvoie null si rien n'est stocké", () => {
    expect(charger("k")).toBeNull()
  })

  it("purge et renvoie null sur une version inconnue", () => {
    localStorage.setItem("k", JSON.stringify({ ...etat, v: 2 }))
    expect(charger("k")).toBeNull()
    expect(localStorage.getItem("k")).toBeNull()
  })

  it("purge et renvoie null sur un JSON illisible", () => {
    localStorage.setItem("k", "{pas du json")
    expect(charger("k")).toBeNull()
    expect(localStorage.getItem("k")).toBeNull()
  })

  it("purger supprime l'entrée", () => {
    enregistrer("k", etat)
    purger("k")
    expect(localStorage.getItem("k")).toBeNull()
  })

  it("ne lève jamais si localStorage est indisponible", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("indisponible")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota")
    })
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("indisponible")
    })
    expect(charger("k")).toBeNull()
    expect(() => enregistrer("k", etat)).not.toThrow()
    expect(() => purger("k")).not.toThrow()
  })
})
```

- [ ] **Step 3 : Lancer le test pour vérifier qu'il échoue**

Run : `bun run --cwd apps/web test -- src/lib/panier-persistance.test.ts`
Expected : FAIL — module `@/lib/panier-persistance` introuvable.

- [ ] **Step 4 : Écrire l'implémentation minimale**

Créer `apps/web/src/lib/panier-persistance.ts` :

```ts
import type { LignePanier } from "./pos"

export interface PanierPersiste {
  v: 1
  lignes: LignePanier[]
  requestId: string
  verrouille: boolean
  majA: string
}

/** Storage key scoped to a till session: closing the register drops the cart. */
export function clePanier(boutiqueId: string, sessionId: string): string {
  return `pos:panier:${boutiqueId}:${sessionId}`
}

/**
 * Reads the stored cart. Returns null — purging the entry — when the payload
 * is unreadable or carries a foreign version, so a format change can never
 * crash the till screen.
 */
export function charger(cle: string): PanierPersiste | null {
  let brut: string | null
  try {
    brut = localStorage.getItem(cle)
  } catch {
    return null
  }
  if (brut === null) return null
  let donnees: unknown
  try {
    donnees = JSON.parse(brut)
  } catch {
    purger(cle)
    return null
  }
  if (
    typeof donnees !== "object" ||
    donnees === null ||
    (donnees as { v?: unknown }).v !== 1 ||
    !Array.isArray((donnees as { lignes?: unknown }).lignes) ||
    typeof (donnees as { requestId?: unknown }).requestId !== "string" ||
    typeof (donnees as { verrouille?: unknown }).verrouille !== "boolean"
  ) {
    purger(cle)
    return null
  }
  return donnees as PanierPersiste
}

export function enregistrer(cle: string, etat: PanierPersiste): void {
  try {
    localStorage.setItem(cle, JSON.stringify(etat))
  } catch {
    // Storage unavailable (private mode) or quota exceeded: degrade silently
    // to the in-memory behaviour rather than crashing the till screen.
  }
}

export function purger(cle: string): void {
  try {
    localStorage.removeItem(cle)
  } catch {
    // Same rationale as enregistrer: never crash on storage failure.
  }
}
```

- [ ] **Step 5 : Lancer le test pour vérifier qu'il passe**

Run : `bun run --cwd apps/web test -- src/lib/panier-persistance.test.ts`
Expected : PASS (7 tests).

Puis `bun run typecheck` → aucune erreur.

- [ ] **Step 6 : Commit**

```bash
git add apps/web/src/lib/panier-persistance.ts apps/web/src/lib/panier-persistance.test.ts apps/web/src/lib/pos.ts
git commit -m "feat(pos): module de persistance locale du panier"
```

---

### Task 2 : Revalidation catalogue (`revaliderPanier`)

**Files:**
- Modify: `apps/web/src/lib/panier-persistance.ts`
- Modify: `apps/web/src/lib/panier-persistance.test.ts`

**Interfaces:**
- Consumes: `LignePanier` (avec `prixModifie?`, Task 1), `ArticlePos` (existant, `lib/pos.ts`) — champs utiles : `variantId: string`, `price: number`.
- Produces:
  - `interface ResultatRevalidation { lignes: LignePanier[]; retirees: number; prixModifies: number }`
  - `revaliderPanier(lignes: LignePanier[], articles: ArticlePos[]): ResultatRevalidation`

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter à la fin de `apps/web/src/lib/panier-persistance.test.ts` (et compléter l'import du haut du fichier avec `revaliderPanier`, et `import type { ArticlePos } from "@/lib/pos"`) :

```ts
const article: ArticlePos = {
  variantId: "v1",
  productId: "p1",
  productName: "Coca 50cl",
  variantName: "Standard",
  nom: "Coca 50cl",
  sku: "SKU1",
  barcode: null,
  categoryId: null,
  trackLots: false,
  imageKey: null,
  price: 500,
  minPrice: 400,
  quantity: 10,
}

describe("revaliderPanier", () => {
  it("retire une ligne dont l'article n'est plus au catalogue", () => {
    const r = revaliderPanier([ligne], [])
    expect(r.lignes).toEqual([])
    expect(r.retirees).toBe(1)
    expect(r.prixModifies).toBe(0)
  })

  it("laisse intacte une ligne dont le prix catalogue n'a pas bougé", () => {
    const r = revaliderPanier([ligne], [article])
    expect(r.lignes).toEqual([ligne])
    expect(r.retirees).toBe(0)
    expect(r.prixModifies).toBe(0)
  })

  it("actualise prixCatalogue et marque la ligne, sans toucher prixUnitaire", () => {
    const r = revaliderPanier([ligne], [{ ...article, price: 600 }])
    expect(r.prixModifies).toBe(1)
    expect(r.retirees).toBe(0)
    expect(r.lignes[0].prixCatalogue).toBe(600)
    expect(r.lignes[0].prixModifie).toBe(true)
    // Le prix négocié doit survivre à la revalidation.
    expect(r.lignes[0].prixUnitaire).toBe(450)
  })

  it("compte séparément retraits et prix modifiés", () => {
    const autre: LignePanier = { ...ligne, variantId: "v2", sku: "SKU2" }
    const r = revaliderPanier([ligne, autre], [{ ...article, price: 600 }])
    expect(r.retirees).toBe(1)
    expect(r.prixModifies).toBe(1)
    expect(r.lignes).toHaveLength(1)
  })

  it("gère un panier vide", () => {
    const r = revaliderPanier([], [article])
    expect(r).toEqual({ lignes: [], retirees: 0, prixModifies: 0 })
  })
})
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run : `bun run --cwd apps/web test -- src/lib/panier-persistance.test.ts`
Expected : FAIL — `revaliderPanier` n'est pas exporté.

- [ ] **Step 3 : Écrire l'implémentation minimale**

Ajouter à `apps/web/src/lib/panier-persistance.ts` — compléter l'import de types en tête du fichier :

```ts
import type { ArticlePos, LignePanier } from "./pos"
```

puis ajouter en fin de fichier :

```ts
export interface ResultatRevalidation {
  lignes: LignePanier[]
  retirees: number
  prixModifies: number
}

/**
 * Reconciles a restored cart against the freshly loaded catalogue: drops lines
 * whose variant disappeared, and flags lines whose catalogue price moved. It
 * never touches `prixUnitaire`, which may hold a negotiated price.
 */
export function revaliderPanier(
  lignes: LignePanier[],
  articles: ArticlePos[]
): ResultatRevalidation {
  const parVariante = new Map(articles.map((a) => [a.variantId, a]))
  const gardees: LignePanier[] = []
  let retirees = 0
  let prixModifies = 0
  for (const ligne of lignes) {
    const article = parVariante.get(ligne.variantId) as ArticlePos | undefined
    if (article === undefined) {
      retirees += 1
      continue
    }
    if (article.price !== ligne.prixCatalogue) {
      gardees.push({
        ...ligne,
        prixCatalogue: article.price,
        prixModifie: true,
      })
      prixModifies += 1
      continue
    }
    gardees.push(ligne)
  }
  return { lignes: gardees, retirees, prixModifies }
}
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run : `bun run --cwd apps/web test -- src/lib/panier-persistance.test.ts`
Expected : PASS (12 tests au total dans le fichier).

Puis `bun run typecheck` → aucune erreur.

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/lib/panier-persistance.ts apps/web/src/lib/panier-persistance.test.ts
git commit -m "feat(pos): revalidation d'un panier restauré contre le catalogue"
```

---

### Task 3 : Câblage de la persistance dans l'écran de vente

**Files:**
- Modify: `apps/web/src/pos/ecran-vente.tsx`
- Modify: `apps/web/src/pos/ecran-vente.test.tsx`

**Interfaces:**
- Consumes: `clePanier`, `charger`, `enregistrer`, `purger`, `PanierPersiste` (Task 1).

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à la fin de `apps/web/src/pos/ecran-vente.test.tsx` un nouveau bloc. Le fichier définit déjà `article`, `me`, `session` (id `"sess1"`) et `renderEcran()` avec la boutique `"store1"` — la clé attendue est donc `pos:panier:store1:sess1`.

```ts
describe("EcranVente — persistance du panier", () => {
  const CLE = "pos:panier:store1:sess1"

  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(posApi, "fetchCataloguePos").mockResolvedValue({
      articles: [article],
      categories: [],
    })
  })
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it("restaure un panier sauvegardé au montage", async () => {
    localStorage.setItem(
      CLE,
      JSON.stringify({
        v: 1,
        lignes: [
          {
            variantId: "v1",
            nom: "Coca 50cl",
            sku: "SKU1",
            imageKey: null,
            quantite: 3,
            prixUnitaire: 500,
            prixCatalogue: 500,
            prixPlancher: null,
            sourceWarehouseId: null,
            sourceNom: null,
            enAlerte: false,
          },
        ],
        requestId: "req-restaure",
        verrouille: false,
        majA: "2026-07-19T10:00:00.000Z",
      })
    )
    renderEcran()
    // Assertion DISCRIMINANTE : « Retirer <nom> » n'existe que pour une LIGNE
    // DE PANIER. Le nom du produit seul apparaît aussi sur la tuile du
    // catalogue — l'asserter passerait même sans restauration (faux positif).
    expect(
      await screen.findByRole("button", { name: "Retirer Coca 50cl" })
    ).toBeInTheDocument()
  })

  it("écrit le panier dans le stockage quand on ajoute un article", async () => {
    renderEcran()
    const tuile = await screen.findByRole("button", { name: /Coca 50cl/ })
    fireEvent.click(tuile)
    await waitFor(() => {
      expect(localStorage.getItem(CLE)).not.toBeNull()
    })
    const stocke = JSON.parse(localStorage.getItem(CLE) ?? "{}") as {
      v: number
      lignes: Array<{ variantId: string; quantite: number }>
    }
    expect(stocke.v).toBe(1)
    expect(stocke.lignes).toHaveLength(1)
    expect(stocke.lignes[0].variantId).toBe("v1")
  })

  it("purge le stockage quand le panier redevient vide", async () => {
    renderEcran()
    const tuile = await screen.findByRole("button", { name: /Coca 50cl/ })
    fireEvent.click(tuile)
    await waitFor(() => expect(localStorage.getItem(CLE)).not.toBeNull())
    // Libellés exacts du composant Panier : le déclencheur porte
    // aria-label="Vider le panier", le bouton de validation de l'AlertDialog
    // s'appelle exactement "Vider" (voir pos/panier.test.tsx).
    fireEvent.click(screen.getByRole("button", { name: "Vider le panier" }))
    fireEvent.click(await screen.findByRole("button", { name: "Vider" }))
    await waitFor(() => {
      expect(localStorage.getItem(CLE)).toBeNull()
    })
  })

  it("restaure l'état verrouillé d'une soumission ambiguë", async () => {
    localStorage.setItem(
      CLE,
      JSON.stringify({
        v: 1,
        lignes: [
          {
            variantId: "v1",
            nom: "Coca 50cl",
            sku: "SKU1",
            imageKey: null,
            quantite: 1,
            prixUnitaire: 500,
            prixCatalogue: 500,
            prixPlancher: null,
            sourceWarehouseId: null,
            sourceNom: null,
            enAlerte: false,
          },
        ],
        requestId: "req-ambigu",
        verrouille: true,
        majA: "2026-07-19T10:00:00.000Z",
      })
    )
    renderEcran()
    const tuile = await screen.findByRole("button", { name: /Coca 50cl/ })
    fireEvent.click(tuile)
    // Panier verrouillé : le clic ne doit RIEN ajouter (quantité reste 1).
    await waitFor(() => {
      const stocke = JSON.parse(localStorage.getItem(CLE) ?? "{}") as {
        lignes: Array<{ quantite: number }>
      }
      expect(stocke.lignes[0].quantite).toBe(1)
    })
  })
})
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run : `bun run --cwd apps/web test -- src/pos/ecran-vente.test.tsx`
Expected : FAIL — le panier n'est ni restauré ni écrit (aucune persistance encore).

- [ ] **Step 3 : Câbler la persistance**

Dans `apps/web/src/pos/ecran-vente.tsx` :

**3a.** Ajouter l'import (après la ligne `import type { ArticlePos, LignePanier } from "@/lib/pos"`) :

```ts
import { clePanier, charger, enregistrer, purger } from "@/lib/panier-persistance"
```

**3b.** Remplacer la ligne `const [lignes, setLignes] = useState<LignePanier[]>([])` par :

```ts
  // Restored once, at first render, so a refresh or an accidental tab close
  // never loses the cart. Scoped to the till session: closing the register
  // drops it.
  const cle = clePanier(boutique.id, session.id)
  const [etatRestaure] = useState(() => charger(cle))
  const [lignes, setLignes] = useState<LignePanier[]>(
    () => etatRestaure?.lignes ?? []
  )
```

**3c.** Remplacer `const [panierVerrouille, setPanierVerrouille] = useState(false)` par :

```ts
  const [panierVerrouille, setPanierVerrouille] = useState(
    etatRestaure?.verrouille ?? false
  )
```

**3d.** Remplacer `const requestId = useRef(crypto.randomUUID())` par :

```ts
  const requestId = useRef(etatRestaure?.requestId ?? crypto.randomUUID())
```

**3e.** Ajouter l'effet d'écriture juste après la déclaration de `requestId` et `rechercheRef` :

```ts
  // Persist on every cart-affecting change. An empty cart purges the entry,
  // which covers both exits for free: successful checkout and "vider le
  // panier" both end on setLignes([]).
  useEffect(() => {
    if (lignes.length === 0) {
      purger(cle)
      return
    }
    enregistrer(cle, {
      v: 1,
      lignes,
      requestId: requestId.current,
      verrouille: panierVerrouille,
      majA: new Date().toISOString(),
    })
  }, [cle, lignes, panierVerrouille])
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run : `bun run --cwd apps/web test -- src/pos/ecran-vente.test.tsx`
Expected : PASS — y compris les tests de verrouillage préexistants du fichier.

Puis la suite complète : `bun run --cwd apps/web test` → tout vert. Puis `bun run typecheck`.

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/pos/ecran-vente.tsx apps/web/src/pos/ecran-vente.test.tsx
git commit -m "feat(pos): restauration et sauvegarde du panier en cours"
```

---

### Task 4 : Revalidation au montage + bandeau + marquage visuel

**Files:**
- Modify: `apps/web/src/pos/ecran-vente.tsx`
- Modify: `apps/web/src/pos/panier.tsx`
- Modify: `apps/web/src/pos/ecran-vente.test.tsx`

**Interfaces:**
- Consumes: `revaliderPanier` (Task 2), `etatRestaure` / `cle` (Task 3).

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter dans le bloc `describe("EcranVente — persistance du panier", …)` de `apps/web/src/pos/ecran-vente.test.tsx` :

```ts
  function panierStocke(quantite: number, prixCatalogue: number) {
    return JSON.stringify({
      v: 1,
      lignes: [
        {
          variantId: "v1",
          nom: "Coca 50cl",
          sku: "SKU1",
          imageKey: null,
          quantite,
          prixUnitaire: 500,
          prixCatalogue,
          prixPlancher: null,
          sourceWarehouseId: null,
          sourceNom: null,
          enAlerte: false,
        },
      ],
      requestId: "req-1",
      verrouille: false,
      majA: "2026-07-19T10:00:00.000Z",
    })
  }

  it("signale un prix catalogue modifié depuis la mise au panier", async () => {
    // Stocké à 450, catalogue à 500 → 1 prix modifié, 0 retrait.
    localStorage.setItem(CLE, panierStocke(1, 450))
    renderEcran()
    expect(
      await screen.findByText(/Panier restauré/)
    ).toBeInTheDocument()
    expect(screen.getByText(/1 prix modifié/)).toBeInTheDocument()
  })

  it("retire une ligne dont l'article a disparu du catalogue", async () => {
    vi.spyOn(posApi, "fetchCataloguePos").mockResolvedValue({
      articles: [],
      categories: [],
    })
    localStorage.setItem(CLE, panierStocke(1, 500))
    renderEcran()
    expect(await screen.findByText(/Panier restauré/)).toBeInTheDocument()
    expect(screen.getByText(/1 article\(s\) retiré/)).toBeInTheDocument()
    // Discriminant : plus aucune LIGNE de panier pour cet article.
    expect(
      screen.queryByRole("button", { name: "Retirer Coca 50cl" })
    ).not.toBeInTheDocument()
  })

  it("n'affiche aucun bandeau si rien n'a changé", async () => {
    localStorage.setItem(CLE, panierStocke(1, 500))
    renderEcran()
    await screen.findByRole("button", { name: /Coca 50cl/ })
    expect(screen.queryByText(/Panier restauré/)).not.toBeInTheDocument()
  })
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run : `bun run --cwd apps/web test -- src/pos/ecran-vente.test.tsx`
Expected : FAIL — aucun bandeau « Panier restauré », la ligne disparue reste affichée.

- [ ] **Step 3 : Implémenter la revalidation et le bandeau**

Dans `apps/web/src/pos/ecran-vente.tsx` :

**3a.** Compléter l'import de Task 3 pour inclure `revaliderPanier` :

```ts
import {
  clePanier,
  charger,
  enregistrer,
  purger,
  revaliderPanier,
} from "@/lib/panier-persistance"
```

**3b.** Ajouter, juste après l'effet d'écriture de Task 3 :

```ts
  // One-shot revalidation of a RESTORED cart, run when the catalogue first
  // arrives. The ref guard means a cart typed normally is never revalidated
  // and later catalogue refetches never replay it.
  const aRevalider = useRef((etatRestaure?.lignes.length ?? 0) > 0)
  const [resumeRestauration, setResumeRestauration] = useState<{
    retirees: number
    prixModifies: number
  } | null>(null)
  useEffect(() => {
    if (!aRevalider.current || !catalogue.isSuccess) return
    aRevalider.current = false
    const resultat = revaliderPanier(lignes, articles)
    if (resultat.retirees === 0 && resultat.prixModifies === 0) return
    setLignes(resultat.lignes)
    setResumeRestauration({
      retirees: resultat.retirees,
      prixModifies: resultat.prixModifies,
    })
  }, [catalogue.isSuccess, articles, lignes])
```

**3c.** Afficher le bandeau. Repérer le bloc qui ouvre la colonne du panier :

```tsx
        <div className="flex w-96 shrink-0">
          <Panier
```

et le remplacer par :

```tsx
        <div className="flex w-96 shrink-0 flex-col">
          {resumeRestauration && (
            <div
              role="status"
              className="mb-2 flex items-start justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs"
            >
              <p>
                Panier restauré
                {resumeRestauration.retirees > 0 &&
                  ` — ${resumeRestauration.retirees} article(s) retiré(s)`}
                {resumeRestauration.prixModifies > 0 &&
                  ` — ${resumeRestauration.prixModifies} prix modifié(s)`}
              </p>
              <button
                type="button"
                className="shrink-0 font-medium underline"
                onClick={() => setResumeRestauration(null)}
              >
                Fermer
              </button>
            </div>
          )}
          <Panier
```

**3d.** Marquer la ligne concernée dans `apps/web/src/pos/panier.tsx`. Remplacer :

```tsx
              className={cn(
                "border-b px-3 py-2.5",
                ligne.enAlerte && "bg-destructive/10"
              )}
```

par :

```tsx
              className={cn(
                "border-b px-3 py-2.5",
                ligne.enAlerte && "bg-destructive/10",
                !ligne.enAlerte && ligne.prixModifie && "bg-warning/10"
              )}
```

et, juste après le bloc existant :

```tsx
              {ligne.enAlerte && (
                <p className="mt-1 text-xs font-semibold text-destructive">
                  Stock insuffisant
                </p>
              )}
```

ajouter :

```tsx
              {ligne.prixModifie && (
                <p className="mt-1 text-xs font-semibold text-warning">
                  Prix catalogue modifié depuis la mise au panier
                </p>
              )}
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run : `bun run --cwd apps/web test -- src/pos/ecran-vente.test.tsx`
Expected : PASS.

Puis la suite complète : `bun run --cwd apps/web test` → tout vert. Puis `bun run typecheck` et `bun run lint`.

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/pos/ecran-vente.tsx apps/web/src/pos/panier.tsx apps/web/src/pos/ecran-vente.test.tsx
git commit -m "feat(pos): revalidation catalogue et bandeau de panier restauré"
```

---

## Validation finale (après les 4 tâches)

- [ ] Suite web complète verte : `bun run --cwd apps/web test`
- [ ] `bun run typecheck` et `bun run lint` propres
- [ ] **E2E navigateur** sur l'app locale (`http://localhost:3000`, compte `owner@exemple.com` / `OwnerLocal!2026`) :
  1. ouvrir une session de caisse, ajouter 2-3 articles au panier ;
  2. **rafraîchir la page** → le panier réapparaît à l'identique, sans modale ;
  3. encaisser → le panier se vide et l'entrée `localStorage` disparaît (vérifier dans les DevTools : clé `pos:panier:<boutique>:<session>`) ;
  4. ajouter un article, fermer la caisse, rouvrir une session → le panier n'est **pas** restauré (portée par session).
