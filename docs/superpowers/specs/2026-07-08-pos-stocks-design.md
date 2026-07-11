# Design — Gestion de stock multi-entrepôts avec point de vente intégré

**Date** : 2026-07-08
**Statut** : validé en brainstorming, en attente de relecture finale

## 1. Contexte et objectifs

Logiciel de gestion de stock multi-entrepôts avec point de vente (POS) intégré, pour **une seule entreprise** dans un premier temps, mais architecturé pour évoluer vers un SaaS multi-tenant (isolation par organisation dès le départ).

**Décisions de cadrage** :
- 100 % en ligne (pas de mode offline en v1)
- Devise : FCFA (XOF) par défaut, paramétrable par organisation
- Paiements v1 : espèces (avec rendu de monnaie) et mobile money (saisie manuelle de la référence)
- Reçus imprimés via impression navigateur (ticket 80 mm), numérotation séquentielle par boutique
- Interface en français
- Comptes créés par l'administrateur (pas d'inscription publique en v1)

**Hors périmètre v1** : offline, carte bancaire, crédit/compte client, remboursements et retours, multi-devises actif, notifications email/push, application mobile, inscription publique SaaS. Le schéma les prépare (organizationId partout, devise paramétrable, statut `refunded` réservé).

## 2. Stack et architecture

- **Backend** : Hono sur Cloudflare Worker, Better Auth (authentification + plugin organization), Drizzle ORM, Cloudflare D1 (base SQL), Cloudflare R2 (images produits)
- **Frontend** : SPA React — Vite, TanStack Router, TanStack Query, shadcn/ui, Tailwind 4 — servie par un second Worker (assets statiques)
- **Déploiement** : deux Workers séparés, ex. `app.domaine.com` (SPA) et `api.domaine.com` (API)

### Monorepo (bun workspaces)

```
pos-stocks/
├── apps/
│   ├── api/        → Worker API : Hono + Better Auth + Drizzle + D1 + R2
│   └── web/        → Worker SPA : React (Vite + TanStack Router + TanStack Query + shadcn)
├── packages/
│   └── shared/     → types partagés + schémas de validation Zod
└── wrangler : une configuration par app
```

Le scaffold TanStack Start existant est restructuré : `apps/web` devient une SPA pure (sans SSR) — le POS et le back-office n'en ont pas besoin.

### Points structurants

- Routes API sous `/api/v1/*`, Better Auth monté sur `/api/auth/*`
- Validation Zod à l'entrée de chaque route
- **Couche services** séparée des routes HTTP : c'est elle qui porte la logique métier et garantit la cohérence du stock
- **Typage bout-en-bout** : le front consomme l'API via le client RPC de Hono (`hc<AppType>`) — types inférés depuis le code de l'API, aucun type à maintenir à la main
- **Cookies cross-sous-domaines** : Better Auth en mode `crossSubDomainCookies` (cookie sur `.domaine.com`) + CORS `credentials: true`. En dev local, proxy Vite (`/api` → Worker API local), pas de CORS
- Images produits sur R2, servies via `/api/v1/files/*` avec contrôle d'accès

## 3. Modèle de données (D1 / Drizzle)

**Conventions** : montants en entiers (unités mineures ; XOF = 0 décimale) ; toutes les tables métier portent `organizationId` ; identifiants texte (nanoid/ULID) ; horodatages en UTC.

### Authentification et organisation (tables Better Auth)

- `user`, `session`, `account`, `verification` — standard
- `organization`, `member`, `invitation` — plugin organization
- Rôle **au niveau entreprise** dans `member.role` : `owner`, `admin`, `auditor` (admin lecture seule), `stock_manager`, `staff`
- `organization.metadata` : devise (défaut `XOF`), paramètres d'impression des reçus (en-tête, pied de ticket)

### Entrepôts et affectations

- `warehouses` — organizationId, nom, **type `warehouse` (réserve) ou `store` (boutique avec POS)**, adresse, actif. Une boutique EST un entrepôt : la vente déduit directement son stock
- `warehouse_members` — userId, warehouseId, **rôle local : `manager` (responsable), `auditor` (auditeur lecture seule), `cashier` (caissier)**. Limite un utilisateur à ses entrepôts assignés

### Catalogue

- `categories` — organizationId, nom, parentId (hiérarchie simple)
- `products` — nom, description, categoryId, sku (**auto-généré `PRD-XXXX`, ou saisi à la création ; non modifiable ensuite en v1** — la logique de bascule des variantes s'appuie sur sa stabilité), code-barres (**unique par organisation, produits et variantes confondus** — un scan POS résout toujours vers un seul article ; erreur `BARCODE_EXISTANT` sinon), prix de vente, **prix plancher optionnel** (`minPrice` — au POS, le vendeur pourra négocier jusqu'au plancher mais jamais en dessous), seuil d'alerte par défaut, `hasVariants`, `trackLots` (péremption activable par produit), `imageKey` (R2), actif
- `product_variants` — productId, attributs (ex. `{taille: "M", couleur: "rouge"}`), sku, code-barres (même unicité par organisation que les produits), surcharge de prix optionnelle. **Un produit sans variantes reçoit une variante implicite unique : tout le stock référence une variante**, ce qui unifie la logique
- `lots` — variantId, numéro de lot, date de péremption

### Stock — journal + niveaux matérialisés

- `stock_movements` — **journal immuable append-only** : warehouseId, variantId, lotId?, delta (+/−), type (`purchase`, `sale`, `transfer_out`, `transfer_in`, `adjustment`, `count`), référence au document source (type + id), userId, date. Source de vérité et piste d'audit complète
- `stock_levels` — quantité courante par (warehouseId, variantId) — les quantités par lot restent dérivables du journal (`lotId` sur chaque mouvement) ; une matérialisation par lot sera tranchée en Phase 6 si le FEFO l'exige — + seuil d'alerte spécifique par entrepôt + **coût moyen pondéré** (`avgCost` — valorisation **CMP** par variante et par entrepôt, recalculé à chaque réception dans le même batch ; base des marges et de la valorisation en Phase 7). Mise à jour **dans le même batch D1** que l'insertion du mouvement — jamais l'un sans l'autre. Recalculable depuis le journal (commande de réconciliation)

### Approvisionnement et opérations

- `suppliers` — nom, contact
- `purchases` + `purchase_items` — réception fournisseur : coût unitaire d'achat (marges), numéro de lot et péremption saisis à la réception, statut `draft` → `received`
- `transfers` + `transfer_items` — fromWarehouseId → toWarehouseId, statut `pending` → `sent` → `received` ; le stock sort à l'expédition, entre à la réception ; annulable avant expédition ; refus partiel à la réception tracé en ajustement. **Valorisation : le CMP de l'entrepôt d'origine est figé sur la ligne à l'expédition et absorbé par le CMP de destination à la réception**
- `inventory_counts` + `inventory_count_items` — par entrepôt, **toujours complet en v1 (tout l'entrepôt ; le partiel viendra plus tard si besoin)** : quantité attendue figée à l'ouverture, quantité comptée, écart → mouvements d'ajustement à la clôture

### Ventes (POS)

- `sales` — numéro de ticket séquentiel par boutique, storeId, cashierId, registerSessionId, total, devise, date, statut (`completed` ; `refunded` réservé v2), identifiant d'idempotence client
- `sale_items` — variantId, lotId?, quantité, prix unitaire, remise ligne, **`sourceWarehouseId`** : par défaut la boutique, peut pointer un autre entrepôt (dépannage depuis la réserve)
- `payments` — saleId, méthode (`cash` | `mobile_money`), montant, référence transaction (mobile money), montant reçu / monnaie rendue (cash). Plusieurs paiements par vente (paiement mixte)
- `register_sessions` — session de caisse (**v1**) : boutique, caissier, fond de caisse à l'ouverture, montant compté à la fermeture, écart, horodatages

## 4. Permissions

Application **côté API** par middleware en deux niveaux : rôle d'entreprise (`member.role`), puis rôle d'entrepôt (`warehouse_members`) pour toute route portant un `warehouseId`. Le front masque ce qui n'est pas autorisé ; la sécurité réelle est dans l'API.

| Action | Owner/Admin | Auditeur admin | Gest. stock | Resp. entrepôt | Auditeur entrepôt | Caissier |
|---|---|---|---|---|---|---|
| Config, utilisateurs, entrepôts | ✅ | 👁 lecture | — | — | — | — |
| Catalogue (produits, prix) | ✅ | 👁 | ✅ | 👁 | 👁 | 👁 |
| Réceptions, transferts, inventaires | ✅ | 👁 | ✅ tous entrepôts | ✅ ses entrepôts | 👁 ses entrepôts | — |
| Vendre (POS) | ✅ | — | — | ✅ | — | ✅ sa boutique |
| Sessions de caisse | ✅ | 👁 | — | ✅ | 👁 | ✅ la sienne |
| Rapports | ✅ tous | 👁 tous | ✅ stock | ✅ ses entrepôts | 👁 ses entrepôts | — |

## 5. Flux métier

**Vente au POS**
1. Ouverture de session de caisse (fond de caisse) — obligatoire avant de vendre
2. Recherche par scan code-barres, nom ou catégorie ; stock affiché = celui de la boutique
3. Panier → paiement (cash avec pavé numérique et calcul de monnaie, mobile money avec référence, ou mixte) ; remise par ligne bornée par le **prix plancher** du produit/variante quand il est défini
4. Validation **atomique** (un `db.batch()` D1) : vente + lignes + paiements + mouvements + décrément des niveaux avec garde `quantity >= demandé` — échec d'une ligne = refus de toute la vente avec détail
5. Produits à péremption : déduction automatique du lot expirant le premier (**FEFO**)
6. Ticket 80 mm via impression navigateur, numéro séquentiel par boutique

**Dépannage depuis un autre entrepôt** : au panier, le caissier autorisé choisit « puiser dans X » pour une ligne → `sourceWarehouseId` = X, le mouvement sort de X. Aucun transfert administratif.

**Transfert** : création (`pending`) → expédition (`sent`, stock sort de l'origine) → réception (`received`, stock entre à destination). Stock « en transit » visible. Annulation possible avant expédition ; écart à la réception tracé en ajustement.

**Réception fournisseur** : brouillon modifiable → validation (`received`) : création des lots (produits à péremption) + mouvements d'entrée + mise à jour du **coût moyen pondéré** de chaque variante dans l'entrepôt. Coût d'achat enregistré par ligne.

**Inventaire** : ouverture (fige les quantités attendues) → saisies de comptage (plusieurs sessions) → clôture : écarts → mouvements d'ajustement. Les ventes restent possibles pendant l'inventaire (écart calculé sur le mouvement net).

**Alertes stock bas** : seuil par produit (défaut) surchargeable par entrepôt ; tableau de bord des produits sous le seuil + badge de navigation. Pas de notifications push/email en v1.

## 6. Surface API

Groupes de routes REST sous `/api/v1`, validation Zod, middleware auth/permissions partout :

- `/auth/*` — Better Auth (login email/mot de passe, sessions)
- `/organizations` — paramètres (devise, en-tête ticket)
- `/users`, `/warehouses`, `/warehouse-members` — administration
- `/categories`, `/products` (+ variantes, upload image R2), `/suppliers`
- `/stock` — niveaux par entrepôt, journal des mouvements filtrable, alertes
- `/purchases`, `/transfers`, `/inventory-counts` — avec transitions d'état (`POST /transfers/:id/send`, `/receive`, …)
- `/sales`, `/register-sessions` — POS
- `/reports` — ventes par période/boutique/produit, valorisation du stock, marges

## 7. Écrans du front

Deux univers dans la même SPA, selon le rôle (caissier → POS direct) :

**POS (plein écran, tactile + scanner clavier)** : écran de vente (recherche/scan à gauche, panier à droite, raccourcis catégories), modale de paiement, ouverture/fermeture de session de caisse, historique des tickets du jour, réimpression.

**Back-office (sidebar)** : tableau de bord (ventes du jour, alertes stock bas, transferts en attente) ; catalogue (produits, variantes, images, lots, catégories, fournisseurs) ; stock (niveaux, journal, réceptions, transferts, inventaires) ; ventes (historique, détail, rapports) ; administration (entrepôts, utilisateurs et affectations, paramètres).

## 8. Cohérence des données et gestion d'erreurs

**Cohérence du stock (risque n° 1)** :
- Toute écriture de stock passe par un service unique (`stockService.applyMovements`) — aucune route ne touche `stock_levels` directement
- Chaque opération métier = un seul `db.batch()` D1 atomique : document + mouvements + niveaux réussissent ou échouent ensemble
- Décréments protégés par contrainte `CHECK (quantity >= 0)` sur `stock_levels` : une ligne qui rendrait le stock négatif fait échouer son statement et D1 **annule le batch entier** → rejet de l'opération (`409 STOCK_INSUFFISANT` avec détail reconstruit). (Un garde `UPDATE … WHERE quantity >= ?` ne suffit pas sur D1 : 0 ligne affectée n'est pas une erreur SQL, le batch serait déjà commité au moment de lire `meta.changes`.) Le stock ne devient jamais négatif, même avec des caisses concurrentes
- `stock_levels` recalculable depuis le journal (commande de réconciliation)

**Erreurs** :
- Erreurs métier typées à code stable (`STOCK_INSUFFISANT`, `SESSION_CAISSE_REQUISE`, `TRANSFERT_DEJA_EXPEDIE`, …) → HTTP 4xx + message en français affiché tel quel
- Validation Zod → 400 avec détail par champ
- Inattendues → 500 générique, détail loggé (observabilité Workers activée), jamais exposé
- **Idempotence des ventes** : identifiant unique généré côté client ; un retry réseau ne duplique pas la vente

## 9. Tests et CI

- **Unitaires (vitest)** : logique pure — totaux/monnaie, FEFO, transitions d'état transferts/inventaires, écarts de caisse
- **Intégration API (`@cloudflare/vitest-pool-workers`)** : routes contre une vraie D1 locale — permissions par rôle, vente atomique, stock insuffisant, ventes concurrentes, cycles complets transfert et inventaire
- **Front** : Testing Library sur les composants critiques (panier, modale de paiement) ; pas d'E2E navigateur en v1
- **CI (GitHub Actions)** : typecheck + lint + tests à chaque push ; déploiement `wrangler deploy` par app
