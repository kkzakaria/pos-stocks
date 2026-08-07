# SPA web responsive — 375 px à desktop

Date : 2026-08-07
Statut : validé (brainstorming), en attente de plan d'implémentation détaillé

## Contexte et objectif

La SPA `apps/web` est aujourd'hui **desktop-only de fait** : sidebar fixe de 240 px sans repli, panneau panier POS fixe de 384 px, et seulement 4 écrans sur 23 portent la moindre classe responsive (des ajustements de grille isolés). Aucun motif de navigation mobile n'existe, même dormant. Le `<meta viewport>` est en revanche correct, et la variante `pointer-coarse:` est déjà utilisée à 21 endroits pour porter les cibles tactiles à 44 px — c'est le seul acquis réel.

`PRODUCT.md` énonce depuis le début une intention jamais opérationnalisée : les caissiers travaillent « souvent sur un écran fixe ou une tablette tactile », et la section Accessibilité demande explicitement « matériel modeste : tablettes et portables plus anciens, petits écrans » et « cibles tactiles confortables ». Ce chantier tient cette promesse.

Objectif : rendre les 23 écrans utilisables de **375 px à desktop**, sans rien retirer ni cacher de ce que l'API autorise.

## Cadre de conception

Trois références ont été consultées avant d'arbitrer, et elles convergent :

- **Register `product` (impeccable)** : « Responsive behavior is structural (collapse sidebar, responsive table, breakpoint-driven columns), **not fluid typography** ». Également : « Modal as first thought. Modals are usually laziness. Exhaust inline / progressive alternatives first. »
- **frontend-design** : quand le brief fixe la direction visuelle, on la suit. `DESIGN.md` et `PRODUCT.md` la fixent (« familiarité gagnante », anti-référence « template d'admin générique »).
- **Web Interface Guidelines** : `touch-action: manipulation`, `overscroll-behavior: contain` dans les tiroirs et panneaux, `env(safe-area-inset-*)` pour les encoches, `min-w-0` sur les enfants flex, `tabular-nums` sur les colonnes de chiffres, `prefers-reduced-motion` honoré.

**Conséquence cadrante : aucun changement d'identité visuelle.** Pas de nouvelle palette, pas de nouvelle typographie, pas de typo fluide (`clamp()`), pas de nouveau composant décoratif. Le chantier est **structurel** : ce qui change, c'est la disposition, pas l'apparence. Les seules exceptions sont les deux correctifs de lisibilité ci-dessous, qui traitent des défauts avérés.

## Breakpoints

Pilotés par le contenu, pas par des tailles d'appareils. Tailwind 4 est utilisé avec ses valeurs par défaut (aucun `--breakpoint-*` n'est redéfini dans `styles.css`), et **on n'en ajoute aucun** :

| Palier | Largeur | Comportement |
|---|---|---|
| base | < 768 px | Colonne unique, tables en cartes, POS en barre de synthèse |
| `md` | ≥ 768 px | Tables réelles, POS à deux colonnes (panier 288 px) |
| `lg` | ≥ 1024 px | Sidebar permanente, POS panier 384 px — l'écran actuel, inchangé |

Écriture **mobile-first** : styles de base pour le petit écran, `min-width` pour enrichir. Pas de `max-width`.

## Décisions structurelles

### 1. Navigation — tiroir sous `lg`

La sidebar de 240 px (`apps/web/src/routes/_app.tsx`) reste identique à partir de `lg`. En dessous, elle est masquée et remplacée par un **tiroir** ouvert depuis un bouton hamburger placé dans un en-tête mobile.

Contraintes : `overscroll-behavior: contain` sur le tiroir ; fermeture au `Escape` et au clic sur le fond ; piège de focus pendant l'ouverture et restitution du focus au bouton à la fermeture ; fermeture automatique à la navigation. Le lien d'évitement « Aller au contenu » existant est conservé et doit rester le premier élément focusable.

Le tiroir réutilise le composant `Dialog` (base-ui) déjà présent — **pas de nouvelle primitive**. Rappel du piège documenté : `<DialogTrigger render={…}>`, jamais `asChild`.

### 2. Tables — cartes empilées sous `md`

Les tables denses (stock, ventes, produits, mouvements, réceptions, transferts, inventaires…) deviennent une **liste de cartes empilées** sous `md` : une carte par ligne, paires libellé/valeur en vertical.

Cette transformation passe par **un composant générique unique**, pas par une réécriture écran par écran — c'est la condition pour que 23 écrans restent cohérents et maintenables. Le composant s'articule avec `table.tsx` et `table-skeleton.tsx` existants, et l'état de chargement doit avoir sa variante carte (le register `product` impose des squelettes, pas des spinners).

Aucune colonne n'est supprimée en passant en carte : « tout se lit, tout se prouve » — masquer une donnée à l'auditeur sur mobile contredit le positionnement du produit. Les colonnes de chiffres portent `tabular-nums`.

Rappel du piège documenté : `TableHeader sticky` n'a d'effet que si le conteneur de la table est lui-même la boîte de défilement vertical (`containerClassName="min-h-0 flex-1 overflow-y-auto"`).

### 3. POS — barre de synthèse persistante sous `md`

L'écran de vente (`apps/web/src/pos/ecran-vente.tsx`) est aujourd'hui `catalogue (flex-1) + panier (w-96 fixe)`.

- **≥ `lg`** : inchangé.
- **`md` → `lg`** : deux colonnes conservées, panier réduit de 384 px à 288 px. Les vignettes du catalogue ont besoin d'environ 480 px pour rester lisibles ; c'est la largeur qui dicte le palier, pas le format d'un appareil.
- **< `md`** : catalogue en pleine largeur, et une **barre de synthèse persistante en bas** — nombre d'articles · total · action « Encaisser » — qui se déplie en panier plein écran au tap.

Justification de l'arbitrage, car deux options plus évidentes ont été écartées :

- L'**empilement vertical** (catalogue puis panier dessous) fait sortir le total du champ de vision pendant qu'on parcourt le catalogue. Il contredit « le chiffre est sacré » : le montant doit être l'élément le plus lisible de l'écran.
- La **bascule par onglets** masque le panier entièrement et impose un aller-retour d'onglet à chaque contrôle. Elle contredit « vite sans bâcler » : on optimise le nombre de gestes.

La barre de synthèse tient les deux : le total ne quitte jamais l'écran, l'action principale est dans la zone du pouce, un tap suffit pour vérifier, un autre pour payer. C'est de la divulgation progressive — ce que le register `product` demande d'épuiser avant toute modale.

Contraintes : la barre respecte `env(safe-area-inset-bottom)` ; le panneau déplié porte `overscroll-behavior: contain` ; le total porte `tabular-nums` et reste formaté par `formaterMontant`.

**Le clavier reste prioritaire au POS** (`PRODUCT.md` : « le caissier encaisse sans souris »). Les raccourcis existants (buffer de scan code-barres, `/`, `F2`) et la navigation clavier de l'écran de vente ne doivent subir aucune régression à aucun palier — c'est un critère de recette, pas un détail.

### 4. Deux correctifs de lisibilité

Ce sont des défauts avérés, pas des préférences :

- **Zoom iOS sur les champs.** `input.tsx` et `textarea.tsx` sont en `text-sm` (14 px) sous `md`. Safari iOS zoome la page à la prise de focus dès qu'un champ fait moins de 16 px — l'utilisateur est décalé à chaque saisie, sur **tous** les formulaires. Correctif : `text-base` (16 px) sous `md`, `md:text-xs` conservé au-delà.
- **Corps de texte à 12 px.** `DESIGN.md` fixe `body: 0.75rem`, assumé sur desktop pour la densité des tables. À 375 px c'est sous le seuil de confort. Correctif : 14 px sous `md`, 12 px à partir de `md` — la densité reste là où les gestionnaires en ont besoin, sans l'imposer au comptoir.

`DESIGN.md` doit être mis à jour pour refléter ces deux paliers, sinon le document ment sur le système réel.

## Ce qui ne change pas

- Aucune modification de l'API, d'un schéma Zod, ou d'une règle d'autorisation. Chantier strictement front.
- Aucune donnée masquée selon la largeur d'écran. Le front masque déjà selon le **rôle** ; il ne masquera jamais selon la **taille**.
- Aucune nouvelle dépendance. Le tiroir s'appuie sur `Dialog` (base-ui) déjà présent.
- Aucun breakpoint personnalisé ajouté à `styles.css`.
- Le ticket 80 mm et son `createPortal(document.body)` ne sont pas touchés — rappel du piège : un ancêtre `print:hidden` rendrait la page blanche.

## Vérification

Il n'existe **aucune infrastructure E2E automatisée** dans ce dépôt (ni Playwright, ni job navigateur en CI) ; les rapports E2E existants sont des sessions manuelles pilotées via `agent-browser`. Ce chantier n'en crée pas non plus — ce serait un chantier à part entière.

- **Tests unitaires** (Vitest + Testing Library, existants) : le composant générique table→carte a ses tests ; les tests d'écran existants ne doivent pas régresser. Rappel du piège documenté : espaces insécables étroites (U+202F) dans les montants `fr-FR` — utiliser les helpers regex existants (`texteMontant`), jamais `getByText(formaterMontant(x))`.
- **Vérification navigateur manuelle** par palier, à 375 px, 768 px et 1280 px, sur les écrans touchés par la phase. Points de contrôle systématiques : aucun défilement horizontal du corps de page, cibles tactiles ≥ 44 px, focus visible au clavier, aucune donnée tronquée sans échappatoire.
- **Non-régression clavier du POS** vérifiée explicitement à chaque palier.

## Phasage

Une PR par phase, chacune livrable et vérifiable au navigateur indépendamment.

1. **Fondations + POS** — tiroir de navigation, composant générique table→carte, les deux correctifs de lisibilité, mise à jour de `DESIGN.md`, et l'écran de vente POS complet (barre de synthèse, paliers 288/384 px, ouverture et fermeture de caisse, tickets du jour).
2. **Ventes et Catalogue** — historique, détail de vente, rapports, produits (liste, fiche, création), catégories, fournisseurs.
3. **Stock** — niveaux, mouvements, réceptions, transferts, inventaires (les écrans les plus denses, ceux qui éprouveront le plus le composant carte).
4. **Administration** — entrepôts, utilisateurs, paramètres, tableau de bord, mon compte, connexion.

La phase 1 porte les fondations parce que tout le reste en dépend : sans le tiroir et le composant carte, chaque écran suivant réinventerait sa propre solution.

## Risques

- **Le composant table→carte est le point de bascule du chantier.** S'il est mal découpé en phase 1, les phases 2 à 4 accumulent des contournements. Il doit être éprouvé sur au moins deux tables de formes différentes avant d'être figé.
- **Régression clavier au POS** : le risque fonctionnel le plus élevé. Le POS est l'écran où l'ergonomie est la plus contrainte et le plus utilisé en production.
- **Le passage du corps à 14 px sous `md` déplace des choses partout.** Il touche les 23 écrans par les primitives partagées — c'est voulu, mais la vérification visuelle de la phase 1 doit être large, pas limitée aux écrans réécrits.
