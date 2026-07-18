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

**Décision de cadrage** : `products.ts` (lignes 51/88/118) est **explicitement
exclu** de ce fix — une branche locale (`feat/pagination-composant-partage`,
PR #17) traite déjà l'issue #13, dont le périmètre inclut la pagination
serveur de `GET /api/v1/products`. Toucher ce fichier créerait un risque de
conflit avec ce travail en cours. Ce fix se limite aux **autres**
emplacements du même défaut, non couverts par un travail en cours.

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
lots d'au plus 100 (marge de sécurité sous la limite de variables SQLite/D1),
exécute la requête fournie par l'appelant pour chaque lot, concatène les
résultats. Retourne `[]` immédiatement si le tableau est vide — remplace
la garde `ids.length > 0 ? … : []` dupliquée à chaque site aujourd'hui.

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

- `apps/api/src/routes/products.ts` (lignes 51, 88, 118) — exclu, cf. §1.
- `apps/api/src/routes/inventory-counts.ts:553` classé « à surveiller »
  plutôt que confirmé RISQUÉ — inclus quand même par décision utilisateur
  (coût marginal nul, même helper).
- Pagination serveur des listes elles-mêmes (issue #13, sous-projet B) —
  non traitée ici.
