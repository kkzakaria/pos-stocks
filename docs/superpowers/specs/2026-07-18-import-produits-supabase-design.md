# Design — Import du catalogue produits depuis l'ancien backend Supabase

**Date** : 2026-07-18
**Statut** : validé en brainstorming, en attente de relecture finale

## 1. Contexte et objectifs

L'entreprise utilisait auparavant un backend Supabase (projet `lmiisxmpdczxskkizehk`) pour un POS distinct. Ce backend contient un catalogue de 744 produits (`product_templates`) à récupérer et importer dans pos-stocks, l'application actuelle.

**Décision de cadrage** : import du **catalogue uniquement** — nom, description, prix, prix plancher, seuil de stock minimum, images, et catégories dérivées des noms de produits. **Explicitement hors périmètre** : quantités de stock par entrepôt (`product_inventory`), coût/CMP de départ (`cost`), historique de ventes, clients, utilisateurs. Rien de tout cela n'est touché par ce script — le stock sera saisi manuellement ou via une réception fournisseur une fois le catalogue en place, en respectant l'invariant « `stockService.applyMovements` est le seul point d'écriture de stock ».

## 2. Données source (Supabase, lecture seule)

- `product_templates` (744 lignes) : `sku` (unique, non vide), `name` (non vide), `description` (164/744 renseignées), `price`/`min_price`/`max_price` (numeric, parfois avec décimales non nulles), `min_stock_level`, `barcode` (toujours NULL — aucun produit n'en a), `image_url` (742/744 renseignées, format `.avif` sur Supabase Storage), `is_active`, `category_id` (toujours NULL — la table `categories` source est vide).
- `product_inventory` relie produits et magasins avec une quantité. Constat : **730 produits appartiennent à « Quincaillerie Sawande & Frères »**, **15 à « Symotocycle »** (pièces/accessoires moto), 1 produit est partagé entre les deux, et un 3ᵉ magasin (« Electronics Sawande & Frères ») est vide. Décision : tout importer dans le même catalogue d'organisation cible ; les produits Symotocycle se distinguent naturellement via la catégorie dédiée « Automobile & Moto » (pas d'exclusion, pas de champ « magasin d'origine » dans le schéma cible de toute façon — `products` n'est rattaché qu'à `organizationId`, jamais à un entrepôt).

## 3. Classification en catégories

Aucune catégorie n'existe côté source. Classification par règles de mots-clés (regex sur `name`), affinée itérativement sur des échantillons du jeu réel :

| Catégorie | Volume approx. |
|---|---|
| Plomberie & Sanitaire | 124 |
| Outillage | 88 |
| Électricité | 57 |
| Peinture & Droguerie | 30 |
| Quincaillerie | 29 |
| Matériaux de construction | 28 |
| Éclairage | 24 |
| Ameublement & Literie | 22 |
| Climatisation | 17 |
| Automobile & Moto | 11 |
| Droguerie & Chimie | 6 |
| Gaz & Cuisine | 1 |
| **Divers / à classer** (repli) | ~307 |

Le catalogue source est hétérogène et contient des noms tronqués, mal orthographiés ou de simples références internes (`SANYA-8`, `N 1,5`…) qu'aucune règle fiable ne peut classer automatiquement. Ces produits vont dans une catégorie de repli **« Divers / à classer »**, à reclasser manuellement après import plutôt que de risquer un mauvais classement automatique. Aucune hiérarchie de catégories (`parentId`) n'est utilisée — toutes plates, au même niveau.

## 4. Correspondance des champs

| Source (`product_templates`) | Cible (`POST /products`) | Règle |
|---|---|---|
| `name` | `name` | tel quel (trim) |
| `description` | `description` | tel quel si non vide, sinon omis |
| `sku` | `sku` | tel quel (unicité déjà vérifiée côté source) |
| `price` | `price` | `Math.round(price)` — XOF entier |
| `min_price` | `minPrice` | `Math.round(min_price)` **seulement si `min_price < price`** ; sinon omis (NULL côté cible = prix fixe, pas de plancher) |
| `max_price` | — | **abandonné** : pas d'équivalent dans le schéma cible (pas de plafond de prix) |
| `min_stock_level` | `defaultMinStock` | tel quel |
| `barcode` | — | toujours NULL côté source, rien à faire |
| catégorie dérivée | `categoryId` | résolu après création des ~13 catégories |
| `image_url` | image produit (`POST /products/:id/image`) | téléchargée, convertie AVIF → WebP (`sharp`, testé), envoyée en `multipart/form-data` (l'endpoint n'accepte que jpeg/png/webp, pas avif) |

Pas de variante réelle à créer manuellement : chaque `POST /products` crée déjà sa variante « Standard » implicite (comportement existant de l'API).

## 5. Architecture du script

**Approche retenue** : script Bun/TS autonome qui pilote la **vraie API HTTP** (`POST /categories`, `POST /products`, `POST /products/:id/image`) plutôt que d'écrire directement en base. Ça réutilise gratuitement la génération/validation de SKU, la création de la variante Standard, la validation Zod, et l'écriture R2 — sans risque de contourner silencieusement un invariant métier.

Étapes :
1. **Export ponctuel** (fait une fois, via la connexion MCP Supabase déjà authentifiée, pas de identifiants Postgres dans le script) : dump des 744 lignes vers un snapshot JSON local, hors dépôt (scratchpad).
2. **Étiquetage catégorie** : la classification par mots-clés est appliquée au snapshot, chaque produit reçoit son nom de catégorie cible (ou « Divers / à classer »).
3. **Script d'import** (`bun run <script> --api-url <url> --email <owner> --password <mdp>`) :
   - crée les catégories manquantes (`POST /categories`, idempotent — si `NOM_EXISTANT`, réutilise l'existante) ;
   - pour chaque produit : `POST /products`, puis téléchargement + conversion + upload de l'image (si `image_url` non nulle) ;
   - concurrence bornée (~5 en parallèle) ;
   - **reprenable** : journal de progression local (id source → id produit créé), une relance saute les produits déjà importés au lieu d'échouer sur SKU dupliqué ;
   - erreurs journalisées par produit (SKU, message), le run continue sans s'interrompre ;
   - rapport de synthèse à la fin (créés / images ok / erreurs / répartition par catégorie).

## 6. Déploiement

1. Run contre la D1 **locale** de dev (`bun run --cwd apps/api dev`), avec le compte owner local existant.
2. Revue manuelle par l'utilisateur (catégories, échantillon de produits, rendu des images).
3. Rejeu du **même script**, pointé vers l'API de prod, avec les identifiants prod fournis via variables d'environnement (jamais committés).

## 7. Hors périmètre / risques assumés

- Pas de test automatisé ajouté (script d'import ponctuel, pas du code applicatif) — validation par revue manuelle après le run local.
- Le rapprochement source→cible ne gère pas les mises à jour ultérieures du catalogue source (si le catalogue Supabase change après l'import, il n'y a pas de synchronisation continue prévue).
- La catégorie « Divers / à classer » restera volumineuse (~307 produits) tant qu'un reclassement manuel n'est pas fait.
