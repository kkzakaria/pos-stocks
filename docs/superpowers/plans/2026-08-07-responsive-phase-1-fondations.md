# SPA responsive — Phase 1 : Fondations + POS + deux tables témoins — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poser les fondations responsive de la SPA (hook de breakpoint, composant liste adaptative, tiroir de navigation, correctifs de lisibilité) et les éprouver immédiatement sur l'écran de vente POS et deux tables réelles.

**Architecture:** Un hook `useMediaQuery` gouverne les bascules **structurelles** (quel arbre est monté) ; le CSS gouverne les ajustements **dimensionnels** (largeurs). Un composant `ListeAdaptative` rend soit une `Table`, soit une liste de cartes hiérarchisées, jamais les deux. Le tiroir de navigation s'appuie sur `Drawer` de `@base-ui/react` via un wrapper maison. Aucune API, aucun schéma, aucune règle d'autorisation n'est touché.

**Tech Stack:** React 19, TanStack Router, Tailwind CSS v4 (config CSS dans `styles.css`), `@base-ui/react` 1.6.0, Vitest 3 + Testing Library + jsdom.

## Global Constraints

- **Langue** : UI, messages d'erreur et messages de commit (conventionnels) en **français** ; commentaires de code et JSDoc en **anglais**.
- **Écriture mobile-first** : styles de base pour le petit écran, `min-width` pour enrichir. **Jamais de `max-width`.**
- **Aucun breakpoint personnalisé** ajouté à `styles.css`. Paliers Tailwind par défaut uniquement : `md` = 48rem (768 px), `lg` = 64rem (1024 px).
- **Aucune donnée masquée selon la largeur d'écran.** Le front masque selon le **rôle**, jamais selon la **taille**.
- **Aucun changement d'identité visuelle** : pas de nouvelle palette, pas de nouvelle fonte, pas de `clamp()`, pas de couleur en dur — tokens uniquement (`bg-sidebar`, `bg-card`, `text-muted-foreground`…).
- **Aucune nouvelle dépendance.**
- **`index.html` n'est pas modifié.**
- **Tout nouveau portail porte `print:hidden`.**
- Montants via `formaterMontant` (`@/lib/format`) ; colonnes de chiffres en `tabular-nums`.
- Pièges eslint du dépôt : `no-unnecessary-condition` (annoter `| null` les retours de lookups), types dans un `import type` séparé, `no-irregular-whitespace`. Base-ui : `render={…}`, **jamais `asChild`**.
- Tests : espaces insécables étroites (U+202F) dans les montants `fr-FR` — utiliser les helpers regex existants (`texteMontant`), **jamais** `getByText(formaterMontant(x))`.
- Hooks husky actifs (pre-commit : lint-staged + typecheck ; pre-push : suites complètes). **Jamais `--no-verify`.**
- Fichiers générés, jamais édités à la main : `apps/web/src/routeTree.gen.ts`.
- Spec de référence : `docs/superpowers/specs/2026-08-07-spa-responsive-design.md`.

---

## Structure de fichiers

**Créés :**

| Fichier | Responsabilité |
|---|---|
| `apps/web/src/lib/use-media-query.ts` | Hook de breakpoint, dégrade vers desktop sans `matchMedia` |
| `apps/web/src/test/media-query.ts` | Helper de test pour simuler une largeur |
| `apps/web/src/components/ui/liste-adaptative.tsx` | Table ≥ `md`, cartes hiérarchisées en dessous |
| `apps/web/src/components/ui/drawer.tsx` | Wrapper maison sur `Drawer` base-ui |
| `apps/web/src/components/entete-mobile.tsx` | En-tête + bouton hamburger sous `lg` |
| `apps/web/src/pos/barre-synthese.tsx` | Barre persistante du POS sous `md` |

**Modifiés :**

| Fichier | Modification |
|---|---|
| `apps/web/src/styles.css` | Redéfinition mobile-first de `--text-xs` |
| `apps/web/src/components/ui/input.tsx` · `textarea.tsx` | `pointer-coarse:text-base` |
| `apps/web/DESIGN.md` | Documente le palier typographique |
| `apps/web/src/routes/_app.tsx` | Sidebar ≥ `lg`, tiroir en dessous |
| `apps/web/src/routes/_app/stock/mouvements.tsx` | Passe par `ListeAdaptative` |
| `apps/web/src/routes/_app/ventes/index.tsx` | Passe par `ListeAdaptative` |
| `apps/web/src/pos/ecran-vente.tsx` | Paliers 288/384 px, barre de synthèse, panneau panier |

---

### Task 1 : Hook de breakpoint et helper de test

Fondation de toutes les bascules structurelles. Le point délicat : **le hook doit fonctionner sans `matchMedia`** (jsdom), en dégradant vers le palier desktop — c'est ce qui permet aux ~30 fichiers de test d'écran existants de rester inchangés.

**Files:**
- Create: `apps/web/src/lib/use-media-query.ts`
- Create: `apps/web/src/test/media-query.ts`
- Test: `apps/web/src/lib/use-media-query.test.tsx`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `useMediaQuery(requete: string): boolean`
  - `useEstDesktop(): boolean` — `min-width: 64rem` (palier `lg`)
  - `useEstLarge(): boolean` — `min-width: 48rem` (palier `md`)
  - `installerMatchMedia(largeurPx: number): () => void` (helper de test, rend une fonction de nettoyage)

- [ ] **Step 1: Écrire le test qui échoue**

Créer `apps/web/src/lib/use-media-query.test.tsx` :

```tsx
import { renderHook } from "@testing-library/react"
import { useEstLarge, useEstDesktop } from "./use-media-query"
import { installerMatchMedia } from "@/test/media-query"

describe("useMediaQuery", () => {
  it("dégrade vers desktop quand matchMedia est absent", () => {
    expect(window.matchMedia).toBeUndefined()
    expect(renderHook(() => useEstLarge()).result.current).toBe(true)
    expect(renderHook(() => useEstDesktop()).result.current).toBe(true)
  })

  it("détecte un téléphone à 375 px", () => {
    const nettoyer = installerMatchMedia(375)
    expect(renderHook(() => useEstLarge()).result.current).toBe(false)
    expect(renderHook(() => useEstDesktop()).result.current).toBe(false)
    nettoyer()
  })

  it("détecte une tablette à 768 px : large mais pas desktop", () => {
    const nettoyer = installerMatchMedia(768)
    expect(renderHook(() => useEstLarge()).result.current).toBe(true)
    expect(renderHook(() => useEstDesktop()).result.current).toBe(false)
    nettoyer()
  })

  it("détecte un desktop à 1280 px", () => {
    const nettoyer = installerMatchMedia(1280)
    expect(renderHook(() => useEstDesktop()).result.current).toBe(true)
    nettoyer()
  })

  it("restaure l'absence de matchMedia après nettoyage", () => {
    installerMatchMedia(375)()
    expect(window.matchMedia).toBeUndefined()
  })
})
```

Le premier et le dernier cas verrouillent la propriété qui protège les tests existants : sans helper, `matchMedia` reste absent et le hook répond « desktop ».

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun run --cwd apps/web test -- use-media-query`
Expected: FAIL — `Cannot find module './use-media-query'`.

- [ ] **Step 3: Écrire le hook**

Créer `apps/web/src/lib/use-media-query.ts` :

```ts
import { useEffect, useState } from "react"

/** `md` breakpoint (48rem / 768px) — tables become tables again. */
const REQUETE_LARGE = "(min-width: 48rem)"
/** `lg` breakpoint (64rem / 1024px) — the sidebar becomes permanent. */
const REQUETE_DESKTOP = "(min-width: 64rem)"

function lire(requete: string): boolean {
  // jsdom implements neither matchMedia nor a layout engine. Degrading to the
  // desktop tier keeps every existing screen test rendering the same tree it
  // rendered before this feature existed; card-mode tests opt in explicitly
  // through the test helper.
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true
  }
  return window.matchMedia(requete).matches
}

/**
 * Structural breakpoint hook. Governs which component tree is mounted —
 * never use it for purely dimensional tweaks, which belong in CSS.
 */
export function useMediaQuery(requete: string): boolean {
  const [correspond, setCorrespond] = useState(() => lire(requete))

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return
    const liste = window.matchMedia(requete)
    const surChangement = (e: MediaQueryListEvent) => setCorrespond(e.matches)
    setCorrespond(liste.matches)
    liste.addEventListener("change", surChangement)
    return () => liste.removeEventListener("change", surChangement)
  }, [requete])

  return correspond
}

/** True from the `md` tier up (≥ 768px). */
export function useEstLarge(): boolean {
  return useMediaQuery(REQUETE_LARGE)
}

/** True from the `lg` tier up (≥ 1024px). */
export function useEstDesktop(): boolean {
  return useMediaQuery(REQUETE_DESKTOP)
}
```

- [ ] **Step 4: Écrire le helper de test**

Créer `apps/web/src/test/media-query.ts` :

```ts
/**
 * Installs a minimal matchMedia backed by a fixed viewport width, and returns
 * a cleanup function that removes it again. Deliberately NOT registered in
 * test-setup.ts: a global stub would break theme.test.tsx, which asserts the
 * production code's behaviour when matchMedia is unavailable.
 *
 * Only `(min-width: <n>rem)` queries are understood — the only form the app
 * uses.
 */
export function installerMatchMedia(largeurPx: number): () => void {
  const precedent = Object.getOwnPropertyDescriptor(window, "matchMedia")

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (requete: string): MediaQueryList => {
      const rem = /\(min-width:\s*([\d.]+)rem\)/.exec(requete)
      const seuilPx = rem ? Number(rem[1]) * 16 : 0
      return {
        matches: largeurPx >= seuilPx,
        media: requete,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      } as MediaQueryList
    },
  })

  return () => {
    if (precedent) Object.defineProperty(window, "matchMedia", precedent)
    else delete (window as { matchMedia?: unknown }).matchMedia
  }
}
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il passe**

Run: `bun run --cwd apps/web test -- use-media-query`
Expected: 5 cas PASS.

- [ ] **Step 6: Vérifier l'absence de régression sur la suite web**

Run: `bun run --cwd apps/web test`
Expected: suite entière verte, `theme.test.tsx` compris — aucun test existant ne doit avoir bougé.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/use-media-query.ts apps/web/src/lib/use-media-query.test.tsx apps/web/src/test/media-query.ts
git commit -m "feat(web): ajoute le hook de breakpoint et son helper de test"
```

---

### Task 2 : Correctifs de lisibilité mobile

Deux défauts avérés. Le premier supprime le zoom au focus sur iOS/iPadOS, le second remonte la taille de texte sous 768 px par un point unique.

**Files:**
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/components/ui/input.tsx:17`
- Modify: `apps/web/src/components/ui/textarea.tsx:11`
- Modify: `apps/web/DESIGN.md`
- Test: `apps/web/src/components/ui/input.test.tsx`

**Interfaces:**
- Consumes: rien.
- Produces: aucun export nouveau. Effet global : `--text-xs` vaut `0.875rem` sous 48rem et `0.75rem` au-delà.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `apps/web/src/components/ui/input.test.tsx` :

```tsx
import { render, screen } from "@testing-library/react"
import { Input } from "./input"
import { Textarea } from "./textarea"

describe("cibles tactiles et lisibilité", () => {
  it("porte text-base sur pointeur grossier pour empêcher le zoom iOS", () => {
    render(<Input aria-label="Champ" />)
    expect(screen.getByLabelText("Champ").className).toContain(
      "pointer-coarse:text-base"
    )
  })

  it("applique la même règle au textarea", () => {
    render(<Textarea aria-label="Zone" />)
    expect(screen.getByLabelText("Zone").className).toContain(
      "pointer-coarse:text-base"
    )
  })

  it("conserve la taille dense sur pointeur fin à partir de md", () => {
    render(<Input aria-label="Champ" />)
    expect(screen.getByLabelText("Champ").className).toContain(
      "md:text-xs/relaxed"
    )
  })
})
```

Le troisième cas est un garde-fou : il empêche qu'on « corrige » le zoom en supprimant la densité desktop.

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun run --cwd apps/web test -- input`
Expected: les deux premiers cas ÉCHOUENT (classe absente), le troisième passe déjà.

- [ ] **Step 3: Ajouter `pointer-coarse:text-base` aux deux primitives**

Dans `apps/web/src/components/ui/input.tsx:17`, la chaîne de classes se termine aujourd'hui par `pointer-coarse:min-h-11`. La remplacer par :

```
pointer-coarse:min-h-11 pointer-coarse:text-base
```

Dans `apps/web/src/components/ui/textarea.tsx:11`, ajouter `pointer-coarse:text-base` en fin de chaîne (ce composant n'a pas de `pointer-coarse:min-h-11`, ne pas en ajouter un).

Le discriminant est la **capacité du pointeur**, pas la largeur : un iPad portrait fait 768–834 px et tomberait dans `md`, donc un correctif par largeur l'aurait laissé exposé au zoom.

- [ ] **Step 4: Redéfinir `--text-xs` en mobile-first**

Dans `apps/web/src/styles.css`, après le bloc `@theme inline { … }` (qui se termine ligne 53) et avant `:root { --background: … }`, insérer :

```css
/* Tailwind emits `.text-xs { font-size: var(--text-xs) }`, so redefining the
   variable retunes all ~96 hardcoded `text-xs` in one place — there is no
   central body font-size in this project. The paired line-height token is
   unitless (calc(1 / 0.75)), so it follows automatically.
   Deliberately broad: small labels (nav sections, timestamps, badges) grow on
   phones too, which is the point. Mobile-first — the larger value is the
   default, `md` restores density. */
:root {
    --text-xs: 0.875rem;
}

@media (width >= 48rem) {
    :root {
        --text-xs: 0.75rem;
    }
}
```

Vérifié empiriquement avant rédaction de ce plan : le CSS compilé contient bien `.text-xs{font-size:var(--text-xs);line-height:var(--tw-leading,var(--text-xs--line-height))}` et `--text-xs:.75rem`. La redéfinition non-layered l'emporte sur la valeur du thème Tailwind.

- [ ] **Step 5: Lancer le test pour vérifier qu'il passe**

Run: `bun run --cwd apps/web test -- input`
Expected: 3 cas PASS.

- [ ] **Step 6: Documenter le palier dans DESIGN.md**

Dans `apps/web/DESIGN.md`, sous l'entrée `typography.body`, ajouter une note indiquant que `fontSize` vaut `0.875rem` sous 48rem et `0.75rem` au-delà, et que le mécanisme est la redéfinition du token `--text-xs` dans `styles.css`. Sans cette note, le document décrit un système qui n'existe plus.

- [ ] **Step 7: Vérification visuelle au navigateur**

Lancer `bun run --cwd apps/web dev` (et l'API : `bun run --cwd apps/api dev`). Se connecter avec `owner@exemple.com` / `OwnerLocal!2026`.

Vérifier à **375 px**, **768 px** et **1280 px**, sur au moins quatre écrans **non réécrits par cette phase** (tableau de bord, catalogue/produits, administration/utilisateurs, stock/niveaux) :
- le texte grossit bien sous 768 px et redevient dense au-dessus ;
- aucun débordement, aucun chevauchement, aucun bouton dont le libellé casse ;
- les contrôles `h-7` restent cohérents avec leur texte agrandi ;
- **en thème sombre aussi**.

Cette étape est large **par conception** : la redéfinition touche ~96 occurrences et pas seulement les écrans de la phase. Consigner ce qui a été regardé.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/styles.css apps/web/src/components/ui/input.tsx apps/web/src/components/ui/textarea.tsx apps/web/src/components/ui/input.test.tsx apps/web/DESIGN.md
git commit -m "feat(web): remonte la lisibilité sur petit écran et supprime le zoom iOS"
```

---

### Task 3 : Composant `ListeAdaptative`

Le point de bascule du chantier. Rend une `Table` à partir de `md`, une liste de **cartes hiérarchisées** en dessous — jamais les deux. À 8 colonnes, un empilement uniforme de paires serait illisible : la carte impose une ligne de titre dominante.

**Files:**
- Create: `apps/web/src/components/ui/liste-adaptative.tsx`
- Test: `apps/web/src/components/ui/liste-adaptative.test.tsx`

**Interfaces:**
- Consumes: `useEstLarge` (Task 1), `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell` et `TableSkeleton` (existants), `Skeleton` (existant), `cn`.
- Produces:
  - `type ColonneAdaptative<T> = { cle: string; entete: React.ReactNode; cellule: (ligne: T) => React.ReactNode; numeric?: boolean; libelle?: React.ReactNode; masquerEnCarte?: boolean }`
  - `ListeAdaptative<T>(props): JSX.Element` avec
    `{ colonnes, lignes, cle, titre, valeur?, sousTitre?, chargement?, etatVide?, containerClassName?, actionCarte? }`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `apps/web/src/components/ui/liste-adaptative.test.tsx` :

```tsx
import { render, screen } from "@testing-library/react"
import { ListeAdaptative } from "./liste-adaptative"
import type { ColonneAdaptative } from "./liste-adaptative"
import { installerMatchMedia } from "@/test/media-query"

type Mouvement = { id: string; article: string; delta: number; motif: string }

const LIGNES: Mouvement[] = [
  { id: "1", article: "Ciment 50kg", delta: 12, motif: "Réception" },
  { id: "2", article: "Sable fin", delta: -3, motif: "Vente" },
]

const COLONNES: ColonneAdaptative<Mouvement>[] = [
  { cle: "article", entete: "Article", cellule: (l) => l.article, masquerEnCarte: true },
  { cle: "delta", entete: "Delta", numeric: true, cellule: (l) => l.delta, masquerEnCarte: true },
  { cle: "motif", entete: "Motif", cellule: (l) => l.motif },
]

function afficher(extra?: Partial<React.ComponentProps<typeof ListeAdaptative<Mouvement>>>) {
  return render(
    <ListeAdaptative<Mouvement>
      colonnes={COLONNES}
      lignes={LIGNES}
      cle={(l) => l.id}
      titre={(l) => l.article}
      valeur={(l) => l.delta}
      {...extra}
    />
  )
}

describe("ListeAdaptative", () => {
  it("rend une table à partir de md", () => {
    const nettoyer = installerMatchMedia(1280)
    afficher()
    expect(screen.getByRole("table")).toBeTruthy()
    expect(screen.getAllByRole("row")).toHaveLength(3) // en-tête + 2 lignes
    nettoyer()
  })

  it("rend des cartes sous md, sans table", () => {
    const nettoyer = installerMatchMedia(375)
    afficher()
    expect(screen.queryByRole("table")).toBeNull()
    expect(screen.getAllByRole("listitem")).toHaveLength(2)
    nettoyer()
  })

  it("ne duplique jamais une valeur entre les deux modes", () => {
    const nettoyer = installerMatchMedia(375)
    afficher()
    expect(screen.getAllByText("Ciment 50kg")).toHaveLength(1)
    nettoyer()
  })

  it("affiche le titre et la valeur en tête de carte, les autres en paires", () => {
    const nettoyer = installerMatchMedia(375)
    afficher()
    const carte = screen.getAllByRole("listitem")[0]!
    expect(carte.textContent).toContain("Ciment 50kg")
    expect(carte.textContent).toContain("12")
    // `motif` n'est pas masqué : il apparaît en paire libellé/valeur.
    expect(carte.textContent).toContain("Motif")
    expect(carte.textContent).toContain("Réception")
    nettoyer()
  })

  it("n'affiche pas le libellé des colonnes masquées en carte", () => {
    const nettoyer = installerMatchMedia(375)
    afficher()
    const carte = screen.getAllByRole("listitem")[0]!
    expect(carte.textContent).not.toContain("Article")
    nettoyer()
  })

  it("rend l'état vide dans les deux modes", () => {
    for (const largeur of [375, 1280]) {
      const nettoyer = installerMatchMedia(largeur)
      const { unmount } = afficher({ lignes: [], etatVide: <p>Aucun mouvement</p> })
      expect(screen.getByText("Aucun mouvement")).toBeTruthy()
      unmount()
      nettoyer()
    }
  })

  it("rend un squelette pendant le chargement dans les deux modes", () => {
    for (const largeur of [375, 1280]) {
      const nettoyer = installerMatchMedia(largeur)
      const { container, unmount } = afficher({ chargement: true })
      expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
      unmount()
      nettoyer()
    }
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun run --cwd apps/web test -- liste-adaptative`
Expected: FAIL — `Cannot find module './liste-adaptative'`.

- [ ] **Step 3: Écrire le composant**

Créer `apps/web/src/components/ui/liste-adaptative.tsx` :

```tsx
import type { ReactNode } from "react"
import { useEstLarge } from "@/lib/use-media-query"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TableSkeleton } from "@/components/ui/table-skeleton"

export type ColonneAdaptative<T> = {
  /** Stable identifier, also the React key. */
  cle: string
  entete: ReactNode
  cellule: (ligne: T) => ReactNode
  /** Right-aligned, tabular figures — for amounts and quantities. */
  numeric?: boolean
  /** Label used in card mode; falls back to `entete`. */
  libelle?: ReactNode
  /** Already carried by the card head (titre/valeur/sousTitre): skip the pair. */
  masquerEnCarte?: boolean
}

type Props<T> = {
  colonnes: ColonneAdaptative<T>[]
  lignes: T[]
  cle: (ligne: T) => string
  /** Card mode: the dominant identity line. */
  titre: (ligne: T) => ReactNode
  /** Card mode: trailing value on the title line (amount, delta). */
  valeur?: (ligne: T) => ReactNode
  /** Card mode: secondary line under the title (usually a date). */
  sousTitre?: (ligne: T) => ReactNode
  chargement?: boolean
  etatVide?: ReactNode
  /** Forwarded to Table: the sticky header needs this to be the scroll box. */
  containerClassName?: string
  /** Card mode: trailing action (e.g. a details link). */
  actionCarte?: (ligne: T) => ReactNode
}

/**
 * Renders a dense table from the `md` tier up, and a list of hierarchical
 * cards below it. Only one of the two trees is ever mounted: duplicating the
 * DOM would make screen readers announce every row twice and would double the
 * render cost of long tables on the modest hardware this product targets.
 *
 * Card layout is deliberately not a flat list of label/value pairs — at eight
 * columns that is a wall of text. The identity of the row goes on a dominant
 * title line, its headline figure sits opposite it, and only the remaining
 * columns become pairs underneath.
 */
export function ListeAdaptative<T>({
  colonnes,
  lignes,
  cle,
  titre,
  valeur,
  sousTitre,
  chargement = false,
  etatVide,
  containerClassName,
  actionCarte,
}: Props<T>) {
  const estLarge = useEstLarge()

  if (estLarge) {
    return (
      <Table containerClassName={containerClassName}>
        <TableHeader sticky>
          <TableRow>
            {colonnes.map((c) => (
              <TableHead key={c.cle} numeric={c.numeric}>
                {c.entete}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {chargement ? (
            <TableSkeleton colonnes={colonnes.length} />
          ) : lignes.length === 0 ? (
            <TableRow>
              <TableCell colSpan={colonnes.length}>{etatVide}</TableCell>
            </TableRow>
          ) : (
            lignes.map((ligne) => (
              <TableRow key={cle(ligne)}>
                {colonnes.map((c) => (
                  <TableCell key={c.cle} numeric={c.numeric}>
                    {c.cellule(ligne)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    )
  }

  if (chargement) {
    return (
      <div className={cn("flex flex-col gap-2", containerClassName)}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-md border p-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="mt-2 h-3 w-1/3" />
          </div>
        ))}
      </div>
    )
  }

  if (lignes.length === 0) {
    return <div className={containerClassName}>{etatVide}</div>
  }

  const paires = colonnes.filter((c) => !c.masquerEnCarte)

  return (
    <ul className={cn("flex flex-col gap-2", containerClassName)}>
      {lignes.map((ligne) => (
        <li key={cle(ligne)} className="rounded-md border bg-card p-3">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 flex-1 font-medium break-words">
              {titre(ligne)}
            </p>
            {valeur && (
              <span className="shrink-0 font-medium tabular-nums">
                {valeur(ligne)}
              </span>
            )}
          </div>
          {sousTitre && (
            <p className="mt-0.5 text-muted-foreground">{sousTitre(ligne)}</p>
          )}
          {paires.length > 0 && (
            <dl className="mt-2 flex flex-col gap-1">
              {paires.map((c) => (
                <div key={c.cle} className="flex justify-between gap-3">
                  <dt className="shrink-0 text-muted-foreground">
                    {c.libelle ?? c.entete}
                  </dt>
                  <dd
                    className={cn(
                      "min-w-0 text-right break-words",
                      c.numeric && "tabular-nums"
                    )}
                  >
                    {c.cellule(ligne)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {actionCarte && <div className="mt-2">{actionCarte(ligne)}</div>}
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `bun run --cwd apps/web test -- liste-adaptative`
Expected: 7 cas PASS.

Si `data-slot="skeleton"` ne correspond pas à l'attribut réel de `skeleton.tsx`, lire le composant et aligner l'assertion sur ce qu'il émet réellement — ne pas modifier `skeleton.tsx`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/liste-adaptative.tsx apps/web/src/components/ui/liste-adaptative.test.tsx
git commit -m "feat(web): ajoute la liste adaptative table/cartes"
```

---

### Task 4 : Wrapper `drawer.tsx`

`Drawer` de base-ui n'a **aucune prop `side`/`anchor`** : l'ancrage à gauche s'écrit en CSS sur le `Popup`, exactement comme `dialog.tsx` code son centrage. `Drawer.Portal` est **obligatoire** (le `Popup` lève une erreur sans lui).

**Files:**
- Create: `apps/web/src/components/ui/drawer.tsx`
- Test: `apps/web/src/components/ui/drawer.test.tsx`

**Interfaces:**
- Consumes: `Drawer` de `@base-ui/react/drawer`, `cn`, `Button`.
- Produces: exports `Drawer`, `DrawerClose`, `DrawerContent`, `DrawerDescription`, `DrawerOverlay`, `DrawerPortal`, `DrawerTitle`, `DrawerTrigger`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `apps/web/src/components/ui/drawer.test.tsx` :

```tsx
import { render, screen } from "@testing-library/react"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "./drawer"

function afficher(ouvert: boolean) {
  return render(
    <Drawer open={ouvert} onOpenChange={() => undefined}>
      <DrawerTrigger>Ouvrir le menu</DrawerTrigger>
      <DrawerContent>
        <DrawerTitle>Navigation</DrawerTitle>
        <DrawerDescription>Sections de l'application</DrawerDescription>
        <a href="/stock">Stock</a>
      </DrawerContent>
    </Drawer>
  )
}

describe("Drawer", () => {
  it("n'affiche pas le contenu tant qu'il est fermé", () => {
    afficher(false)
    expect(screen.getByText("Ouvrir le menu")).toBeTruthy()
    expect(screen.queryByText("Stock")).toBeNull()
  })

  it("affiche le contenu, son titre et sa description une fois ouvert", () => {
    afficher(true)
    expect(screen.getByText("Navigation")).toBeTruthy()
    expect(screen.getByText("Sections de l'application")).toBeTruthy()
    expect(screen.getByText("Stock")).toBeTruthy()
  })

  it("ancre le panneau à gauche et l'exclut de l'impression", () => {
    const { baseElement } = afficher(true)
    const panneau = baseElement.querySelector('[data-slot="drawer-content"]')
    expect(panneau).not.toBeNull()
    expect(panneau!.className).toContain("left-0")
    expect(panneau!.className).toContain("print:hidden")
    expect(panneau!.className).toContain("overscroll-contain")
  })
})
```

Le troisième cas verrouille les trois contraintes non négociables : ancrage CSS, exclusion de l'impression (le panneau est portalé sur `body` et échappe donc aux `print:hidden` ancêtres), et confinement du défilement.

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun run --cwd apps/web test -- drawer`
Expected: FAIL — `Cannot find module './drawer'`.

- [ ] **Step 3: Écrire le wrapper**

Créer `apps/web/src/components/ui/drawer.tsx`, en calquant la structure de `dialog.tsx` (fonctions nommées, `data-slot`, `cn(…, className)`, bloc `export { … }` final trié) :

```tsx
"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

function Drawer({ ...props }: DrawerPrimitive.Root.Props) {
  // swipeDirection only drives the dismiss gesture — anchoring is pure CSS
  // on the popup below. Keep the two consistent.
  return <DrawerPrimitive.Root data-slot="drawer" swipeDirection="left" {...props} />
}

function DrawerTrigger({ ...props }: DrawerPrimitive.Trigger.Props) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />
}

function DrawerPortal({ ...props }: DrawerPrimitive.Portal.Props) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />
}

function DrawerClose({ ...props }: DrawerPrimitive.Close.Props) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />
}

function DrawerOverlay({ className, ...props }: DrawerPrimitive.Backdrop.Props) {
  return (
    <DrawerPrimitive.Backdrop
      data-slot="drawer-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 print:hidden",
        className
      )}
      {...props}
    />
  )
}

function DrawerContent({
  className,
  children,
  ...props
}: DrawerPrimitive.Popup.Props) {
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Popup
        data-slot="drawer-content"
        className={cn(
          // Portalled onto <body>: it escapes any ancestor `print:hidden`,
          // hence its own. Anchoring is written here because base-ui exposes
          // no side/anchor prop.
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col gap-2 overflow-y-auto overscroll-contain border-r bg-sidebar p-4 text-sidebar-foreground outline-none duration-100 data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left print:hidden",
          className
        )}
        {...props}
      >
        {children}
        <DrawerPrimitive.Close
          data-slot="drawer-close"
          render={<Button variant="ghost" size="icon-sm" className="absolute top-2 right-2" />}
        >
          <XIcon />
          <span className="sr-only">Fermer</span>
        </DrawerPrimitive.Close>
      </DrawerPrimitive.Popup>
    </DrawerPortal>
  )
}

function DrawerTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("text-base font-semibold", className)}
      {...props}
    />
  )
}

function DrawerDescription({
  className,
  ...props
}: DrawerPrimitive.Description.Props) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
}
```

Si `size="icon-sm"` n'existe pas dans les variantes de `button.tsx`, lire le fichier et utiliser la variante de taille réellement disponible — ne pas en ajouter une.

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `bun run --cwd apps/web test -- drawer`
Expected: 3 cas PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/drawer.tsx apps/web/src/components/ui/drawer.test.tsx
git commit -m "feat(web): ajoute le wrapper drawer ancré à gauche"
```

---

### Task 5 : Coquille `_app` — sidebar ≥ `lg`, tiroir en dessous

La navigation est extraite dans un composant réutilisé par les deux modes, pour qu'aucun lien n'existe en double.

**Files:**
- Create: `apps/web/src/components/entete-mobile.tsx`
- Modify: `apps/web/src/routes/_app.tsx`
- Test: `apps/web/src/routes/_app.test.tsx`

**Interfaces:**
- Consumes: `useEstDesktop` (Task 1), `Drawer`/`DrawerContent`/`DrawerTitle`/`DrawerDescription` (Task 4).
- Produces: `EnteteMobile({ onOuvrir }: { onOuvrir: () => void })`.

- [ ] **Step 1: Extraire la navigation sans changer de comportement**

Dans `apps/web/src/routes/_app.tsx`, extraire tout le contenu de `<nav aria-label="Navigation principale">…</nav>` — ainsi que les calculs `estAdmin`, `accesStock`, `accesPos`, `accesVentes`, `accesRapports` et le composant `BadgeAlertesStock` — dans un composant local `NavigationPrincipale({ me }: { me: Me })` **du même fichier**. `AppLayout` l'appelle à l'identique. Aucun changement visuel à ce stade.

Vérifier : `bun run --cwd apps/web test` reste vert, et l'app est inchangée au navigateur.

- [ ] **Step 2: Écrire le test qui échoue**

Créer `apps/web/src/routes/_app.test.tsx`. Le composant `AppLayout` est couplé au routeur : tester **`EnteteMobile`** et la bascule structurelle, pas la route entière.

```tsx
import { render, screen } from "@testing-library/react"
import { EnteteMobile } from "@/components/entete-mobile"

describe("EnteteMobile", () => {
  it("expose un bouton de menu accessible", () => {
    render(<EnteteMobile onOuvrir={() => undefined} />)
    expect(screen.getByRole("button", { name: "Ouvrir le menu" })).toBeTruthy()
  })

  it("déclenche l'ouverture au clic", () => {
    let ouvert = false
    render(<EnteteMobile onOuvrir={() => (ouvert = true)} />)
    screen.getByRole("button", { name: "Ouvrir le menu" }).click()
    expect(ouvert).toBe(true)
  })
})
```

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

Run: `bun run --cwd apps/web test -- _app`
Expected: FAIL — `Cannot find module '@/components/entete-mobile'`.

- [ ] **Step 4: Écrire l'en-tête mobile**

Créer `apps/web/src/components/entete-mobile.tsx` :

```tsx
import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"

/** Compact bar shown below the `lg` tier, where the sidebar is a drawer. */
export function EnteteMobile({ onOuvrir }: { onOuvrir: () => void }) {
  return (
    <header className="flex items-center gap-2 border-b bg-sidebar px-3 py-2 text-sidebar-foreground lg:hidden print:hidden">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Ouvrir le menu"
        onClick={onOuvrir}
      >
        <Menu />
      </Button>
      <span className="font-semibold">pos-stocks</span>
    </header>
  )
}
```

- [ ] **Step 5: Brancher la bascule dans `_app.tsx`**

Dans `AppLayout` : ajouter `const estDesktop = useEstDesktop()` et `const [menuOuvert, setMenuOuvert] = useState(false)`.

Remplacer la structure de retour par : `<div className="flex min-h-screen flex-col lg:flex-row">`, le lien d'évitement inchangé **en premier**, puis

- si `estDesktop` : l'`<aside>` actuel, inchangé ;
- sinon : `<EnteteMobile onOuvrir={() => setMenuOuvert(true)} />` plus

```tsx
<Drawer open={menuOuvert} onOpenChange={setMenuOuvert}>
  <DrawerContent>
    <DrawerTitle>Navigation</DrawerTitle>
    <DrawerDescription className="sr-only">
      Sections de l'application
    </DrawerDescription>
    <NavigationPrincipale me={me} />
    <div className="mt-auto border-t border-sidebar-border pt-2">
      <UserMenu me={me} onSignOut={handleSignOut} />
    </div>
  </DrawerContent>
</Drawer>
```

Le `<main>` reste tel quel, en ajustant son padding : `p-4 lg:p-6`.

**Fermeture à la navigation** : ajouter dans `AppLayout`

```tsx
const chemin = useRouterState({ select: (s) => s.location.pathname })
useEffect(() => setMenuOuvert(false), [chemin])
```

(`useRouterState` vient de `@tanstack/react-router`.) Sans cela, le tiroir reste ouvert par-dessus la page qu'on vient d'atteindre.

Le tiroir n'est monté **que** sous `lg` : la navigation n'existe jamais en double dans le DOM, ni pour les lecteurs d'écran.

- [ ] **Step 6: Lancer les tests**

```bash
bun run --cwd apps/web test -- _app
bun run --cwd apps/web test
```
Expected: les 2 nouveaux cas PASS, suite entière verte.

- [ ] **Step 7: Vérification au navigateur**

À **375 px**, **768 px** et **1280 px** :
- à 1280 px, la sidebar est identique à avant ce chantier ;
- à 375 et 768 px, l'en-tête et le hamburger apparaissent, le tiroir s'ouvre et se ferme au `Escape`, au clic sur le fond, au glissement vers la gauche, et **automatiquement à la navigation** ;
- le focus part sur le tiroir à l'ouverture et **revient au bouton hamburger** à la fermeture ;
- le lien « Aller au contenu » reste le premier élément focusable au clavier ;
- thème sombre vérifié.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/entete-mobile.tsx apps/web/src/routes/_app.tsx apps/web/src/routes/_app.test.tsx
git commit -m "feat(web): replie la navigation en tiroir sous le palier lg"
```

---

### Task 6 : Table témoin 1 — journal des mouvements

8 colonnes : la borne haute du produit. C'est cette table qui valide que la hiérarchie de carte tient.

**Files:**
- Modify: `apps/web/src/routes/_app/stock/mouvements.tsx:182-241`
- Test: `apps/web/src/routes/_app/stock/mouvements.test.tsx`

**Interfaces:**
- Consumes: `ListeAdaptative`, `ColonneAdaptative` (Task 3).
- Produces: rien de réutilisable.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `apps/web/src/routes/_app/stock/mouvements.test.tsx` testant le **tableau de colonnes exporté**, pas la route (couplée au routeur et à la query). Extraire d'abord la définition des colonnes dans une constante exportée `COLONNES_MOUVEMENTS: ColonneAdaptative<MouvementJournal>[]` du même fichier, puis :

```tsx
import { render, screen } from "@testing-library/react"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import { installerMatchMedia } from "@/test/media-query"
import {
  COLONNES_MOUVEMENTS,
  titreMouvement,
  valeurMouvement,
  sousTitreMouvement,
} from "./mouvements"
import type { MouvementJournal } from "@/lib/stock"

const M: MouvementJournal = {
  id: "m1",
  createdAt: "2026-08-07T10:30:00.000Z",
  warehouseId: "w1",
  warehouseName: "Boutique Centre",
  variantId: "v1",
  productName: "Ciment 50kg",
  variantName: "Sac",
  sku: "CIM-50",
  delta: 12,
  type: "purchase",
  reason: null,
  refType: null,
  refId: null,
  userName: "Awa",
  lotNumber: null,
}

function afficher(largeur: number) {
  const nettoyer = installerMatchMedia(largeur)
  render(
    <ListeAdaptative<MouvementJournal>
      colonnes={COLONNES_MOUVEMENTS}
      lignes={[M]}
      cle={(m) => m.id}
      titre={titreMouvement}
      valeur={valeurMouvement}
      sousTitre={sousTitreMouvement}
    />
  )
  return nettoyer
}

describe("colonnes du journal des mouvements", () => {
  it("expose les 8 colonnes du journal", () => {
    expect(COLONNES_MOUVEMENTS).toHaveLength(8)
  })

  it("rend les 8 colonnes en table à 1280 px", () => {
    const nettoyer = afficher(1280)
    for (const entete of ["Date", "Entrepôt", "Article", "Type", "Delta", "Lot", "Motif", "Par"]) {
      expect(screen.getByText(entete)).toBeTruthy()
    }
    nettoyer()
  })

  it("montre l'article en titre et le delta signé en valeur à 375 px", () => {
    const nettoyer = afficher(375)
    const carte = screen.getAllByRole("listitem")[0]!
    expect(carte.textContent).toContain("Ciment 50kg")
    expect(carte.textContent).toContain("+12")
    nettoyer()
  })

  it("ne perd aucune donnée en mode carte", () => {
    const nettoyer = afficher(375)
    const carte = screen.getAllByRole("listitem")[0]!
    // Toutes les valeurs restent lisibles : rien n'est masqué par la largeur.
    expect(carte.textContent).toContain("Boutique Centre")
    expect(carte.textContent).toContain("Réception")
    expect(carte.textContent).toContain("Awa")
    nettoyer()
  })
})
```

Le dernier cas est le garde-fou du principe « tout se lit, tout se prouve ».

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun run --cwd apps/web test -- mouvements`
Expected: FAIL — les exports n'existent pas encore.

- [ ] **Step 3: Extraire les colonnes et les accesseurs de carte**

Dans `apps/web/src/routes/_app/stock/mouvements.tsx`, au-dessus du composant, définir et exporter :

```tsx
export const COLONNES_MOUVEMENTS: ColonneAdaptative<MouvementJournal>[] = [
  {
    cle: "date",
    entete: "Date",
    masquerEnCarte: true,
    cellule: (m) => (
      <span className="whitespace-nowrap">
        {new Date(m.createdAt).toLocaleString("fr-FR")}
      </span>
    ),
  },
  { cle: "entrepot", entete: "Entrepôt", cellule: (m) => m.warehouseName },
  {
    cle: "article",
    entete: "Article",
    masquerEnCarte: true,
    cellule: (m) => (
      <>
        <span className="font-medium">{m.productName}</span>{" "}
        <span className="text-muted-foreground">
          {m.variantName} ({m.sku})
        </span>
      </>
    ),
  },
  {
    cle: "type",
    entete: "Type",
    cellule: (m) => LIBELLES_TYPE_MOUVEMENT[m.type] ?? m.type,
  },
  {
    cle: "delta",
    entete: "Delta",
    numeric: true,
    masquerEnCarte: true,
    cellule: (m) => (
      <span className={m.delta > 0 ? "font-medium text-success" : "font-medium text-destructive"}>
        {m.delta > 0 ? `+${m.delta}` : m.delta}
      </span>
    ),
  },
  {
    cle: "lot",
    entete: "Lot",
    cellule: (m) => <span className="font-mono">{m.lotNumber ?? "—"}</span>,
  },
  { cle: "motif", entete: "Motif", cellule: (m) => m.reason ?? "—" },
  { cle: "par", entete: "Par", cellule: (m) => m.userName },
]

/** Card mode: the product identifies the row. */
export function titreMouvement(m: MouvementJournal) {
  return (
    <>
      {m.productName}{" "}
      <span className="font-normal text-muted-foreground">
        {m.variantName} ({m.sku})
      </span>
    </>
  )
}

/** Card mode: the signed delta is the headline figure. */
export function valeurMouvement(m: MouvementJournal) {
  return (
    <span className={m.delta > 0 ? "text-success" : "text-destructive"}>
      {m.delta > 0 ? `+${m.delta}` : m.delta}
    </span>
  )
}

export function sousTitreMouvement(m: MouvementJournal) {
  return new Date(m.createdAt).toLocaleString("fr-FR")
}
```

Ajouter `import type { ColonneAdaptative } from "@/components/ui/liste-adaptative"` dans un `import type` séparé.

- [ ] **Step 4: Remplacer la table par `ListeAdaptative`**

Remplacer le bloc `<Table …>…</Table>` (lignes 182-241) par :

```tsx
<ListeAdaptative<MouvementJournal>
  colonnes={COLONNES_MOUVEMENTS}
  lignes={liste}
  cle={(m) => m.id}
  titre={titreMouvement}
  valeur={valeurMouvement}
  sousTitre={sousTitreMouvement}
  chargement={mouvements.isPending}
  containerClassName="min-h-0 flex-1 overflow-y-auto"
  etatVide={
    <EtatVide
      icon={History}
      titre="Aucun mouvement"
      message="Aucun mouvement ne correspond à ces filtres."
    />
  }
/>
```

Reprendre le `message` exact de l'état vide existant. Supprimer les imports de `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`, `TableSkeleton` devenus inutilisés dans ce fichier.

Adapter aussi la barre de filtres : les cinq contrôles sont en `w-56` fixe et débordent à 375 px. Passer chaque conteneur de contrôle en `w-full sm:w-56` et le conteneur de la barre reste en `flex flex-wrap`.

- [ ] **Step 5: Lancer les tests**

```bash
bun run --cwd apps/web test -- mouvements
bun run --cwd apps/web test
```
Expected: 4 cas PASS, suite entière verte.

- [ ] **Step 6: Vérification au navigateur**

Écran Stock → Mouvements, à 375 px, 768 px et 1280 px : en-tête collant fonctionnel à partir de 768 px, cartes lisibles à 375 px, aucun défilement horizontal du corps de page, pagination et filtres utilisables au pouce, thème sombre vérifié.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/routes/_app/stock/mouvements.tsx apps/web/src/routes/_app/stock/mouvements.test.tsx
git commit -m "feat(web): rend le journal des mouvements adaptatif"
```

---

### Task 7 : Table témoin 2 — historique des ventes

Forme différente : 6 colonnes, un montant, et une colonne d'action qui devient la cible de tap de la carte.

**Files:**
- Modify: `apps/web/src/routes/_app/ventes/index.tsx:165-212`
- Test: `apps/web/src/routes/_app/ventes/index.test.tsx`

**Interfaces:**
- Consumes: `ListeAdaptative`, `ColonneAdaptative` (Task 3).
- Produces: rien de réutilisable.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `apps/web/src/routes/_app/ventes/index.test.tsx`, sur le même modèle que la Task 6 : extraire `COLONNES_VENTES`, `titreVente`, `valeurVente`, `sousTitreVente`, puis vérifier
- que `COLONNES_VENTES` a 5 colonnes de données (la 6e, l'action, est portée par `actionCarte` / une colonne dédiée) ;
- qu'à 1280 px les en-têtes `N°`, `Date`, `Caissier`, `Articles`, `Total` sont présents ;
- qu'à 375 px la carte porte `N° 42` en titre et le montant en valeur ;
- qu'à 375 px le lien « Détail » est présent et pointe vers la bonne vente.

**Pour l'assertion du montant, utiliser le helper `texteMontant` existant** — `formaterMontant` produit des espaces insécables étroites (U+202F) que `getByText` ne retrouve pas. Localiser le helper dans les tests POS existants et le réutiliser.

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun run --cwd apps/web test -- ventes`
Expected: FAIL — les exports n'existent pas.

- [ ] **Step 3: Extraire les colonnes et les accesseurs**

Dans `apps/web/src/routes/_app/ventes/index.tsx` :

```tsx
export const COLONNES_VENTES: ColonneAdaptative<VenteListe>[] = [
  { cle: "numero", entete: "N°", numeric: true, masquerEnCarte: true, cellule: (v) => v.ticketNumber },
  {
    cle: "date",
    entete: "Date",
    masquerEnCarte: true,
    cellule: (v) => new Date(v.createdAt).toLocaleString("fr-FR"),
  },
  { cle: "caissier", entete: "Caissier", cellule: (v) => v.cashierName },
  { cle: "articles", entete: "Articles", numeric: true, cellule: (v) => v.itemCount },
  {
    cle: "total",
    entete: "Total",
    numeric: true,
    masquerEnCarte: true,
    cellule: (v) => formaterMontant(v.total, v.currency),
  },
]

export function titreVente(v: VenteListe) {
  return `N° ${v.ticketNumber}`
}

export function valeurVente(v: VenteListe) {
  return formaterMontant(v.total, v.currency)
}

export function sousTitreVente(v: VenteListe) {
  return new Date(v.createdAt).toLocaleString("fr-FR")
}
```

- [ ] **Step 4: Remplacer la table**

```tsx
<ListeAdaptative<VenteListe>
  colonnes={COLONNES_VENTES}
  lignes={liste}
  cle={(v) => v.id}
  titre={titreVente}
  valeur={valeurVente}
  sousTitre={sousTitreVente}
  chargement={ventes.isPending}
  containerClassName="min-h-0 flex-1 overflow-y-auto"
  etatVide={<EtatVide icon={Receipt} titre="Aucune vente" message="…" />}
  actionCarte={(v) => (
    <Link
      to="/ventes/$saleId"
      params={{ saleId: v.id }}
      className="text-primary hover:underline"
    >
      Détail
    </Link>
  )}
/>
```

En mode table, la colonne d'action doit rester présente : ajouter une 6e entrée à `COLONNES_VENTES` avec `entete: ""`, `masquerEnCarte: true` et le même `Link` en `cellule`, pour que la table conserve exactement ses 6 colonnes actuelles. Adapter le test de l'étape 1 en conséquence (6 entrées, dont une d'action).

Adapter la barre de filtres pour 375 px comme en Task 6, et **normaliser au passage les deux champs de date** qui utilisent un `<label>` nu au lieu du motif `Label` + `div` du reste du dépôt.

- [ ] **Step 5: Lancer les tests**

```bash
bun run --cwd apps/web test -- ventes
bun run --cwd apps/web test
```
Expected: tous verts.

- [ ] **Step 6: Vérification au navigateur**

Écran Ventes → Historique aux trois paliers. Vérifier en particulier que le lien « Détail » reste facilement atteignable au pouce sur la carte.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/routes/_app/ventes/index.tsx apps/web/src/routes/_app/ventes/index.test.tsx
git commit -m "feat(web): rend l'historique des ventes adaptatif"
```

---

### Task 8 : POS — barre de synthèse et panneau panier

La tâche la plus sensible du chantier. Trois contraintes d'intégration vérifiées contre le code sont **non négociables** — les ignorer produirait un ticket imprimé barré par le panneau.

**Files:**
- Create: `apps/web/src/pos/barre-synthese.tsx`
- Modify: `apps/web/src/pos/ecran-vente.tsx:469-491` (structure), `:215-220` (garde clavier)
- Test: `apps/web/src/pos/barre-synthese.test.tsx`

**Interfaces:**
- Consumes: `useEstLarge` (Task 1), `totalPanier` et `LignePanier` (`@/lib/pos`), `formaterMontant`.
- Produces: `BarreSynthese({ lignes, devise, verrouille, onOuvrirPanier, onEncaisser })`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `apps/web/src/pos/barre-synthese.test.tsx` couvrant :
- le nombre d'articles et le total affichés (assertion du montant via `texteMontant`, jamais `getByText(formaterMontant(x))`) ;
- le bouton « Encaisser » désactivé quand le panier est vide ;
- le bouton « Encaisser » désactivé quand `verrouille` est vrai ;
- `onOuvrirPanier` appelé au clic sur la zone de synthèse ;
- la présence de `print:hidden` sur la barre.

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun run --cwd apps/web test -- barre-synthese`
Expected: FAIL — module absent.

- [ ] **Step 3: Écrire la barre de synthèse**

Créer `apps/web/src/pos/barre-synthese.tsx`. Contraintes de rendu :
- conteneur `border-t bg-card px-3 py-2 print:hidden`, disposition `flex items-center justify-between gap-3` ;
- la zone « N articles · total » est un `<button type="button">` avec `aria-label="Voir le panier"`, hauteur minimale 44 px ;
- le total en `font-medium tabular-nums`, formaté par `formaterMontant` ;
- le bouton « Encaisser » réutilise le `Button` du dépôt, `disabled` si `lignes.length === 0 || verrouille`.

Ne pas recalculer le total : utiliser `totalPanier(lignes)`.

- [ ] **Step 4: Brancher la bascule dans `ecran-vente.tsx`**

Ajouter `const estLarge = useEstLarge()` et `const [panierOuvert, setPanierOuvert] = useState(false)`.

**Colonne de droite (≥ `md`)** — remplacer `<div className="flex min-h-0 w-96 shrink-0 flex-col">` par `<div className="flex min-h-0 w-72 shrink-0 flex-col lg:w-96">`, et n'en rendre le bloc que si `estLarge`. Le passage 288 → 384 px est un ajustement **dimensionnel**, donc en CSS ; la présence ou non de la colonne est **structurelle**, donc pilotée par le hook.

**Sous `md`** — après le `<div className="flex min-h-0 flex-1">`, rendre :

```tsx
{!estLarge && (
  <>
    <BarreSynthese
      lignes={lignes}
      devise={devise}
      verrouille={panierVerrouille}
      onOuvrirPanier={() => setPanierOuvert(true)}
      onEncaisser={() => setPaiementOuvert(true)}
    />
    {panierOuvert && (
      // Inline overlay, NOT a portal: the whole POS screen sits under
      // `print:hidden`, and a portalled panel would escape it and print over
      // the 80mm receipt. Staying below ModalePaiement's z-30 also keeps the
      // payment modal in front of the panel that opened it.
      <div className="absolute inset-0 z-20 flex flex-col overscroll-contain bg-card print:hidden">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="font-medium">Panier</h2>
          <Button variant="ghost" onClick={() => setPanierOuvert(false)}>
            Fermer
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* même <Panier …/> que la colonne de droite */}
        </div>
      </div>
    )}
  </>
)}
```

Le `<main>` racine (`ecran-vente.tsx:385`) doit recevoir `relative` pour ancrer cet `absolute`.

**Un seul `<Panier>` est monté à la fois** : extraire son JSX (bannière de restauration comprise) dans une variable locale `const panneauPanier = (<>…</>)` réutilisée par les deux branches, plutôt que de le dupliquer.

- [ ] **Step 5: Ne PAS ajouter le panneau au garde clavier**

Dans le calcul de `modaleOuverte` (`ecran-vente.tsx:215-220`), **ne pas ajouter `panierOuvert`**. C'est une décision de conception, pas un oubli : le caissier scanne en regardant son total, donc le buffer de scan et les raccourcis restent actifs panneau ouvert. Documenter ce choix par un commentaire en anglais au-dessus du calcul, faute de quoi un futur lecteur l'ajoutera par réflexe.

- [ ] **Step 6: Lancer les tests**

```bash
bun run --cwd apps/web test -- barre-synthese
bun run --cwd apps/web test -- ecran-vente
bun run --cwd apps/web test
```
Expected: tous verts. `ecran-vente.test.tsx` (958 lignes) ne doit pas régresser — sans `matchMedia`, le hook répond « desktop » et l'écran rend exactement l'arbre qu'il rendait avant.

- [ ] **Step 7: Vérification au navigateur — la plus importante de la phase**

Écran POS. À **1280 px** puis **768 px** puis **375 px** :

1. **Non-régression clavier à chaque palier** : buffer de scan code-barres, `/` (focus recherche), `F2` (encaisser), **`Delete`** (vider le panier).
2. À 375 px, le scan et les raccourcis restent **actifs panneau panier ouvert**.
3. Le total de la barre de synthèse suit le panier en temps réel.
4. `F2` ou « Encaisser » ouvre la modale de paiement **par-dessus** le panneau panier, jamais dessous.
5. **Vente réelle de bout en bout à 375 px, puis impression du ticket** (`Ctrl+P` ou aperçu) : le ticket 80 mm s'imprime **seul**, sans le panneau panier ni la barre de synthèse.
6. Ouverture de caisse, fermeture de caisse et tickets du jour utilisables à 375 px.
7. Paysage téléphone (812×375) : l'écran reste utilisable malgré la hauteur réduite.
8. Thème sombre.

Le point 5 est celui qui justifie l'overlay inline : le vérifier réellement, pas en le supposant.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pos/barre-synthese.tsx apps/web/src/pos/barre-synthese.test.tsx apps/web/src/pos/ecran-vente.tsx
git commit -m "feat(pos): ajoute la barre de synthèse et le panneau panier sous md"
```

---

### Task 9 : POS — écrans périphériques

Ouverture de caisse, fermeture de caisse et tickets du jour. Écrans simples, mais ils font partie du parcours caissier et resteraient inutilisables sans passe.

**Files:**
- Modify: `apps/web/src/pos/ouverture-caisse.tsx`, `fermeture-caisse.tsx`, `tickets-du-jour.tsx`
- Test: suites existantes (`tickets-du-jour.test.tsx`), pas de nouveau fichier

**Interfaces:**
- Consumes: rien de nouveau.
- Produces: rien.

- [ ] **Step 1: Adapter les trois écrans**

Pour chacun, à 375 px : conteneurs en `w-full` avec `max-w-*` plutôt que largeurs fixes, `px-4` minimum, boutons d'action empilés en pleine largeur sous `sm`, et champs numériques conservant `inputMode="numeric"`. Aucun changement de logique métier, aucun changement de contrat.

`tickets-du-jour.tsx` est une liste, pas une table : vérifier qu'elle tient à 375 px sans passer par `ListeAdaptative` — n'introduire le composant que si la liste est réellement tabulaire.

- [ ] **Step 2: Lancer les tests**

```bash
bun run --cwd apps/web test
```
Expected: suite entière verte, `tickets-du-jour.test.tsx` compris.

- [ ] **Step 3: Vérification au navigateur**

Parcours caissier complet à 375 px : ouverture de caisse (fond de caisse) → vente → paiement → tickets du jour → fermeture de caisse (montant compté, écart). Aucun défilement horizontal, toutes les cibles ≥ 44 px.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pos/ouverture-caisse.tsx apps/web/src/pos/fermeture-caisse.tsx apps/web/src/pos/tickets-du-jour.tsx
git commit -m "feat(pos): adapte l'ouverture, la fermeture et les tickets du jour"
```

---

## Definition of Done

- `bun run typecheck`, `bun run lint`, `bun run test` verts à la racine.
- Aucun test existant modifié pour « le faire passer » : le hook dégradant vers desktop garantit que les suites d'écran sont inchangées. Si un test existant a dû bouger, c'est un signal à remonter, pas à absorber.
- Vérification navigateur consignée aux trois paliers (375, 768, 1280 px), en thème clair **et** sombre.
- **Impression du ticket 80 mm vérifiée depuis une vente réelle à 375 px** — le ticket sort seul.
- Non-régression clavier du POS vérifiée à chaque palier, `Delete` compris.
- Aucune modification de l'API, d'un schéma, d'une règle d'autorisation, de `index.html` ou de `routeTree.gen.ts`.
- PR ouverte, revue CodeRabbit traitée, merge **uniquement sur feu vert explicite de l'utilisateur** (merge commit, pas de squash).

## Points ouverts assumés pour les phases suivantes

- Les 18 écrans restants (phases 2 à 4) consomment `ListeAdaptative` sans le modifier. Si l'un d'eux exige une évolution du composant, c'est un signal que la Task 3 a été figée trop tôt — le remonter plutôt que de contourner.
- `dialogue-depannage.tsx` et `modale-paiement.tsx` sont vérifiés à 375 px dans cette phase mais non réécrits : ils tiennent déjà grâce aux contraintes existantes des dialogues.
