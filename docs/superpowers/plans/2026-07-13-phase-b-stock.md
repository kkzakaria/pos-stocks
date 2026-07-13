# Phase B — Monde Stock / Gestionnaire (refonte UI/UX)

> Plan détaillé de la Phase B de `2026-07-13-refonte-ui-ux-roadmap.md`. Web uniquement, branche `feat/refonte-ui-ux`. Public : gestionnaires en tables denses, exigence d'exactitude. Consomme les primitives de la Phase A. **Au-delà de la remise à niveau, saisir les vraies améliorations UX** (consigne explicite : ne pas se limiter au correctif mécanique).

## Fondations partagées (livrées avant le fan-out)
- `ui/badge.tsx` : variantes sémantiques `success` / `warning` (économie de l'indigo — les statuts passifs quittent l'indigo).
- `components/etat-vide.tsx` : `EtatVide` (état vide qui oriente l'action, bord tireté, voix registre).
- `ui/table-skeleton.tsx` : `TableSkeleton` (lignes de squelette à la densité de la table).
- Primitives Phase A : `Table` (`numeric`, `sticky`, `scope`), `Skeleton`, `AlertDialog`, `Checkbox`, `Textarea`, `Select`, `dropdown-menu`.

## Règles de transformation (mécaniques — appliquer partout)
Mapping couleurs brutes → tokens (theme-aware, réparent le sombre) :
- `text-gray-400/500` → `text-muted-foreground` · `text-gray-700` → `text-foreground`
- `bg-gray-50/100` → `bg-muted` · `bg-white` → `bg-card`
- `text-red-600/700` → `text-destructive` · `bg-red-100 text-red-800` → `<Badge variant="destructive">`
- `text-green-700` → `text-success`
- `border-amber-200 bg-amber-50` → `border-warning/20 bg-warning/10` · `bg-amber-100 text-amber-800` → `<Badge variant="warning">`
Autres règles :
- **Chiffres** : colonnes quantités/CMP/coûts/prix/seuils/deltas → prop `numeric` sur `TableHead`/`TableCell` (`text-right tabular-nums`). Deltas colorés → `text-success`/`text-destructive`.
- **`<select>` natifs** → `Select` (h-7, tokens, focus-ring). **`<input type=checkbox>`** → `Checkbox`. **`<textarea>`** → `Textarea`.
- **`window.confirm`/`alert`** → `AlertDialog` (confirmations destructives) / erreur inline `text-destructive` `role="alert"`.
- **Loaders texte** « Chargement… » → `TableSkeleton` (dans une table) ou `Skeleton`.
- **États vides** → `EtatVide` avec titre + message orientant + action (lien de création) quand pertinent.
- **Statuts** (« Actif », « Validée », « Clos », « En attente »…) → Badge `secondary`/`outline`/`success`/`warning`, jamais `default` (indigo).

## Améliorations proactives (vrais gains UX, pas seulement dette)
- **En-têtes de table collants** (`TableHeader sticky`) sur les longues listes (niveaux, mouvements, produits).
- **Tri de colonnes** (`aria-sort`) sur les tables d'audit denses là où ça a du sens (mouvements, niveaux, produits) — tri client, en-têtes cliquables au clavier.
- **Lignes cliquables accessibles** au clavier (`produits/index` : ligne → `<Link>` ou `role/tabIndex`+focus).
- **Actions de ligne en menu** (`dropdown-menu`) quand plusieurs actions encombrent la cellule (ex. niveaux : Ajuster/Seuil).
- **États vides qui guident** (lien vers réception/création selon le contexte).
- Pagination/scroll homogène là où les listes peuvent être longues.

## Fichiers (fan-out par sous-agents, réf. = `stock/index.tsx`)
Stock : `stock/index.tsx` (**référence, faite d'abord**), `stock/mouvements.tsx`, `stock/receptions/index.tsx`, `stock/receptions/$purchaseId.tsx`, `stock/transferts/index.tsx`, `stock/transferts/$transferId.tsx`, `stock/inventaires/index.tsx`, `stock/inventaires/$countId.tsx`.
Catalogue : `catalogue/produits/index.tsx`, `catalogue/produits/$productId.tsx`, `catalogue/categories.tsx`, `catalogue/fournisseurs.tsx`.
Produit : `components/produit/*`.

## Vérifications
- `typecheck` · `lint` · `test` verts.
- Grep de contrôle : 0 couleur brute résiduelle dans le périmètre Stock/Catalogue ; `tabular-nums` présent sur les colonnes chiffrées.
- QA navigateur (clair + sombre) sur niveaux, mouvements, produits, une réception, un transfert, un inventaire.

## Différés / arbitrages (à alimenter)
