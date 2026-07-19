# Recréation des magasins et de l'inventaire Supabase — Design

**Date :** 2026-07-19
**Contexte :** La prod pos-stocks a été purgée (0 magasin, 0 produit). On reconstruit l'état du backend Supabase « gest » (projet `lmiisxmpdczxskkizehk`) : les 3 magasins, le catalogue (déjà scripté), puis le stock par magasin.

## Objectif

Reproduire fidèlement en prod pos-stocks, depuis Supabase :
1. les 3 magasins (`stores` → `warehouses`) ;
2. le catalogue (`product_templates` → `products` + variante « Standard ») — **script d'import existant, inchangé** ;
3. le stock par magasin (`product_inventory` → `stock_levels` via réception valorisée), CMP sémé depuis `cost`.

## Correspondance des modèles

| Supabase | pos-stocks |
|---|---|
| `stores` (name, address, phone, email) | `warehouses` (name, type=`store`, address) — tél/email **non repris** |
| `product_templates` | `products` + une `product_variant` « Standard » |
| `product_inventory` (product_id, store_id, quantity) | `stock_levels` (variant_id, warehouse_id, quantity) matérialisé via `stock_movements` |
| `product_templates.cost` | `stock_levels.avg_cost` (CMP), sémé au mouvement `purchase` |
| `categories` | `categories` |

Différences structurelles clés :
- Le stock porte sur la **variante**, jamais le produit. Chaque produit importé a une variante « Standard » implicite.
- pos-stocks dérive le stock d'un **journal immuable** (`stock_movements`) via `applyMovements` ; Supabase stocke une quantité plate. → un mouvement d'entrée initial par (variante, magasin).
- Le **CMP** n'est sémé que par les types `purchase`/`transfer_in`. → l'entrée initiale valorisée est une **réception** (`purchase`).

## Architecture

Tout passe par l'**API prod** (jamais d'écriture directe en D1, invariant d'archi #1) avec un cookie owner, en réutilisant le `http-client.ts` du worktree. Deux nouveaux scripts s'ajoutent au worktree `import-produits-supabase` :

- `creer-magasins.ts` — crée les 3 magasins + le fournisseur technique, écrit un journal.
- `semer-inventaire.ts` — lit l'inventaire Supabase (via `supabase db query --linked`) et pose le stock par réceptions valorisées chunkées.

Le catalogue reste `run.ts` (import existant, validé : 720 produits, 22 doublons de noms + 2 prix ≤ 0 rejetés).

**Ordre d'exécution prod :** `creer-magasins` → `run` (catalogue) → `semer-inventaire`.

## Composants

### `creer-magasins.ts`
- Entrée : les 3 `stores` (lues via `supabase db query --linked "select id,name,address from stores"`).
- Actions :
  - `POST /warehouses` `{name, type:"store", address}` ×3 → capture `name → warehouseId`.
  - `POST /suppliers` `{name:"Stock initial (import Supabase)"}` → capture `supplierId`.
- Journal : `data/magasins-<cible>.json` = `{ warehousesByName: {…}, supplierId }`. Reprise : si présent, ne recrée pas.
- Idempotence secondaire : avant `POST`, `GET /warehouses` et `GET /suppliers` ; si un nom existe déjà, réutilise son id (au cas où le journal a été perdu).

### `semer-inventaire.ts`
- Entrées :
  - Inventaire Supabase :
    `select pt.sku, pi.store_id, pi.quantity, pt.cost from product_inventory pi join product_templates pt on pt.id = pi.product_id where pi.quantity > 0`.
  - `stores` (pour `store_id → name`).
  - Journal magasins (`name → warehouseId`, `supplierId`).
  - Catalogue prod : `GET /products?page=…&limite=200` paginé → `sku → variantId` (`product.variants[0].id`, variante Standard unique).
- Mapping :
  - `store_id → name → warehouseId`.
  - `sku → variantId` ; SKU absent en prod → **ligne ignorée et rapportée** (produit non importé).
  - `unitCost = Math.round(cost)` ; `cost` nul → `0` (rapporté).
- Pose du stock, par magasin ayant des lignes :
  - découpe les lignes en **chunks de ≤ 100** ;
  - par chunk : `POST /purchases` `{warehouseId, supplierId, reference:"Stock initial Supabase (lot k)"}` → `POST /purchases/:id/items` par ligne → validation (passage `received`).
- Journal : `data/inventaire-<cible>.json` = ensemble des `(warehouseId, chunkIndex)` déjà validés → reprise sans doublon.
- Magasin sans ligne (Electronics) → aucune réception.

## Flux de données prod

```
supabase db query --linked ─┐
                            ├─> creer-magasins.ts ─> POST /warehouses ×3, POST /suppliers
                            │        └─> data/magasins-prod.json
run.ts (catalogue) ─────────┘        └─> products + variantes « Standard »
                                              │
supabase db query --linked (inventaire) ──────┤
GET /products (sku→variantId) ────────────────┤
data/magasins-prod.json ──────────────────────┴─> semer-inventaire.ts
                                                     └─> POST /purchases (+items) + received, chunks ≤100
                                                     └─> data/inventaire-prod.json
```

## Gestion d'erreurs

- **Reprise sur erreur** : journaux de progression pour chaque script ; re-lancer saute ce qui est déjà fait.
- **Idempotence** : magasin/fournisseur déjà présents → réutilisés ; chunk de réception déjà validé → sauté.
- **Lignes non mappables** (SKU absent, `cost` nul) : ignorées et **rapportées**, jamais bloquantes.
- **Échec réseau/HTTP** : le `http-client` lève ; le journal préserve l'avancement ; la reprise reprend au chunk suivant.
- **Réception vide** (toutes lignes ignorées) : ne pas créer de réception (la validation refuse une réception sans ligne).

## Rapport final

Chaque script imprime un récapitulatif :
- `creer-magasins` : magasins créés/réutilisés, fournisseur.
- `semer-inventaire` : par magasin — lignes semées, quantité totale, lignes ignorées (SKU absent / cost 0), nombre de réceptions (chunks).

## Tests & validation

- **Unitaires (Vitest)** : mapping `store_id→name`, arrondi `Math.round(cost)`, chunking (≤100, reste), résolution `sku→variantId`, filtrage `quantity>0` et lignes non mappables.
- **End-to-end local d'abord** : l'API dev (8787) a déjà les 720 produits.
  1. `creer-magasins` en local → 3 magasins + fournisseur.
  2. `semer-inventaire` en local.
  3. Vérifier `stock_levels` (quantité + CMP) contre l'inventaire Supabase : recompter à la main quelques SKU (quantité = `product_inventory.quantity`, CMP = `round(cost)`).
- **Prod** : l'utilisateur lance les commandes via `!` avec ses identifiants owner prod (`--api-url https://pos-stocks-api.koffiz2110.workers.dev`, `--web-origin` = domaine web prod), jamais collés en chat.

## Hors périmètre

- Historique des ventes/mouvements Supabase (`sales`, `stock_movements`) : non repris — seul l'**état de stock courant** est reconstruit (une entrée initiale).
- `phone`/`email` des magasins : pas de champ pos-stocks.
- Clients (`customers`), sessions de caisse, PIN managers : hors sujet.
