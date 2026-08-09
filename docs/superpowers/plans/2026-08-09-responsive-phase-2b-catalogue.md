# SPA responsive — Phase 2b : Catalogue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre utilisables de 375 px à desktop les cinq écrans du catalogue — liste des produits, fiche produit, création de produit, catégories, fournisseurs — et poser le point d'insertion de la future compression d'image.

**Architecture:** Trois écrans consomment `ListeAdaptative` tel quel. Deux structures de la fiche produit ne passent **pas** par lui, délibérément, et reçoivent une passe écrite à la main. Un module `@/lib/image.ts` devient le point de passage unique des deux chemins d'envoi d'image, avec une implémentation identité pour l'instant.

**Tech Stack:** React 19, TanStack Router + Query, Tailwind CSS v4, `@base-ui/react`, Vitest 3 + Testing Library + jsdom.

## Global Constraints

- **Langue** : UI, messages d'erreur et messages de commit (conventionnels) en **français** ; commentaires de code et JSDoc en **anglais**, tests compris, sans exception.
- **Mobile-first** : `min-width`/`sm:`/`md:`/`lg:` uniquement. **Jamais de `max-width` en media query** (la propriété CSS `max-w-*` reste permise).
- **Aucun breakpoint personnalisé.** Paliers Tailwind par défaut.
- **Aucune donnée masquée selon la largeur.** Le front masque selon le **rôle**, jamais selon la **taille**.
- **Aucun changement d'identité visuelle**, tokens uniquement. **Aucune nouvelle dépendance.**
- Aucune modification d'`apps/api`, `packages/shared`, `index.html`, `routeTree.gen.ts`.
- Montants via `formaterMontant` ; chiffres en `tabular-nums`. Helper de test partagé : `texteMontant` depuis `@/test/texte-montant` — **ne pas en recréer une copie locale**.
- Tests : Vitest 3 `globals: true`. Les deux formes coexistent dans le dépôt (26 fichiers importent `describe`/`it`/`expect`, 9 non) — **suivre le fichier voisin** plutôt qu'une règle absolue.
- **Jamais `getByText(formaterMontant(x))`** : espaces insécables étroites (U+202F).
- Hooks husky actifs. **Jamais `--no-verify`.** Push local avec `CI=1`.
- Spec : `docs/superpowers/specs/2026-08-07-spa-responsive-design.md`.

### `ListeAdaptative` — gel assoupli

Le composant est consommé tel quel par défaut, et l'a été sur sept écrans sans qu'une prop soit ajoutée. **Mais le gel n'est pas un interdit** : quand une contrainte réelle n'a aucune alternative propre — les contournements au niveau de l'écran dégraderaient le rendu, la sémantique ou la donnée —, **on modifie le composant**. Ordre de préférence : résoudre au niveau de l'écran → vérifier que `masquerEnCarte` ne couvre pas déjà le cas → ouvrir le composant. Toute modification est additive, documentée en JSDoc, couverte par un test, et sa raison consignée au rapport de tâche. **C'est le contournement qui doit se justifier.**

### Les six pièges accumulés en phases 1 et 2a

1. **Le test garde-fou « ne perd aucune donnée en mode carte » porte sur les colonnes `masquerEnCarte`**, jamais sur les visibles — celles-ci passent par les paires quoi qu'il arrive.
2. **Une colonne dont la donnée est déjà portée par `titre`/`valeur`/`sousTitre` doit être `masquerEnCarte`**, même si son rendu de table est plus riche ; c'est `valeur` (ou `titre`) qui s'enrichit. Sinon la figure s'affiche deux fois dans la carte.
3. **Réutiliser l'accesseur comme `cellule`** (`cellule: valeurLigneX`) plutôt que ré-inliner l'expression : c'est ce qui empêche *structurellement* la divergence, pas le commentaire.
4. **`ListeAdaptative` ne transmet au `TableCell` que `numeric` et `classeCellule`.** Toute autre classe de l'ancien `<TableCell>` doit être reposée. Comparer chaque colonne migrée à celle qu'elle remplace et le dire dans le rapport.
5. **Une assertion doit porter sur ce qui peut casser.** Cibler la paire libellé/valeur, pas `carte.textContent`.
6. **Migrer aussi la branche de chargement.** En phase 2a, les trois rapports ont gardé une table brute en `isPending` parce que chaque tâche n'avait migré que `isSuccess` : à 375 px l'utilisateur voyait une table dense défiler avant les cartes. Passer `chargement` et supprimer les imports `Table`/`TableSkeleton` devenus inutiles.

---

## Structure de fichiers

**Créés :**

| Fichier | Responsabilité |
|---|---|
| `apps/web/src/lib/image.ts` | `preparerImage(fichier)` — point de passage unique avant envoi, identité pour l'instant |

**Modifiés :** `catalogue/produits/index.tsx`, `catalogue/categories.tsx`, `catalogue/fournisseurs.tsx`, `catalogue/produits/$productId.tsx`, `catalogue/produits/nouveau.tsx`, et `components/produit/{champ-image,section-identite,section-synthese,section-stock,section-variantes,formulaire-variantes}.tsx`.

---

### Task 1 : Liste des produits

**Migrée en premier délibérément** : c'est le seul écran qui éprouve les deux points restés ouverts à l'issue de la phase 2a — la vignette et la ligne cliquable. Les découvrir ici laisse le temps de corriger ; les découvrir en dernier ne le laisserait pas.

**Files:**
- Modify: `apps/web/src/routes/_app/catalogue/produits/index.tsx`
- Test: `apps/web/src/routes/_app/catalogue/produits/index.test.tsx` (à créer)

**Interfaces:**
- Consumes: `ListeAdaptative`, `ColonneAdaptative`, `FiltresRepliables`, `texteMontant` (`@/test/texte-montant`, tests).
- Produces: `COLONNES_PRODUITS`, `titreProduit`, `sousTitreProduit` exportés pour le test.

- [ ] **Step 1: La vignette — appliquer la règle, pas rouvrir le composant**

La colonne 1 porte une vignette 40×40 (ou un placeholder) sous un `<TableHead />` sans libellé. **L'image porte `alt=""`** : l'application la déclare elle-même décorative, un lecteur d'écran l'ignore.

Traitement : `masquerEnCarte: true` sur cette colonne, et **`titre` rend la vignette aux côtés du nom**. Le garde-fou « aucune donnée masquée » est satisfait deux fois — formellement, l'image réapparaît dans le titre ; sur le fond, elle ne portait aucune donnée auditable.

Rendre le titre comme un `<span className="flex items-center gap-2">` contenant la vignette puis le nom. `ListeAdaptative` place `titre` dans un `<p className="min-w-0 flex-1 font-medium break-words">` : vérifier que la vignette ne casse pas le `break-words` du nom.

**Ne pas toucher** à `crossOrigin="use-credentials"`, au cache-busting `?v=${updatedAt}`, ni à `loading="lazy"`. Si la vignette cesse de s'afficher après le déplacement, c'est là qu'il faut regarder — pas dans `ListeAdaptative`.

- [ ] **Step 2: La ligne cliquable — honorer le contrat de la phase 2a**

La ligne navigue vers `/catalogue/produits/$productId` en portant les filtres de la liste. Le contrat posé en phase 2a — *toute ligne cliquable expose un lien ou un bouton réel, en table comme en carte* — n'a jamais été exercé : cet écran est le premier.

La cellule « Nom » porte déjà un `<Link>` réel. Faire que **`titre` rende ce même `<Link>`** (avec la vignette à côté) : le contrat est alors honoré en carte comme en table, sans rien inventer.

Passer `surClicLigne` pour conserver le confort souris sur toute la ligne. **Retirer le `onClick={(e) => e.stopPropagation()}` du `<Link>`** : `ListeAdaptative` neutralise déjà les descendants interactifs, cette garde manuelle est devenue redondante.

- [ ] **Step 3: Filtres, pleine hauteur, chargement**

Envelopper la barre de filtres dans `<FiltresRepliables nbActifs={…}>`. Les deux contrôles sont `w-72` et `w-56` fixes : les passer en `w-full sm:w-72` / `w-full sm:w-56`.

Calculer `nbFiltresActifs` à partir des filtres réellement renseignés. **Attention** : cet écran porte ses filtres dans l'**URL** (`q`, `categorie`, `page`), contrairement à `ventes/index.tsx` dont la période est un état local. Le motif du gel par `useRef` employé là-bas **ne convient pas ici** : au montage, l'état peut déjà contenir des valeurs restaurées depuis l'URL (lien partagé, retour arrière), et les qualifier de neutres afficherait zéro filtre actif sur une liste filtrée. Compter simplement les valeurs non vides.

Migrer `h-[calc(100dvh-3rem)]` → `h-full`. Passer `chargement={…isPending}` et supprimer les imports `Table`/`TableSkeleton` devenus inutiles (piège n°6).

**Ne pas toucher** au debounce de 300 ms ni à l'effet de réalignement d'URL protégé par focus : ils sont sensibles au focus et le repli des filtres ne doit pas changer quand ils se déclenchent.

- [ ] **Step 4: Tests**

Écrire le fichier de test sur le modèle de `routes/_app/ventes/index.test.tsx`. Couvrir : les 6 en-têtes à 1280 px ; le garde-fou sur les colonnes `masquerEnCarte` à 375 px ; **la vignette présente dans la carte** ; **le lien « Nom » présent exactement une fois en carte** et pointant vers la bonne fiche ; et que `surClicLigne` ne se déclenche pas au clic sur ce lien.

- [ ] **Step 5: Vérifier et commiter**

```bash
bun run --cwd apps/web test
```
Puis commit conventionnel en français.

---

### Task 2 : Catégories

**Files:**
- Modify: `apps/web/src/routes/_app/catalogue/categories.tsx`
- Test: `apps/web/src/routes/_app/catalogue/categories.test.tsx` (à créer)

- [ ] **Step 1: Migrer**

2 colonnes quand `peutEcrire`, 1 sinon : « Catégorie » (avec le préfixe `Parent > Enfant`) et une colonne d'actions à en-tête vide portant le bouton « Modifier ».

Motif éprouvé en phase 2a sur `ventes/index.tsx` : la colonne d'action est `masquerEnCarte: true`, et `actionCarte` rend le même bouton en carte — le bouton n'existe donc jamais en double. `titre` = le libellé hiérarchique.

**Pas de ligne cliquable** : l'action de cet écran est un bouton d'édition, pas une navigation. Ne pas passer `surClicLigne`.

`h-[calc(100dvh-3rem)]` → `h-full`. `chargement`, `etatVide` (reprendre le message et l'`action` existants **mot pour mot**), et suppression des imports devenus inutiles.

- [ ] **Step 2: Ne pas casser le piège `SelectValue`**

Le dialogue d'édition contient un `<SelectValue>` avec fonction de rendu — piège documenté dans `CLAUDE.md` : la fonction est appelée même à vide et son retour `undefined` affiche un champ blanc. **Ne pas le refactorer en `<SelectValue placeholder>` nu**, et vérifier qu'il porte bien un libellé de repli dans la fonction.

- [ ] **Step 3: Tests, vérification, commit**

Garde-fou sur les colonnes masquées, et le bouton « Modifier » présent exactement une fois en carte.

---

### Task 3 : Fournisseurs

**Files:**
- Modify: `apps/web/src/routes/_app/catalogue/fournisseurs.tsx`
- Test: `apps/web/src/routes/_app/catalogue/fournisseurs.test.tsx` (à créer)

- [ ] **Step 1: Migrer**

5 colonnes quand `peutEcrire`, 4 sinon : Nom, Contact, Téléphone, Statut (un `Badge`), et la colonne d'actions à en-tête vide (« Désactiver »/« Réactiver »). Même motif que la Task 2 : action `masquerEnCarte` + `actionCarte`.

`titre` = nom. Le `Badge` de statut reste une paire visible — c'est une information d'état, elle a sa place dans la carte.

`h-full`, `chargement`, `etatVide` repris mot pour mot, imports nettoyés.

- [ ] **Step 2: L'alerte de bascule**

Les erreurs de bascule s'affichent dans un `<p role="alert">` **au-dessus** de la table, à l'intérieur de la colonne flex — son apparition décale donc la hauteur disponible. Vérifier que ça reste correct une fois l'écran en `h-full`.

- [ ] **Step 3: Tests, vérification, commit**

---

### Task 4 : Point d'insertion de la compression d'image

Ne livre **pas** la compression. Pose le seul point de passage par lequel elle s'insérera, et corrige les trois obstacles structurels qui l'empêchent aujourd'hui.

**Files:**
- Create: `apps/web/src/lib/image.ts`
- Create: `apps/web/src/lib/image.test.ts`
- Modify: `apps/web/src/components/produit/champ-image.tsx`
- Modify: `apps/web/src/components/produit/section-identite.tsx`

**Interfaces:**
- Produces: `preparerImage(fichier: File): Promise<File>`.

- [ ] **Step 1: Écrire le module**

`preparerImage` renvoie le fichier **inchangé** pour l'instant. Sa JSDoc énonce le contrat : *point de passage unique avant tout envoi d'image ; la compression cliente s'insérera ici et nulle part ailleurs* — et liste les décisions ouvertes documentées dans la spec (orientation EXIF, format de sortie, dimension cible, garantie plutôt que tentative).

Test : l'identité préserve le contenu, le type MIME et le nom du fichier.

- [ ] **Step 2: Corriger l'ordre dans `ChampImage`**

Aujourd'hui la validation taille/MIME vit **en ligne** dans le gestionnaire `onChange` et s'exécute **avant** toute transformation : une photo de 3 Mo est rejetée avant d'avoir pu être réduite.

Extraire le gestionnaire en fonction nommée **`async`**, et rétablir l'ordre que la spec fixe (§ « Compression d'image », amendée en cours de phase) : **valider le type MIME → `preparerImage` → valider la taille → remettre au parent**.

Le découpage n'est pas un détail de mise en œuvre, chaque moitié a sa raison :

- **le type MIME AVANT** — c'est une garde d'entrée : on ne passe pas un fichier arbitraire à un décodeur d'image. Un PDF doit dire « Formats acceptés : JPEG, PNG, WebP », pas produire une erreur de décodage du navigateur ;
- **la taille APRÈS** — c'est le fichier *préparé* qui doit tenir sous le plafond, jamais l'original : valider avant, c'est rejeter la photo de 3 Mo avant qu'elle ait eu sa chance d'être réduite, ce qui est précisément le défaut que cette tâche corrige.

Ajouter un état d'attente visible pendant la préparation — une photo de 5 Mo prend un moment et le champ ne doit pas paraître figé.

**Conserver impérativement** : la remise à `""` de `input.value` après chaque tentative (sans elle, resélectionner le même fichier ne déclenche plus rien), et **l'ordre `<input class="peer">` immédiatement suivi du `<label>`** — un test assert ce motif, et le `peer-focus-visible` de Tailwind ne matche que les frères généraux.

- [ ] **Step 3: Brancher le chemin d'édition**

`section-identite.tsx` poste l'image **sans aucune validation cliente** : ni taille, ni MIME. Un fichier de 5 Mo part et se fait rejeter par le serveur.

Lui appliquer les mêmes validations que `ChampImage`, **dans le même ordre qu'au Step 2** et pour les mêmes raisons. Extraire les constantes de plafond et de types acceptés pour qu'elles ne soient définies qu'une fois.

Attention à la collision d'`id` : `section-identite.tsx` code `id="p-image"` en dur, qui est aussi la valeur par défaut de `ChampImage`. Ils ne coexistent jamais aujourd'hui, mais la prop `id` de `ChampImage` existe précisément pour ça.

- [ ] **Step 4: Tests, vérification, commit**

Les 7 cas existants de `champ-image.test.tsx` ne doivent pas régresser — dont celui qui assert le motif `peer`.

---

### Task 5 : Création de produit

**Files:**
- Modify: `apps/web/src/routes/_app/catalogue/produits/nouveau.tsx`
- Modify: `apps/web/src/components/produit/formulaire-variantes.tsx`

- [ ] **Step 1: Relever ce qui casse à 375 px**

Lister avant de corriger. Les suspects connus : la section « Prix » est un `flex gap-3` de deux champs `flex-1` **sans `flex-wrap`** ; la rangée d'actions en pied ; et surtout, dans `formulaire-variantes.tsx`, les **rangées d'attributs répétées** — `flex gap-2` avec deux `Input` plus un bouton « Retirer », sans `flex-wrap`. À 343 px utiles, c'est la pire rangée du produit.

- [ ] **Step 2: Corriger**

`flex-col sm:flex-row` ou `flex-wrap` selon les cas. Les libellés `aria-label` des rangées d'attributs (`Attribut N — nom`, `Attribut N — valeur`, `Retirer l'attribut N`) sont assertés **au caractère près** par 15 tests, tiret cadratin compris : **ne pas les toucher**.

**Ne pas toucher non plus** : le timeout de 60 s d'`apiFetch` (délibéré — l'écriture n'est pas rejouable, une annulation cliente courserait une écriture déjà validée), ni `suffixeSku`, qui doit rester aligné octet pour octet avec `genererSkuVariante` côté API.

- [ ] **Step 3: Vérification, commit**

Les 4 cas de `nouveau.test.tsx` et les 15 de `formulaire-variantes.test.tsx` doivent passer inchangés.

---

### Task 6 : Fiche produit — coquille, synthèse et identité

**Files:**
- Modify: `apps/web/src/routes/_app/catalogue/produits/$productId.tsx`
- Modify: `apps/web/src/components/produit/section-synthese.tsx`
- Modify: `apps/web/src/components/produit/section-identite.tsx`

- [ ] **Step 1: Corriger**

La grille de la route est déjà `grid-cols-1 lg:grid-cols-3` — mobile-safe. En revanche l'en-tête (`flex items-center gap-3` : titre, SKU, badge de statut) n'a pas de `flex-wrap` et s'écrase sur un nom long.

`section-synthese.tsx` : trois `Input className="w-32"` en mode édition. Les passer en `w-full sm:w-32`. En mode lecture, le bouton « Modifier » en `ml-auto` atterrit mal sur une ligne qui a débordé — vérifier.

`section-identite.tsx` : le formulaire est déjà en `w-full`. Vérifier l'image 128×128 et son placeholder.

- [ ] **Step 2: Vérification, commit**

Les suites de `section-synthese.test.tsx` (6 cas) et `section-identite.test.tsx` (4 cas) ne doivent pas bouger.

---

### Task 7 : Fiche produit — tableau de stock

**Ne passe pas par `ListeAdaptative`**, décidé en phase 2a : cette table porte un `TableFooter` de totaux — le seul du dépôt — et une **colonne conditionnelle** (« Variante » n'apparaît que si `plusieursVariantes`), deux notions que `ColonneAdaptative` n'a pas. Ajouter une API de pied pour un unique consommateur alourdirait une surface destinée à seize écrans.

**Files:**
- Modify: `apps/web/src/components/produit/section-stock.tsx`
- Modify: `apps/web/src/components/produit/section-stock.test.tsx`

- [ ] **Step 1: Passe responsive écrite à la main**

Sous `md`, rendre une liste de cartes : entrepôt en titre, valeur de ligne en vis-à-vis, puis les paires. **Le total sort de la liste** et devient une ligne de synthèse distincte, au lieu d'un `TableFooter` — c'est la décision de la spec.

L'arithmétique de `colSpan={colonnes - 3}` est fragile : en la retirant du chemin carte, ne pas la casser côté table.

- [ ] **Step 2: Tests**

Les 3 cas existants assertent la **présence ou l'absence de la colonne « Variante »** selon le nombre de variantes, et l'état vide. Ils doivent passer inchangés en mode table. Ajouter les cas carte, dont le total resté visible.

- [ ] **Step 3: Vérification, commit**

---

### Task 8 : Fiche produit — variantes et lots

**Ne passe pas par `ListeAdaptative`**, décidé en phase 2a : ce composant émet **deux lignes par variante** — la variante, puis une ligne pleine largeur listant ses lots. C'est du maître-détail, pas un tableau de lignes uniformes.

**Files:**
- Modify: `apps/web/src/components/produit/section-variantes.tsx`
- Modify: `apps/web/src/components/produit/section-variantes.test.tsx`

- [ ] **Step 1: Passe responsive écrite à la main**

Sous `md`, chaque variante devient une carte portant son nom, son SKU, ses attributs, son prix, son badge de statut, son bouton de bascule — **et ses lots à l'intérieur de la même carte**, ce qui est plus naturel qu'en table où ils occupent une seconde ligne.

Les lots portent leur numéro en `font-mono`, leur date de péremption, et un `Badge` « Expiré » le cas échéant : c'est de l'information d'audit, elle doit rester visible en carte.

- [ ] **Step 2: Les deux dialogues**

« Nouvelle variante » contient une rangée de prix en `flex gap-3` (deux `flex-1`, acceptable) et des rangées de paires d'attributs en `flex gap-2` — même problème qu'en Task 5. « Nouveau lot » est simple.

Rappel : `<DialogTrigger render={…}>`, **jamais `asChild`**.

- [ ] **Step 3: Tests**

Les 2 cas existants assertent que les lots apparaissent sous leur variante avec `trackLots`, et disparaissent sans. Ils doivent passer inchangés en table. Ajouter les cas carte.

- [ ] **Step 4: Vérification, commit**

---

## Definition of Done

- `bun run typecheck`, `bun run lint`, `bun run test` verts à la racine.
- Aucun test existant modifié pour « le faire passer ». Le hook dégradant vers desktop garantit que les suites d'écran sont inchangées ; si l'une a dû bouger, c'est un signal à remonter.
- Le littéral `h-[calc(100dvh-3rem)]` a **disparu du répertoire `catalogue/`**. Il survit encore dans `stock/` et `administration/` — phases 3 et 4.
- Vérification navigateur consignée à 375, 768 et 1280 px, thèmes clair **et** sombre, sur les cinq écrans.
- Si `ListeAdaptative` a été modifié, la raison est consignée et la modification est additive, documentée et testée.
- PR ouverte, revue CodeRabbit traitée — **CLI et bot, ils trouvent des choses différentes** — merge sur feu vert explicite (merge commit, pas de squash).

## Hors périmètre

- La compression d'image elle-même : la Task 4 pose le point d'insertion, pas l'algorithme.
- `stock/` et `administration/` : phases 3 et 4.
- Propagation de `reglages.data.currency` à `Panier` + `ModalePaiement` + `BarreSynthese` — différé transversal tracé.
- Le débordement horizontal de 13 px du tableau de bord — phase 4, préexistant et prouvé non-régression.
- `ListeAdaptative` applique `TableHeader sticky` systématiquement, y compris là où l'attribut ne peut rien faire faute de conteneur défilant. Inerte, donc cosmétique — mais si le composant est rouvert pour une autre raison en 2b, en profiter.
