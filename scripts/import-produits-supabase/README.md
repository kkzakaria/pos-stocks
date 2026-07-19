# Import du catalogue Supabase vers pos-stocks

Script ponctuel — voir `docs/superpowers/specs/2026-07-18-import-produits-supabase-design.md`
pour le contexte complet (mapping des champs, classification en catégories,
périmètre exclu).

## Prérequis

- `data/produits-supabase.json` présent (snapshot déjà exporté, 744 produits).
- Un serveur pos-stocks API accessible (local `wrangler dev` ou prod).
- Un compte owner/admin/stock_manager sur l'organisation cible.

## Utilisation

```bash
cd scripts/import-produits-supabase

# 1. Aperçu sans aucun appel réseau
bun run run.ts --dry-run

# 2. Contre la D1 locale (par défaut http://localhost:8787)
IMPORT_EMAIL=owner@exemple.com IMPORT_PASSWORD='OwnerLocal!2026' bun run run.ts

# 3. Contre la prod, une fois le résultat local validé
IMPORT_EMAIL=<owner-prod> IMPORT_PASSWORD='<mot-de-passe-prod>' \
  bun run run.ts --api-url https://pos-stocks-api.koffiz2110.workers.dev \
  --web-origin https://pos-stocks-web.koffiz2110.workers.dev \
  --progression data/progress-prod.json
```

Le script est **reprenable** : `data/progress.json` (ou le chemin passé à
`--progression`) journalise chaque produit importé ; une relance saute les
produits déjà créés au lieu d'échouer sur SKU dupliqué. Utiliser un fichier
de progression **différent** par environnement (local vs prod) — sinon la
relance en prod sauterait tout, croyant l'import déjà fait. Un produit créé
mais dont l'image n'a jamais été téléversée avec succès (échec réseau,
interruption…) n'est **pas** considéré comme terminé : une relance retente
uniquement l'étape image pour ce produit, sans le recréer.

**Cas limite observé en pratique** : il arrive qu'une création de produit
réussisse côté serveur mais que le client échoue à lire la réponse (JSON
tronqué, coupure réseau) — le script journalise alors un échec plutôt qu'un
succès, et le produit reste orphelin (créé en base, mais absent du
journal). Une relance ultérieure échoue alors sur ce SKU avec
`409 NOM_EXISTANT` (nom déjà pris par le produit orphelin), ce qui peut se
lire à tort comme un doublon dans les données source. Devant un
`NOM_EXISTANT` inattendu, vérifier si le produit existe déjà côté cible
avant de conclure à un vrai conflit de nom source.

`--web-origin` doit correspondre au `WEB_ORIGIN` configuré côté serveur cible
(vérification `trustedOrigins` de Better Auth sur la connexion) — c'est le
domaine du frontend web, **indépendant** de `--api-url` (API et web vivent
sur des sous-domaines distincts) : un mauvais `--web-origin` fait échouer la
connexion avec un 403, même si `--api-url` est correct.

## Options

| Option | Défaut | Description |
|---|---|---|
| `--api-url` | `http://localhost:8787` | Base URL de l'API cible |
| `--web-origin` | `http://localhost:3000` | Origin du frontend web attendu par le serveur cible (trustedOrigins) |
| `--snapshot` | `data/produits-supabase.json` | Chemin du snapshot source |
| `--progression` | `data/progress.json` | Chemin du journal de reprise |
| `--concurrence` | `5` | Nombre d'imports en parallèle |
| `--dry-run` | `false` | N'effectue aucun appel réseau, affiche ce qui serait fait |

---

# Recréation des magasins et de l'inventaire Supabase

Voir `docs/superpowers/specs/2026-07-19-recreation-magasins-inventaire-supabase-design.md`.
Reconstruit en pos-stocks, depuis le backend Supabase, les **magasins** puis le
**stock par magasin** (le catalogue restant couvert par `run.ts` ci-dessus).

Ces deux scripts lisent Supabase via la CLI `supabase db query --linked`
(projet lié « gest »). Ils passent `--workdir` (défaut : racine du worktree)
pour que `--linked` résolve le projet même exécutés depuis ce sous-dossier.

## Ordre d'exécution

1. **Magasins + fournisseur** — `creer-magasins.ts`
2. **Catalogue** — `run.ts` (voir plus haut)
3. **Inventaire par magasin** — `semer-inventaire.ts`

L'étape 3 dépend de 1 (entrepôts + fournisseur) et 2 (variantes à peupler).

```bash
cd scripts/import-produits-supabase

# 1. Magasins + fournisseur (local)
IMPORT_EMAIL=owner@exemple.com IMPORT_PASSWORD='OwnerLocal!2026' \
  bun run creer-magasins.ts --journal data/magasins-local.json

# 3. Inventaire (local), après le catalogue
IMPORT_EMAIL=owner@exemple.com IMPORT_PASSWORD='OwnerLocal!2026' \
  bun run semer-inventaire.ts \
  --journal-magasins data/magasins-local.json \
  --journal data/inventaire-local.json
```

En **prod** (lancé par l'utilisateur, identifiants owner prod jamais collés en
chat), avec des journaux `*-prod.json` dédiés et le domaine web de prod :

```bash
IMPORT_EMAIL=<owner-prod> IMPORT_PASSWORD='<mdp-prod>' \
  bun run creer-magasins.ts \
  --api-url https://pos-stocks-api.koffiz2110.workers.dev \
  --web-origin https://pos-stocks-web.koffiz2110.workers.dev \
  --journal data/magasins-prod.json

# puis run.ts --progression data/progress-prod.json (catalogue), puis :

IMPORT_EMAIL=<owner-prod> IMPORT_PASSWORD='<mdp-prod>' \
  bun run semer-inventaire.ts \
  --api-url https://pos-stocks-api.koffiz2110.workers.dev \
  --web-origin https://pos-stocks-web.koffiz2110.workers.dev \
  --journal-magasins data/magasins-prod.json \
  --journal data/inventaire-prod.json
```

## `creer-magasins.ts`

Crée les magasins Supabase (`stores`) comme entrepôts de type `store`
(`phone`/`email` non repris) et le fournisseur technique
« Stock initial (import Supabase) ». **Idempotent** : un nom déjà présent
(journal ou `GET /warehouses`/`/suppliers`) est réutilisé, jamais recréé.

| Option | Défaut | Description |
|---|---|---|
| `--api-url` | `http://localhost:8787` | Base URL de l'API cible |
| `--web-origin` | `http://localhost:3000` | Origin frontend attendu (trustedOrigins) |
| `--journal` | `data/magasins-local.json` | Journal `{warehousesByName, supplierId}` |
| `--supabase-workdir` | racine worktree | Dossier de résolution du lien Supabase |
| `--dry-run` | `false` | Aucune écriture API ; lit Supabase et affiche le plan |

## `semer-inventaire.ts`

Peuple le stock initial par **réceptions valorisées** (`purchase`) : pour
chaque ligne `product_inventory`, une entrée valorisée par le `cost` Supabase
(arrondi entier XOF) qui pose la quantité **et fige le CMP** (`avg_cost`). La
correspondance produit se fait par **SKU** (`sku → variante « Standard »`).
Les réceptions sont **découpées en lots de ≤ `--taille-lot`** (limite batch D1).

- Ligne dont le SKU n'existe pas en cible (produit non importé) → **ignorée et
  rapportée**, jamais bloquante.
- **Reprenable** : `data/inventaire-*.json` = nombre de lots validés par
  entrepôt ; une relance saute les lots déjà passés.
- En `--dry-run` : sans identifiants, affiche un plan brut (lignes/quantités
  par magasin) ; avec identifiants, résout les variantes et détaille les lots.

| Option | Défaut | Description |
|---|---|---|
| `--api-url` | `http://localhost:8787` | Base URL de l'API cible |
| `--web-origin` | `http://localhost:3000` | Origin frontend attendu (trustedOrigins) |
| `--journal-magasins` | `data/magasins-local.json` | Journal produit par `creer-magasins.ts` (lecture) |
| `--journal` | `data/inventaire-local.json` | Journal de reprise des lots validés |
| `--supabase-workdir` | racine worktree | Dossier de résolution du lien Supabase |
| `--taille-lot` | `100` | Nombre de lignes max par réception |
| `--dry-run` | `false` | Aucune écriture API |

## Validation locale (2026-07-19)

Sur la D1 locale (catalogue des 720 produits déjà importé) : 3 magasins + 1
fournisseur créés ; niveaux de stock **Quincaillerie 691**, **Symotocycle 15**,
**Electronics 0** (= 745 lignes d'inventaire Supabase − 39 SKU absents du
catalogue). Quantités et CMP (`avg_cost = round(cost)`) vérifiés valeur par
valeur contre Supabase, y compris des coûts décimaux (200,35→200 ; 3,50→4).
Relance = 0 nouvelle réception (idempotence confirmée).
