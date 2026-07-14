# CLAUDE.md

Application de gestion de stock multi-entrepôts avec point de vente (POS) intégré, en français, pour une seule entreprise mais architecturée pour évoluer en SaaS multi-tenant (isolation par `organizationId` partout). **La v1 est complète** (7 phases, voir la roadmap) et en production.

- Spec de référence : `docs/superpowers/specs/2026-07-08-pos-stocks-design.md`
- Roadmap et plans de phase : `docs/superpowers/plans/`
- Journal d'exécution détaillé (décisions, arbitrages, différés) : `.superpowers/sdd/progress.md`
- Différés post-v1 : issue GitHub #10
- Prod : API `https://pos-stocks-api.koffiz2110.workers.dev`, SPA `https://pos-stocks-web.koffiz2110.workers.dev`, D1 `pos-stocks-db`

## Structure

Monorepo **bun workspaces**, déployé en 2 Workers Cloudflare distincts :

- `apps/api` — Hono 4 + Better Auth 1.6 (plugin organization) + Drizzle ORM + D1 + R2. Tests d'intégration sur **D1 réelle** via `@cloudflare/vitest-pool-workers`.
- `apps/web` — SPA React 19 + Vite + TanStack Router (file-based) + TanStack Query + shadcn (base-mira sur `@base-ui/react`) + Tailwind 4. Tests Testing Library + jsdom.
- `packages/shared` — schémas Zod et types partagés. **Exports NOMMÉS uniquement** dans `src/index.ts` (jamais `export *`).

## Commandes

```bash
bun install                                # racine
bun run --cwd apps/api dev                 # API locale (wrangler)
bun run --cwd apps/web dev                 # SPA locale (vite)
bun run --cwd apps/api test                # tests API (D1 réelle) ; ciblé : bun run test -- <fichier>
bun run --cwd apps/web test                # tests web
bun run typecheck                          # tsc sur les 3 workspaces
bun run lint
bun run --cwd apps/web build               # régénère aussi routeTree.gen.ts
cd apps/api && bun run db:migrate:local    # migrations sur la D1 locale
cd apps/api && bunx drizzle-kit generate --name=…           # migration standard
cd apps/api && bunx drizzle-kit generate --custom --name=…  # migration custom (triggers/index)
```

CD : `deploy.yml` migre la D1 de prod puis déploie les deux Workers via `bunx wrangler` à chaque push sur `main`.

## Conventions

- **Langue** : UI, messages d'erreur et messages de commit (conventionnels) en **français** ; **commentaires de code et JSDoc/docstrings en anglais** ; prose de `docs/superpowers/` en français. Politique appliquée par `.coderabbit.yaml`. (Historique : des commentaires antérieurs sont encore en français — migration au fil de l'eau, pas de traduction de masse.)
- Enveloppe d'erreur API : `{ code: "MAJUSCULES", message: "français", details? }`. Réutiliser les codes existants avant d'en créer.
- Montants en **entiers XOF** (0 décimale) ; formatage web via `formaterMontant` (`apps/web/src/lib/format.ts`).
- IDs texte (`crypto.randomUUID()`), horodatages UTC, toutes les tables métier portent `organizationId`.
- Ressource hors organisation → `404 INTROUVABLE` ; hors portée/rôle → `403 ACCES_REFUSE`. Garde cross-tenant AVANT tout bypass de rôle.
- Hooks husky actifs : pre-commit (lint-staged + typecheck), pre-push (suites complètes). **Jamais `--no-verify`.**
- Fichiers GÉNÉRÉS, ne jamais éditer à la main : `apps/api/src/db/schema/auth.ts` (CLI Better Auth), `apps/web/src/routeTree.gen.ts` (build Vite).
- Pièges eslint du dépôt : `no-unnecessary-condition` (annoter `| null` les retours de lookups — `noUncheckedIndexedAccess` est désactivé), types dans un `import type` séparé, `no-irregular-whitespace`. Dialog base-ui : `<DialogTrigger render={…}>`, jamais `asChild`.

## Invariants d'architecture (NE PAS CONTOURNER)

1. **`stockService.applyMovements` (`apps/api/src/services/stock.ts`) est le SEUL point d'écriture de `stock_movements`/`stock_levels`** (exceptions documentées : `definirSeuil`, `reconcilier`). Toute opération métier = UN `db.batch()` : l'appelant passe ses insertions (vente, lignes, gels…) via `instructionsAvant`.
2. **Jamais `db.run(sql)` dans un batch D1** (drizzle : `SQLiteRaw` sans `.stmt` casse `batch()`, vérifié empiriquement). Pour du SQL calculé dans un batch : expressions `sql` dans `.values()`/`.set()`, ou `db.insert().select()` avec champs aliasés `.as()`.
3. **Pas de lecture-puis-écriture pour les compteurs, gels et coûts** : numéro de ticket (`MAX+1`), attendu de fermeture de caisse, CMP figé (expédition de transfert, `sale_items.unit_cost`) sont calculés par **sous-requête SQL DANS le batch**.
4. **Défense en profondeur SQL** : chaque hypothèse lue en JS a son garde transactionnel (triggers `RAISE(ABORT, 'CODE')`, index uniques/partiels, CHECK). Les triggers/index custom vivent dans des **migrations custom HORS snapshots** drizzle-kit (`IF NOT EXISTS` partout) ; l'évolution d'un trigger = `DROP` + `CREATE` dans une **NOUVELLE** migration. Jamais éditer une migration appliquée.
5. La garde anti-stock-négatif est le `CHECK (quantity >= 0)` — un `UPDATE … WHERE` à 0 ligne n'annule PAS un batch D1. L'upsert de niveau se fait en **2 statements** (INSERT neutre ON CONFLICT DO NOTHING + UPDATE relatif) car SQLite évalue le CHECK sur la ligne brute AVANT résolution du conflit.
6. Discrimination des erreurs SQLite (`apps/api/src/lib/db-errors.ts`) : `estViolationUnicite(err, fragment)` matche les **COLONNES** (« warehouses.name »), jamais le nom d'index ; `estErreurDeclencheur(err, code)` est ancré sur `<code>: SQLITE_CONSTRAINT`. Toute erreur non reconnue est **rethrow** inchangée.
7. **Permissions à deux niveaux** (matrice spec §4) : rôle d'entreprise (owner/admin/auditor/stock_manager/staff) puis rôle d'entrepôt (manager/auditor/cashier). Helpers : `verifierAccesEntrepot`, `porteeLectureStock`/`estDansPortee`/`filtrePortee` (`lib/stock-acces.ts`), `verifierAccesVente` (`lib/pos-acces.ts`), `porteeRapport` (`lib/reports-acces.ts`). Le front masque, **l'API fait autorité**.
8. La vente ne touche jamais le CMP (`TYPES_APPORT_VALORISE` = purchase + transfer_in uniquement) ; le FEFO dérive les quantités par lot du journal (aucune matérialisation) avec le trigger `LOT_INSUFFISANT` en garde transactionnelle.

## Pièges vérifiés empiriquement

- `apps/api/vitest.config.ts` est **INTOUCHABLE** : le pool workers démarre un processus workerd PAR FICHIER de test — à ~50 fichiers, les runners GitHub saturent (« Network connection lost » en rafale). D'où `singleWorker: Boolean(process.env.CI)` + `retry: CI ? 2 : 0` + `testTimeout: 20000`.
- `Response.text()` **strippe le BOM** (spec WHATWG) : toute assertion sur le BOM d'un CSV passe par `arrayBuffer()`.
- Dédup de données avant pose d'un index unique : dans la même migration, via CTE `AS MATERIALIZED` + `ROW_NUMBER()` — jamais de sous-requête corrélée (elle relit la table en cours d'UPDATE et casse à 3+ doublons).
- Le ticket 80 mm s'imprime via `createPortal(document.body)` — un ancêtre `print:hidden` rendrait la page blanche, aucune classe descendante ne peut le réafficher.
- Testing Library + montants `fr-FR` : espaces insécables étroites (U+202F) — utiliser les helpers regex existants (`texteMontant`) plutôt que `getByText(formaterMontant(x))`.

## Tests

- API : D1 réelle, helpers dans `apps/api/test/helpers.ts` (`bootstrapOwner`, `createUserWithRole`, `creerEntrepot`, `affecterEntrepot`, `creerProduitSimple`) ; seed de stock via `applyMovements` direct ; corps typés `res.json<T>()` sans cast `as`. Les migrations sont appliquées par `test/apply-migrations.ts`.
- Valeurs attendues **recalculables à la main** (CMP, marges, agrégats) — jamais d'assertion dérivée de la sortie de l'implémentation.
- Comptes dev locaux : owner@exemple.com / OwnerLocal!2026 ; caissier sur « Boutique Centre » / Caissier!2026.

## Process de développement

Chaque évolution significative suit le cycle établi : brainstorming/cadrage → amendement de la spec → plan détaillé (`docs/superpowers/plans/`) → exécution par subagents avec revue par tâche → E2E navigateur → revue finale de branche + vague de fix unique → PR avec revue CodeRabbit (corriger le fondé, écarter en citant les différés tracés au ledger) → **merge uniquement sur feu vert explicite de l'utilisateur** (merge commit, pas de squash). Jamais de secret commité (`.dev.vars` est gitignoré, seul `.dev.vars.example` est versionné).

## Contexte design (Impeccable)

Le contexte design de la SPA vit dans `apps/web/` : `PRODUCT.md` (stratégie — register `product`, plateforme `web`) et `DESIGN.md` (système visuel — tokens, typo, composants). Config du mode live pré-remplie dans `apps/web/.impeccable/live/config.json`.

- **Positionnement** : *l'exactitude vérifiable* — chaque mouvement et chaque montant sont traçables et réconciliables.
- **Personnalité** : précis, efficace, fiable ; ressenti *rapide et sans friction*, en tension avec la rigueur d'audit.
- **Principes** : le chiffre est sacré · vite sans bâcler · tout se lit, tout se prouve · familiarité gagnante · la densité au service du métier.
- **Anti-références** : ERP obèse (SAP/Sage), POS grand public ludique, template admin générique, clinquant marketing.

Pour faire évoluer une interface, passer par le skill `/impeccable` (les commandes lisent `PRODUCT.md` et `DESIGN.md`).
