# SPA web responsive — 375 px à desktop

Date : 2026-08-07
Statut : validé (brainstorming), en attente de plan d'implémentation détaillé
Révision : 2 — amendée après revue critique contre le code (mécanisme typographique, empilement et impression du POS, bascule table/carte, `Drawer` base-ui, phasage)

## Contexte et objectif

La SPA `apps/web` est aujourd'hui **desktop-only de fait** : sidebar fixe de 240 px sans repli, panneau panier POS fixe de 384 px, et seulement 4 écrans sur 23 portent la moindre classe responsive (des ajustements de grille isolés). Aucun motif de navigation mobile n'existe, même dormant. Le `<meta viewport>` est correct, et la variante `pointer-coarse:` est déjà utilisée à 17 endroits pour porter les cibles tactiles à 44 px — c'est le seul acquis réel.

`PRODUCT.md` énonce depuis le début une intention jamais opérationnalisée : les caissiers travaillent « souvent sur un écran fixe ou une tablette tactile », et la section Accessibilité demande explicitement « matériel modeste : tablettes et portables plus anciens, petits écrans » et « cibles tactiles confortables ». Ce chantier tient cette promesse.

Objectif : rendre les 23 écrans utilisables de **375 px à desktop**, sans rien retirer ni cacher de ce que l'API autorise.

## Cadre de conception

Trois références ont été consultées avant d'arbitrer, et elles convergent :

- **Register `product` (impeccable)** : « Responsive behavior is structural (collapse sidebar, responsive table, breakpoint-driven columns), **not fluid typography** ». Également : « Modal as first thought. Modals are usually laziness. Exhaust inline / progressive alternatives first. »
- **frontend-design** : quand le brief fixe la direction visuelle, on la suit. `DESIGN.md` et `PRODUCT.md` la fixent (« familiarité gagnante », anti-référence « template d'admin générique »).
- **Web Interface Guidelines** : `touch-action: manipulation`, `overscroll-behavior: contain` dans les tiroirs et panneaux, `min-w-0` sur les enfants flex, `tabular-nums` sur les colonnes de chiffres, `prefers-reduced-motion` honoré.

**Conséquence cadrante : aucun changement d'identité visuelle.** Pas de nouvelle palette, pas de nouvelle typographie, pas de typo fluide (`clamp()`), pas de nouveau composant décoratif. Le chantier est **structurel** : ce qui change, c'est la disposition, pas l'apparence. Les seules exceptions sont les deux correctifs de lisibilité ci-dessous, qui traitent des défauts avérés.

## Breakpoints

Pilotés par le contenu, pas par des tailles d'appareils. Tailwind 4 est utilisé avec ses valeurs par défaut (aucun `--breakpoint-*` n'est redéfini dans `styles.css`), et **on n'en ajoute aucun** :

| Palier | Largeur | Comportement |
|---|---|---|
| base | < 768 px | Navigation en tiroir, colonne unique, tables en cartes, POS en barre de synthèse |
| `md` | ≥ 768 px | Navigation **toujours en tiroir**, tables réelles, POS à deux colonnes (panier 288 px) |
| `lg` | ≥ 1024 px | Sidebar permanente, POS panier 384 px — l'écran actuel, inchangé |

Les deux transformations ne basculent donc pas au même palier : les **tables** redeviennent des tables dès `md`, la **navigation** ne redevient une sidebar qu'à `lg`. C'est délibéré — une table de 6 colonnes tient dans 768 px, une sidebar de 240 px en plus n'y tient pas.

Écriture **mobile-first** : styles de base pour le petit écran, `min-width` pour enrichir. Pas de `max-width`.

## Décisions structurelles

### 1. Navigation — tiroir sous `lg`

La sidebar de 240 px (`apps/web/src/routes/_app.tsx`) reste identique à partir de `lg`. En dessous, elle est masquée et remplacée par un **tiroir** ouvert depuis un bouton hamburger placé dans un en-tête mobile.

**Le tiroir s'appuie sur le composant `Drawer` de `@base-ui/react` (1.6.0), déjà installé** — il fournit nativement le piège de focus, la fermeture au `Escape`, la fermeture au clic extérieur et le glissement pour fermer (`swipeDirection`). Pas de nouvelle dépendance.

Attention : `Drawer` **n'a aucune prop `side`/`anchor`** — l'ancrage à gauche s'écrit intégralement en CSS sur le `Popup` (`fixed inset-y-0 left-0`), exactement comme `Dialog` code son centrage. `swipeDirection="left"` ne pilote que le geste de fermeture, pas la position. Un wrapper `drawer.tsx` est donc à écrire dans le style de la maison, au même titre que `dialog.tsx`. Reste aussi à la charge du chantier : `overscroll-behavior: contain`, la fermeture automatique à la navigation, et le respect de `prefers-reduced-motion`.

**Règle transversale : tout nouveau portail porte `print:hidden`.** Un composant portalé sur `body` échappe au `print:hidden` de ses ancêtres — voir §3 pour la conséquence concrète au POS.

Le lien d'évitement « Aller au contenu » existant est conservé et doit rester le premier élément focusable.

**Portée réelle** : `routes/pos.tsx` et `routes/login.tsx` vivent **hors** de la coquille `_app` et ne sont donc pas concernés par cette décision — le POS n'a pas de sidebar à replier, et l'écran de connexion est déjà `max-w-sm` centré avec `px-4`, donc quasi conforme à 375 px. La recette du POS mobile se fait **sans** tiroir.

### 2. Tables — cartes empilées sous `md`

Les tables denses (stock, mouvements, ventes, produits, réceptions, transferts, inventaires…) deviennent une **liste de cartes empilées** sous `md`. La table la plus large du produit est `stock/mouvements.tsx` avec **8 colonnes** (Date, Entrepôt, Article, Type, Delta, Lot, Motif, Par) : c'est la borne haute que le composant doit tenir.

**Bascule par `matchMedia`, pas par CSS.** Un hook de breakpoint rend soit la table, soit les cartes — jamais les deux. Deux raisons : rendre deux fois des centaines de lignes contredit « matériel modeste » de `PRODUCT.md`, et un DOM dupliqué fait lire deux fois le même contenu aux lecteurs d'écran.

**Règle générale du chantier** : le hook gouverne les bascules **structurelles** (quel arbre de composants est monté — table/cartes, sidebar/tiroir, panier en colonne/en panneau) ; le CSS gouverne les ajustements **dimensionnels** (largeurs, espacements — par exemple `w-72 lg:w-96` pour le panier). Le critère est simple : si la bascule dupliquerait du contenu dans le DOM, elle passe par le hook.

Coût assumé : jsdom n'implémente pas `matchMedia`. Le hook **dégrade explicitement vers le palier desktop quand `matchMedia` est absent** — de sorte que les tests d'écran existants continuent de voir des tables sans aucune modification, et que seuls les nouveaux tests en mode carte installent un stub. C'est délibérément préféré à un mock global dans `test-setup.ts`, qui casserait le test existant de `theme.test.tsx` reposant sur l'absence de `matchMedia` en jsdom.

Cette transformation passe par **un composant générique unique**, pas par une réécriture écran par écran — c'est la condition pour que 23 écrans restent cohérents et maintenables. Le composant s'articule avec `table.tsx` et `table-skeleton.tsx` existants, et l'état de chargement doit avoir sa variante carte (le register `product` impose des squelettes, pas des spinners).

**La carte impose une hiérarchie, pas une liste plate.** À 8 colonnes, un empilement uniforme de paires libellé/valeur devient un mur illisible. Le composant exige une **ligne de titre** (l'identifiant de la ligne — date, article, référence selon la table) visuellement dominante, puis les paires restantes en dessous. Aucune colonne n'est supprimée : « tout se lit, tout se prouve » — masquer une donnée à l'auditeur sur mobile contredit le positionnement du produit. Les colonnes de chiffres portent `tabular-nums`.

Rappel du piège documenté : `TableHeader sticky` n'a d'effet que si le conteneur de la table est lui-même la boîte de défilement vertical (`containerClassName="min-h-0 flex-1 overflow-y-auto"`).

### 3. POS — barre de synthèse persistante sous `md`

L'écran de vente (`apps/web/src/pos/ecran-vente.tsx`) est aujourd'hui `catalogue (flex-1) + panier (w-96 fixe)`.

- **≥ `lg`** : inchangé.
- **`md` → `lg`** : deux colonnes conservées, panier réduit de 384 px à 288 px.
- **< `md`** : catalogue en pleine largeur, et une **barre de synthèse persistante en bas** — nombre d'articles · total · action « Encaisser » — qui se déplie en panneau panier plein écran au tap.

Justification de l'arbitrage, car deux options plus évidentes ont été écartées :

- L'**empilement vertical** (catalogue puis panier dessous) fait sortir le total du champ de vision pendant qu'on parcourt le catalogue. Il contredit « le chiffre est sacré ».
- La **bascule par onglets** masque le panier entièrement et impose un aller-retour d'onglet à chaque contrôle. Elle contredit « vite sans bâcler ».

La barre de synthèse tient les deux : le total ne quitte jamais l'écran, l'action principale est dans la zone du pouce, un tap suffit pour vérifier, un autre pour payer.

L'état du panier vit déjà dans `EcranVente` et `Panier` est purement présentationnel : le démonter sous `md` ne perd rien.

#### Contraintes d'intégration (vérifiées contre le code, non négociables)

Le panneau panier déplié **n'est pas un portail**. C'est un overlay **inline**, enfant de `<main>`, sur le modèle de `modale-confirmation.tsx`. Trois raisons vérifiées :

1. **Impression.** Tout l'écran POS est sous `<main className="… print:hidden">`. Un composant portalé sur `body` échappe à cette classe. Or le panneau sera précisément **ouvert** au moment de l'encaissement, et `ImpressionTicket` déclenche `window.print()` après la vente : un panneau portalé s'imprimerait par-dessus le ticket 80 mm. Le panneau reste inline, et porte de toute façon `print:hidden` en propre.
2. **Empilement.** `ModalePaiement` est un `fixed z-30` enfant de `main`. Le panneau panier doit rester **sous** cette strate, sinon il passe devant la modale de paiement ouverte depuis lui.
3. **Sûreté du geste.** Un overlay inline hérite du contexte d'empilement du POS et ne peut pas surgir au-dessus d'une confirmation de vente.

#### Comportement clavier

`PRODUCT.md` impose « le caissier encaisse sans souris ». Le garde global de l'écran de vente désactive aujourd'hui le buffer de scan et les raccourcis dès qu'un overlay est ouvert.

**Décision : le panneau panier déplié ne compte pas comme un overlay bloquant.** Le buffer de scan code-barres et les raccourcis restent **actifs** panneau ouvert — c'est l'usage réel : le caissier scanne en regardant le total. Le panneau est un dépliement, pas une modale.

Aucune régression n'est tolérée sur les raccourcis existants à aucun palier : buffer de scan, `/`, `F2` et **`Delete`** (vider le panier). C'est un critère de recette, pas un détail.

Contraintes complémentaires : le panneau porte `overscroll-behavior: contain` ; le total porte `tabular-nums` et reste formaté par `formaterMontant`.

### 4. Deux correctifs de lisibilité

Ce sont des défauts avérés, pas des préférences.

**a. Zoom au focus sur les champs de saisie.** `input.tsx` et `textarea.tsx` portent `text-sm … md:text-xs/relaxed`, soit 14 px sous `md`. Safari iOS **et iPadOS** zooment la page à la prise de focus dès qu'un champ fait moins de 16 px.

Le correctif est piloté par **la capacité du pointeur, pas par la largeur** : `pointer-coarse:text-base` sur `input` et `textarea`. Un iPad portrait fait 768–834 px et tombe donc dans `md` : un correctif basé sur la largeur l'aurait laissé exposé, alors que `PRODUCT.md` désigne explicitement la tablette tactile comme le matériel du caissier. Ce choix prolonge la stratégie `pointer-coarse:` déjà en place (17 occurrences). Le suffixe `/relaxed` de `md:text-xs/relaxed` doit survivre au correctif.

**b. Taille de texte à 12 px sur petit écran.** Il n'existe **aucune taille de corps centralisée** dans le projet : `styles.css` ne pose pas de `font-size` sur `body` et ne redéfinit aucun token `--text-*`. Le « corps à 12 px » est en réalité **~96 occurrences de `text-xs` codées en dur**, primitives comprises (`table.tsx`, `dialog.tsx`).

Le correctif passe donc par **une redéfinition de `--text-xs` sous 768 px** dans `styles.css` : les utilitaires Tailwind 4 lisent `var(--text-xs)`, donc toutes les occurrences remontent en un seul point. C'est un **instrument volontairement large** : les libellés délibérément petits (libellés de section de la nav, horodatages, badges) grossissent aussi. C'est souhaitable sur mobile, mais c'est précisément pourquoi la vérification visuelle de la phase 1 doit être large et non limitée aux écrans réécrits.

`DESIGN.md` doit être mis à jour pour refléter ce palier, sinon le document ment sur le système réel.

## Ce qui ne change pas

- Aucune modification de l'API, d'un schéma Zod, ou d'une règle d'autorisation. Chantier strictement front.
- Aucune donnée masquée selon la largeur d'écran. Le front masque déjà selon le **rôle** ; il ne masquera jamais selon la **taille**.
- Aucune nouvelle dépendance : le tiroir s'appuie sur `Drawer` de `@base-ui/react` déjà installé.
- Aucun breakpoint personnalisé ajouté à `styles.css`.
- Le ticket 80 mm et son `createPortal(document.body)` ne sont pas touchés.
- **`index.html` n'est pas modifié.** La contrainte `env(safe-area-inset-bottom)` envisagée initialement est abandonnée : sans `viewport-fit=cover`, `env()` vaut 0 et le navigateur insète déjà la zone sûre. Ajouter `cover` aurait des conséquences bord-à-bord sur tous les écrans, pour un bénéfice nul ici.
- Aucune route nouvelle, donc aucun impact sur `routeTree.gen.ts`.
- Les dialogues existants tiennent déjà à 375 px (`DialogContent` porte `max-w-[calc(100%-2rem)]`, `DialogFooter` un empilement `sm:`) : on n'y touche pas.

## Vérification

Il n'existe **aucune infrastructure E2E automatisée** dans ce dépôt (ni Playwright, ni job navigateur en CI) ; les rapports E2E existants sont des sessions manuelles pilotées via `agent-browser`. Ce chantier n'en crée pas non plus — ce serait un chantier à part entière.

- **Pas de mock `matchMedia` global.** Le hook dégrade vers le palier desktop en son absence, donc les tests d'écran existants sont inchangés. Un helper de test dédié permet aux nouveaux tests de simuler explicitement une largeur ; `theme.test.tsx`, qui repose sur l'absence de `matchMedia` en jsdom, n'est pas touché.
- **Tests unitaires** (Vitest + Testing Library, existants) : le composant générique table→carte a ses tests, aux deux paliers. Les tests d'écran existants ne doivent pas régresser. Rappel du piège documenté : espaces insécables étroites (U+202F) dans les montants `fr-FR` — utiliser les helpers regex existants (`texteMontant`), jamais `getByText(formaterMontant(x))`.
- **Vérification navigateur manuelle** par palier, à 375 px, 768 px et 1280 px, sur les écrans touchés par la phase. Points de contrôle systématiques : aucun défilement horizontal du corps de page, cibles tactiles ≥ 44 px, focus visible au clavier, aucune donnée tronquée sans échappatoire.
- **Mode sombre** vérifié à chaque palier : la bascule est par classe (`@custom-variant dark`), et l'en-tête mobile, le tiroir et les cartes doivent rester sur les tokens (`bg-sidebar`, `bg-card`) — pas de couleur en dur.
- **Paysage téléphone** (812×375, donc palier `md`) : au POS, c'est la **hauteur** qui devient critique, pas la largeur (`h-screen` + en-tête + onglets de catégories). À vérifier explicitement.
- **Non-régression clavier du POS** vérifiée à chaque palier, raccourci `Delete` compris.

## Phasage

Une PR par phase, chacune livrable et vérifiable au navigateur indépendamment.

1. **Fondations + POS + deux tables témoins** — tiroir de navigation, composant générique table→carte, mock `matchMedia`, les deux correctifs de lisibilité, mise à jour de `DESIGN.md`, l'écran de vente POS complet (barre de synthèse, paliers 288/384 px, ouverture et fermeture de caisse, tickets du jour), **plus `stock/mouvements.tsx` (8 colonnes, la plus large) et `ventes/index.tsx`**.
2. **Ventes et Rapports** (phase 2a) — deux chantiers transverses puis les écrans : retrait de `role="button"` sur les lignes de `ListeAdaptative` au profit d'un lien réel, composant de repli des filtres (`<details>` sous `md` avec compteur de filtres actifs), détail de vente, et les trois rapports (ventes, marges, valorisation).
3. **Catalogue** (phase 2b) — produits (liste, fiche, création), catégories, fournisseurs.
4. **Stock** — niveaux, réceptions, transferts, inventaires.
5. **Administration** — entrepôts, utilisateurs, paramètres, tableau de bord, mon compte. L'écran de connexion est déjà quasi conforme et ne demande qu'une vérification.

La phase 2 initialement prévue a été **scindée en 2a et 2b** après reconnaissance : elle cumulait 7 écrans, 10 tables et 8 fichiers de test à ne pas casser, soit plus du double de la phase 1. Le catalogue concentre à lui seul les deux structures qui résistent à `ListeAdaptative` (voir ci-dessous) et 7 des 8 fichiers de test.

**Deux structures ne passeront pas par `ListeAdaptative`, délibérément** (décidé en phase 2a, à appliquer en 2b) :

- `components/produit/section-stock.tsx` porte un `TableFooter` de totaux — le seul du dépôt. Ajouter une API de pied au composant pour un unique consommateur alourdirait une surface destinée à 18 écrans ; le total se rend hors de la liste, en ligne de synthèse.
- `components/produit/section-variantes.tsx` émet **deux lignes par variante** (la variante, puis une ligne pleine largeur listant ses lots). C'est du maître-détail, pas un tableau de lignes uniformes : il reçoit une passe responsive écrite à la main.

Les deux tables témoins sont **dans** la phase 1 délibérément : le POS n'utilise aucune `Table`, donc sans elles le composant carte serait figé sans avoir jamais été éprouvé, et les phases 2 à 4 accumuleraient des contournements. `stock/mouvements.tsx` fixe la borne haute à 8 colonnes ; `ventes/index.tsx` fournit une forme différente.

## Risques

- **Le composant table→carte est le point de bascule du chantier.** Il est éprouvé en phase 1 sur deux tables de formes différentes avant d'être figé — c'est la raison d'être des deux tables témoins.
- **Régression clavier au POS** : le risque fonctionnel le plus élevé. Le POS est l'écran où l'ergonomie est la plus contrainte et le plus utilisé en production.
- **La redéfinition de `--text-xs` déplace des choses partout.** Elle touche ~96 occurrences en un point unique — c'est voulu, mais la vérification visuelle de la phase 1 doit couvrir des écrans non réécrits, pas seulement ceux de la phase.
- **Le panneau panier POS a trois contraintes d'intégration vérifiées** (impression, empilement, geste). Les ignorer produirait un défaut visible en production : un ticket imprimé barré par le panneau.
