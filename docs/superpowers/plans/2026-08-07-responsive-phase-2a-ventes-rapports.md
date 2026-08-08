# SPA responsive — Phase 2a : transverses, détail de vente et rapports — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Régler les deux chantiers transverses décidés après la phase 1 (sémantique des lignes cliquables, repli des filtres), puis rendre responsive le détail de vente et les trois rapports.

**Architecture:** Les deux transverses passent en premier parce que tout le reste s'appuie dessus. `ListeAdaptative` perd `role="button"` sur ses lignes au profit d'un lien réel dans une cellule. Un composant `FiltresRepliables` replie les barres de filtres sous `md` derrière un `<details>` natif, avec compteur de filtres actifs. Les écrans consomment ensuite `ListeAdaptative` **sans le modifier**.

**Tech Stack:** React 19, TanStack Router + Query, Tailwind CSS v4, `@base-ui/react`, Vitest 3 + Testing Library + jsdom.

## Global Constraints

- **Langue** : UI, messages d'erreur et messages de commit (conventionnels) en **français** ; commentaires de code et JSDoc en **anglais**.
- **Mobile-first** : styles de base pour petit écran, `min-width`/`sm:`/`md:`/`lg:` pour enrichir. **Jamais de `max-width` en media query** (la propriété CSS `max-w-*` reste permise).
- **Aucun breakpoint personnalisé.** Paliers Tailwind par défaut uniquement.
- **Aucune donnée masquée selon la largeur d'écran.** Le front masque selon le **rôle**, jamais selon la **taille**.
- **Aucun changement d'identité visuelle** : pas de nouvelle palette, pas de nouvelle fonte, pas de `clamp()`, pas de couleur en dur — tokens uniquement.
- **Aucune nouvelle dépendance.** Aucune modification d'`apps/api`, `packages/shared`, `index.html` ou `routeTree.gen.ts`.
- Montants via `formaterMontant` ; colonnes de chiffres en `tabular-nums`.
- Pièges eslint : `no-unnecessary-condition`, types dans un `import type` séparé, `no-irregular-whitespace`. Base-ui : `render={…}`, **jamais `asChild`**.
- Tests : Vitest 3 `globals: true` — **ne pas importer** `describe`/`it`/`expect`. `@testing-library/jest-dom` n'est **pas** installé. Espaces insécables étroites (U+202F) dans les montants `fr-FR` — **jamais** `getByText(formaterMontant(x))`.
- Hooks husky actifs. **Jamais `--no-verify`.** Push local avec `CI=1` (la suite API est instable sans, piège workerd documenté).
- Spec de référence : `docs/superpowers/specs/2026-08-07-spa-responsive-design.md`.

### Les trois pièges qui ont coûté des rondes de correction en phase 1

1. **Le test garde-fou « ne perd aucune donnée en mode carte » porte sur les colonnes `masquerEnCarte`**, jamais sur les colonnes visibles — celles-ci passent par les paires quoi qu'il arrive, les asserter ne prouve rien. L'erreur inverse a été commise deux fois.
2. **`ListeAdaptative` ne transmet au `TableCell` que `numeric` et `classeCellule`.** Toute autre classe portée par l'ancien `<TableCell>` (`font-medium`, `font-mono`, `text-muted-foreground`…) doit être reposée via `classeCellule` ou sur le contenu rendu dans `cellule`. Deux régressions silencieuses en vue table sont passées par là. **Comparer chaque colonne migrée au `<TableCell>` qu'elle remplace, et le dire dans le rapport.**
3. **Une assertion doit porter sur ce qui peut casser**, pas sur ce qui est vrai par construction. Un `toContain("3")` a été accepté alors que la date de la fixture contenait déjà un « 3 ».
4. **Les commentaires des extraits de code de ce plan sont parfois en français par inadvertance.** La convention du dépôt est l'**anglais** pour tout commentaire de code, tests compris, sans exception. Un extrait de plan fautif n'y change rien : le signaler plutôt que le recopier.
5. **Un test ne justifie jamais de dégrader l'interface.** Si une assertion d'un extrait de ce plan ne passe qu'en simplifiant le rendu (retirer un `<span>` stylé pour satisfaire `getByText`, par exemple), c'est **le test** qui s'adapte — via `textContent`, un matcher fonction ou `within()`. Le cas s'est produit sur le compteur de `FiltresRepliables`.
6. **Ne pas recopier tel quel le calcul de `nbActifs` de la Task 3.** `ventes/index.tsx` gèle sa fenêtre par défaut dans un `useRef` au montage pour la comparer ensuite. C'est correct **parce que sa période est un état local**, recalculé à chaque montage. Un écran dont la période viendrait de l'URL (partage de lien, retour arrière) verrait ce gel qualifier de « neutres » des valeurs que l'utilisateur a explicitement choisies — et annoncerait zéro filtre actif sur une liste filtrée, exactement ce que le compteur existe pour éviter. Chaque écran redécide selon son propre état initial ; en cas d'état d'URL, préférer un drapeau explicite positionné dans les handlers.

---

## Structure de fichiers

**Créés :**

| Fichier | Responsabilité |
|---|---|
| `apps/web/src/components/ui/filtres-repliables.tsx` | `<details>` sous `md`, ouvert et inerte à partir de `md` |

**Modifiés :**

| Fichier | Modification |
|---|---|
| `apps/web/src/components/ui/liste-adaptative.tsx` | Retrait de `role="button"`, `tabIndex` et du gestionnaire clavier de ligne |
| `apps/web/src/components/ui/liste-adaptative.test.tsx` | Tests alignés sur la nouvelle sémantique |
| `apps/web/src/routes/_app/stock/mouvements.tsx` · `_app/ventes/index.tsx` | Barres de filtres repliées |
| `apps/web/src/routes/_app/ventes/$saleId.tsx` | Table 8 colonnes → `ListeAdaptative`, en-tête et paiements |
| `apps/web/src/routes/_app/ventes/rapports.tsx` | Barre d'onglets débordante |
| `apps/web/src/rapports/rapport-ventes.tsx` | 2 tables, `SelecteurPeriode`, trio de boutons |
| `apps/web/src/rapports/rapport-marges.tsx` | Table 7 colonnes, tuiles `grid-cols-3` |
| `apps/web/src/rapports/rapport-valorisation.tsx` | N tables (une par entrepôt), en-tête |

---

### Task 1 : `ListeAdaptative` — retirer `role="button"` des lignes

Aujourd'hui une ligne cliquable porte `role="button"` et `tabIndex={0}`, ce qui **écrase** son rôle natif : un `<tr>` cesse d'être annoncé comme `row` et ses cellules perdent leur propriétaire de ligne ; un `<li>` fait perdre au `<ul>` sa sémantique de liste. Sur un produit positionné sur *l'exactitude vérifiable*, casser la structure d'un tableau pour qui l'écoute contredit la promesse.

Le motif retenu : **le lien réel dans une cellule porte l'action accessible**, le clic sur la ligne reste un confort souris.

**Files:**
- Modify: `apps/web/src/components/ui/liste-adaptative.tsx`
- Modify: `apps/web/src/components/ui/liste-adaptative.test.tsx`

**Interfaces:**
- Consumes: rien.
- Produces: `ListeAdaptative` conserve `surClicLigne?: (ligne: T) => void` et `classeLigne?: (ligne: T) => string`, mais les lignes ne sont plus focusables ni activables au clavier.

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `liste-adaptative.test.tsx`, remplacer les cas qui interrogent les lignes par `role="button"` et les cas d'activation clavier par :

```tsx
it("conserve les rôles natifs de tableau quand la ligne est cliquable", () => {
  const nettoyer = installerMatchMedia(1280)
  afficher({ surClicLigne: () => undefined })
  // The native `row` role must survive: screen readers must keep announcing
  // a table, and cells must keep a row owner.
  expect(screen.getAllByRole("row").length).toBe(3) // header + 2 rows
  expect(screen.queryAllByRole("button")).toHaveLength(0)
  nettoyer()
})

it("conserve la sémantique de liste en mode carte quand la ligne est cliquable", () => {
  const nettoyer = installerMatchMedia(375)
  afficher({ surClicLigne: () => undefined })
  expect(screen.getAllByRole("listitem")).toHaveLength(2)
  expect(screen.queryAllByRole("button")).toHaveLength(0)
  nettoyer()
})

it("n'expose aucune ligne focusable au clavier", () => {
  const nettoyer = installerMatchMedia(1280)
  const { container } = afficher({ surClicLigne: () => undefined })
  expect(container.querySelectorAll("[tabindex]")).toHaveLength(0)
  nettoyer()
})

it("déclenche surClicLigne au clic sur la ligne", () => {
  const nettoyer = installerMatchMedia(1280)
  let recu: string | null = null
  afficher({ surClicLigne: (l) => (recu = l.id) })
  screen.getAllByRole("row")[1].click()
  expect(recu).toBe("1")
  nettoyer()
})

it("ne déclenche pas surClicLigne au clic sur un contrôle interne", () => {
  const nettoyer = installerMatchMedia(375)
  let appels = 0
  afficher({
    surClicLigne: () => (appels += 1),
    actionCarte: () => <a href="/detail">Détail</a>,
  })
  screen.getByText("Détail").click()
  expect(appels).toBe(0)
  nettoyer()
})
```

Adapter la signature du helper `afficher` du fichier pour qu'il accepte ces props si ce n'est pas déjà le cas.

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `bun run --cwd apps/web test -- liste-adaptative`
Expected: les cas sur les rôles natifs et `[tabindex]` ÉCHOUENT (les lignes portent encore `role="button"` et `tabIndex={0}`).

- [ ] **Step 3: Retirer la sémantique de bouton**

Dans `liste-adaptative.tsx` :
- supprimer `role="button"` et `tabIndex={0}` du `<TableRow>` **et** du `<li>` ;
- supprimer la fonction `gererClavierLigne` et les `onKeyDown` qui l'utilisent ;
- **conserver** `gererClicLigne`, `SELECTEUR_INTERACTIF` et `depuisDescendantInteractif` : sans eux, un clic sur un lien de cellule remonterait à la ligne et déclencherait une seconde navigation ;
- corriger le commentaire au-dessus de `SELECTEUR_INTERACTIF`, qui mentionne encore que la ligne « porte aussi `role="button"` » — c'est devenu faux, et la condition `interactif !== limite` reste utile car la ligne elle-même n'est plus interactive.

Mettre à jour la JSDoc de `surClicLigne` pour énoncer le contrat : **le confort souris ne remplace pas une action accessible ; tout écran qui passe `surClicLigne` doit exposer un lien ou un bouton réel dans la ligne**, en table comme en carte.

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `bun run --cwd apps/web test -- liste-adaptative`
Expected: tous verts.

- [ ] **Step 5: Vérifier les consommateurs existants**

Aucun écran ne passe `surClicLigne` aujourd'hui (`grep -rn "surClicLigne" apps/web/src --include=*.tsx` ne doit rendre que le composant et son test). Confirmer, et lancer la suite complète.

Run: `bun run --cwd apps/web test`
Expected: suite entière verte.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ui/liste-adaptative.tsx apps/web/src/components/ui/liste-adaptative.test.tsx
git commit -m "fix(web): rend leurs rôles natifs aux lignes de la liste adaptative"
```

---

### Task 2 : Composant `FiltresRepliables`

Sur les écrans à filtres, les contrôles passés en pleine largeur s'empilent : mesuré à ~700 px de formulaire avant la première donnée à 375 px. Le repli est natif (`<details>`), sans JS, accessible au clavier, et affiche le nombre de filtres actifs pour que rien ne soit caché silencieusement.

**Files:**
- Create: `apps/web/src/components/ui/filtres-repliables.tsx`
- Test: `apps/web/src/components/ui/filtres-repliables.test.tsx`

**Interfaces:**
- Consumes: `useEstLarge` (`@/lib/use-media-query`), `cn`.
- Produces: `FiltresRepliables({ nbActifs, children, className })` où `nbActifs: number` est le nombre de filtres actuellement renseignés.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `apps/web/src/components/ui/filtres-repliables.test.tsx` :

```tsx
import { render, screen } from "@testing-library/react"
import { FiltresRepliables } from "./filtres-repliables"
import { installerMatchMedia } from "@/test/media-query"

function afficher(nbActifs: number, largeur: number) {
  const nettoyer = installerMatchMedia(largeur)
  render(
    <FiltresRepliables nbActifs={nbActifs}>
      <label htmlFor="x">Entrepôt</label>
      <input id="x" />
    </FiltresRepliables>
  )
  return nettoyer
}

describe("FiltresRepliables", () => {
  it("laisse les filtres visibles et sans résumé à partir de md", () => {
    const nettoyer = afficher(0, 1280)
    expect(screen.getByLabelText("Entrepôt")).toBeTruthy()
    expect(screen.queryByText(/Filtres/)).toBeNull()
    nettoyer()
  })

  it("replie les filtres sous md derrière un résumé", () => {
    const nettoyer = afficher(0, 375)
    const resume = screen.getByText(/Filtres/)
    expect(resume).toBeTruthy()
    // Le contenu reste dans le DOM (donc atteignable), simplement replié.
    expect(screen.getByLabelText("Entrepôt")).toBeTruthy()
    nettoyer()
  })

  it("annonce le nombre de filtres actifs sous md", () => {
    const nettoyer = afficher(2, 375)
    // The count lives in its own styled <span>, so match on the summary's full
    // textContent rather than on a single text node.
    const resume = document.querySelector("summary")
    expect(resume?.textContent).toBe("Filtres (2)")
    nettoyer()
  })

  it("s'ouvre d'emblée quand au moins un filtre est actif", () => {
    const nettoyer = afficher(1, 375)
    const details = document.querySelector("details")
    expect(details).not.toBeNull()
    expect(details.open).toBe(true)
    nettoyer()
  })

  it("reste replié quand aucun filtre n'est actif", () => {
    const nettoyer = afficher(0, 375)
    expect(document.querySelector("details").open).toBe(false)
    nettoyer()
  })
})
```

Le quatrième cas porte le principe « tout se lit, tout se prouve » : si un filtre est actif, l'utilisateur doit le voir sans avoir à déplier.

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun run --cwd apps/web test -- filtres-repliables`
Expected: FAIL — module absent.

- [ ] **Step 3: Écrire le composant**

Créer `apps/web/src/components/ui/filtres-repliables.tsx`. Contraintes de rendu :

- À partir de `md` (`useEstLarge()`), rendre les enfants **tels quels**, sans `<details>` ni résumé — la densité desktop est inchangée.
- En dessous, envelopper dans `<details>` avec `open` initialisé à `nbActifs > 0`, et un `<summary>` portant le libellé `Filtres` suivi de `(N)` quand `nbActifs > 0`.
- Le `<summary>` est une cible tactile : hauteur minimale 44 px, `cursor-pointer`, focus visible (`focus-visible:ring-2 focus-visible:ring-ring/30`).
- Tokens uniquement (`text-muted-foreground`, `border`), aucune couleur en dur.
- Le contenu replié reste dans le DOM — `<details>` s'en charge nativement.

La bascule passe par le hook et non par le CSS : rendre les deux versions dupliquerait les contrôles de formulaire dans le DOM, avec des `id` en double et des libellés associés deux fois.

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `bun run --cwd apps/web test -- filtres-repliables`
Expected: 5 cas PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/filtres-repliables.tsx apps/web/src/components/ui/filtres-repliables.test.tsx
git commit -m "feat(web): ajoute le repli des barres de filtres sous md"
```

---

### Task 3 : Appliquer le repli aux deux écrans déjà migrés

Éprouve `FiltresRepliables` sur les deux écrans de la phase 1 avant que les rapports ne le consomment.

**Files:**
- Modify: `apps/web/src/routes/_app/stock/mouvements.tsx`
- Modify: `apps/web/src/routes/_app/ventes/index.tsx`
- Test: suites existantes de ces deux écrans

- [ ] **Step 1: Envelopper les barres de filtres**

Dans `mouvements.tsx`, la barre porte 5 contrôles (Entrepôt, Type, Produit, Du, Au). Dans `ventes/index.tsx`, elle porte la boutique, deux dates et trois boutons de préréglage.

Envelopper chaque barre dans `<FiltresRepliables nbActifs={…}>`. Calculer `nbActifs` à partir des filtres **réellement renseignés**, en excluant les valeurs par défaut : un `Select` sur « Tous » ne compte pas, une recherche vide ne compte pas, une date vide ne compte pas.

Écrire ce calcul comme une expression nommée (`const nbFiltresActifs = …`) et non en ligne dans le JSX — les tâches suivantes le liront comme modèle.

- [ ] **Step 2: Vérifier la non-régression**

Run: `bun run --cwd apps/web test`
Expected: suite entière verte. Les tests existants ne montent pas `installerMatchMedia`, donc le hook répond « desktop » et les filtres restent rendus tels quels — aucun test ne doit bouger. **Si un test bouge, c'est un signal à remonter, pas à absorber.**

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/_app/stock/mouvements.tsx apps/web/src/routes/_app/ventes/index.tsx
git commit -m "feat(web): replie les filtres des mouvements et de l'historique"
```

---

### Task 4 : Détail de vente

La table la plus large de la phase : 8 colonnes, dont trois montants formatés. L'écran n'a ni filtre, ni ligne cliquable, et n'est pas pleine hauteur.

**Files:**
- Modify: `apps/web/src/routes/_app/ventes/$saleId.tsx`
- Test: `apps/web/src/routes/_app/ventes/$saleId.test.tsx` (à créer)

**Interfaces:**
- Consumes: `ListeAdaptative`, `ColonneAdaptative`, type `LigneVente` (`@/lib/pos-api`).
- Produces: `COLONNES_LIGNES_VENTE`, `titreLigneVente`, `valeurLigneVente`, `sousTitreLigneVente` exportés pour le test.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `$saleId.test.tsx` sur le modèle de `routes/_app/ventes/index.test.tsx` (lire ce fichier d'abord). Couvrir :
- les 8 en-têtes présents à 1280 px ;
- à 375 px, la carte porte l'article en titre et le montant de ligne en valeur ;
- **le garde-fou** : chaque colonne `masquerEnCarte` réapparaît (article via `titre`, PU appliqué via `valeur`, et le SKU si masqué) ;
- aucune donnée perdue : `Source`, `Lot`, `Qté`, `Prix catalogue` et `Remise` restent lisibles en carte.

Pour les montants, utiliser un helper regex tolérant aux U+202F, comme dans `ventes/index.test.tsx`.

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun run --cwd apps/web test -- saleId`

- [ ] **Step 3: Migrer la table**

Extraire `COLONNES_LIGNES_VENTE: ColonneAdaptative<LigneVente>[]` et les accesseurs de carte, puis remplacer le bloc `<Table>`.

**Reposer les classes des anciennes cellules via `classeCellule`** : `font-medium` sur `Article`, `font-mono text-muted-foreground` sur `SKU`, `text-muted-foreground` sur `Lot`. Comparer chaque colonne à son `<TableCell>` d'origine et l'indiquer dans le rapport.

Hiérarchie de carte : `titre` = nom d'article (avec la variante quand elle n'est pas `"Standard"`), `valeur` = `PU appliqué`, `sousTitre` = SKU.

`chargement` : cet écran n'utilise pas `TableSkeleton` mais 4 `<Skeleton>` bruts. Conserver ce bloc de chargement tel quel **au-dessus** de la liste, et ne pas passer `chargement` — sinon deux états de chargement se superposeraient.

- [ ] **Step 4: Corriger l'en-tête et les paiements**

`<h1>Ticket n° {ticketNumber} — {storeName}</h1>` et les lignes de paiement (`flex justify-between` avec deux longs spans) débordent à 375 px. Les faire passer en `flex-col sm:flex-row` ou autoriser le retour à la ligne. Ne pas tronquer : les montants et la référence mobile money doivent rester entièrement lisibles.

- [ ] **Step 5: Vérifier**

```bash
bun run --cwd apps/web test -- saleId
bun run --cwd apps/web test
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/_app/ventes/\$saleId.tsx apps/web/src/routes/_app/ventes/\$saleId.test.tsx
git commit -m "feat(web): rend le détail de vente adaptatif"
```

---

### Task 5 : Coquille des rapports et contrôles partagés

Trois rangées `flex` sans `flex-wrap` débordent à 375 px. Cette tâche ne touche à aucune table.

**Files:**
- Modify: `apps/web/src/routes/_app/ventes/rapports.tsx`
- Modify: `apps/web/src/rapports/rapport-ventes.tsx` (uniquement `SelecteurPeriode` et la rangée de contrôles)
- Test: `apps/web/src/rapports/rapport-ventes.test.tsx` (non-régression)

- [ ] **Step 1: Relever ce qui déborde**

Lire et lister, avant toute modification :
- `rapports.tsx` — la barre d'onglets (3 boutons, dont « Valorisation du stock ») ;
- `rapport-ventes.tsx` — `SelecteurPeriode` (deux `<label>` nus enveloppant un `Input`, largeur indéterminée) et le trio `Par boutique` / `Par produit` / `Exporter CSV` ;
- `rapport-valorisation.tsx` — l'en-tête `flex items-center justify-between` avec un long paragraphe et un bouton.

- [ ] **Step 2: Corriger**

Ajouter `flex-wrap` là où il manque, et normaliser `SelecteurPeriode` sur le motif `Label` + `div` du dépôt (comme `mouvements.tsx`) plutôt que le `<label>` nu — les deux champs de date doivent avoir une largeur déterminée (`w-full sm:w-40` ou équivalent).

`SelecteurPeriode` est **partagé** par les trois rapports : le corriger ici les sert tous. Le dire dans le rapport.

- [ ] **Step 3: Vérifier**

Run: `bun run --cwd apps/web test -- rapport-ventes`
Expected: les 4 cas existants passent inchangés.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/_app/ventes/rapports.tsx apps/web/src/rapports/rapport-ventes.tsx
git commit -m "feat(web): corrige les rangées débordantes des rapports"
```

---

### Task 6 : Rapport des ventes — deux tables

**Files:**
- Modify: `apps/web/src/rapports/rapport-ventes.tsx`
- Modify: `apps/web/src/rapports/rapport-ventes.test.tsx`

- [ ] **Step 1: Écrire les tests qui échouent**

Étendre le fichier de test existant (sans toucher aux 4 cas actuels) avec, pour **chacune** des deux tables : les en-têtes présents à 1280 px, et à 375 px le garde-fou sur les colonnes `masquerEnCarte`.

Table « Par boutique » (6 colonnes, type `LigneVentesBoutique`, clé `storeId`) : `titre` = nom de boutique, `valeur` = CA.
Table « Par produit » (7 colonnes, type `LigneVentesProduit`, clé `variantId`) : `titre` = nom de produit, `valeur` = CA, `sousTitre` = SKU.

- [ ] **Step 2: Migrer les deux tables**

Extraire `COLONNES_VENTES_BOUTIQUE` et `COLONNES_VENTES_PRODUIT`, puis remplacer les deux blocs `<Table>`.

**La colonne `CA` de la table « Par boutique » contient une `BarreProportion`** dans un `<span className="flex flex-col items-end gap-1">`. Conserver ce rendu à l'identique dans `cellule` pour la vue table.

En carte, **`ca` est `masquerEnCarte: true` et c'est `valeur` qui porte le rendu complet** (montant + barre empilés). Sans cela le montant s'afficherait deux fois dans la même carte : une fois en tête via `valeur`, une fois en paire via la colonne restée visible. Piège générique : **une colonne dont la donnée est déjà portée par `titre`/`valeur`/`sousTitre` doit être `masquerEnCarte`**, même si son rendu de table est plus riche — c'est `valeur` qui s'enrichit, pas la colonne qui reste visible.

Reposer `font-medium` sur `Boutique` et `Produit`, et `font-mono text-xs text-muted-foreground` sur `SKU`, via `classeCellule`.

Attention : la table « Par boutique » n'a **pas** `TableHeader sticky` aujourd'hui, la table « Par produit » l'a. `ListeAdaptative` pose `sticky` systématiquement — c'est une amélioration, mais elle n'a d'effet que si un `containerClassName` fait du conteneur la boîte de défilement. Ces écrans ne sont pas pleine hauteur : ne pas passer `containerClassName`, et le noter.

- [ ] **Step 3: Vérifier**

```bash
bun run --cwd apps/web test -- rapport-ventes
bun run --cwd apps/web test
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/rapports/rapport-ventes.tsx apps/web/src/rapports/rapport-ventes.test.tsx
git commit -m "feat(web): rend le rapport des ventes adaptatif"
```

---

### Task 7 : Rapport des marges

**Files:**
- Modify: `apps/web/src/rapports/rapport-marges.tsx`
- Test: `apps/web/src/rapports/rapport-marges.test.tsx` (à créer — cet écran n'a aucun test)

- [ ] **Step 1: Écrire le test qui échoue**

Créer le fichier. Couvrir les 7 en-têtes à 1280 px, le garde-fou `masquerEnCarte` à 375 px, et **la présence du `BadgeEstime`** sur une ligne estimée dans les deux modes — c'est une information d'audit, elle ne doit pas disparaître en carte.

- [ ] **Step 2: Corriger les tuiles et migrer la table**

Les tuiles sont en `grid grid-cols-3 gap-3` **sans préfixe responsive** : trois colonnes de montants XOF à 375 px. Passer en `grid-cols-1 sm:grid-cols-3` (ou `grid-cols-3` à partir de `sm` seulement).

Migrer la table (7 colonnes, type `LigneMarge`, clé `variantId`) : `titre` = produit, `valeur` = marge (avec son badge), `sousTitre` = SKU. Reposer les classes via `classeCellule`.

- [ ] **Step 3: Vérifier**

```bash
bun run --cwd apps/web test -- rapport-marges
bun run --cwd apps/web test
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/rapports/rapport-marges.tsx apps/web/src/rapports/rapport-marges.test.tsx
git commit -m "feat(web): rend le rapport des marges adaptatif"
```

---

### Task 8 : Rapport de valorisation

Structure particulière : **une table par entrepôt**, dans un `map`. `ListeAdaptative` s'appelle une fois par section — il n'y a pas de difficulté de fond, seulement à ne pas mélanger les clés.

**Files:**
- Modify: `apps/web/src/rapports/rapport-valorisation.tsx`
- Test: `apps/web/src/rapports/rapport-valorisation.test.tsx` (à créer — aucun test aujourd'hui)

- [ ] **Step 1: Écrire le test qui échoue**

Couvrir : deux entrepôts rendent deux listes distinctes ; les 6 en-têtes à 1280 px ; le garde-fou `masquerEnCarte` à 375 px ; et le fait que **la valeur totale de chaque entrepôt reste visible** dans les deux modes (elle vit dans l'en-tête de section, pas dans la table).

- [ ] **Step 2: Migrer**

Extraire `COLONNES_VALORISATION: ColonneAdaptative<LigneValorisation>[]` **une seule fois** au module, réutilisée à chaque itération. Clé de ligne `variantId`. `titre` = produit, `valeur` = valeur de ligne, `sousTitre` = SKU.

Corriger aussi l'en-tête de section (`flex items-baseline justify-between` : nom d'entrepôt, montant et `BarreProportion`) pour qu'il tienne à 375 px.

- [ ] **Step 3: Vérifier**

```bash
bun run --cwd apps/web test -- rapport-valorisation
bun run --cwd apps/web test
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/rapports/rapport-valorisation.tsx apps/web/src/rapports/rapport-valorisation.test.tsx
git commit -m "feat(web): rend le rapport de valorisation adaptatif"
```

---

## Definition of Done

- `bun run typecheck`, `bun run lint`, `bun run test` verts à la racine.
- Aucun test existant modifié pour « le faire passer ». Le hook dégradant vers desktop garantit que les suites d'écran sont inchangées ; si l'une a dû bouger, c'est un signal à remonter.
- Vérification navigateur consignée à 375, 768 et 1280 px, en thème clair **et** sombre, sur les 5 écrans touchés (détail de vente, les 3 rapports, et l'un des deux écrans à filtres repliés).
- Aucune modification d'`apps/api`, `packages/shared`, `index.html`, `routeTree.gen.ts`.
- `ListeAdaptative` n'a reçu **aucune** nouvelle prop : les écrans le consomment tel quel.
- PR ouverte, revue CodeRabbit traitée (CLI **et** bot — ils trouvent des choses différentes), merge **uniquement sur feu vert explicite de l'utilisateur** (merge commit, pas de squash).

## Hors périmètre, tracé pour la phase 2b

- `components/produit/section-stock.tsx` — `TableFooter` de totaux : le total se rendra **hors** de `ListeAdaptative`, en ligne de synthèse.
- `components/produit/section-variantes.tsx` — deux lignes par variante (variante + ses lots) : maître-détail, passe responsive **écrite à la main**, pas de migration vers `ListeAdaptative`.
- Le littéral `h-[calc(100dvh-3rem)]` survit dans `catalogue/produits/index.tsx`, `catalogue/categories.tsx`, `catalogue/fournisseurs.tsx` (phase 2b) et dans `stock/{index,receptions,transferts,inventaires}.tsx` + `administration/utilisateurs.tsx` (phases 3 et 4). La migration vers `h-full` n'est **pas** terminée.
- `formulaire-variantes.tsx` — rangées d'attributs à deux `Input` plus un bouton sans `flex-wrap` : la pire rangée du produit à 375 px.
- `nouveau.tsx` — envoi `multipart`, plafond image 2 Mo, timeout délibéré de 60 s : **ne pas raccourcir le timeout**, et ne pas introduire d'affordance d'annulation concurrente.
