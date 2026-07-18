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
