# Phase A — Fondations DS & châssis (refonte UI/UX)

> Plan détaillé de la Phase A de la campagne `2026-07-13-refonte-ui-ux-roadmap.md`. Web uniquement (`apps/web`), branche `feat/refonte-ui-ux-phase-a-fondations`. Objectif : livrer le kit de primitives + le châssis dont les phases B/C/D dépendent, et rendre le thème sombre réellement utilisable et conforme AA. Aucune régression (tests web + typecheck + lint verts).

## Contexte technique vérifié

- Stack : React 19, TanStack Router (file-based), Tailwind 4, shadcn/base-ui 1.6.0, `@base-ui/react` expose `alert-dialog`, `checkbox`, `switch`, `toast`.
- Tokens dans `styles.css` : le bloc `.dark` (L94-128) existe, `@custom-variant dark (&:is(.dark *))` (L8) → il suffit de poser `.dark` sur `<html>`. Tokens `--success`/`--warning` déjà définis clair+sombre.
- Primitive `Table` (`table.tsx`) a **déjà** le wrapper `overflow-x-auto` (L11) ; il manque `scope`, `tabular-nums`, sticky, et l'en-tête est `h-10`.
- `Button`/`Input`/`SelectTrigger` ont déjà `focus-visible:ring-2 ring-ring/30` ; il manque le dimensionnement tactile `pointer:coarse`.
- `_app.tsx` : sidebar hors DS (grays bruts, pas de `bg-sidebar`, pas d'actif indigo, capitales tramées, bouton nu), pas de skip-link.
- `main.tsx` monte `QueryClientProvider > RouterProvider` ; `__root.tsx` est minimal ; `index.html` sert `<html lang="fr">` sans classe (risque FOUC à traiter).

## Chantiers

### A1 — Thème sombre atteignable et éprouvé
- **`src/lib/theme.tsx`** (nouveau) : `ThemeProvider` + `useTheme()`. État `'light' | 'dark' | 'system'`, persisté `localStorage["theme"]`. Applique/retire `.dark` sur `document.documentElement`. En `system`, suit `matchMedia("(prefers-color-scheme: dark)")` (écoute le changement). Garde `typeof window`/`matchMedia` pour jsdom (tests).
- **`index.html`** : script inline **bloquant** dans `<head>` qui lit `localStorage`/`prefers-color-scheme` et pose `.dark` avant le rendu React (anti-FOUC). `<meta name="color-scheme" content="light dark">`.
- **`main.tsx`** : envelopper l'app dans `<ThemeProvider>`.
- **`src/components/theme-toggle.tsx`** (nouveau) : bascule 3 états (clair/sombre/système) via `Select` ou groupe de boutons, icônes `Sun`/`Moon`/`Monitor`, `aria-label`. Placée dans la zone compte de la sidebar.
- **Acceptation** : bascule fonctionnelle sans FOUC ; préférence persistée au reload ; les deux thèmes lisibles (AA) éprouvés au navigateur.

### A2 — Kit de primitives (consommé par B/C/D)
- **`table.tsx`** : `TableHead` pose `scope="col"` par défaut (surchargeable) ; en-tête `h-8` (au lieu de `h-10`) ; prop `numeric?: boolean` sur `TableHead`/`TableCell` → `text-right tabular-nums` ; prop `sticky?: boolean` sur `TableHeader` → en-têtes collants (`[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-background`).
- **`skeleton.tsx`** (nouveau) : `animate-pulse rounded-md bg-muted`, avec garde `prefers-reduced-motion`.
- **`alert-dialog.tsx`** (nouveau) : sur `@base-ui/react/alert-dialog` (role=alertdialog, piège de focus natif), API `AlertDialog{,Trigger,Content,Header,Footer,Title,Description,Close}` + boutons action/annulation, sans ombre (filet `ring-1 ring-foreground/10`), tokens.
- **`toast.tsx` + `Toaster`** (nouveau) : sur `@base-ui/react/toast`, provider monté dans le layout ; helpers succès/erreur tokenisés (`success`/`destructive`). Remplace les `alert()` en B/C/D.
- **`checkbox.tsx`** (nouveau) : sur `@base-ui/react/checkbox`, tokens + focus-ring DS.
- **`textarea.tsx`** (nouveau) : calé sur `Input` (bg `input/20`, filet, focus-ring, `text-xs`).
- **`select.tsx`** : retirer `shadow-md` du popup (L85) — profondeur par filet (règle du filet).
- **Acceptation** : primitives typées, importables, testables ; `scope`/`numeric`/`sticky` disponibles ; `AlertDialog`/`Toaster` montables.

### A3 — Système tactile `pointer:coarse`
- **`button.tsx`** : ajouter `pointer-coarse:min-h-11` (44px) aux tailles interactives de comptoir (`default`, `sm`, `lg`, `icon`) ; **laisser** `xs`/`icon-xs`/`icon-sm` compacts (actions inline denses, opt-in explicite).
- **`input.tsx`**, **`select.tsx`** (trigger) : `pointer-coarse:min-h-11` sur la taille par défaut.
- Rendu **souris inchangé** (`h-7`) ; seul le tactile s'agrandit.
- **Acceptation** : à l'émulation `pointer:coarse`, les contrôles par défaut ≥ 44px ; densité souris intacte.

### A4 — Refonte sidebar (`_app.tsx`)
- `<aside>` sur `bg-sidebar text-sidebar-foreground` ; `<nav aria-label="Navigation principale">`.
- `lienClasses` : purge des grays → tokens ; `hover:bg-sidebar-accent` ; actif porté par `aria-[current=page]:bg-sidebar-primary aria-[current=page]:text-sidebar-primary-foreground` ; `focus-visible:ring-2 focus-visible:ring-ring/30`.
- Libellés de section : retirer `uppercase tracking-widest` → casse normale `font-medium text-muted-foreground`.
- « Se déconnecter » : primitive `Button variant="ghost"` `text-destructive`, focus visible.
- E-mail/organisation : `text-muted-foreground` (token) au lieu de `text-gray-500`.
- Intégrer le `ThemeToggle` (A1) dans le bloc compte.
- **Acceptation** : 0 couleur brute, 0 capitale tramée dans `_app.tsx` ; actif indigo visible ; sidebar sur sa surface propre en clair et sombre.

### A5 — a11y du châssis
- Skip-link `<a href="#contenu" class="sr-only focus:not-sr-only …">Aller au contenu</a>` en tête ; `<main id="contenu" tabIndex={-1}>`.
- Focus visible unifié (couvert par A4 pour la nav).
- **Acceptation** : Tab depuis le haut atteint le skip-link ; navigation clavier fluide.

### A6 — Motion
- **`styles.css`** : garde globale `@media (prefers-reduced-motion: reduce)` neutralisant `animation`/`transition` d'app (hors ticket, déjà géré) ; `scroll-behavior: auto`.
- **Acceptation** : sous réduction de mouvement, dialog/select/boutons ne s'animent plus.

## Ordre d'exécution
`styles.css` (A6) → `theme.tsx` (A1) → `index.html` + `main.tsx` (A1) → primitives A2/A3 → `theme-toggle.tsx` → `_app.tsx` (A4/A5) → vérifications.

## Vérifications de fin de phase
- `bun run typecheck` (3 workspaces) · `bun run lint` · `bun run --cwd apps/web test` — tous verts.
- Navigateur : bascule claire/sombre sans FOUC ; sidebar (actif indigo, tokens) ; skip-link ; émulation tactile ≥44px. Captures avant/après.
- 0 couleur Tailwind brute et 0 capitale tramée résiduelles dans `_app.tsx` (grep de contrôle).

## Différés / arbitrages (à alimenter)
- **Primitive `toast`/`Toaster` reportée en Phase C** : l'empilement base-ui toast mérite d'être construit et éprouvé contre un vrai flux (`administration/utilisateurs.tsx` remplace ses `alert()`). Livrer une primitive toast non testée en A serait moins rigoureux. Le kit A2 livré = `table`, `skeleton`, `alert-dialog`, `checkbox`, `textarea`, fix `select`.
- Dimensionnement tactile `pointer:coarse` volontairement **non** appliqué aux tailles `xs`/`icon-xs` (compacité inline assumée) — à réévaluer si retour comptoir.
- Scrim `Dialog` `bg-black/80` laissé tel quel (P2, theme-neutre acceptable).
