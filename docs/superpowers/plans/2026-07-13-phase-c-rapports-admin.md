# Phase C — Monde Rapports / Admin / Accueil (refonte UI/UX)

> Plan détaillé de la Phase C de `2026-07-13-refonte-ui-ux-roadmap.md`. Web uniquement, branche `feat/refonte-ui-ux`. Public : propriétaire/admin — vue d'ensemble et contrôle. Consomme les primitives A/B. Inclut les deux **temps forts d'ambition** (dashboard à point de vue + data-viz registre) et la primitive **`toast`** différée.

## Fondations (livrées avant le fan-out, testées d'abord)
- `ui/toast.tsx` + `Toaster` : sur `@base-ui/react/toast` (`createToastManager` + `Toast.Provider toastManager`), helper `toast.success/error/message`, filet sans ombre, tokens `success`/`destructive`. Monté dans `main.tsx`. **Testé en navigateur via `administration/utilisateurs.tsx` avant le fan-out.**

## Règles de transformation (mécaniques — mêmes qu'en B)
- Couleurs brutes → tokens : `bg-white`→`bg-card` ; `bg-gray-50`→`bg-muted` ; `text-gray-500`→`text-muted-foreground` ; `text-gray-700`→`text-foreground` ; `text-red-600/700`→`text-destructive` ; liens `text-blue-600`→`text-primary` ; `bg-black text-white` (CTA)→`Button`/`bg-primary` ; badges `amber/orange`→`<Badge variant="warning">`.
- Tables en `<table>` brut → primitive `Table` (scope, `overflow-x-auto`, `numeric` sur colonnes chiffrées) OU a minima `scope="col"` + wrapper `overflow-x-auto` + `tabular-nums`.
- Montants déjà `tabular-nums` dans les rapports (bien) — garder ; colonnes non-monétaires chiffrées → `numeric`.
- `window.alert(...)` (utilisateurs ×4) → `toast.error(...)` (succès pertinents → `toast.success`).
- Loaders « Chargement… » → `Skeleton`/`TableSkeleton`. « Réessayer » homogène (`ErreurChargement`) sur les blocs du dashboard.
- Statuts en Badge non-indigo (`success`/`warning`/`secondary`).

## Temps forts (ambition)
- **Tableau de bord à point de vue** (`_app/index.tsx`, fait main) : sortir de la grille 2×2 de cartes anonymes. Mettre le **chiffre sacré en tête** — bandeau réglé (registre) : CA du jour + Valeur du stock (+ nb d'alertes comme signal), en `tabular-nums`, filets fins, **sans hero-metric clinquant ni dégradé** (anti-références). Puis les blocs de détail hiérarchisés ; alertes traitées comme signal.
- **Data-viz registre** (fait main) : activer la rampe `chart-1..5` (0 % utilisée) par des **barres fines de proportion** — part de CA par boutique (ventes du jour), part de valeur par entrepôt (valorisation) — alignées, sobres ; jamais de camembert.

## Fichiers
- Fait main : `ui/toast.tsx`, `main.tsx`, `administration/utilisateurs.tsx` (test toast), `_app/index.tsx` (dashboard).
- Fan-out sous-agents : `ventes/{index,$saleId,rapports}.tsx`, `rapports/{rapport-ventes,rapport-marges,rapport-valorisation}.tsx`, `administration/{entrepots,parametres}.tsx`, `mon-compte.tsx`.

## Vérifications
- `typecheck` · `lint` · `test` verts.
- Grep : 0 couleur brute résiduelle dans le périmètre Rapports/Admin/Accueil.
- QA navigateur (clair + sombre) : dashboard (point de vue + barres), un rapport, ventes, utilisateurs (toast).

## Différés / arbitrages (à alimenter)
