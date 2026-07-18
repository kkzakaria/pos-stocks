# Design — Découpage en lots des `inArray` non bornés

**Date** : 2026-07-18
**Statut** : validé en brainstorming, en attente de relecture finale

## 1. Contexte et objectif

L'import du catalogue Supabase (script ponctuel, voir
`docs/superpowers/specs/2026-07-18-import-produits-supabase-design.md`) a
révélé en conditions réelles (720 produits importés) un crash de
`GET /api/v1/products` :

```
D1_ERROR: too many SQL variables at offset 561: SQLITE_ERROR
```

Cause : `apps/api/src/routes/products.ts:88` alimente un
`inArray(productVariants.productId, idsProduits)` avec un `idsProduits`
non borné (tous les produits de l'organisation), ce qui dépasse la limite
de variables liées par requête de SQLite/D1 une fois le volume de données
réel atteint.

**Correction (reprise du fix)** : `products.ts:88` — la source exacte du crash —
est **inclus** dans ce fix. L'hypothèse initiale (« PR #17 couvre déjà la
pagination serveur de `GET /products` ») était erronée : PR #17 (issue #13,
sous-projet A) était **web-only** (composant de pagination + refactos), elle n'a
ajouté aucune pagination serveur. La pagination serveur des listes reste
l'objet du sous-projet B (non démarré) ; en attendant, le découpage en lots est
la seule protection contre le crash — et reste utile en défense en profondeur
même après pagination (une taille de page > 90 dépasserait encore la limite).
Sur les trois `inArray` de `products.ts` : seul le **88** (variantes de tous les
produits listés, tableau JS non borné) est batché ; le **51** est une
sous-requête (`IN (SELECT …)`, aucune variable liée en masse) et le **118** est
borné par les variantes d'un seul produit — tous deux sûrs, non touchés.

## 2. Audit des emplacements à risque

Un audit de tous les `inArray(...)` de `apps/api/src/` (hors `products.ts`)
a classé chaque appel selon si le tableau qu'il reçoit est structurellement
borné (panier POS, lignes d'un seul document, portée d'entrepôts d'un
utilisateur, liste littérale fixe) ou s'il peut croître avec le volume de
données de l'organisation (résultat d'une liste non paginée).

**4 emplacements retenus**, tous corrigés par ce plan :

| Fichier:ligne | Requête | Alimenté par |
|---|---|---|
| `apps/api/src/routes/purchases.ts:164` | agrégat `GROUP BY purchaseId` (nb lignes, coût total) | toutes les réceptions de l'org (liste non paginée) |
| `apps/api/src/routes/transfers.ts:204` | agrégat `GROUP BY transferId` (nb lignes, quantité totale) | tous les transferts de l'org (limite optionnelle, absente par défaut) |
| `apps/api/src/routes/inventory-counts.ts:130` | agrégat `GROUP BY countId` (nb lignes, nb comptées) | tous les inventaires de l'org (liste non paginée) |
| `apps/api/src/routes/inventory-counts.ts:553` | jointure simple (SKU/noms des variantes en écart) | écarts d'UN inventaire — borné par le nombre de SKU d'UN entrepôt, mais peut approcher la limite sur un grand entrepôt |

**10 autres emplacements** audités sont sûrs (bornés par un panier POS,
les lignes d'un seul document, la portée d'entrepôts d'un utilisateur, ou
une liste littérale fixe) — non touchés par ce fix.

## 3. Conception du correctif

**Helper générique** `requeterParLots` (nouveau fichier
`apps/api/src/lib/db-batch.ts`) : découpe un tableau d'identifiants en
lots d'au plus **90**, exécute la requête fournie par l'appelant pour chaque
lot, concatène les résultats. Retourne `[]` immédiatement si le tableau est
vide — remplace la garde `ids.length > 0 ? … : []` dupliquée à chaque site.

**Taille de lot = 90, pas 100** : D1 plafonne une requête à **100 paramètres
liés**. Le lot est donc capé SOUS 100 pour laisser de la place aux autres
paramètres liés de la requête englobante — `GET /products` lie un
`organizationId` en plus de l'`inArray`, si bien qu'un lot plein de 100 ids
totaliserait 101 et crasherait encore. 90 laisse 10 paramètres de marge pour
tous les sites d'appel actuels (vérifié empiriquement par un test de régression
qui semait > 90 produits et reproduisait le crash à 100).

```ts
export async function requeterParLots<T>(
  ids: string[],
  requete: (lot: string[]) => Promise<T[]>
): Promise<T[]>
```

**Pourquoi c'est sûr pour les 3 requêtes `GROUP BY`** : la colonne groupée
(`purchaseId`, `transferId`, `countId`) est la MÊME colonne que celle
filtrée par `inArray`. Chaque ligne source appartient à exactement un id,
donc à exactement un lot — le découpage ne coupe jamais un groupe en deux.
Concaténer les résultats groupés lot par lot équivaut donc exactement à un
seul `GROUP BY` sur l'ensemble non découpé. Aucune ré-agrégation
inter-lots n'est nécessaire.

**Pourquoi c'est sûr pour la jointure simple** (`inventory-counts.ts:553`) :
pas d'agrégation du tout, la concaténation de lignes plates par lot est
triviale et équivalente à la requête non découpée.

**Comportement préservé à `inventory-counts.ts:553`** : cette requête est
déjà entourée d'un `try/catch` qui retombe sur `variantes = []` en cas
d'échec (repli délibéré — un échec transitoire de cette lecture
post-commit ne doit pas transformer une clôture d'inventaire réussie en
500, cf. commentaire existant). Le fix conserve ce comportement exact :
un seul `try/catch` autour de l'appel à `requeterParLots` dans son
ensemble, pas de tentative de préserver les résultats partiels d'un lot
individuel en cas d'échec d'un autre lot — la sémantique « best effort,
tout ou rien » existante n'est pas modifiée par ce fix.

**Approche écartée** : ajouter la pagination serveur aux endpoints de
liste eux-mêmes (réceptions, transferts, inventaires) — c'est exactement
le périmètre non démarré de l'issue #13 (sous-projet B), et l'implémenter
ici créerait le même risque de conflit qu'on évite déjà sur `products.ts`.
Le découpage en lots reste de toute façon utile en défense en profondeur
une fois la pagination ajoutée (protège contre une limite de page
généreuse).

## 4. Hors périmètre

- `apps/api/src/routes/products.ts:88` — **inclus** (source du crash), cf. §1 ;
  les sites 51 (sous-requête) et 118 (borné) restent sûrs et non touchés.
- `apps/api/src/routes/inventory-counts.ts:553` classé « à surveiller »
  plutôt que confirmé RISQUÉ — inclus quand même par décision utilisateur
  (coût marginal nul, même helper).
- Pagination serveur des listes elles-mêmes (issue #13, sous-projet B) —
  non traitée ici.
