# Roadmap — Refonte UI/UX (post-v1)

> Campagne d'amélioration de l'interface de la SPA `apps/web`, menée avec les skills `/impeccable` (registre `product`, plateforme `web`), `/frontend-design` et `/web-design-guidelines`. Document maître de suivi ; chaque phase reçoit son plan détaillé dans `docs/superpowers/plans/` **juste avant son exécution**, pour bénéficier de ce qui a été appris. Cocher au fil de l'avancement.
>
> **Références** : DS `apps/web/DESIGN.md` (« le registre du comptable ») · produit `apps/web/PRODUCT.md` · CLAUDE.md (conventions, invariants). La v1 (7 phases) est complète et en prod ; cette campagne **ne touche pas l'API** — web uniquement.

## Constat fondateur

Audit croisé des 4 mondes (fidélité DS × Web Interface Guidelines), lecture seule. La dette est **systémique et transversale**, pas éparse : les mêmes causes reviennent partout, donc on corrige au niveau des **primitives et des tokens** avec un fort effet de levier. Métriques mesurées à l'ouverture de la campagne (à ramener à ~0 en fin de campagne) :

| Indicateur de dette | Mesure d'ouverture (2026-07-13) |
|---|---|
| Couleurs Tailwind brutes non theme-aware (`text-gray-*`, `bg-white`, `text-red/green/amber/orange-*`) | **~120+ occurrences** sur les 4 mondes |
| Thème sombre atteignable par l'utilisateur | **Non** — bloc `.dark` défini (`styles.css:94-128`) mais aucun `ThemeProvider`/toggle, `<html>` sans classe |
| `tabular-nums` sur colonnes de chiffres (monde Stock) | **0** |
| `text-right` sur colonnes de chiffres (monde Stock) | **0** |
| `scope="col"` sur en-têtes de table | **0** (primitive `table.tsx` ne le pose pas) |
| Wrapper `overflow-x-auto` sur tables larges | **0** |
| `<select>` natifs contournant le primitive `Select` | **~25 sites** |
| `window.confirm` / `window.alert` | **~12 sites** |
| Primitive `skeleton` | **inexistant** (~60 loaders texte « Chargement… ») |
| Pièges de focus manquants sur modales | 3 modales satellites POS |

## Décisions cadrées (verrouillées)

1. **Thème sombre → activé et éprouvé.** `ThemeProvider` (persistance localStorage + `prefers-color-scheme`) + toggle dans la zone compte de la sidebar ; `.dark` appliqué sur `<html>`. La purge des couleurs brutes devient une **feature qui shippe** : conformité AA vérifiée sur les **deux** thèmes.
2. **Tactile comptoir → système `pointer:coarse`.** Les contrôles passent ≥ 44 px au doigt via `@media (pointer: coarse)` tout en gardant `h-7` (28 px) à la souris. Le cœur POS (PR #11) le fait déjà ponctuellement — on **généralise** au niveau primitives. La densité « registre » reste la règle à la souris.
3. **Ambition → remise à niveau + points forts ciblés.** Toute la dette DS/a11y est corrigée ; **en plus**, deux temps forts fidèles aux anti-références (pas de hero-metrics clinquant) : (a) tableau de bord **à point de vue** — le « chiffre sacré » en tête, hiérarchie entre blocs ; (b) **data-viz registre** — la rampe `chart-1..5` (aujourd'hui 0 % utilisée) portée par des barres fines de proportion, jamais de camembert décoratif.

## Principes directeurs

- **Corriger à la source.** Un fix de primitive (`table`, `select`, `skeleton`, `AlertDialog`) ou de token vaut mieux que N corrections de page. Les phases B/C/D **consomment** les primitives livrées en A.
- **Ne pas dénaturer.** Le DS « registre du comptable » est délibéré et abouti. On respecte : plat (filets `ring-1`, jamais d'ombre app), une seule voix indigo (< 10 % surface, action/sélection/état), Inter partout, densité assumée, monde clos du ticket. La refonte **renforce** la doctrine, elle ne la réécrit pas.
- **Le chiffre est sacré.** `tabular-nums` + alignement à droite sur toute donnée chiffrée ; montants XOF entiers via `formaterMontant`.
- **Tout theme-aware.** Zéro couleur Tailwind brute rémanente en fin de campagne ; tout passe par les tokens (`muted-foreground`, `card`, `destructive`, `success`, `warning`, `primary`, `sidebar-*`, `chart-*`).
- **Process projet.** Plan de phase détaillé → exécution par sous-agents avec revue par tâche → E2E navigateur → revue finale de branche + vague de fix unique → PR + revue CodeRabbit → **merge sur feu vert explicite** (merge commit). Hooks husky actifs, jamais `--no-verify`.

## Suivi global

| Phase | Contenu | Plan détaillé | Statut |
|---|---|---|---|
| A | **Fondations DS & châssis** : thème sombre atteignable, upgrade primitives (`table`, `skeleton`, `Select`, `AlertDialog`, `checkbox`/`textarea`), système tactile `pointer:coarse`, refonte sidebar, a11y du châssis, garde `prefers-reduced-motion` globale | `2026-07-13-phase-a-fondations-ui.md` | 🟢 implémentée (86 tests verts) — QA visuelle + PR en attente |
| B | **Monde Stock / Gestionnaire** : purge couleurs, `tabular-nums`, skeletons, états vides pédagogiques, adoption `Select`, `AlertDialog`, tables denses pro (sticky/scope/clavier), économie de l'indigo | `2026-07-13-phase-b-stock.md` | 🟢 implémentée (86 tests verts, 0 couleur brute résiduelle, QA clair+sombre) |
| C | **Monde Rapports / Admin / Accueil** : purge couleurs, pattern table auditable, retrait `alert()`, états « Réessayer », **tableau de bord à point de vue**, **data-viz registre** | `2026-07-13-phase-c-rapports-admin.md` | 🟢 implémentée (86 tests verts, 0 couleur brute résiduelle, toast + dashboard point-de-vue + barres, QA clair+sombre) |
| D | **Monde POS / Caisse** (léger) : pièges de focus des 3 modales satellites, « Entrée encaisse », 44 px au comptoir, tokens des satellites | rapport `refonte-ui-phase-d-report.md` | 🟢 implémentée (86 tests verts, monde clos préservé, QA sombre) |

Ordre imposé : **A d'abord** (habilitante). B, C, D sont ensuite indépendants ; D est le plus léger (le cœur POS refondu au PR #11 est sain).

## Détail des phases

### Phase A — Fondations DS & châssis *(habilitante)*

Objectif : livrer les primitives et le châssis dont B/C/D dépendent, et rendre le thème sombre réellement utilisable et conforme AA.

**Chantiers**
- **A1 — Thème atteignable.** `ThemeProvider` (localStorage + `prefers-color-scheme`), application de `.dark` sur `document.documentElement`, toggle accessible dans la zone compte de la sidebar. Éprouver AA sur les deux thèmes.
- **A2 — Primitives auditables.** `table.tsx` : `scope="col"` par défaut sur `TableHead`, wrapper `overflow-x-auto`, variante numérique (`text-right tabular-nums`) sur cellule/en-tête, option en-tête collant (`sticky top-0`), densité en-tête `h-8`. Créer `ui/skeleton.tsx`. Créer/adopter `ui/alert-dialog.tsx`. Primitives `checkbox`/`textarea` tokenisées. Retirer `shadow-md` du popup `Select` (`select.tsx:85`) — profondeur par filet, pas d'ombre.
- **A3 — Système tactile.** Variantes de taille `pointer:coarse` (≥ 44 px) sur `Button`/`Input`/`Select`/lignes cliquables, sans changer le rendu souris (`h-7`).
- **A4 — Refonte sidebar (`_app.tsx`).** `bg-sidebar text-sidebar-foreground` ; entrée active portée par `sidebar-primary` ; purge des grays/red bruts → tokens ; retrait des **capitales tramées** (`uppercase tracking-widest`) → casse normale `font-medium text-muted-foreground` ; bouton « Se déconnecter » via primitive `Button` `text-destructive`.
- **A5 — a11y du châssis.** Skip-link + `<main id="contenu" tabIndex>`, `focus-visible:ring-ring/30` unifié sur liens nav et boutons, `aria-label` sur `<nav>`.
- **A6 — Motion.** Garde `@media (prefers-reduced-motion: reduce)` globale neutralisant transitions/animations d'app (dialog, select, boutons).

**Livrable** : primitives prêtes pour B/C/D ; thème sombre commutable et AA ; sidebar conforme DS ; châssis navigable au clavier. Régression zéro (tests web + typecheck + lint verts).

**Critères de succès** : bascule claire/sombre fonctionnelle et lisible (AA) ; `scope`/`overflow-x-auto`/`tabular-nums`/skeleton/`AlertDialog` disponibles au niveau primitive ; 0 couleur brute et 0 capitale tramée dans `_app.tsx`.

### Phase B — Monde Stock / Gestionnaire

Public : gestionnaires en tables denses, exigence d'exactitude.

**Chantiers** (consomment A) : purge des ~60 couleurs brutes → tokens ; **`tabular-nums` + alignement droite** sur toutes les colonnes chiffrées (quantités, CMP, coûts, seuils, deltas) ; deltas colorés → `text-success`/`text-destructive` ; 28 loaders texte → skeletons de table ; états vides qui **orientent l'action** ; 18 `<select>` natifs → `Select` ; 8 `window.confirm/alert` → `AlertDialog`/toast ; en-têtes collants + `scope` (via A2) ; lignes produit cliquables accessibles au clavier (`<Link>` ou `role/tabIndex`+focus) ; économie de l'indigo (statuts passifs en `secondary`/`outline`/`success`).

**Livrable** : les écrans stock/catalogue sont denses, theme-aware, auditables (chiffres alignés), accessibles clavier, avec chargement/vide soignés.

### Phase C — Monde Rapports / Admin / Accueil

Public : propriétaire/admin — vue d'ensemble et contrôle.

**Chantiers** : purge couleurs (fonds `bg-white`/`bg-gray-50` → `card`/`muted`, liens bleus/`bg-black` → `primary`, badges amber/orange → `warning`) ; pattern table auditable (via A2) sur ventes/`$saleId`/3 rapports ; 4 `alert()` d'`utilisateurs` → erreur inline/toast ; « Réessayer » homogène sur les blocs du dashboard ; skeletons.
**Points forts (ambition)** : **tableau de bord à point de vue** — CA du jour + valeur de stock en tête, hiérarchie entre blocs, alertes traitées comme signal (pas carte anonyme), sortie de la grille 2×2 générique ; **data-viz registre** — activer `chart-1..5` par des barres fines de proportion (part de CA par boutique, part de valeur par entrepôt), esthétique registre, jamais de camembert clinquant.

**Livrable** : le pilotage a un vrai point de vue comptable ; rapports lisibles, theme-aware, accessibles ; data-viz sobre dans la voix de la marque.

### Phase D — Monde POS / Caisse *(léger)*

Public : caissiers, clavier d'abord, comptoir tactile. Le cœur (PR #11) est sain ; on solde les régressions des **modales satellites**.

**Chantiers** : `dialogue-depannage`, `tickets-du-jour`, `fermeture-caisse` sous `usePiegeFocus` (role=dialog, Échap, focus trap/restore) ; **Entrée valide** dans `modale-paiement` quand `pretAValider`, et Entrée ajoute l'unique résultat filtré dans la recherche ; boutons de flux passant sous 44 px → `pointer:coarse` (via A3) ; tokens des satellites (`bg-white`/`gray/red/green` → tokens) + `focus-visible:ring` sur tuiles/lignes/× hand-rollés ; raccourcis globaux court-circuités modale ouverte.
**Garde** : la **règle du monde clos** reste absolue (aucune fuite orange rack/vert comptoir/fontes ticket dans l'app ; aucun indigo sur le ticket) — vérifiée saine à l'audit, à préserver.

**Livrable** : encaissement clavier de bout en bout, modales égales devant le clavier, comptoir tactile confortable, cohérence tokens jusqu'aux satellites.

## Journal des différés / arbitrages

- **2026-07-13 (PR #12 — revue CodeRabbit) — aucune issue de code.** Review en état `COMMENTED` (pas `REQUEST_CHANGES`), **0 commentaire actionnable** (0 Potential issue / Refactor / Nitpick), profil CHILL. Seul point non vert : un **pre-merge check ⚠️ non bloquant** « Docstring Coverage 22,5 % < 80 % » — **écarté** : seuil de politique org, pas un défaut ; les fonctions non triviales de la campagne portent déjà des commentaires FR (convention du dépôt, CLAUDE.md ; pas de JSDoc systématique sur les primitives shadcn triviales). CI verte, check CodeRabbit global `pass`.
- **2026-07-13 (revue finale de branche) — 4 reviewers adversariaux + vague de fix unique** (détail : `.superpowers/sdd/refonte-ui-revue-finale.md`). Corrigés : 2 régressions réelles (double-ajout scan/recherche au POS ; garde de formulaire perdue à la conversion `<select required>`→`Select` sur 3 sites), 1 bug de thème manqué (bouton `bg-black` invisible en sombre → `Button`), affordance tactile de `Checkbox`, + 5 P2 (a11y/cohérence). Différés P2 préexistants (non-régressions) : lignes cliquables sans accès clavier sur 3 listes stock (patron `produits` à généraliser), clés d'index, dédup cosmétiques. Post-fix : `typecheck`/`lint`/`86 tests` verts.
- **2026-07-13 (clôture de campagne) — Les 4 phases sont implémentées.** Grep final : **0 couleur Tailwind brute** sur toute l'app (hors scrims `bg-black/NN` theme-neutres et monde clos login/ticket) ; `typecheck` + `lint` + **86 tests** verts ; 3 composants transverses oubliés (`erreur-chargement`, `provisional-password-dialog`, `change-password-form`) rattrapés en fin de Phase D. **Le thème sombre est propre de bout en bout → il passe de « WIP » à « prêt ».** Reste hors implémentation : QA finale, revue de branche, PR + CodeRabbit, merge sur feu vert.
- **2026-07-13 (fin Phase A) — Séquencement du thème sombre.** Le toggle rend le sombre atteignable, mais le contenu (cartes, tables) porte encore ~120 couleurs brutes non theme-aware, purgées en B/C/D. Décision : **garder le toggle, sombre = WIP jusqu'à la fin de campagne**. Le sombre sert de révélateur de dette (un écran propre en sombre = un écran purgé) ; il n'est officiellement « prêt » qu'une fois B/C/D livrées. QA visuelle Phase A : châssis validé en clair ET sombre (sidebar, actif indigo, toggle, pas de FOUC) ; la dette de contenu en sombre est attendue, pas une régression.
- Primitive `toast`/`Toaster` reportée en Phase C (build-when-tested contre `utilisateurs.tsx`).
