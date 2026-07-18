# Composant Pagination partagé — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extraire un composant `Pagination` réutilisable et refactorer les trois paginations inline existantes (ventes, mouvements, tickets-du-jour) pour l'utiliser.

**Architecture:** Un composant présentational unique `apps/web/src/components/ui/pagination.tsx` prend `{ page, total, pageSize, onPageChange, element }`, calcule lui-même `pageCount` et l'accord grammatical, rend `Précédent / « Page X/Y — N ventes » / Suivant` ou le compteur seul sur une page unique. Les trois écrans remplacent leur bloc inline par ce composant. Aucune modification d'API.

**Tech Stack:** React 19, TanStack Query, shadcn/base-mira (`Button`), Tailwind 4, Vitest + Testing Library + jsdom.

## Global Constraints

- Périmètre **web uniquement** — aucune modification d'API, aucun test d'intégration API.
- UI et libellés en **français** ; commentaires de code et JSDoc en **anglais**.
- DS « registre du comptable » : sobre, **compact** (`Button size="sm"`), pas d'ellipse de numéros de page.
- Le composant est la **source unique** du nombre de pages : `pageCount = Math.max(1, Math.ceil(total / pageSize))`. Aucun `pageCount` passé de l'extérieur.
- Accord français géré par le composant : `total > 1 ? plusieurs : un` (« 0 vente », « 1 vente », « 2 ventes »).
- Format texte multi-pages **exact** : `Page {page} / {pageCount} — {total} {nom}` (contrainte du test existant `tickets-du-jour.test.tsx`, qui matche `/Page 1 \/ 2/` et les boutons nommés « Précédent »/« Suivant »).
- Comportement page unique (`pageCount ≤ 1`) : rend le compteur seul, **sans boutons**.
- Ne jamais utiliser `--no-verify`. Hooks husky actifs.

---

### Task 1: Composant `Pagination` + test unitaire

**Files:**
- Create: `apps/web/src/components/ui/pagination.tsx`
- Test: `apps/web/src/components/ui/pagination.test.tsx`

**Interfaces:**
- Consumes: `Button` depuis `@/components/ui/button` ; `cn` depuis `@/lib/utils`.
- Produces:
  ```ts
  type NomElement = { un: string; plusieurs: string }
  type PaginationProps = {
    page: number
    total: number
    pageSize: number
    onPageChange: (page: number) => void
    element: NomElement
    className?: string
  }
  export function Pagination(props: PaginationProps): JSX.Element
  ```

- [ ] **Step 1: Écrire le test qui échoue**

Create `apps/web/src/components/ui/pagination.test.tsx` :

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { Pagination } from "./pagination"

const element = { un: "vente", plusieurs: "ventes" }
const noop = () => undefined

describe("Pagination", () => {
  it("page unique : compteur seul, aucun bouton", () => {
    render(
      <Pagination
        page={1}
        total={7}
        pageSize={50}
        onPageChange={noop}
        element={element}
      />
    )
    expect(
      screen.getByRole("navigation", { name: "Pagination" }).textContent
    ).toBe("7 ventes")
    expect(screen.queryByRole("button", { name: "Précédent" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Suivant" })).toBeNull()
  })

  it("multi-pages : texte « Page X / Y — N ventes »", () => {
    render(
      <Pagination
        page={2}
        total={138}
        pageSize={50}
        onPageChange={noop}
        element={element}
      />
    )
    expect(
      screen.getByRole("navigation", { name: "Pagination" }).textContent
    ).toContain("Page 2 / 3 — 138 ventes")
  })

  it("désactive Précédent en première page, Suivant en dernière", () => {
    const { rerender } = render(
      <Pagination
        page={1}
        total={138}
        pageSize={50}
        onPageChange={noop}
        element={element}
      />
    )
    expect(
      (screen.getByRole("button", { name: "Précédent" }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
    expect(
      (screen.getByRole("button", { name: "Suivant" }) as HTMLButtonElement)
        .disabled
    ).toBe(false)
    rerender(
      <Pagination
        page={3}
        total={138}
        pageSize={50}
        onPageChange={noop}
        element={element}
      />
    )
    expect(
      (screen.getByRole("button", { name: "Suivant" }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
  })

  it("onPageChange reçoit page±1 au clic", () => {
    const onPageChange = vi.fn()
    render(
      <Pagination
        page={2}
        total={138}
        pageSize={50}
        onPageChange={onPageChange}
        element={element}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Précédent" }))
    expect(onPageChange).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }))
    expect(onPageChange).toHaveBeenCalledWith(3)
  })

  it("accord : 0 et 1 → singulier, 2+ → pluriel", () => {
    const { rerender } = render(
      <Pagination
        page={1}
        total={0}
        pageSize={50}
        onPageChange={noop}
        element={element}
      />
    )
    expect(screen.getByRole("navigation").textContent).toBe("0 vente")
    rerender(
      <Pagination
        page={1}
        total={1}
        pageSize={50}
        onPageChange={noop}
        element={element}
      />
    )
    expect(screen.getByRole("navigation").textContent).toBe("1 vente")
    rerender(
      <Pagination
        page={1}
        total={2}
        pageSize={50}
        onPageChange={noop}
        element={element}
      />
    )
    expect(screen.getByRole("navigation").textContent).toContain("2 ventes")
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun run --cwd apps/web test -- pagination`
Expected: FAIL (module `./pagination` introuvable).

- [ ] **Step 3: Implémenter le composant**

Create `apps/web/src/components/ui/pagination.tsx` :

```tsx
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type NomElement = { un: string; plusieurs: string }

type PaginationProps = {
  page: number
  total: number
  pageSize: number
  onPageChange: (page: number) => void
  element: NomElement
  className?: string
}

/**
 * Shared table pagination: "Prev / Page X/Y — N items / Next", or the count
 * alone on a single page. Sober and accessible (nav + aria-label), no
 * page-number ellipsis. The component is the single source of the page count.
 */
export function Pagination({
  page,
  total,
  pageSize,
  onPageChange,
  element,
  className,
}: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const compteur = `${total} ${total > 1 ? element.plusieurs : element.un}`
  if (pageCount <= 1) {
    return (
      <nav
        aria-label="Pagination"
        className={cn("text-sm text-muted-foreground", className)}
      >
        {compteur}
      </nav>
    )
  }
  return (
    <nav
      aria-label="Pagination"
      className={cn("flex items-center justify-between text-sm", className)}
    >
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Précédent
      </Button>
      <span className="text-muted-foreground">
        Page {page} / {pageCount} — {compteur}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        Suivant
      </Button>
    </nav>
  )
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `bun run --cwd apps/web test -- pagination`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `bun run --cwd apps/web typecheck`
Expected: aucune erreur.

```bash
git add apps/web/src/components/ui/pagination.tsx apps/web/src/components/ui/pagination.test.tsx
git commit -m "feat(web): composant Pagination partagé (issue #13)"
```

---

### Task 2: Refacto `pos/tickets-du-jour.tsx`

**Files:**
- Modify: `apps/web/src/pos/tickets-du-jour.tsx` (retirer la ligne 26 `const pages = …` ; remplacer le bloc 112-132)
- Test (existant, doit rester vert) : `apps/web/src/pos/tickets-du-jour.test.tsx`

**Interfaces:**
- Consumes: `Pagination` de `@/components/ui/pagination` (Task 1).

- [ ] **Step 1: Ajouter l'import du composant**

Dans `apps/web/src/pos/tickets-du-jour.tsx`, après la ligne `import { Button } from "@/components/ui/button"` :

```tsx
import { Pagination } from "@/components/ui/pagination"
```

- [ ] **Step 2: Supprimer le calcul de pages devenu inutile**

Supprimer la ligne 26 :

```tsx
  const pages = Math.max(1, Math.ceil(total / 50))
```

- [ ] **Step 3: Remplacer le bloc de pagination inline**

Remplacer le bloc (lignes 112-132) :

```tsx
        {pages > 1 && (
          <div className="flex items-center justify-between border-t px-5 py-2 text-sm">
            <Button
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Précédent
            </Button>
            <span className="text-muted-foreground">
              Page {page} / {pages} — {total} tickets
            </span>
            <Button
              variant="outline"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Suivant
            </Button>
          </div>
        )}
```

par :

```tsx
        {liste.length > 0 && (
          <div className="border-t px-5 py-2">
            <Pagination
              page={page}
              total={total}
              pageSize={50}
              onPageChange={setPage}
              element={{ un: "ticket", plusieurs: "tickets" }}
            />
          </div>
        )}
```

- [ ] **Step 4: Vérifier que le test existant reste vert**

Run: `bun run --cwd apps/web test -- tickets-du-jour`
Expected: PASS (le test « masque la pagination à 50 tickets ou moins » passe car page unique = pas de bouton Suivant ; « pagine au-delà de 50 tickets » passe car le texte « Page 1 / 2 » et le bouton « Suivant » sont rendus).

- [ ] **Step 5: Typecheck + commit**

Run: `bun run --cwd apps/web typecheck`
Expected: aucune erreur (`Button` reste importé — il sert encore ailleurs dans le fichier).

```bash
git add apps/web/src/pos/tickets-du-jour.tsx
git commit -m "refactor(web): tickets-du-jour utilise le composant Pagination (issue #13)"
```

---

### Task 3: Refacto `stock/mouvements.tsx`

**Files:**
- Modify: `apps/web/src/routes/_app/stock/mouvements.tsx` (retirer l'import `Button` ; retirer la ligne 86 `const dernierePage = …` ; remplacer le bloc 241-264)

**Interfaces:**
- Consumes: `Pagination` de `@/components/ui/pagination` (Task 1). `LIMITE` (constante locale = 50) reste utilisée pour le paramètre de requête.

- [ ] **Step 1: Remplacer l'import Button par l'import Pagination**

Dans `apps/web/src/routes/_app/stock/mouvements.tsx`, remplacer :

```tsx
import { Button } from "@/components/ui/button"
```

par :

```tsx
import { Pagination } from "@/components/ui/pagination"
```

(Les deux seules occurrences de `<Button` sont dans le bloc de pagination remplacé à l'étape 3 ; l'import devient inutile.)

- [ ] **Step 2: Supprimer le calcul de dernierePage devenu inutile**

Supprimer la ligne 86 :

```tsx
  const dernierePage = Math.max(1, Math.ceil(total / LIMITE))
```

- [ ] **Step 3: Remplacer le bloc de pagination inline**

Remplacer le bloc (lignes 241-264) :

```tsx
          {!mouvements.isPending && (
            <div className="mt-4 flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Précédent
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} / {dernierePage} — {total} mouvement
                {total > 1 ? "s" : ""}
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
          )}
```

par :

```tsx
          {!mouvements.isPending && (
            <Pagination
              className="mt-4"
              page={page}
              total={total}
              pageSize={LIMITE}
              onPageChange={setPage}
              element={{ un: "mouvement", plusieurs: "mouvements" }}
            />
          )}
```

- [ ] **Step 4: Typecheck + lint (import Button retiré)**

Run: `bun run --cwd apps/web typecheck`
Expected: aucune erreur.
Run: `bunx eslint apps/web/src/routes/_app/stock/mouvements.tsx`
Expected: exit 0 (aucun import inutilisé).

- [ ] **Step 5: Vérifier la non-régression de la suite web**

Run: `bun run --cwd apps/web test`
Expected: PASS (aucune régression).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/_app/stock/mouvements.tsx
git commit -m "refactor(web): mouvements de stock utilisent le composant Pagination (issue #13)"
```

---

### Task 4: Refacto `ventes/index.tsx`

**Files:**
- Modify: `apps/web/src/routes/_app/ventes/index.tsx` (retirer la ligne 77 `const pages = …` ; remplacer le bloc 215-236)

**Interfaces:**
- Consumes: `Pagination` de `@/components/ui/pagination` (Task 1). `parPage` (lu de la réponse API) reste utilisé.

- [ ] **Step 1: Ajouter l'import du composant**

Dans `apps/web/src/routes/_app/ventes/index.tsx`, ajouter (à côté des imports de composants existants) :

```tsx
import { Pagination } from "@/components/ui/pagination"
```

- [ ] **Step 2: Supprimer le calcul de pages devenu inutile**

Supprimer la ligne 77 :

```tsx
  const pages = Math.max(1, Math.ceil(total / parPage))
```

(Conserver les lignes `total` et `parPage` juste au-dessus, qui restent utilisées.)

- [ ] **Step 3: Remplacer le bloc de pagination inline**

Remplacer le bloc (lignes 215-236) :

```tsx
            {liste.length > 0 && pages > 1 && (
              <div className="mt-3 flex items-center justify-between text-sm">
                <Button
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Précédent
                </Button>
                <span className="text-muted-foreground">
                  Page {page} / {pages} — {total} ventes
                </span>
                <Button
                  variant="outline"
                  disabled={page >= pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Suivant
                </Button>
              </div>
            )}
```

par :

```tsx
            {liste.length > 0 && (
              <Pagination
                className="mt-3"
                page={page}
                total={total}
                pageSize={parPage}
                onPageChange={setPage}
                element={{ un: "vente", plusieurs: "ventes" }}
              />
            )}
```

- [ ] **Step 4: Typecheck + lint**

Run: `bun run --cwd apps/web typecheck`
Expected: aucune erreur (`Button` reste importé — il sert encore ailleurs).
Run: `bunx eslint apps/web/src/routes/_app/ventes/index.tsx`
Expected: exit 0.

- [ ] **Step 5: Vérifier la non-régression de la suite web complète**

Run: `bun run --cwd apps/web test`
Expected: PASS (toute la suite web).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/_app/ventes/index.tsx
git commit -m "refactor(web): historique des ventes utilise le composant Pagination (issue #13)"
```

---

## Notes de vérification finale

Après la Task 4, la branche `feat/pagination-composant-partage` contient : le composant + son test, et les trois écrans refactorés. État attendu : `bun run --cwd apps/web test` et `bun run typecheck` verts, `bunx eslint` propre sur les fichiers touchés. Le sous-projet B (pagination serveur des listes non bornées) fera l'objet d'un spec et d'un plan distincts.
