# Pagination serveur des listes non bornées — Sous-projet B

- **Issue** : #13 (pagination cohérente des tableaux), sous-projet B
- **Statut** : design validé, prêt pour plan d'implémentation
- **Périmètre** : API + web + tests ; un seul PR
- **Prérequis livrés** : composant `Pagination` web (sous-projet A, PR #17) ; découpage en lots `inArray` (PR #18)

## Contexte

Six endpoints de liste renvoient aujourd'hui toutes leurs lignes sans borne, ce
qui grossit avec le volume de données de l'organisation (app architecturée pour
évoluer en SaaS multi-tenant). Le crash SQL correspondant est déjà couvert par le
découpage en lots (PR #18) ; ce sous-projet porte donc sur l'**UX et la taille de
payload** : borner les réponses et brancher le composant `Pagination` déjà livré.

Deux endpoints paginent déjà, avec des conventions divergentes :

- `GET /api/v1/sales` — `page` / `parPage`, réponse `{ sales, total, page, parPage }`.
- `GET /api/v1/stock/movements` — `page` / `limite`, réponse `{ movements, total, page, limite }`.

Ce sous-projet **harmonise sur `page` / `limite`** (déjà la convention de
`/stock/movements`) et migre `/sales` en conséquence.

## Décisions de cadrage

1. **Convention** : `page` / `limite` partout (réponse `{ …, total, page, limite }`).
2. **Endpoints paginés (6)** : `products`, `stock/levels`, `purchases` (réceptions),
   `transfers`, `inventory-counts`, `users` — tous consommés uniquement par leur
   écran de liste.
3. **Non touchés** : `categories` et `suppliers` — listes de configuration
   structurellement petites, **consommées par des menus déroulants/filtres qui ont
   besoin de la liste entière** (select catégorie du formulaire produit, filtre
   catégorie de la liste produits, filtre fournisseur des réceptions). Les paginer
   par défaut casserait ces déroulants ; hors périmètre.
4. **Validation** : `400 VALIDATION` sur paramètre invalide (contrat explicite,
   comme `/sales`), pas de clamp silencieux.

## Convention et forme de réponse

- **Paramètres** : `page` (entier ≥ 1, défaut 1) ; `limite` (entier, 1..200, défaut 50).
- **Invalide → `400`** avec l'enveloppe `{ code: "VALIDATION", message: "français" }`
  si `page < 1`, `limite < 1`, `limite > 200`, ou non-entier.
- **Réponse** : la clé tableau existante **+ `total`, `page`, `limite`**. Exemple :

  ```text
  GET /api/v1/products?page=2&limite=50
  → { products: [...], total: 138, page: 2, limite: 50 }
  ```

- La réponse reste additive (les lecteurs de `.products` continuent), mais la liste
  est désormais **bornée** au défaut (50). L'API et le front d'un même endpoint sont
  donc livrés ensemble pour éviter une régression d'affichage.

## Helper API partagé

Nouveau `apps/api/src/lib/pagination.ts` :

```ts
type Pagination = { page: number; limite: number }

// Parse et valide page/limite depuis la query. Retourne un objet Pagination,
// ou une Response 400 VALIDATION à renvoyer telle quelle si un paramètre est
// invalide. Défauts : page = 1, limite = 50. Bornes : page ≥ 1, 1 ≤ limite ≤ 200.
function lirePagination(c: Context): Pagination | Response
```

Usage dans une route :

```ts
const pagination = lirePagination(c)
if (pagination instanceof Response) return pagination
const { page, limite } = pagination
// … total = COUNT(*) scopé à l'identique …
// … page = requête de liste + .limit(limite).offset((page - 1) * limite) …
return c.json({ <clé>: lignes, total, page, limite })
```

- **`lirePagination` est la source unique** du parsing/validation ; aucune route ne
  ré-implémente ce contrat.
- Le calcul du `total` (un `COUNT(*)` sur le même `WHERE`) et l'application de
  `.limit().offset()` restent dans chaque route, car les requêtes diffèrent
  (jointures, agrégats, tris). Le helper ne masque pas la requête, il ne porte que
  le contrat des paramètres.
- **`/sales` et `/stock/movements` migrés sur `lirePagination`** :
  - `/stock/movements` utilise déjà `page` / `limite` → passe simplement au helper
    (parsing/validation unifiés ; comportement inchangé, hormis le passage du clamp
    au `400` sur paramètre invalide).
  - `/sales` : paramètre et champ réponse **`parPage → limite`**. Contrat d'API
    modifié (front migré en conséquence).

## Endpoints (6)

Pour chacun, le même patron : `lirePagination` → `COUNT(*)` **scopé exactement
comme la requête de liste** → page bornée → `{ <clé>, total, page, limite }`.

| Endpoint | Clé | Scoping à préserver (count ET page) |
| --- | --- | --- |
| `GET /api/v1/products` | `products` | `organizationId` + filtres `actifs`/`recherche` |
| `GET /api/v1/stock/levels` | `levels` | `organizationId` + portée de rôle (entrepôts lisibles) |
| `GET /api/v1/purchases` | `purchases` | `organizationId` + filtre `statut` |
| `GET /api/v1/transfers` | `transfers` | `organizationId` + filtre `statut` |
| `GET /api/v1/inventory-counts` | `counts` | `organizationId` + filtre `statut` |
| `GET /api/v1/users` | `users` | `organizationId` (rôle owner/admin/auditor déjà requis) |

**Invariant d'isolation multi-tenant** : le `total` et la tranche de page dérivent
tous deux du même ensemble scopé. Le `total` ne compte jamais de lignes hors
`organizationId` ni hors portée de rôle. L'enrichissement par lots (agrégats
`inArray` des réceptions/transferts/inventaires, PR #18) s'applique désormais à la
**page** (≤ 200 ids), bien sous la limite de 90 par lot.

## Front

- Brancher le composant `Pagination` (déjà livré, `apps/web/src/components/ui/pagination.tsx`)
  sur les 6 écrans de liste : état `page` local, envoi `page` / `limite`, `total` et
  `limite` lus de la réponse (jamais de taille de page codée en dur — pattern déjà
  retenu au sous-projet A).
- Tout changement de filtre revient à la page 1 (motif existant de `/stock/movements`
  et `/ventes`).
- Migrer les appels web de `/sales` : type `PageVentes` `parPage → limite`,
  `fetchVentesPeriode` et `fetchVentesDuJour`.

## Tests

- **API (D1 réelle)**, par endpoint paginé :
  - `total` exact et **tranche de page** recalculables à la main (jamais dérivés de
    l'implémentation) ; ex. seed 3 lignes, `limite=2` → page 1 renvoie 2, page 2
    renvoie 1, `total=3`.
  - **Page au-delà de la dernière** → `[] 200`, `total` conservé.
  - **Paramètres invalides** (`page=0`, `limite=0`, `limite=500`, non-entier) → `400 VALIDATION`.
  - **Isolation** : une organisation/rôle ne voit dans `total` ni dans les pages que
    ses propres lignes (au moins un test cross-tenant ou hors-portée par famille).
- **Migration `/sales`** : mise à jour des tests existants `parPage → limite`.
- **Web** : le composant `Pagination` est déjà couvert (sous-projet A) ; vérifier le
  câblage `page`/`total` sur 1–2 écrans représentatifs, sans dupliquer la couverture
  du composant.

## Note — sélecteurs de produits (formulaires transfert/réception)

Les formulaires de détail transfert (`transferts/$transferId.tsx`) et réception
(`receptions/$purchaseId.tsx`) consomment `GET /products` via un **sélecteur à
recherche** (debounce → `?actifs=true&recherche=…`). Avec la pagination, ces
sélecteurs reçoivent les **200 premiers résultats correspondants** (`limite=200`) — comportement
acceptable et bénéfique à l'échelle (ils ne chargent plus tout le catalogue) :
la recherche reste le mécanisme de sélection. Contrairement aux déroulants
catégories/fournisseurs (qui peuplent des options à partir de la liste entière),
un sélecteur à recherche est intrinsèquement borné. Seul l'état « recherche
vide » est plafonné à 200 ; polir ce cas (ex. message d'invite à rechercher) est
un suivi possible, hors périmètre de ce sous-projet.

## Hors périmètre

- `categories`, `suppliers` — non paginés (cf. décision 3).
- Curseur / pagination par keyset — `limit`/`offset` suffit à ce volume ; non traité.
- Numéros de page à ellipses — le composant `Pagination` reste sobre (Précédent /
  « Page X/Y — N » / Suivant), décision du sous-projet A.
