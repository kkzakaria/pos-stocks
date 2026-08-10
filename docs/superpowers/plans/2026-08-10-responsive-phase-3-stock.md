# SPA responsive — Phase 3 : Stock — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre utilisables de 375 px à desktop les sept écrans du domaine stock — niveaux, réceptions (liste et détail), transferts (liste et détail), inventaires (liste et détail) — et refermer au passage les défauts d'affichage que la phase 2b a tracés sur ce répertoire.

**Architecture:** Les **huit** tables du périmètre — sept écrans, mais `inventaires/$countId.tsx` en porte **deux** (saisie + récapitulatif de clôture) — consomment `ListeAdaptative` telle quelle. C'est le compte qu'attend le journal du projet, qui annonce **douze tables restantes pour les phases 3 et 4** : huit ici, quatre en phase 4 (`administration/entrepots.tsx`, `administration/utilisateurs.tsx`, `produit/section-variantes.tsx`, `produit/section-stock.tsx`). Aucune de ces structures ne lui résiste : pas de pied de totaux, pas de maître-détail, pas de colonne conditionnelle en milieu de tableau qu'un scalaire de ligne ne résoudrait pas. La phase crée en revanche **son propre filet de tests** : le domaine n'en a qu'un seul aujourd'hui, sur le seul écran déjà migré.

**Tech Stack:** React 19, TanStack Router + Query, Tailwind CSS v4, `@base-ui/react`, Vitest 3 + Testing Library + jsdom.

---

## Avertissement liminaire : cette phase n'hérite d'aucun filet

`apps/web/src/routes/_app/stock/` contient **un seul fichier de test** — `mouvements.test.tsx`, sur l'écran migré en phase 1, **hors périmètre**. Les sept écrans de cette phase n'ont aucune couverture.

Conséquence directe sur la méthode : en phase 2b, une colonne perdue ou dupliquée était rattrapée par les suites existantes du catalogue. **Ici, rien ne rattrape.** Le test garde-fou d'un écran n'existe que s'il est écrit **dans la tâche qui migre cet écran**, jamais « à la fin ». Une tâche dont le test n'est pas écrit n'est pas terminée, même si l'écran se rend correctement au navigateur.

Corollaire : les 4 cas de `mouvements.test.tsx` ne doivent **pas bouger d'une ligne**. S'ils bougent, c'est qu'une tâche a touché à `mouvements.tsx` ou à un composant partagé — à remonter, pas à corriger dans le test.

---

## Global Constraints

- **Langue** : UI, messages d'erreur et messages de commit (conventionnels) en **français** ; commentaires de code et JSDoc en **anglais**, tests compris, sans exception.
- **Mobile-first** : `min-width`/`sm:`/`md:`/`lg:` uniquement. **Jamais de `max-width` en media query** (la propriété CSS `max-w-*` reste permise).
- **Aucun breakpoint personnalisé.** Paliers Tailwind par défaut.
- **Aucune donnée masquée selon la largeur.** Le front masque selon le **rôle**, jamais selon la **taille**.
- **Aucun changement d'identité visuelle**, tokens uniquement. **Aucune nouvelle dépendance.**
- Aucune modification d'`apps/api`, `packages/shared`, `index.html`, `routeTree.gen.ts`.
- Montants via `formaterMontant` ; chiffres en `tabular-nums`. **Jamais `getByText(formaterMontant(x))`** : espaces insécables étroites (U+202F) — passer par `texteMontant`.
- Helpers de test **partagés, jamais recopiés localement** : `installerMatchMedia` (`@/test/media-query`), `jetons` (`@/test/jetons`), `texteMontant` (`@/test/texte-montant`).
- Tests : Vitest 3 `globals: true`. Les deux formes (import explicite de `describe`/`it`/`expect`, ou globales) coexistent dans le dépôt — **suivre le fichier voisin** (`stock/mouvements.test.tsx` et `catalogue/*.test.tsx` utilisent les globales).
- **`routeTree.gen.ts` ne doit JAMAIS apparaître au diff.** Il est régénéré par la suite de tests elle-même. Vérifié : le plugin TanStack Router ignore déjà les fichiers `*.test.tsx` du répertoire `routes/` (`grep -c test src/routeTree.gen.ts` = 0), donc créer `receptions/$purchaseId.test.tsx` est sûr — mais le contrôler au `git status` avant chaque commit.
- Hooks husky actifs. **Jamais `--no-verify`.** Push local avec `CI=1`.
- Spec : `docs/superpowers/specs/2026-08-07-spa-responsive-design.md`, §Phasage point 4.

### Composition des colonnes — les règles héritées de la phase 2b

Reprises telles quelles, formulées pour ce domaine.

1. **PAS DE FABRIQUE de colonnes.** Le tableau de colonnes est une **constante au niveau module**, exportée pour que le test asserte *le tableau que l'écran passe*, pas une copie reconstruite.
2. Quand une cellule a besoin d'un contexte que la ligne ne porte pas — un gestionnaire d'écran, un scalaire de page, un état de saisie —, définir un **type « Affichée »** qui l'épisse dans chaque ligne (`ReceptionAffichee`, `NiveauStockAffiche`, `LigneInventaireAffichee`…). Précédents : `ProduitAffiche`, `FournisseurAffiche`, `LigneVenteAffichee`.
3. Le type « Affichée » **peut transporter un gestionnaire `sur*`** — en contrepartie son câblage se teste avec **un mock DISTINCT par ligne**, deux lignes rendues, **clic sur la seconde**, et assertion que la première n'a pas bougé. Un mock partagé laisserait passer une fermeture qui capture la mauvaise ligne (`mutate(items[0])` au lieu de `mutate(item)`), c'est-à-dire une écriture sur le mauvais article.
4. **Composition par droit** : `COLONNES_X` (base, exportée = exactement la vue lecture seule) · `COLONNE_ACTION_X` (module-privée) · `COLONNES_X_ECRITURE = [...COLONNES_X, COLONNE_ACTION_X]` (exportée) · **ternaire au point d'appel**. Deux tableaux énumérés séparément se désynchronisent en silence, et une colonne ajoutée au seul tableau d'écriture masque de la donnée par rôle sans que le rôle le justifie.
5. La colonne d'action est **toujours `masquerEnCarte: true`**, et `actionCarte` rend **le même nœud** — le bouton n'existe donc jamais en double.

### `TEXTE_LIBRE` — sur les colonnes de texte libre, et seulement celles-là

`TEXTE_LIBRE` (`whitespace-normal wrap-anywhere`, exporté par `components/ui/table.tsx`) va sur les cellules qui portent du **texte saisi par un humain** : nom de produit, nom de variante, nom d'entrepôt, nom de fournisseur, numéro de lot fournisseur, référence de bon de livraison, motif.

Il ne va **pas** sur un montant formaté, une quantité, une date formatée, un compte de lignes, un badge : ce sont des valeurs **atomiques**, les couper en deux serait un défaut, pas une correction. Un test par écran assert cette absence, pour qu'un `classeCellule` posé en aveugle sur toutes les colonnes échoue ici plutôt que d'être livré.

Rappel du mécanisme (JSDoc de `TEXTE_LIBRE`) : `break-words` seul y est **inerte** — `overflow-wrap: break-word` ne contribue **jamais** au calcul du `min-content`, or `table-layout: auto` dimensionne les colonnes exactement là-dessus. C'est `whitespace-normal` qui grignote les opportunités de coupure que le texte contient par hasard (espaces **et tirets**), et `wrap-anywhere` qui est la seule des deux à entrer dans le `min-content`. D'où la paire, indissociable.

### Hors table

- Conteneur **flex-rangée** : `min-w-0` **+** `break-words` — indivisibles. Sans `min-w-0`, l'item flex est planchéré à son `min-content` et `break-words` n'a pas de ligne où s'exercer.
- Conteneur **colonne**, ou item portant déjà `w-full` : `break-words` seul (la taille est déjà définie, `min-w-0` serait inerte).
- **Un montant formaté est une séquence entièrement insécable** — `formaterMontant` joint jusqu'au symbole monétaire par des espaces insécables étroites. Son `min-content` vaut **sa largeur entière**, rien ne peut le couper. C'est la cause vérifiée du défaut de la modale de paiement du POS (488 px de panneau dans un écran de 375). Corollaire opératoire : à côté d'un montant, **c'est le minimum à zéro qui corrige, jamais un maximum borné** — `1fr` seul vaut `minmax(auto, 1fr)` et reproduit le défaut à l'identique.

### Bascule et sémantique

- La bascule table ↔ cartes passe par **`useEstLarge()`**, jamais par CSS, et **jamais deux arbres montés** : un DOM dupliqué ferait lire deux fois chaque ligne aux lecteurs d'écran et doublerait le coût de rendu sur le matériel modeste que vise le produit.
- **`role="list"` sur toute liste de cartes écrite à la main.** La Preflight Tailwind pose `list-style: none` sur tout `<ul>`, et VoiceOver/Safari retire alors le rôle de liste : l'utilisateur perd la cardinalité et la position que le mode table lui donne gratuitement. `ListeAdaptative` le porte déjà ; toute liste ajoutée à la main doit le porter aussi (voir le bloc « En transit entrant » de `stock/index.tsx`, Task 4).
- **Toute ligne cliquable expose un lien ou un bouton réel**, en table comme en carte. `surClicLigne` est du confort souris : la ligne reste un `row`/`listitem` non focusable.

### Tests

- Les tests gardent que **la classe est posée**, jamais qu'elle produit son effet : jsdom n'a ni moteur de mise en page ni cascade. **L'écrire en commentaire dans les cas concernés** — l'effet se mesure au navigateur, et le plan attend cette mesure au § Definition of Done.
- Une assertion doit porter sur **ce qui peut casser** : cibler la paire `<dt>`/`<dd>`, pas `carte.textContent`. Reprendre le helper local `valeurPaire` du modèle (`catalogue/fournisseurs.test.tsx`).

### `ListeAdaptative` — gel assoupli

Le composant est consommé tel quel par défaut. **Mais le gel n'est pas un interdit** : quand une contrainte réelle n'a aucune alternative propre, on modifie le composant. Ordre de préférence : résoudre au niveau de l'écran → vérifier que `masquerEnCarte` ne couvre pas déjà le cas → ouvrir le composant. Toute modification est additive, documentée en JSDoc, couverte par un test, et sa raison consignée au rapport de tâche. **C'est le contournement qui doit se justifier.**

À ce stade de la reconnaissance, **aucune tâche de cette phase n'a de raison d'ouvrir `ListeAdaptative`.** Si l'une croit devoir le faire, c'est un signal à remonter avant d'écrire la ligne. (La phase ouvre en revanche **un** composant partagé, et un seul : `FiltresRepliables`, dont le `label` s'élargit à `React.ReactNode` — arbitrage A, Task 4. C'est une exception tranchée d'avance, pas un précédent.)

---

## Les pièges accumulés

### Hérités des phases 1 à 2b

1. **Le test garde-fou « ne perd aucune donnée en mode carte » porte sur les colonnes `masquerEnCarte`**, jamais sur les visibles — celles-ci passent par les paires quoi qu'il arrive. Le garde-fou assert leur **absence** de la liste de paires ; il ne prouve rien s'il assert la présence des colonnes visibles.
2. **Une colonne dont la donnée est déjà portée par `titre`/`valeur`/`sousTitre` doit être `masquerEnCarte`**, même si son rendu de table est plus riche ; c'est `titre`/`valeur` qui s'enrichit. Sinon la donnée s'affiche deux fois dans la carte.
3. **Réutiliser l'accesseur comme `cellule`** (`cellule: titreReception`) plutôt que ré-inliner l'expression : c'est ce qui empêche *structurellement* la divergence entre table et carte, pas le commentaire.
4. **`ListeAdaptative` ne transmet au `TableCell` que `numeric` et `classeCellule`.** Toute autre classe de l'ancien `<TableCell>` (`font-medium`, `font-mono text-xs`, `text-sm`, `whitespace-nowrap`) doit être reposée via `classeCellule`. Comparer chaque colonne migrée à celle qu'elle remplace, et le dire dans le rapport de tâche.
5. **Migrer aussi la branche de chargement.** Passer `chargement={…isPending}` et supprimer les imports `Table`/`TableSkeleton` devenus inutiles — sans quoi l'utilisateur voit une table dense défiler à 375 px avant que les cartes n'apparaissent.
6. **`cn()` (tailwind-merge) supprime `whitespace-nowrap` quand `whitespace-normal` est passé.** Ne pas s'étonner de voir `whitespace-nowrap` disparaître d'une cellule portant `TEXTE_LIBRE` : c'est le comportement voulu, et c'est aussi pourquoi un `classeCellule: "whitespace-nowrap"` posé *à côté* de `TEXTE_LIBRE` serait silencieusement annulé.

### Nés depuis la phase 2b

7. **Le palier le plus étroit du mode table est 1024 px, pas 768.** À `lg`, la barre latérale devient permanente (−240 px) au moment exact où la grille passe à trois colonnes. Conteneur mesuré : 991 px à 1023 → **480 px à 1024** → 651 px à 1280. Un défaut de largeur de table y est **invisible aux paliers habituels**. **Ajouter 1024 à toute campagne de vérification.**
8. **Une correction responsive horizontale peut faire franchir un plafond vertical.** C'est ce qui a rendu un dialogue non validable en 2b : replier une rangée la rend plus haute, et un dialogue plafonné à `viewport − 2rem` finit par pousser son bouton de validation dans la zone défilante. Toute correction horizontale sur un dialogue se revérifie **en hauteur**, à 375×812 **et** en viewport court.
9. **Un calque en `position: fixed` masque son propre débordement à `scrollWidth`.** `documentElement.scrollWidth` vaut `clientWidth` alors que la modale déborde de 129 px. **Aucune assertion automatique de débordement ne peut voir ce défaut** : mesurer les **rectangles des éléments** (`getBoundingClientRect`), jamais le document. Concerne **les quatorze calques du périmètre — 9 `Dialog` et 5 `AlertDialog`**, énumérés un par un au § Definition of Done. **C'est cette énumération qui se coche, jamais un compte** : un compte se retient de travers, et un calque non mesuré ne se signale par rien.
10. **Le JIT de Tailwind v4 ne génère que les classes présentes DANS LES SOURCES.** Injecter une classe via `className` depuis la console pour mesurer donne un faux négatif : mesurer en `style.cssText`.
11. **Chrome renvoie encore des rectangles de layout pour le contenu d'un `<details>` FERMÉ** (`content-visibility: hidden`). Chaque panneau `FiltresRepliables` replié produit de fausses occlusions et de fausses cibles sous-dimensionnées lors d'un audit automatisé. Déplier avant de mesurer.
12. **`FiltresRepliables` n'a pas de wrapper au-dessus de `md`** : au palier `md`+ il rend `<>{children}</>`. Un `className` (et donc une marge) passé au composant **est perdu au desktop**. Les marges vivent sur le `<div>` intérieur, exactement comme `catalogue/produits/index.tsx` le fait avec son `mt-4`.

---

## Structure de fichiers

**Modifiés (8) :**

| Fichier | Ce que la phase y fait |
|---|---|
| `apps/web/src/routes/_app/stock/receptions/index.tsx` | `ListeAdaptative` + lien de ligne + `FiltresRepliables` + `h-full` + 2 `SelectValue` |
| `apps/web/src/routes/_app/stock/transferts/index.tsx` | idem (sans les `SelectValue` de création, déjà pourvus d'une fonction de rendu — mais sans repli) |
| `apps/web/src/routes/_app/stock/inventaires/index.tsx` | idem + le `SelectValue` sans libellé de repli |
| `apps/web/src/routes/_app/stock/index.tsx` | `ListeAdaptative` + `FiltresRepliables` + `h-full` + liste « En transit » + `SelectValue` |
| `apps/web/src/routes/_app/stock/receptions/$purchaseId.tsx` | `ListeAdaptative` + en-tête de page + `SelectValue` d'article |
| `apps/web/src/routes/_app/stock/transferts/$transferId.tsx` | `ListeAdaptative` + en-tête de page + dialogue de réception |
| `apps/web/src/routes/_app/stock/inventaires/$countId.tsx` | `ListeAdaptative` (saisie **et** récapitulatif de clôture) + en-tête + élargissement du dialogue de récapitulatif + `flex-wrap` du bloc d'actions de pied |
| `apps/web/src/components/ui/filtres-repliables.tsx` | `label` élargi de `string` à `React.ReactNode` — **seule ouverture de composant partagé de la phase**, arbitrage A |

**Créés (7 fichiers de test) :** `receptions/index.test.tsx`, `transferts/index.test.tsx`, `inventaires/index.test.tsx`, `stock/index.test.tsx`, `receptions/$purchaseId.test.tsx`, `transferts/$transferId.test.tsx`, `inventaires/$countId.test.tsx`.

**Intouchés :** `stock/mouvements.tsx` et `stock/mouvements.test.tsx` (tables témoins de la phase 1), `lib/transferts.ts`, `lib/stock.ts`, `lib/permissions.ts`, et `components/ui/*` **à la seule exception de `filtres-repliables.tsx`** ci-dessus. En particulier `liste-adaptative.tsx`, `dialog.tsx` et `table.tsx` ne bougent pas : l'élargissement du dialogue de récapitulatif passe par le `className` que `DialogContent` accepte déjà.

---

## Décisions déjà prises — ne pas les rouvrir

### 1. Le lien de ligne : la colonne d'identité métier porte le lien

Trois listes (réceptions, transferts, inventaires) ont aujourd'hui une ligne cliquable **sans lien réel** — le seul point resté ouvert du chantier depuis la phase 2a.

**La réponse retenue : la colonne d'identité métier porte le lien**, celle qui est déjà en `font-medium` dans chaque liste :

| Écran | Colonne porteuse | Cible |
|---|---|---|
| Réceptions | **Fournisseur** | `/stock/receptions/$purchaseId` |
| Transferts | **Destination** | `/stock/transferts/$transferId` |
| Inventaires | **Entrepôt** | `/stock/inventaires/$countId` |

Cette colonne devient le **`titre`** de la carte, exactement comme « Nom » sur la liste des produits. **Aucun motif nouveau** : la colonne est `masquerEnCarte: true` et `titre` rend **le même `<Link>`**, ce qui interdit *structurellement* la divergence entre les deux paliers.

`surClicLigne` reste passé pour le confort souris sur toute la ligne. `ListeAdaptative` neutralise déjà les descendants interactifs (`depuisDescendantInteractif`) : **ne pas ajouter de `stopPropagation` manuel**, il serait redondant.

Note sur les transferts : le `titre` ne porte que la destination, mais **la direction n'est pas perdue** — « Origine » reste une paire visible juste en dessous, et le sous-titre porte la date. La lecture de la carte reste « vers X, depuis Y, le Z ».

Ces trois écrans portent leurs filtres en **état local** (`useState`), pas dans l'URL : le `<Link>` n'a donc **aucun `search` à transporter**, contrairement à la liste des produits. C'est plus simple, pas moins rigoureux — et cela dispense ces trois écrans d'un type « Affichée ».

### 2. Repli des filtres sur les QUATRE listes

`FiltresRepliables` va sur **les quatre listes**, y compris les trois qui n'ont qu'un sélecteur de statut. La cohérence prime sur l'économie d'un geste : quatre écrans voisins qui se comportent différemment coûtent plus cher, à l'usage comme à la relecture, que le tap supplémentaire. Et le panneau récupère de la hauteur à 375 px, là où elle est la ressource rare.

---

## Les quatre arbitrages tranchés dans ce plan

### A. `stock/index.tsx` — le sélecteur d'entrepôt ne compte PAS comme filtre actif

**Le fait :** l'entrepôt est présélectionné par un effet (`if (!entrepotId && entrepots.length > 0) setEntrepotId(entrepots[0]?.id ?? "")`) et la requête est conditionnée dessus (`enabled: entrepotId !== ""`). Le compter afficherait « 1 » en permanence.

**Tranché : il ne compte pas.** `nbFiltresActifs = (recherche !== "" ? 1 : 0) + (alertesSeules ? 1 : 0)`.

Trois raisons, dans l'ordre de force :

1. **Ce n'est pas un filtre, c'est la portée de la requête.** Un filtre restreint un ensemble par rapport à un état non filtré ; ici il n'existe **aucune liste sans entrepôt** — la requête n'est même pas émise. Un compteur doit répondre à « combien de restrictions ai-je posées ? », pas à « combien de contrôles ai-je touchés ? ».
2. **Un « 1 » permanent détruit le mécanisme du composant.** `nbActifs` ne peut que **forcer l'ouverture** sur son front montant. L'effet de présélection ferait passer 0 → 1 au montage, donc le panneau serait **toujours déplié à l'arrivée** : le repli n'aurait jamais lieu, sur le seul écran de la phase qui en a le plus besoin (trois contrôles).
3. Un badge qui ne descend jamais à zéro cesse d'être lu au bout de deux visites — il devient du bruit, ce qui abîme le compteur sur les trois autres écrans par contagion d'habitude.

**Mais l'entrepôt ne doit pas disparaître derrière un `<details>` fermé** : c'est le contexte de *chaque chiffre* affiché en dessous, et une quantité sans son entrepôt ne veut rien dire — « le chiffre est sacré ». Correctif, avec la prop existante et **sans toucher au composant** :

```tsx
<FiltresRepliables
  nbActifs={nbFiltresActifs}
  label={nomEntrepotCourant ? `Filtres — ${nomEntrepotCourant}` : "Filtres"}
>
```

`label` n'est rendu que dans le `<summary>`, c'est-à-dire **uniquement sous `md`** : le desktop est strictement inchangé.

**Ce libellé composé doit être protégé de la coupe — le plan l'invente, il lui doit sa propre règle.** `nomEntrepotCourant` est du **texte libre saisi par l'utilisateur** ; l'écran le plus étroit du périmètre est aussi celui où on le fait remonter dans un en-tête. Direction du conteneur, vérifiée dans le composant : le `<summary>` est `flex min-h-11 items-center gap-1.5`, donc **flex-rangée** — c'est la première des deux formes du § Hors table qui s'applique, la **paire indivisible `min-w-0 break-words`**, pas `break-words` seul.

Difficulté mécanique : `label` est typé `string`, il arrive donc dans le `<summary>` comme **item flex anonyme**, et un item anonyme ne peut porter aucune classe. La protection suppose un porteur. **Tranché : élargir `label` de `string` à `React.ReactNode`** — modification **additive** de `FiltresRepliables` (valeur par défaut `"Filtres"` inchangée, aucun appelant existant cassé), documentée en JSDoc, couverte par un cas dans `components/ui/filtres-repliables.test.tsx`, et consignée au rapport de tâche. L'écran passe alors :

```tsx
label={
  nomEntrepotCourant ? (
    <span className="min-w-0 break-words">Filtres — {nomEntrepotCourant}</span>
  ) : (
    "Filtres"
  )
}
```

C'est la **seule** ouverture de composant partagé prévue par la phase, et elle ne concerne pas `ListeAdaptative`. Si un exécutant trouve une voie qui protège la coupe sans toucher au composant, elle est préférable — mais elle doit produire le même résultat mesuré au navigateur, avec un nom d'entrepôt d'un seul jeton insécable à 375 px.

**Alternative écartée :** sortir le sélecteur d'entrepôt du panneau et le laisser au-dessus. Elle scinderait la barre de filtres en deux groupes visuels et réinstallerait précisément le mur de contrôles empilés que le repli existe pour supprimer.

### B. `inventaires/$countId.tsx` — la table de saisie passe PAR `ListeAdaptative`

**Le fait :** la cellule « Compté » contient un `<Input>` éditable, et l'action est un bouton d'enregistrement **par ligne**.

**Tranché : oui, `ListeAdaptative`.** Cinq arguments :

1. `cellule` accepte **tout nœud React**. Un champ de saisie n'est pas plus exotique qu'un `Badge` ou un `<Link>`, tous deux déjà rendus par des colonnes en production.
2. Les lignes sont **uniformes** — un article, quatre chiffres, une action. C'est exactement la forme que le composant sert ; rien ici n'a la structure d'un maître-détail ou d'un pied de totaux, les deux seules formes qui lui aient résisté.
3. **Le mode carte améliore la saisie plutôt que de la dégrader.** En table à 375 px, un `<Input className="w-24">` plus un bouton « Enregistrer » dans la même rangée que le nom du produit et trois chiffres, c'est la pire rangée du domaine. En carte, l'article est le titre, le champ occupe sa paire « Compté » avec son libellé en vis-à-vis, et le bouton devient `actionCarte` — rendu **sous les paires, en bas de carte, dans la zone du pouce**, au lieu d'être comprimé dans la rangée. (Sans plus : `ListeAdaptative` rend `actionCarte` dans un simple `<div className="mt-2">` et **n'impose aucune largeur** — le bouton garde la sienne. Aucune tâche de la phase ne prescrit `w-full` ; les deux actions de carte du périmètre restent alignées à droite, parce que c'est **le même nœud** qui sert de cellule de table et d'`actionCarte`, règle 5 de la composition.)
4. L'état de saisie vit déjà **dans l'écran** (`saisies: Record<string, string>`), pas dans la cellule : le passer par un type « Affichée » ne déplace aucune responsabilité.
5. Écrire une passe manuelle ici, c'est écrire une **huitième** implémentation de carte dans le dépôt, avec sa propre dérive de libellés.

**Ce que devient la saisie en mode carte :** la colonne « Compté » **n'est pas** `masquerEnCarte` — c'est la donnée qu'on est en train de saisir, elle reste une paire visible. Son `<dd>` porte `min-w-0 text-right break-words tabular-nums` ; l'`Input` y garde ses classes actuelles `ml-auto w-24 text-right` (le `ml-auto` fonctionne dans un `<dd>` comme dans un `<td>` : c'est une boîte bloc de largeur définie). Le bouton « Enregistrer » quitte la table via `COLONNE_ACTION_LIGNE_INVENTAIRE` (`masquerEnCarte: true`) et revient par `actionCarte`, donc **exactement une fois** par ligne, à chaque palier.

**Le piège de composition, et sa résolution.** La colonne « Compté » se rend différemment selon `ouvert && peutEcrire` — champ de saisie, ou valeur en lecture. Elle est **au milieu** du tableau, pas en queue : la composer par deux tableaux énumérés (`COLONNES_…` / `COLONNES_…_SAISIE`) violerait la règle 4 et se désynchroniserait. **La résolution est de faire porter le drapeau par la ligne** : `LigneInventaireAffichee` transporte `saisissable: boolean` (un scalaire de page épissé dans chaque ligne — précédent exact : `totalCa` dans `rapports/rapport-ventes.tsx`), et **une seule** colonne « Compté » branche dessus. Le tableau reste donc : 4 colonnes de données + 1 colonne d'action appendée par spread, ternaire au point d'appel. La convention tient sans exception.

### C. `inventaires/$countId.tsx` — le récapitulatif de clôture passe AUSSI par `ListeAdaptative`

**Le fait :** le récapitulatif est une table de 4 colonnes **à l'intérieur d'un `DialogContent`** — sans précédent dans le dépôt.

**Tranché : `ListeAdaptative`, ET on élargit ce dialogue-là.** Les deux vont ensemble ; voici pourquoi.

**Le signal de bascule est bon, mais il ne suffit pas.** `ListeAdaptative` ne mesure rien : il lit `matchMedia` sur le **viewport**. Sous `md` c'est exactement ce qu'il faut — le `DialogContent` vaut alors `max-w-[calc(100%-2rem)]`, donc il suit le viewport, et le mode cartes s'installe pile au moment où la boîte devient étroite. **Mais au-delà, le dialogue est découplé du viewport** : `dialog.tsx` plafonne le contenu à `sm:max-w-sm` dès 640 px, soit **384 px pour toujours**. Or `useEstLarge()` rebascule en table à 768 px. À partir de `md`, le composant partagé rendrait donc une table de 4 colonnes dans une boîte de 384 px — à défilement horizontal interne, c'est-à-dire **la géométrie même que l'arbitrage prétend fuir**.

**Correctif, sur ce dialogue seulement :** `<DialogContent className="md:max-w-2xl">`. Le composant accepte déjà un `className` fusionné par `cn()`, et le précédent existe dans le dépôt (`components/utilisateur/gerer-acces.tsx`, `sm:max-w-lg`) — aucune modification de `dialog.tsx`. Le palier choisi est `md`, pas `sm` : à `sm` (640–767 px) le mode cartes est encore actif et `max-w-2xl` (42 rem = 672 px) dépasserait le viewport, ce qui collerait la boîte aux bords ; à `md` (768 px) elle laisse 96 px de marge et 640 px de corps utile, de quoi loger « Article / Compté / Stock avant clôture / Écart appliqué » sans défilement interne. `2xl` est sur l'échelle Tailwind du système, comme `sm` et `lg` déjà utilisés pour les dialogues du dépôt.

**Ce plafond se mesure**, aux quatre paliers de la campagne (375, 768, 1024, 1280) : la boîte doit valoir ~343 px à 375 (cartes), et 672 px à 768/1024/1280 (table), **sans barre de défilement horizontale interne** au conteneur de table. C'est une correction de géométrie pure, dans le mandat de la phase.

**Ce que le défaut est vraiment — et ce qu'il n'est pas.** Ne pas écrire que la table « déborde du calque, invisible à `scrollWidth` » : `components/ui/table.tsx` enveloppe déjà chaque table dans un `<div className="relative w-full overflow-x-auto">`. La table **défile donc à l'intérieur** du dialogue ; elle ne le fait pas grandir et ne crève pas le calque. Le défaut réel est « une table de 4 colonnes à défilement horizontal dans une modale de 384 px » — mauvais, mais d'une autre nature : on perd la comparaison entre colonnes, pas des pixels hors écran. Le précédent invoqué au piège 9 (la modale de paiement du POS, 488 px de panneau dans 375) est un calque **écrit à la main, sans ce conteneur** : c'est pour cela que lui débordait pour de bon. La distinction compte — la confondre enseignerait un mécanisme faux, et ferait chercher au navigateur un débordement qui n'existe pas ici.

Le besoin de la bascule reste entier sous `md` : à 375 px le corps du dialogue offre ~311 px utiles, et quatre colonnes n'y sont pas lisibles, défilement ou pas. La table restante est purement lecture seule, sans état, sans action : le consommateur le plus simple de toute la phase.

**Deux contraintes, non négociables :**

- **Ne PAS passer de `containerClassName`.** Le corps du dialogue est déjà la boîte défilante ; y ajouter `min-h-0 flex-1 overflow-y-auto` créerait une seconde région de défilement imbriquée — le motif exact qui a rendu un dialogue non validable en 2b.
- **Vérifier le plafond vertical** (piège 8). Une liste de cartes est **plus haute** qu'une table : avec trois écarts, le titre « Récapitulatif de clôture » et le paragraphe de synthèse final doivent rester atteignables, et **aucune barre de défilement parasite** ne doit apparaître. À mesurer à 375×812 **et** en viewport court.

`ecartRendu` reste **une seule fonction**, partagée par la table principale et le récapitulatif, comme aujourd'hui.

### D. Le double prédicat : nommer l'autorisation, pas sa formule

**Le fait — et une divergence avec le brief :** ce ne sont pas deux écrans mais **trois**, avec deux formulations :

| Écran | Prédicat actuel | Répétitions dans le fichier | Points d'appel |
|---|---|---|---|
| `receptions/$purchaseId.tsx` | `brouillon && peutEcrire` | **6** | bouton « Ajouter une ligne » · `<TableHead />` d'action · cellule d'action · `colSpan` · message d'état vide · bloc d'actions de pied |
| `transferts/$transferId.tsx` | `brouillon && peutEcrireOrigine` | **6** | mêmes six |
| `inventaires/$countId.tsx` | `ouvert && peutEcrire` | **5** | `const colonnes = … ? 5 : 4` · `<TableHead />` d'action · cellule « Compté » (saisie ou lecture) · cellule d'action · bloc d'actions de pied |

Deux de ces points d'appel **disparaissent** avec la migration sur chaque écran — `<TableHead />` et `colSpan` pour les réceptions/transferts, `<TableHead />` et `const colonnes` pour l'inventaire —, `ListeAdaptative` calculant `colonnes.length`. Les autres survivent, et la « cellule d'action » en engendre **deux** (le ternaire de choix du tableau de colonnes **et** `actionCarte`, qui vont toujours ensemble). Bilan après migration : **cinq** usages de `ligneModifiable` sur les réceptions et les transferts, **quatre** de `saisieOuverte` sur l'inventaire.

**Tranché :**

1. **Les noms de tableaux restent sur l'axe du droit** — `COLONNES_LIGNES_RECEPTION` / `COLONNE_ACTION_LIGNE_RECEPTION` / `COLONNES_LIGNES_RECEPTION_ECRITURE`. Un tableau de colonnes ne dépend pas de l'état du document ; le baptiser `_BROUILLON_ECRITURE` lui attacherait une notion qu'il ne porte pas et casserait l'homogénéité avec les huit écrans déjà migrés.
2. **Le prédicat composé est nommé UNE fois, au niveau de l'écran, juste après ses deux opérandes**, et dit **ce qu'il autorise**, pas comment il se calcule :
   - `const ligneModifiable = brouillon && peutEcrire` (réception détail)
   - `const ligneModifiable = brouillon && peutEcrireOrigine` (transfert détail)
   - `const saisieOuverte = ouvert && peutEcrire` (inventaire détail)
3. **Cette constante remplace TOUTES les répétitions du fichier** : choix du tableau de colonnes, `actionCarte`, bouton « Ajouter une ligne », bloc d'actions de pied, **message d'état vide** — et, sur l'inventaire, le branchement de la cellule « Compté » (via `saisissable`, voir l'arbitrage B). Le risque n'est pas la verbosité, c'est qu'une des six occurrences (cinq sur l'inventaire) dérive. **Aucune ne se laisse oublier : le § Definition of Done exige qu'après migration le prédicat brut n'apparaisse plus qu'une seule fois par fichier — sa déclaration.**
4. **Ne jamais l'appeler `peutEcrire`** — cela masquerait le droit pur et laisserait croire au lecteur que l'action de ligne suit le rôle seul.
5. Bénéfice collatéral : l'arithmétique `colSpan={brouillon && peutEcrire ? 6 : 5}` **disparaît entièrement**, `ListeAdaptative` calculant `colonnes.length`. Trois occurrences fragiles en moins.

---

## Inventaire des défauts confirmés à traiter

Relevé par reconnaissance, **à revérifier en lisant le code au début de chaque tâche**.

### `SelectValue` — deux modes d'échec distincts, 10 occurrences défectueuses sur 12

Le périmètre porte **12** `SelectValue`. Dix sont défectueux et listés ci-dessous ; **deux sont déjà conformes et ne doivent pas être touchés** : `r-statut` (`receptions/index.tsx`, repli `?? "Tous"`) et `t-statut` (`transferts/index.tsx`, ternaire sur `""`).

**Mode 1 — auto-fermant, sans fonction de rendu : base-ui retombe sur la valeur brute et affiche l'UUID.** Trois occurrences, **les seules de la SPA** (vérifié par recherche) ; la phase referme ce mode définitivement.

| Fichier | `id` | Effet observé |
|---|---|---|
| `receptions/index.tsx` | `r-entrepot` | « 4d5231ad-ddca-… » au lieu du nom d'entrepôt |
| `receptions/index.tsx` | `r-fournisseur` | idem, nom de fournisseur |
| `receptions/$purchaseId.tsx` | `l-variante` | idem, libellé d'article |

**Mode 2 — fonction de rendu SANS libellé de repli : la fonction est appelée même à vide, son retour `undefined` affiche un champ blanc.** Le brief n'en nommait qu'une (`inventaires/index.tsx`) ; **le code en porte sept.**

| Fichier | `id` | Vide au premier rendu ? |
|---|---|---|
| `stock/index.tsx` | `n-entrepot` | **Oui** — `entrepotId` vaut `""` jusqu'à ce que l'effet de présélection passe : champ blanc visible à l'arrivée |
| `inventaires/index.tsx` | `i-entrepot` | **Oui** — `""` tant qu'aucun entrepôt n'est choisi dans le dialogue |
| `inventaires/index.tsx` | `i-statut` | Non (`STATUTS_INVENTAIRE_FR[""]` = « Tous ») ; blanc sur une valeur inconnue |
| `transferts/index.tsx` | `t-origine` | **Oui** |
| `transferts/index.tsx` | `t-destination` | **Oui** |
| `transferts/$transferId.tsx` | `tl-variante` | **Oui** |
| `transferts/$transferId.tsx` | `tl-lot` | **Oui** |

**Le correctif est le même partout, et il est écrit dans `CLAUDE.md` :** le libellé de repli va **dans la fonction**, de préférence via le repli du lookup — `find(…)?.name ?? "— choisir —"`. Ce motif couvre aussi la remise à zéro après succès quand l'option vient de quitter la liste. Une fois la fonction pourvue de son repli, l'attribut `placeholder` **est mort** (base-ui l'ignore dès qu'une fonction est passée) : le retirer, pour que le prochain lecteur ne le croie pas actif.

### En-têtes de page qui s'écrasent — 3 occurrences

`flex items-center gap-3` sans `flex-wrap` ni `min-w-0`, chacun avec un titre contenant du **texte libre** et un `Badge` :

| Fichier | Titre | Exposition |
|---|---|---|
| `receptions/$purchaseId.tsx` | `Réception — {supplierName}` | Mesuré en 2b : `scrollWidth` **925** contre 375, déclenché par un jeton insécable dans le nom de fournisseur |
| `transferts/$transferId.tsx` | `Transfert — {from} → {to}` | **Le plus exposé** : deux noms d'entrepôt |
| `inventaires/$countId.tsx` | `Inventaire — {warehouseName}` | Un nom d'entrepôt |

Correctif uniforme : `flex flex-wrap items-center gap-3` sur le conteneur, `min-w-0 break-words` sur le `<h1>` (conteneur flex-rangée → la paire est indivisible), `shrink-0` sur le `Badge`. **`TEXTE_LIBRE` ne s'applique pas ici** : il traite les cellules de table, pas les titres de page.

### Autres

- **`h-[calc(100dvh-3rem)]` sur les quatre listes** → `h-full`. `_app.tsx` rend son `<main>` `flex min-h-0 min-w-0 flex-1 flex-col`, donc la hauteur résolue est déjà définie : le `calc` est une rétro-ingénierie qui dérive dès que la chrome au-dessus change. **Le littéral doit avoir disparu du répertoire `stock/`** à la fin de la phase (il survivra dans `administration/utilisateurs.tsx` — phase 4).
- **`TableHeader sticky` inerte sur les trois écrans de détail** (table sans conteneur de défilement). **Tranché : on le laisse inerte.** Donner une boîte défilante à ces trois tables changerait le mode de défilement de la page entière — hors du mandat responsive, et exactement le genre de correction horizontale qui franchit un plafond vertical (piège 8). Après migration, le `sticky` provient de `ListeAdaptative` et n'est plus un choix d'auteur : il n'y a plus rien à retirer au niveau de l'écran. Déjà tracé comme cosmétique au hors-périmètre de la 2b ; le rester.
- **Quantités sans séparateur de milliers** alors que les montants passent par `formaterMontant` : différé tracé en 2b, **hors périmètre**, ne pas le corriger au passage.
- **Devise** : les écrans du stock appellent `formaterMontant(x)` sans devise (repli `XOF`). La propagation de `reglages.data.currency` est un différé **transversal** tracé ; **ne pas l'introduire ici**, cela ferait entrer un type « Affichée » sur trois écrans qui n'en ont pas besoin.

---

## Découpage

Sept tâches, **de poids inégaux — ce plan ne prétend pas le contraire.**

**`receptions/index.tsx` en premier, délibérément** : il porte **deux des trois** défauts d'identifiant brut, et sa table n'a **aucune** colonne conditionnelle. Elle isole donc le point resté ouvert du chantier — le lien de ligne — de toute autre variable. Les deux tâches suivantes ne font que répliquer ce qu'elle aura établi. (Ce n'est pas le plus petit des trois écrans à ligne cliquable — `inventaires/index.tsx` l'est —, et l'ordre ne repose pas là-dessus.)

**Répartition réelle de la charge**, à dire d'emblée pour que personne ne prenne une tâche en croyant en prendre une autre :

- **Tasks 2 et 3** — répliques minces de la Task 1. Le motif est déjà tranché, il reste à le transposer et à écrire le test.
- **Tasks 4 et 6** — nettement plus lourdes : la 4 cumule trois contrôles de filtre, l'arbitrage A, un bloc `<ul>` hors composant, une colonne d'action conditionnelle et deux dialogues ; la 6 travaille le plus gros fichier du domaine, avec deux dialogues, l'en-tête le plus exposé et deux `SelectValue`.
- **Task 7 — la plus lourde et la plus risquée de la phase.** Elle porte **deux tables** (saisie et récapitulatif de clôture), **deux arbitrages** (B et C), un élargissement de dialogue à mesurer, le plus grand nombre de cas de test (neuf), et la seule colonne éditable du périmètre. **On ne la scinde pas** : ses deux tables vivent dans le même fichier et partagent `ecartRendu`, les séparer créerait deux tâches qui se marchent dessus sur les mêmes lignes. À planifier comme telle — pas comme « la septième d'une série de sept comparables ».

---

### Task 1 : Réceptions — liste

**Files:**
- Modify: `apps/web/src/routes/_app/stock/receptions/index.tsx`
- Create: `apps/web/src/routes/_app/stock/receptions/index.test.tsx`

**Interfaces:**
- Consumes: `ListeAdaptative`, `ColonneAdaptative`, `FiltresRepliables`, `TEXTE_LIBRE`.
- Produces (exportés pour le test) : `COLONNES_RECEPTIONS`, `titreReception`, `valeurReception`, `sousTitreReception`.

- [ ] **Step 1: Le lien de ligne — l'établir ici, proprement, une fois**

La cellule « Fournisseur » (`font-medium`) devient un `<Link to="/stock/receptions/$purchaseId" params={{ purchaseId: r.id }}>`, dans une fonction nommée **unique** :

```tsx
/** The one real link to the receipt sheet — used verbatim by the table's
 * "Fournisseur" cell and by the card's title, so the two renderings can never
 * drift apart. */
export function titreReception(r: ReceptionListe) { /* <Link …>{r.supplierName}</Link> */ }
```

Reprendre les classes du précédent (`catalogue/produits/index.tsx`, `lienNomProduit`) : `min-w-0 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/30`.

Cette fonction est **à la fois** `cellule` de la colonne `fournisseur` (elle-même `masquerEnCarte: true`) **et** la prop `titre`. Ne pas ré-inliner l'expression : c'est la réutilisation qui interdit la divergence, pas le commentaire.

`surClicLigne` reste passé (confort souris) et appelle le même `navigate` qu'aujourd'hui. **Pas de `stopPropagation`.**

**Pas de type « Affichée » ici** : les filtres sont en état local, le lien n'a rien à transporter, la devise n'est pas propagée. `ColonneAdaptative<ReceptionListe>[]` suffit.

- [ ] **Step 2: Les 7 colonnes**

| `cle` | `entete` | `numeric` | `masquerEnCarte` | `classeCellule` | Devient |
|---|---|---|---|---|---|
| `date` | Date | — | **oui** | `text-sm` | `sousTitre` |
| `entrepot` | Entrepôt | — | non | `TEXTE_LIBRE` | paire |
| `fournisseur` | Fournisseur | — | **oui** | `cn("font-medium", TEXTE_LIBRE)` | `titre` (le `<Link>`) |
| `reference` | Référence | — | non | `cn("font-mono text-xs", TEXTE_LIBRE)` | paire |
| `lignes` | Lignes | oui | non | — | paire |
| `total` | Total | oui | **oui** | — | `valeur` |
| `statut` | Statut | — | non | — | paire |

`valeur = formaterMontant(r.totalCost)` : le total est le chiffre saillant d'une réception, il a sa place en vis-à-vis du titre. `sousTitre` = la date, formatée **exactement** comme aujourd'hui (`toLocaleDateString("fr-FR")`).

`TEXTE_LIBRE` va sur entrepôt, fournisseur et référence — trois textes saisis, dont une référence de bon de livraison qui peut être un jeton insécable. **Pas** sur Lignes, Total, Statut. La classe `whitespace-nowrap` de l'ancienne cellule Date est le défaut de `TableCell`, pas une intention : elle disparaît avec la migration, et `text-sm` seule est reposée (piège 4).

- [ ] **Step 3: Filtres, pleine hauteur, chargement, état vide**

Envelopper le bloc statut dans `<FiltresRepliables nbActifs={statut !== "" ? 1 : 0}>`, et **reprendre la géométrie de `catalogue/produits/index.tsx`** : un `<div className="mt-4 flex flex-wrap items-end gap-3">` intérieur, le contrôle en `flex w-full flex-col gap-1.5 sm:w-48`, `SelectTrigger` en `w-full sm:w-48`. La marge vit **à l'intérieur** (piège 12).

`h-[calc(100dvh-3rem)]` → `h-full`. Passer `chargement={receptions.isPending}` et `etatVide={<EtatVide … />}` — **titre et messages repris mot pour mot**, y compris la variante conditionnée par `peutCreer`. Supprimer les imports `Table`, `TableBody`, `TableCell`, `TableHead`, `TableHeader`, `TableRow`, `TableSkeleton` devenus inutiles.

Conserver la branche `receptions.isError ? <ErreurChargement …/> : <ListeAdaptative …/>` telle quelle, et `containerClassName="min-h-0 flex-1 overflow-y-auto"` (c'est ce qui rend le `sticky` effectif ici). La `Pagination` reste hors de la liste.

- [ ] **Step 4: Les deux `SelectValue` du dialogue de création**

`r-entrepot` et `r-fournisseur` : ajouter la fonction de rendu avec son repli, retirer le `placeholder` devenu mort.

```tsx
<SelectValue>
  {(valeur: string) =>
    entrepotsEcriture.find((w) => w.id === valeur)?.name ?? "— choisir —"}
</SelectValue>
```

**Ne pas toucher** au reste du dialogue : `disabled={creer.isPending || !entrepotId || !fournisseurId}` est la garde anti-double-création, et `onSuccess` navigue vers le brouillon créé.

- [ ] **Step 5: Tests**

Modèle : `catalogue/produits/index.test.tsx` (le mock `Link`) + `catalogue/fournisseurs.test.tsx` (le helper `valeurPaire`). Mock `Link` sérialisant `params.purchaseId` dans le `href`.

Cas attendus :

1. `COLONNES_RECEPTIONS` a **7** éléments.
2. Les **7** en-têtes nommés sont rendus à 1280 px (`Date`, `Entrepôt`, `Fournisseur`, `Référence`, `Lignes`, `Total`, `Statut`) — aucun en-tête vide sur cet écran, contrairement aux tables à colonne d'action.
3. Le total est formaté via `texteMontant`, **jamais** `getByText(formaterMontant(x))`.
4. À 375 px, le lien vers la fiche est présent **exactement une fois** et pointe sur `/stock/receptions/p1`.
5. `surClicLigne` **ne se déclenche pas** au clic sur ce lien.
6. **Garde-fou — il assert l'ABSENCE des colonnes masquées, jamais la présence des visibles :**

```tsx
it("ne duplique aucune colonne masquée en mode carte", () => {
  afficher(375)
  const carte = screen.getAllByRole("listitem")[0]

  // Each `masquerEnCarte` column resurfaces through titre/valeur/sousTitre, so
  // it must NOT also appear as a label/value pair. Dropping a flag would render
  // the data twice — invisible to a presence-only assertion.
  expect(within(carte).queryByText("Fournisseur")).toBeNull()
  expect(within(carte).queryByText("Date")).toBeNull()
  expect(within(carte).queryByText("Total")).toBeNull()
  // …and the data itself exists exactly once.
  expect(within(carte).getAllByText("Sotra Distribution")).toHaveLength(1)
})
```

7. Le pendant positif : les 4 paires visibles portent bien leur valeur (`valeurPaire(carte, "Entrepôt")`, `"Référence"`, `"Lignes"`, `"Statut"`).
8. `TEXTE_LIBRE` : les cellules Entrepôt / Fournisseur / Référence portent **les deux** jetons (`wrap-anywhere` **et** `whitespace-normal`) ; Total et Statut n'en portent **aucun**. Commentaire obligatoire dans le cas : *jsdom n'a ni moteur de mise en page ni cascade — on garde que la classe est posée, l'effet se mesure au navigateur.*
9. Un cas dédié au repli des `SelectValue` corrigés (`r-entrepot`, `r-fournisseur`) si le dialogue de création est montable dans le test ; **à défaut, le couvrir par la vérification navigateur et le consigner au rapport de tâche**. Un correctif de sélecteur sans test ni consigne de preuve n'est pas terminé.

- [ ] **Step 6: Vérifier et commiter**

```bash
bun run --cwd apps/web test && bun run typecheck && bun run lint
git status   # routeTree.gen.ts ne doit PAS apparaître
```

**Ne pas approcher :** l'`useEffect(() => setPage(1), [statut])`, la clé de requête `["purchases", statut, page]`, la navigation post-création, et les libellés de `LIBELLES_STATUT`.

---

### Task 2 : Transferts — liste

Réplique de la Task 1. Toute divergence de motif par rapport à ce qu'elle aura établi doit être justifiée au rapport.

**Files:**
- Modify: `apps/web/src/routes/_app/stock/transferts/index.tsx`
- Create: `apps/web/src/routes/_app/stock/transferts/index.test.tsx`

**Produces:** `COLONNES_TRANSFERTS`, `titreTransfert`, `valeurTransfert`, `sousTitreTransfert`.

- [ ] **Step 1: Les 7 colonnes et le lien**

| `cle` | `entete` | `numeric` | `masquerEnCarte` | `classeCellule` | Devient |
|---|---|---|---|---|---|
| `date` | Date | — | **oui** | — | `sousTitre` |
| `origine` | Origine | — | non | `TEXTE_LIBRE` | paire |
| `destination` | Destination | — | **oui** | `cn("font-medium", TEXTE_LIBRE)` | `titre` (le `<Link>`) |
| `reference` | Référence | — | non | `cn("font-mono text-xs", TEXTE_LIBRE)` | paire |
| `lignes` | Lignes | oui | non | — | paire |
| `quantite` | Quantité | oui | **oui** | — | `valeur` |
| `statut` | Statut | — | non | — | paire |

`titreTransfert` rend le `<Link to="/stock/transferts/$transferId" params={{ transferId: t.id }}>` autour de `t.toWarehouseName`. Le badge de statut continue de passer par `varianteBadgeStatut` et `STATUTS_TRANSFERT_FR` — **importés, jamais recopiés**.

- [ ] **Step 2: Filtres, pleine hauteur, chargement, état vide**

Identique à la Task 1. `nbActifs = statut !== "" ? 1 : 0`. `h-full`. `etatVide` mot pour mot, avec sa variante `peutCreer`.

- [ ] **Step 3: Les deux `SelectValue` du dialogue de création**

`t-origine` et `t-destination` ont **déjà** une fonction de rendu, mais **sans repli** : leur valeur initiale est `""`, donc le champ est **blanc à l'ouverture du dialogue** au lieu d'afficher « — choisir — ». Ajouter `?? "— choisir —"` et retirer le `placeholder` mort. Deux occurrences du mode 2 que le brief n'avait pas listées.

- [ ] **Step 4: Tests**

Mêmes 9 cas que la Task 1, transposés. Garde-fou : `queryByText("Destination")`, `queryByText("Date")` et `queryByText("Quantité")` **null**, et le nom de l'entrepôt de destination présent **une seule fois**. `TEXTE_LIBRE` sur Origine / Destination / Référence, **absent** sur Lignes, Quantité et Statut. Cas dédié au repli des `SelectValue` corrigés (`t-origine`, `t-destination`) si le dialogue de création est montable ; **à défaut, le couvrir par la vérification navigateur et le consigner au rapport de tâche**. Ne pas toucher à `t-statut`, déjà conforme.

- [ ] **Step 5: Vérifier et commiter**

**Ne pas approcher :** `lib/transferts.ts` dans son entier. La logique origine/destination — en particulier le fait que les destinations viennent de `GET /warehouses/destinations` (toute l'organisation) et non des entrepôts visibles, et le `if (destinationId === v) setDestinationId("")` qui empêche origine == destination. Le `filter((w) => w.id !== origineId)` de la liste des destinations.

---

### Task 3 : Inventaires — liste

**Files:**
- Modify: `apps/web/src/routes/_app/stock/inventaires/index.tsx`
- Create: `apps/web/src/routes/_app/stock/inventaires/index.test.tsx`

**Produces:** `COLONNES_INVENTAIRES`, `titreInventaire`, `sousTitreInventaire`.

- [ ] **Step 1: Les 5 colonnes et le lien**

| `cle` | `entete` | `masquerEnCarte` | `classeCellule` | Devient |
|---|---|---|---|---|
| `ouvertLe` | Ouvert le | **oui** | — | `sousTitre` |
| `entrepot` | Entrepôt | **oui** | `cn("font-medium", TEXTE_LIBRE)` | `titre` (le `<Link>`) |
| `avancement` | Avancement | non | — | paire |
| `closLe` | Clos le | non | — | paire |
| `statut` | Statut | non | — | paire |

**Pas de `valeur`** ici : l'avancement (« 3 / 12 comptés ») est une phrase, pas un chiffre saillant ; il se lit bien mieux avec son libellé, en paire. Le `<span className="tabular-nums">` intérieur reste tel quel.

`sousTitreInventaire` = `new Date(i.openedAt).toLocaleString("fr-FR")` — noter le `toLocaleString` (avec l'heure), différent des deux autres listes qui utilisent `toLocaleDateString`. **Ne pas uniformiser** : c'est une donnée différente.

- [ ] **Step 2: Filtres, pleine hauteur, chargement, état vide**

Identique aux Tasks 1–2. `nbActifs = statut !== "" ? 1 : 0`. `h-full`. `etatVide` mot pour mot avec sa variante `peutOuvrir`.

- [ ] **Step 3: Les deux `SelectValue`**

- `i-statut` — fonction de rendu **sans libellé de repli** : `STATUTS_INVENTAIRE_FR[valeur]` sur un `Record<string, string>` renvoie `undefined` pour toute valeur hors des trois connues, donc **champ blanc**. C'est le piège documenté dans `CLAUDE.md`. Correctif : `STATUTS_INVENTAIRE_FR[valeur] ?? "Tous"`.
- `i-entrepot` (dialogue d'ouverture) — même mode d'échec, **blanc au premier rendu** puisque `entrepotId` vaut `""`. Correctif : `?? "— choisir —"`, `placeholder` retiré.

- [ ] **Step 4: Tests**

Mêmes cas transposés. `COLONNES_INVENTAIRES` a **5** éléments. Garde-fou : `queryByText("Entrepôt")` et `queryByText("Ouvert le")` **null** ; le nom d'entrepôt présent **une seule fois**. `TEXTE_LIBRE` sur Entrepôt uniquement ; **absent** sur Avancement, Clos le et Statut. Ajouter un cas dédié au repli du `SelectValue` de statut si l'écran est monté ; à défaut, le couvrir par la vérification navigateur et le consigner.

- [ ] **Step 5: Vérifier et commiter**

**Ne pas approcher :** le texte du dialogue d'ouverture (« Les quantités attendues de TOUT l'entrepôt sont figées à l'ouverture… ») — c'est un avertissement métier. La mutation `ouvrir` et sa navigation.

---

### Task 4 : Niveaux de stock

L'écran le plus dense de la phase : trois contrôles de filtre, un bloc « En transit », une table à colonne d'action conditionnelle, et deux dialogues d'écriture.

**Files:**
- Modify: `apps/web/src/routes/_app/stock/index.tsx`
- Modify: `apps/web/src/components/ui/filtres-repliables.tsx` (`label` → `React.ReactNode`) et `apps/web/src/components/ui/filtres-repliables.test.tsx` (le cas qui le couvre)
- Create: `apps/web/src/routes/_app/stock/index.test.tsx`

**Produces:** `NiveauStockAffiche`, `COLONNES_NIVEAUX`, `COLONNES_NIVEAUX_ECRITURE`, `titreNiveau`, `actionsNiveau`.

- [ ] **Step 1: Le type « Affichée » et les colonnes**

`NiveauStockAffiche = NiveauStock & { surAjuster: () => void; surSeuil: () => void }` — deux gestionnaires d'écran que la ligne ne porte pas. Les fermetures actuelles (`setErreurAjustement(null); setDelta(""); setMotif(""); setAjustementPour(n)`) migrent telles quelles dans le `map` qui construit `lignes`, **sans réordonner les appels**.

| `cle` | `entete` | `numeric` | `masquerEnCarte` | `classeCellule` | Devient |
|---|---|---|---|---|---|
| `produit` | Produit | — | **oui** | `cn("font-medium", TEXTE_LIBRE)` | `titre` |
| `variante` | Variante | — | **oui** | `TEXTE_LIBRE` | `titre` |
| `sku` | SKU | — | **oui** | `cn("font-mono text-xs", TEXTE_LIBRE)` | `titre` |
| `quantite` | Quantité | oui | non | — | paire (badge « Stock bas » compris) |
| `cmp` | CMP | oui | non | — | paire |
| `seuil` | Seuil | oui | non | — | paire |

`titreNiveau` adopte **la forme d'identité déjà en production dans ce domaine** (`titreMouvement`, `stock/mouvements.tsx`) : `productName` en dominante, puis `variantName (sku)` en `text-muted-foreground`. **Ne pas importer `titreMouvement`** — les types de ligne diffèrent — mais reproduire la forme au jeton près. Cinq écrans du domaine partageront cette silhouette à la fin de la phase ; c'est ce qui les rend lisibles ensemble.

**Décision assumée : pas de `valeur`.** La quantité est le chiffre saillant, mais sa cellule embarque le `Badge` « Stock bas », et `valeur` est rendue dans un `shrink-0` : à 375 px, un badge plus un nombre en `shrink-0` ne laisseraient presque rien au nom de produit dans le `min-w-0 flex-1` d'en face. La quantité reste une paire, **badge et chiffre ensemble** — les divorcer serait pire que les deux options.

Colonne d'action : `COLONNE_ACTION_NIVEAU` (module-privée, `masquerEnCarte: true`, en-tête vide) portant `actionsNiveau` — les deux boutons « Ajuster » et « Seuil » dans un `<span className="flex justify-end gap-2">`. `COLONNES_NIVEAUX_ECRITURE = [...COLONNES_NIVEAUX, COLONNE_ACTION_NIVEAU]`. Au point d'appel : `colonnes={peutEcrireIci ? COLONNES_NIVEAUX_ECRITURE : COLONNES_NIVEAUX}` et `actionCarte={peutEcrireIci ? actionsNiveau : undefined}` — les deux vont toujours ensemble.

- [ ] **Step 2: Filtres — l'arbitrage A**

`FiltresRepliables` avec `nbActifs = (recherche !== "" ? 1 : 0) + (alertesSeules ? 1 : 0)` — **l'entrepôt ne compte pas** — et le `label` composé « Filtres — {nom d'entrepôt} ». Voir l'arbitrage A pour le raisonnement complet ; ne pas le rouvrir, le citer en commentaire.

**Le nom d'entrepôt est du texte libre : le libellé porte sa protection de coupe.** Le `<summary>` de `FiltresRepliables` est un conteneur flex-**rangée**, donc c'est la paire indivisible `min-w-0 break-words` qu'il faut, sur un **porteur** — ce qui suppose d'élargir `label` de `string` à `React.ReactNode` (modification additive, JSDoc, cas de test dans `components/ui/filtres-repliables.test.tsx`, raison au rapport). Le code exact et la justification sont à l'arbitrage A. **C'est la seule ouverture de composant partagé de la phase** ; `ListeAdaptative` n'est pas concerné.

Utiliser `recherche` (l'état vif) et non `rechercheDebouncee` : c'est ce que fait `mouvements.tsx`, et un compteur qui met 300 ms à réagir à la frappe donnerait l'impression d'un bug.

Largeurs : `w-56` → `w-full sm:w-56`, `w-72` → `w-full sm:w-72`, chaque contrôle dans un `flex w-full flex-col gap-1.5 sm:w-…`. Le trio case à cocher + libellé (`flex h-7 items-center gap-2`) reste tel quel mais doit être vérifié : à 375 px la cible tactile doit rester ≥ 44 px (le correctif `pointer-coarse` de la phase 1 s'en charge, le confirmer).

`h-[calc(100dvh-3rem)]` → `h-full`.

- [ ] **Step 3: Le bloc « En transit entrant »**

C'est un `<ul>` écrit à la main, hors `ListeAdaptative`. Deux corrections :

- **`role="list"`** sur le `<ul>` — la Preflight Tailwind neutralise les puces, VoiceOver retire alors le rôle, et l'utilisateur perd la cardinalité (« liste, 4 éléments ») que l'en-tête annonce pourtant entre parenthèses.
- Chaque `<li>` est une phrase de texte libre (nom de produit, nom de variante, SKU, numéro de lot, nom d'entrepôt d'origine) dans un conteneur **colonne** (`flex flex-col gap-1`) : **`break-words` seul** y suffit — la taille est définie par le parent, `min-w-0` serait inerte.

**Ne pas toucher** à la clé `` `${l.transferId}-${l.variantId}-${index}` `` (elle est composite parce que la même variante peut arriver de deux transferts), ni au conditionnement `enabled: entrepotId !== ""`.

- [ ] **Step 4: Chargement, état vide, dialogues**

`chargement={entrepotsEnCours || niveaux.isPending}` — **conserver la disjonction**, elle évite un état vide trompeur pendant que la liste d'entrepôts arrive. `etatVide` repris mot pour mot avec sa variante `alertesSeules`.

`n-entrepot` : ajouter le repli `?? "Choisir un entrepôt"` (le champ est **blanc au premier rendu** aujourd'hui, avant que l'effet de présélection ne passe). Conserver le libellé exact de l'ancien `placeholder`.

Les deux dialogues (ajustement, seuil) : ils passent par `DialogContent`, donc la géométrie corrigée en 2b s'applique. Vérifier au navigateur qu'ils tiennent à 375 px — en mesurant **les rectangles**, pas `scrollWidth` (piège 9) — et que le titre `Ajuster — {productName} ({variantName})`, qui contient deux textes libres, ne pousse pas la boîte.

- [ ] **Step 5: Tests**

Cas attendus :

1. `COLONNES_NIVEAUX` a **6** éléments, `COLONNES_NIVEAUX_ECRITURE` en a **7**, et `COLONNES_NIVEAUX_ECRITURE.at(-1)!.cle === "action"`.
2. À 1280 px en écriture : 7 `columnheader` (c'est le **seul** moyen de voir la colonne d'action, son en-tête étant vide) et les boutons « Ajuster » / « Seuil » présents.
3. En lecture seule : 6 `columnheader`, **aucun** bouton, et le nom du produit toujours présent (la lecture seule ne doit coûter aucune donnée).
4. **Câblage des gestionnaires avec un mock DISTINCT par ligne** : deux lignes rendues, clic sur « Ajuster » de **la seconde**, `AJUSTER_LIGNE_2` appelé une fois et `AJUSTER_LIGNE_1` **jamais**. Idem pour « Seuil ».
5. Garde-fou d'absence : `queryByText("Produit")`, `queryByText("Variante")`, `queryByText("SKU")` **null** ; `getAllByRole("button")` dans la carte a **longueur 2** (les deux actions, jamais dupliquées) ; le nom de produit présent **une seule fois**.
6. Paires visibles : `valeurPaire(carte, "CMP")` via `texteMontant`, `valeurPaire(carte, "Seuil")`, et la quantité **avec** son badge « Stock bas » quand `enAlerte`.
7. `TEXTE_LIBRE` posé sur Produit / Variante / SKU, **absent** sur Quantité / CMP / Seuil / action.
8. Un cas dédié au repli du `SelectValue` `n-entrepot` — c'est le seul de la phase qui est **blanc au premier rendu de l'écran lui-même**, donc le plus facile à couvrir en test : monter l'écran sans entrepôt sélectionné et asserter « Choisir un entrepôt ». **À défaut, le couvrir par la vérification navigateur et le consigner au rapport de tâche.**

- [ ] **Step 6: Vérifier et commiter**

**Ne pas approcher :** les deux mutations d'écriture — `ajuster` (POST `/adjustments`, entrée de stock **non rejouable**) et `definirSeuil` (PATCH). Leur `onSuccess` et son triple `invalidateQueries`. Le débounce de 300 ms. L'effet `setPage(1)` sur changement de filtre. L'effet de présélection d'entrepôt.

---

### Task 5 : Réception — détail

**Files:**
- Modify: `apps/web/src/routes/_app/stock/receptions/$purchaseId.tsx`
- Create: `apps/web/src/routes/_app/stock/receptions/$purchaseId.test.tsx`

**Produces:** `LigneReceptionAffichee`, `COLONNES_LIGNES_RECEPTION`, `COLONNES_LIGNES_RECEPTION_ECRITURE`, `titreLigneReception`, `actionsLigneReception`.

- [ ] **Step 1: L'en-tête de page**

`flex items-center gap-3` → `flex flex-wrap items-center gap-3` ; `<h1>` en `min-w-0 break-words` ; `Badge` en `shrink-0`. C'est le débordement mesuré en 2b : `scrollWidth` **925** contre 375, déclenché par un jeton insécable dans le nom de fournisseur. Le `<p>` de sous-titre qui suit est déjà un bloc, il n'a besoin de rien.

- [ ] **Step 2: Le prédicat composé — l'arbitrage D**

`const ligneModifiable = brouillon && peutEcrire`, déclaré immédiatement après `brouillon` et `peutEcrire`. Le fichier porte **six** occurrences du prédicat brut : bouton « Ajouter une ligne », `<TableHead />` de la colonne d'action, cellule d'action, `colSpan` de l'état vide, **message d'état vide**, bloc d'actions de pied. Deux disparaissent avec la migration (`<TableHead />` et `colSpan={brouillon && peutEcrire ? 6 : 5}`, `ListeAdaptative` calculant `colonnes.length`) ; les autres deviennent **cinq usages** de `ligneModifiable` :

1. le ternaire `colonnes={ligneModifiable ? COLONNES_…_ECRITURE : COLONNES_…}` ;
2. `actionCarte={ligneModifiable ? actionsLigneReception : undefined}` ;
3. le bouton « Ajouter une ligne » ;
4. le **message d'état vide** (« Ajoutez une ligne pour composer cette réception… » / « Cette réception ne comporte aucune ligne. ») — c'est celui qu'on oublie, il est loin des quatre autres et son texte est repris mot pour mot ;
5. le bloc d'actions de pied.

Après cette étape, **`brouillon && peutEcrire` n'apparaît plus qu'une fois dans le fichier : sa déclaration.**

- [ ] **Step 3: Les colonnes**

| `cle` | `entete` | `numeric` | `masquerEnCarte` | `classeCellule` | Devient |
|---|---|---|---|---|---|
| `article` | Article | — | **oui** | `TEXTE_LIBRE` | `titre` |
| `quantite` | Quantité | oui | non | — | paire |
| `cout` | Coût unitaire | oui | non | — | paire |
| `lot` | Lot | — | non | `cn("font-mono text-xs", TEXTE_LIBRE)` | paire |
| `peremption` | Péremption | — | non | `text-sm` | paire |

`titreLigneReception` reprend la forme d'identité du domaine : `productName` en dominante, `variantName (sku)` en muted. **`TEXTE_LIBRE` sur Article et Lot uniquement** — un numéro de lot fournisseur est un jeton arbitraire, souvent insécable ; en revanche une **date de péremption formatée** est atomique, et la couper en deux est précisément le défaut qu'a subi la fiche produit.

`COLONNE_ACTION_LIGNE_RECEPTION` (module-privée, en-tête vide, `masquerEnCarte: true`) porte `actionsLigneReception` : « Modifier » et « Retirer » dans un `<span className="flex gap-2">`. Type « Affichée » : `LigneReception & { surModifier: () => void; surRetirer: () => void }`.

Pas de `valeur`, pas de `sousTitre` : les cinq colonnes se lisent bien en titre + quatre paires, et inventer un total de ligne créerait une donnée que la table ne porte pas.

- [ ] **Step 4: Le `SelectValue` d'article du dialogue de ligne**

`l-variante` est le troisième et dernier auto-fermant sans fonction de rendu de la SPA : il affiche l'UUID de la variante. Correctif :

```tsx
<SelectValue>
  {(valeur: string) =>
    variantes.find((v) => v.variantId === valeur)?.libelle ?? "— choisir —"}
</SelectValue>
```

Avec ce correctif, **le sujet du mode 1 est refermé pour toute la SPA** — ces trois `SelectValue` auto-fermants sont les seuls du dépôt, vérifié par recherche —, **et le domaine du stock est entièrement propre** pour les deux modes.

**Ce qui reste ailleurs, et pourquoi c'est inoffensif.** Cinq fonctions de rendu sans libellé de repli subsistent **hors périmètre** : `administration/entrepots.tsx` (`wh-type`), `administration/utilisateurs.tsx` (`u-role`), `components/utilisateur/gerer-acces.tsx` (`ga-role`, `ga-role-entrepot`) et `pos/ouverture-caisse.tsx` (le sélecteur de boutique). Aucune ne peut afficher un champ blanc en pratique : leur valeur initiale n'est jamais vide (`"store"`, `"staff"`, un rôle d'entrepôt existant) ou le contrôle n'est rendu que lorsqu'un identifiant valide est déjà là (`boutiques.length > 1` avec `boutiqueId` fourni en prop). **Ne pas les corriger ici** — un correctif d'agrément hors périmètre, à traiter avec la phase 4 ou une passe dédiée.

Vérifier la géométrie du dialogue au navigateur : ses libellés d'article (`{nom} — {variante} ({sku})`) sont les chaînes les plus longues du domaine, et le différé de 2b sur le rognage des options longues s'y appliquera — le constater, ne pas le corriger ici.

Le dialogue contient deux rangées `flex gap-3` de champs `flex-1` (quantité/coût, puis lot/péremption). Elles se replient correctement à 375 px, mais le vérifier **en hauteur aussi** (piège 8) : dans le cas `suitLots`, le dialogue porte deux rangées de plus et peut franchir le plafond `max-h-[calc(100dvh-2rem)]`.

- [ ] **Step 5: Tests**

1. `COLONNES_LIGNES_RECEPTION` a **5** éléments, `…_ECRITURE` en a **6**, dont la dernière `cle === "action"`.
2. En écriture à 1280 px : 6 `columnheader` ; en lecture seule : 5 et **aucun bouton**.
3. Mocks **distincts par ligne** : deux lignes, clic sur « Retirer » de la seconde, la première intacte. Idem « Modifier ».
4. Garde-fou d'absence : `queryByText("Article")` **null** ; `getAllByRole("button")` dans la carte de longueur **2** ; le nom de produit présent **une seule fois**.
5. Paires : Quantité, Coût unitaire (via `texteMontant`), Lot, Péremption — dont le cas « — » quand `lotNumber`/`expiryDate` sont `null`.
6. `TEXTE_LIBRE` : posé sur Article et Lot, **absent** sur Quantité, Coût unitaire et Péremption.
7. Un cas dédié au libellé du `SelectValue` `l-variante` si le dialogue de ligne est montable dans le test — c'est le mode 1, celui qui affichait un UUID : asserter qu'aucun identifiant brut n'apparaît et que le repli « — choisir — » est rendu à vide. **À défaut, le couvrir par la vérification navigateur et le consigner au rapport de tâche.**

- [ ] **Step 6: Vérifier et commiter**

**Ne pas approcher :** la mutation `valider` (POST `/receive`) — **elle fait entrer le stock, elle n'est pas rejouable** — ni son `AlertDialog` de confirmation ni le texte « Le stock sera mis à jour et le document deviendra immuable. ». La mutation `supprimerBrouillon` et sa navigation. `enregistrerLigne` et sa distinction création/édition, y compris le fait que l'édition n'envoie `lotNumber`/`expiryDate` que si `ligneEditee.trackLots`. Le débounce de 300 ms de la recherche d'article et le `limite=200` du catalogue.

---

### Task 6 : Transfert — détail

**Files:**
- Modify: `apps/web/src/routes/_app/stock/transferts/$transferId.tsx`
- Create: `apps/web/src/routes/_app/stock/transferts/$transferId.test.tsx`

**Produces:** `LigneTransfertAffichee`, `COLONNES_LIGNES_TRANSFERT`, `COLONNES_LIGNES_TRANSFERT_ECRITURE`, `titreLigneTransfert`, `actionsLigneTransfert`.

- [ ] **Step 1: L'en-tête de page — le plus exposé du dépôt**

`Transfert — {fromWarehouseName} → {toWarehouseName}` : **deux** noms d'entrepôt saisis, plus un `Badge`, dans un `flex items-center gap-3` sans repli. Même correctif que la Task 5, et c'est ici qu'il faut le mesurer en premier au navigateur, avec deux noms longs.

- [ ] **Step 2: Le prédicat composé**

`const ligneModifiable = brouillon && peutEcrireOrigine`. Le fichier porte **six** occurrences du prédicat brut, exactement les mêmes que la Task 5 : bouton « Ajouter une ligne », `<TableHead />` d'action, cellule d'action, `colSpan`, **message d'état vide** (« Ajoutez des articles à transférer avant d'expédier. » / « Ce transfert ne comporte aucune ligne. »), bloc d'actions de pied. Deux disparaissent avec la migration, les autres deviennent **cinq usages** de `ligneModifiable` — la liste numérotée de la Task 5 s'applique telle quelle. Après cette étape, **`brouillon && peutEcrireOrigine` n'apparaît plus qu'une fois : sa déclaration.**

**Attention : `peutEcrireDestination` est un droit DIFFÉRENT**, qui gouverne le bouton « Réceptionner » — ne pas le confondre ni le fondre dans la même constante.

- [ ] **Step 3: Les colonnes**

| `cle` | `entete` | `numeric` | `masquerEnCarte` | `classeCellule` | Devient |
|---|---|---|---|---|---|
| `article` | Article | — | **oui** | `TEXTE_LIBRE` | `titre` |
| `quantite` | Quantité | oui | non | — | paire |
| `lot` | Lot | — | non | `cn("font-mono text-xs", TEXTE_LIBRE)` | paire |
| `cmpFige` | CMP figé | oui | non | — | paire |
| `recu` | Reçu | oui | non | — | paire (badge « Écart −N » compris) |

`TEXTE_LIBRE` sur Article et Lot seulement. **Pas** sur « CMP figé » (montant formaté, insécable par construction) ni sur « Reçu » (badge + chiffre : atomiques, et les séparer romprait le lien entre l'écart et sa quantité).

`COLONNE_ACTION_LIGNE_TRANSFERT` identique en forme à celle de la Task 5.

- [ ] **Step 4: Le dialogue de réception**

Chaque ligne est un `flex items-center gap-3` : un `<span className="flex-1 text-sm">` portant `{productName} — {variantName} (expédié : {quantity})` et un `<Input className="w-24">`. À 375 px, le corps du dialogue fait ~311 px : la phrase dispose d'environ 203 px et contient **deux textes libres**.

Correctif : `min-w-0 break-words` sur le `<span>` (conteneur flex-**rangée** → la paire est indivisible), `shrink-0` sur l'`Input` pour que sa largeur de 24 reste. Ne pas passer la rangée en `flex-wrap` : un champ numérique qui saute sous son libellé casse l'alignement de la colonne de saisie sur une liste de dix articles.

**Harmoniser aussi le bloc d'actions de pied**, tant qu'on est dans ce fichier : `<div className="mt-6 flex items-center gap-3">` → `flex flex-wrap`. Son jumeau de `receptions/$purchaseId.tsx` porte **déjà** `flex-wrap` — la preuve que le motif a été jugé nécessaire pour un bloc de ce gabarit à 375 px. Ici la rangée porte « Expédier », « Annuler le transfert » **et** le paragraphe d'erreur `role="alert"`, tous trois items flex de la même rangée : le besoin est strictement supérieur. Correction d'une classe, pas de restructuration : les `AlertDialog`, leurs déclencheurs et leurs textes restent intouchés.

**Ne pas toucher** à `aria-label={\`Quantité reçue — ${item.sku}\`}` — **au caractère près**, tiret cadratin compris.

Vérifier le plafond vertical (piège 8) : ce dialogue croît **linéairement avec le nombre de lignes**, c'est le plus haut du domaine. Le bouton « Valider la réception » doit rester atteignable, et le corps du dialogue doit défiler sans barre parasite.

`tl-variante` et `tl-lot` : ajouter les replis (`?? "— choisir —"`, `?? "— à choisir avant expédition —"`), retirer les `placeholder` morts.

- [ ] **Step 5: Tests**

Structure identique à la Task 5 : comptes de colonnes (5 / 6), en-têtes aux deux droits, mocks distincts par ligne, garde-fou d'absence (`queryByText("Article")` null, deux boutons par carte, nom de produit une seule fois), paires visibles dont le cas `unitCost === null` → « — » et le cas `receivedQuantity < quantity` → badge « Écart −N », et le cas `TEXTE_LIBRE` posé/absent.

Ajouter un cas dédié aux replis des `SelectValue` corrigés (`tl-variante`, `tl-lot`) si le dialogue de ligne est montable dans le test ; **à défaut, le couvrir par la vérification navigateur et le consigner au rapport de tâche.**

Ajouter un cas sur `preparerReception` **si et seulement si** un comportement de l'écran a changé — sinon, ne pas y toucher : la fonction est testée ailleurs et sa logique est hors périmètre.

- [ ] **Step 6: Vérifier et commiter**

**Ne pas approcher :** `lib/transferts.ts` dans son entier, `preparerReception` en particulier. Les mutations `expedier` (POST `/send` — **fige le CMP côté API**), `annuler` (POST `/cancel`), `receptionner` (POST `/receive`) et leurs `AlertDialog`. Le chargement conditionnel des lots (`produitIdPourLots`, `enabled: produitIdPourLots !== ""`) et la distinction `ligneEditee` / `varianteChoisie` pour `suitLots`.

---

### Task 7 : Inventaire — détail

**La tâche la plus lourde et la plus risquée de la phase** — deux tables dans un même fichier, les arbitrages B et C, un dialogue à élargir et à mesurer, la seule colonne éditable du périmètre, neuf cas de test. Elle n'est pas « comparable » aux six autres ; voir le § Découpage.

**Files:**
- Modify: `apps/web/src/routes/_app/stock/inventaires/$countId.tsx`
- Create: `apps/web/src/routes/_app/stock/inventaires/$countId.test.tsx`

**Produces:** `LigneInventaireAffichee`, `COLONNES_LIGNES_INVENTAIRE`, `COLONNES_LIGNES_INVENTAIRE_ECRITURE`, `titreLigneInventaire`, `actionEnregistrerLigne`, `EcartClotureAffiche`, `COLONNES_ECARTS_CLOTURE`, `titreEcartCloture`.

- [ ] **Step 1: En-tête de page et prédicat composé**

`Inventaire — {warehouseName}` : même correctif d'en-tête que les Tasks 5 et 6.

`const saisieOuverte = ouvert && peutEcrire`. Le fichier porte **cinq** occurrences du prédicat brut : `const colonnes = ouvert && peutEcrire ? 5 : 4`, `<TableHead />` de la colonne d'action, la cellule « Compté » (champ de saisie ou valeur en lecture), la cellule d'action, le bloc d'actions de pied. Les deux premières **disparaissent** avec la migration (`colonnes`, son `colSpan` et l'en-tête vide) ; les trois autres deviennent **quatre usages** :

1. `saisissable: saisieOuverte` épissé dans chaque `LigneInventaireAffichee` (arbitrage B) — c'est lui qui branche la cellule « Compté » ;
2. le ternaire `colonnes={saisieOuverte ? COLONNES_…_ECRITURE : COLONNES_…}` ;
3. `actionCarte={saisieOuverte ? actionEnregistrerLigne : undefined}` ;
4. le bloc d'actions de pied.

Cet écran n'a **ni** bouton « Ajouter une ligne » **ni** message d'état vide conditionné par le prédicat — c'est la seule différence avec les Tasks 5 et 6, et elle explique le 5 au lieu du 6. Après cette étape, **`ouvert && peutEcrire` n'apparaît plus qu'une fois : sa déclaration.**

**Harmoniser le bloc d'actions de pied** au passage : `<div className="mt-6 flex items-center gap-3">` → `flex flex-wrap`. Comme sur le transfert (Task 6), la rangée porte le bouton de clôture **et** un paragraphe d'erreur `role="alert"`, et son jumeau de `receptions/$purchaseId.tsx` porte déjà `flex-wrap`. Une classe, rien d'autre : l'`AlertDialog` de clôture et son texte ne bougent pas.

- [ ] **Step 2: Le type « Affichée » — l'arbitrage B**

```ts
export type LigneInventaireAffichee = LigneInventaire & {
  /** Screen-level scalar spliced into every row: the whole count is either
   * editable or read-only, but the "Compté" column sits in the MIDDLE of the
   * array, so branching here keeps ONE column array composed by spread. */
  saisissable: boolean
  /** Raw local entry, or null when the server value is still the reference. */
  saisie: string | null
  surSaisie: (valeur: string) => void
  surEnregistrer: () => void
  /** Computed at the screen, verbatim — see "ne pas approcher". */
  enregistrementDesactive: boolean
}
```

`enregistrementDesactive` est calculé **au niveau de l'écran, mot pour mot comme aujourd'hui** (`enregistrer.isPending || !(item.id in saisies)`) et simplement épissé : le prédicat de désactivation est hors périmètre, il ne doit être ni réécrit ni « simplifié ».

- [ ] **Step 3: Les colonnes de saisie**

| `cle` | `entete` | `numeric` | `masquerEnCarte` | `classeCellule` | Devient |
|---|---|---|---|---|---|
| `article` | Article | — | **oui** | `TEXTE_LIBRE` | `titre` |
| `attendu` | Attendu (à l'ouverture) | oui | non | — | paire |
| `compte` | Compté | oui | **non** | — | paire — **le champ de saisie y vit** |
| `ecart` | Écart | oui | non | — | paire |

La colonne « Compté » branche sur `l.saisissable` : `<Input>` si vrai, sinon la valeur en lecture (« — (non compté) » ou le nombre), **exactement comme aujourd'hui**. L'`Input` conserve `aria-label={\`Quantité comptée — ${item.sku}\`}` **au caractère près**, ainsi que `type="number" min={0} step={1}` et `className="ml-auto w-24 text-right"`.

`COLONNE_ACTION_LIGNE_INVENTAIRE` (module-privée, en-tête vide, `masquerEnCarte: true`) porte le bouton « Enregistrer » ; `actionCarte={saisieOuverte ? actionEnregistrerLigne : undefined}`. `actionEnregistrerLigne` rend **le même nœud** dans les deux modes, en conservant le `<span className="flex justify-end">` actuel de la cellule — pas de `w-full` : `ListeAdaptative` place `actionCarte` dans un `<div className="mt-2">` sans largeur imposée, et le bouton reste aligné à droite comme celui de la Task 4.

`TEXTE_LIBRE` sur Article seulement. **Pas** sur Attendu, Compté ni Écart — ce sont des quantités, et `ecartRendu` colore un signe qu'il ne faut pas séparer de son chiffre.

- [ ] **Step 4: Le récapitulatif de clôture — l'arbitrage C**

Le second tableau, dans le `Dialog`, passe aussi par `ListeAdaptative` :

| `cle` | `entete` | `numeric` | `masquerEnCarte` | `classeCellule` | Devient |
|---|---|---|---|---|---|
| `article` | Article | — | **oui** | `TEXTE_LIBRE` | `titre` |
| `compte` | Compté | oui | non | — | paire |
| `avant` | Stock avant clôture | oui | non | — | paire |
| `ecart` | Écart appliqué | oui | non | — | paire |

`titreEcartCloture` reprend le repli existant `e.productName ?? e.variantId` et le `(${e.sku})` en muted — **ne pas « améliorer » ces replis**, ils couvrent le cas d'une variante supprimée entre l'ouverture et la clôture.

**Élargir ce dialogue** : `<DialogContent className="md:max-w-2xl">`. Sans cela, le plafond `sm:max-w-sm` de `dialog.tsx` fige la boîte à **384 px dès 640 px de viewport**, alors que `useEstLarge()` rebascule en table à 768 px — quatre colonnes dans 384 px, à défilement horizontal interne. Voir l'arbitrage C pour le raisonnement complet et le choix du palier `md` plutôt que `sm` ; ne pas le rouvrir, le citer en commentaire. **À mesurer aux quatre paliers de la campagne** (375, 768, 1024, 1280) : ~343 px de boîte à 375 (cartes), 672 px à 768 et au-delà (table), et **aucune barre de défilement horizontale** sur le conteneur de table.

**`containerClassName` non passé** (le corps du dialogue est déjà la boîte défilante). `ecartRendu` reste partagé entre les deux tableaux.

Le paragraphe final (« N mouvements de stock générés… ») et le cas `recap.ecarts.length === 0` restent **hors** de la liste, tels quels.

- [ ] **Step 5: Tests**

1. `COLONNES_LIGNES_INVENTAIRE` a **4** éléments, `…_ECRITURE` en a **5**, dernière `cle === "action"`. `COLONNES_ECARTS_CLOTURE` en a **4**.
2. En saisie à 1280 px : 5 `columnheader`, et un `getByRole("spinbutton", { name: "Quantité comptée — CIM-50" })` — **le nom accessible est asserté au caractère près**, c'est lui qui garantit que l'`aria-label` n'a pas bougé.
3. En lecture seule : 4 `columnheader`, **aucun** champ de saisie, **aucun** bouton, et la valeur comptée toujours lisible (y compris « — (non compté) »).
4. À 375 px en saisie : le champ apparaît **exactement une fois**, dans la paire « Compté » ; le bouton « Enregistrer » apparaît **exactement une fois**, via `actionCarte`.
5. Mocks **distincts par ligne** : deux lignes, saisie puis clic sur « Enregistrer » de la **seconde**, `ENREGISTRER_LIGNE_1` **jamais** appelé. C'est le cas qui protège d'un enregistrement sur le mauvais article.
6. `enregistrementDesactive: true` désactive **le bouton de cette ligne seulement**, l'autre restant cliquable.
7. Garde-fou d'absence, sur les deux tableaux : `queryByText("Article")` **null** dans la carte ; le nom de produit présent **une seule fois** ; un seul bouton par carte de saisie.
8. Récapitulatif : les trois paires visibles portent leurs valeurs, et l'écart positif / négatif / nul rend bien les trois formes de `ecartRendu`.
9. `TEXTE_LIBRE` posé sur Article (les deux tableaux), **absent** sur toutes les colonnes chiffrées.

- [ ] **Step 6: Vérifier et commiter**

**Ne pas approcher :** la mutation `cloturer` (POST `/close` — **génère les mouvements d'écart, irréversible**), son `AlertDialog`, et le texte de sa description avec ses accords au pluriel. La mutation `enregistrer` et son `onSuccess` qui **retire** l'entrée locale de `saisies` pour que la valeur serveur redevienne la référence. Le prédicat `enregistrer.isPending || !(item.id in saisies)`. La distinction entre « saisie absente de `saisies` » et « saisie vide » (`brut === "" ? null : Number(brut)`) — elle porte la différence entre « pas compté » et « compté à zéro ».

---

## Definition of Done

- `bun run typecheck`, `bun run lint`, `bun run test` verts à la racine.
- **Les 4 cas de `stock/mouvements.test.tsx` sont inchangés**, au caractère près. S'ils ont bougé, c'est un signal à remonter, pas à corriger dans le test.
- Aucun autre test existant modifié pour « le faire passer ». Le hook dégradant vers desktop garantit que les suites d'écran préexistantes voient le même arbre qu'avant.
- **Les 7 fichiers de test sont créés**, et chacun prouve que **chaque garde mord** : le garde-fou assert l'**absence** des colonnes masquées ; les gestionnaires sont câblés avec un mock **distinct par ligne** et un clic sur la **seconde** ; la lecture seule ne perd aucune donnée ; `TEXTE_LIBRE` est posé sur les colonnes de texte libre **et absent des autres**.
- **Le prédicat composé brut n'apparaît plus qu'une fois par fichier — sa déclaration.** Garde vérifiable par recherche, chaque compte doit valoir exactement **1** :

  ```bash
  grep -c "brouillon && peutEcrire\b"        apps/web/src/routes/_app/stock/receptions/\$purchaseId.tsx
  grep -c "brouillon && peutEcrireOrigine\b" apps/web/src/routes/_app/stock/transferts/\$transferId.tsx
  grep -c "ouvert && peutEcrire\b"           apps/web/src/routes/_app/stock/inventaires/\$countId.tsx
  ```

  Avant migration ces comptes valent **6, 6 et 5**. Tout compte supérieur à 1 après migration signale une occurrence oubliée — le plus souvent le **message d'état vide**, qui est loin des autres dans le fichier.
- Le littéral `h-[calc(100dvh-3rem)]` a **disparu du répertoire `stock/`** (`grep -rn "100dvh" apps/web/src/routes/_app/stock/` ne renvoie rien). Il survit dans `administration/utilisateurs.tsx` — phase 4.
- **Les 10 `SelectValue` défectueux du domaine affichent un libellé**, jamais un identifiant ni un champ blanc : 3 auto-fermants pourvus d'une fonction de rendu, 7 fonctions de rendu pourvues d'un repli, `placeholder` morts retirés. Le périmètre en porte **12** au total — les deux filtres de statut de `receptions/index.tsx` (`r-statut`, repli `?? "Tous"`) et de `transferts/index.tsx` (`t-statut`, ternaire sur `""`) sont **déjà conformes** et ne doivent pas être touchés. Le **mode 1** (auto-fermant sans fonction de rendu) est refermé pour toute la SPA ; le **mode 2** l'est pour le domaine du stock, cinq fonctions sans repli subsistant hors périmètre (administration, `gerer-acces`, ouverture de caisse) — inoffensives car leur valeur initiale n'est jamais vide, tracées, non corrigées ici.
- Les 3 en-têtes de page se replient, avec `min-w-0 break-words` sur le titre et `shrink-0` sur le badge.
- `routeTree.gen.ts` **n'apparaît dans aucun diff de la phase**.
- **Vérification navigateur consignée à 375, 768, 1024 et 1280 px**, thèmes clair **et** sombre, sur les sept écrans (niveaux, réceptions liste et détail, transferts liste et détail, inventaires liste et détail — les compter, ne pas se fier au chiffre). **1024 est obligatoire** (piège 7) : c'est le palier le plus étroit du mode table.
  - Aucun défilement horizontal du corps de page ; cibles tactiles ≥ 44 px ; focus visible au clavier ; aucune donnée tronquée sans échappatoire.
  - **Les quatorze calques du périmètre sont ouverts et mesurés en RECTANGLES d'éléments**, jamais en `scrollWidth` (piège 9). Ils s'énumèrent, ils ne se comptent pas — voici la liste, relevée par recherche dans le code (`<DialogContent` / `<AlertDialogContent`). Les numéros de ligne sont ceux d'avant migration et **bougeront** ; c'est l'identité du calque qui fait foi.

    **9 `Dialog` :**

    | # | Calque | Emplacement (avant migration) |
    |---|---|---|
    | 1 | « Nouvelle réception » | `receptions/index.tsx:146` |
    | 2 | « Nouveau transfert » | `transferts/index.tsx:127` |
    | 3 | « Ouvrir un inventaire complet » | `inventaires/index.tsx:123` |
    | 4 | « Ajuster — {produit} ({variante}) » | `stock/index.tsx:378` |
    | 5 | « Seuil d'alerte — {produit} ({variante}) » | `stock/index.tsx:437` |
    | 6 | Ligne de réception (« Ajouter » / « Modifier la ligne ») | `receptions/$purchaseId.tsx:481` |
    | 7 | Ligne de transfert (« Ajouter » / « Modifier la ligne ») | `transferts/$transferId.tsx:517` |
    | 8 | « Réceptionner le transfert » | `transferts/$transferId.tsx:641` |
    | 9 | « Récapitulatif de clôture » | `inventaires/$countId.tsx:350` |

    **5 `AlertDialog` :**

    | # | Calque | Emplacement (avant migration) |
    |---|---|---|
    | 1 | « Valider la réception ? » | `receptions/$purchaseId.tsx:409` |
    | 2 | « Supprimer ce brouillon ? » | `receptions/$purchaseId.tsx:441` |
    | 3 | « Expédier le transfert ? » | `transferts/$transferId.tsx:440` |
    | 4 | « Annuler ce transfert ? » | `transferts/$transferId.tsx:468` |
    | 5 | « Clôturer l'inventaire ? » | `inventaires/$countId.tsx:310` |

    La 2b avait laissé un trou assumé sur exactement trois d'entre eux — ligne de réception (`Dialog` 6), ligne de transfert (`Dialog` 7), récapitulatif de clôture (`Dialog` 9) — faute de données locales : **ce trou doit être comblé ici**, en seedant une réception en brouillon, un transfert et un inventaire ouvert. Les mêmes données ouvrent aussi le `Dialog` 8 et les `AlertDialog` 1 à 5, qui n'ont pas d'autre chemin d'accès.
  - Chaque dialogue corrigé horizontalement est revérifié **en hauteur**, à 375×812 et en viewport court (piège 8).
  - Les panneaux `FiltresRepliables` sont **dépliés avant mesure** (piège 11).
- Si `ListeAdaptative` a été modifié, la raison est consignée et la modification est additive, documentée et testée. **À ce stade, aucune tâche n'a de raison de le faire.**
- `FiltresRepliables.label` accepte un `React.ReactNode` (par défaut `"Filtres"` inchangé), la JSDoc le dit, un cas de `components/ui/filtres-repliables.test.tsx` le couvre, et le libellé composé de `stock/index.tsx` porte `min-w-0 break-words` — vérifié au navigateur à 375 px avec un nom d'entrepôt d'un seul jeton insécable.
- Le dialogue « Récapitulatif de clôture » porte `md:max-w-2xl` et **aucun conteneur de table n'y défile horizontalement** à 768, 1024 et 1280 px. `dialog.tsx` n'apparaît dans aucun diff.
- PR ouverte, revue CodeRabbit traitée — **CLI et bot, ils trouvent des choses différentes, lancer les deux** — merge sur feu vert explicite (merge commit, pas de squash).

---

## Ne pas approcher

### Écritures irréversibles du domaine

Aucune de ces mutations, aucun de leurs `AlertDialog`, aucun de leurs textes de confirmation ne doit être touché par cette phase :

- **Validation de réception** (`POST /purchases/:id/receive`) — fait entrer le stock, rend le document immuable.
- **Expédition de transfert** (`POST /transfers/:id/send`) — **fige le CMP côté API**.
- **Annulation de transfert** (`POST /transfers/:id/cancel`).
- **Réception de transfert** (`POST /transfers/:id/receive`) — trace les écarts en ajustement.
- **Clôture d'inventaire** (`POST /inventory-counts/:id/close`) — génère les mouvements d'écart, irréversible.
- **Ajustement de quantité** (`POST /stock/warehouses/:id/adjustments`).
- Suppression de brouillon de réception, suppression de ligne (réception et transfert).

### Logique métier

- **`apps/web/src/lib/transferts.ts`** dans son entier — `preparerReception`, `STATUTS_TRANSFERT_FR`, `varianteBadgeStatut`, les types. Importer, jamais recopier ni modifier.
- **La logique origine/destination des transferts** : destinations issues de `GET /warehouses/destinations` (toute l'organisation) et non des entrepôts visibles ; réinitialisation de la destination quand elle devient l'origine ; exclusion de l'origine de la liste des destinations.
- **Le prédicat de désactivation du bouton d'enregistrement par ligne** de l'inventaire (`enregistrer.isPending || !(item.id in saisies)`), et la distinction entre saisie absente et saisie vide.
- Les gardes de concurrence des boutons de création (`disabled={mutation.isPending || …}`) et les `invalidateQueries` de chaque `onSuccess`.
- Les débounces de 300 ms et les effets `setPage(1)`.

### Libellés

- **Tous les `aria-label` existants, au caractère près**, tiret cadratin compris : `Quantité comptée — {sku}` et `Quantité reçue — {sku}`.
- Les messages d'`EtatVide` et leurs variantes conditionnelles, repris **mot pour mot**.
- Les textes des `AlertDialogDescription` et leurs accords au pluriel.

---

## Hors périmètre

- **`stock/mouvements.tsx` et son test** : table témoin de la phase 1, déjà migrée. Ses 4 cas ne doivent pas bouger.
- **`administration/`** et le tableau de bord — phase 4, avec le dernier `h-[calc(100dvh-3rem)]` et le débordement horizontal de 13 px déjà prouvé non-régression.
- **Quantités sans séparateur de milliers** : différé tracé en 2b, en tension avec « le chiffre est sacré », mais transversal.
- **Propagation de `reglages.data.currency`** : différé transversal tracé, à faire en un seul passage.
- **`alert-dialog.tsx` sans `max-h` ni défilement interne** : différé majeur tracé en 2b (fichier jumeau de `dialog.tsx`, non corrigé). Cette phase ouvre cinq `AlertDialog` de plus — si l'un d'eux déborde en hauteur, **le constater et le consigner**, pas le corriger : le correctif appartient à une passe dédiée sur le composant.
- **Rognage des options longues de `Select`** : différé mineur tracé en 2b, le déclencheur borné fait hériter la liste de sa largeur. Le dialogue d'article de la Task 5 l'exhibera au maximum — le constater, pas le corriger.
- **`InputGroupButton size="icon-xs"` à 24 px** : différé mineur, ne concerne pas ce répertoire.
- **`TableHeader sticky` inerte sur les trois écrans de détail** : tranché ci-dessus, on le laisse inerte. Donner une boîte défilante à ces tables sort du mandat responsive.
