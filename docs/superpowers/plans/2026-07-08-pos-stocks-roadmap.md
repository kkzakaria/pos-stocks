# Roadmap d'implémentation — pos-stocks

> Document maître de suivi. Chaque phase a (ou aura) son propre plan détaillé dans `docs/superpowers/plans/`. Le plan d'une phase est rédigé juste avant son exécution, pour bénéficier de ce qui a été appris dans les phases précédentes. Cocher les cases au fil de l'avancement.

**Spec de référence** : `docs/superpowers/specs/2026-07-08-pos-stocks-design.md`

## Suivi global

| Phase | Contenu | Plan détaillé | Statut |
|---|---|---|---|
| 1 | Fondations : monorepo, API Hono + D1 + Drizzle, Better Auth + organisation, login, CI | `2026-07-08-phase-1-fondations.md` | ✅ terminée (2026-07-08, PR #1) |
| 2 | Administration : entrepôts, utilisateurs, affectations, middleware de permissions complet | `2026-07-09-phase-2-administration.md` | ✅ terminée (2026-07-10, PR #3 mergée) |
| 3 | Catalogue : catégories, fournisseurs, produits, variantes, images R2, lots | `2026-07-10-phase-3-catalogue.md` | ✅ terminée (2026-07-10, PR #4 mergée) |
| 4 | Moteur de stock : journal + niveaux, service atomique, réceptions, ajustements, alertes | `2026-07-10-phase-4-moteur-de-stock.md` | ✅ terminée (2026-07-11, PR #5 mergée) |
| 5 | Transferts inter-entrepôts et inventaires physiques | `2026-07-11-phase-5-transferts-inventaires.md` | ✅ terminée (2026-07-12, PR #6 mergée) |
| 6 | POS : sessions de caisse, vente atomique, paiements, ticket 80 mm, FEFO, dépannage — **mini-brainstorming UI avant le plan** | à rédiger | — |
| 7 | Rapports, tableau de bord, finitions (valorisation, marges, alertes visibles) | à rédiger | — |

## Détail des phases

### Phase 1 — Fondations
- [x] Monorepo bun workspaces (`apps/api`, `apps/web`, `packages/shared`)
- [x] Worker API : Hono, D1, Drizzle, tests `vitest-pool-workers`
- [x] Better Auth (adapter Drizzle/D1, plugin organization, inscription publique bloquée)
- [x] Bootstrap organisation + compte owner (route protégée par jeton)
- [x] Middleware de session + route `/api/v1/me`
- [x] Front : page de connexion, garde de routes, shell back-office minimal
- [x] CI GitHub Actions + premier déploiement des deux Workers

Notes de fin de phase : API `https://pos-stocks-api.koffiz2110.workers.dev`, SPA `https://pos-stocks-web.koffiz2110.workers.dev` ; connexion validée en production au niveau API (cookie SameSite=Lax partagé — les deux hôtes sont same-site sous `koffiz2110.workers.dev`). CD GitHub : `CLOUDFLARE_ACCOUNT_ID` et `VITE_API_URL` posés ; **reste à créer manuellement** un token API Cloudflare (modèle « Edit Cloudflare Workers » + D1) et `gh secret set CLOUDFLARE_API_TOKEN`.

**Livrable** : application déployée où l'on peut se connecter et voir un back-office vide.

### Phase 2 — Administration
- [ ] Reprise Phase 1 (partiel — reste : évaluer défaut SQL updatedAt à la régénération du schéma, voir P2-T2) : ~~étape de migration D1 dans deploy.yml~~ (✅ fait le 2026-07-09, avec bascule wrangler-action → bunx wrangler), ~~message français sur `CREATION_UTILISATEUR`~~ (✅ 2026-07-09), ~~suppression de `--passWithNoTests`~~ (✅ 2026-07-09), dépendances web inutilisées **conservées volontairement** : les composants shadcn/ui ajoutés en Phase 2 requièrent `@base-ui/react`, `class-variance-authority`, `clsx`, `tailwind-merge` (et `lucide-react` est utilisé depuis la refonte login), ~~redirection /login si déjà connecté~~ et ~~`role="alert"` sur l'erreur de connexion~~ (✅ 2026-07-09, refonte UI login), drop de l'index dupliqué `organization_slug_uidx` **non traité volontairement** : le schéma est régénéré par la CLI Better Auth qui ré-émettrait l'index à chaque régénération (drift schéma/DB) ; quirk upstream accepté, sans impact fonctionnel, ~~`COOKIE_DOMAIN` documenté dans .dev.vars.example~~ (✅ 2026-07-09), évaluer un défaut SQL pour session/account.updatedAt lors de la prochaine régénération du schéma Better Auth
- [x] CRUD entrepôts/boutiques (`warehouses`)
- [x] Création de comptes par l'admin, rôles d'entreprise (owner, admin, auditor, stock_manager, staff)
- [x] Affectations aux entrepôts (`warehouse_members` : manager, auditor, cashier)
- [x] Middleware de permissions à deux niveaux (rôle entreprise + rôle entrepôt) — matrice de la spec §4
- [x] Écrans d'administration (entrepôts, utilisateurs, affectations, paramètres devise/ticket)

**Livrable** : l'admin gère entrepôts et équipe ; chaque rôle ne voit que ce qu'il doit.

### Phase 3 — Catalogue
- [x] Catégories (hiérarchie simple), fournisseurs
- [x] Produits + variante implicite unique ; variantes explicites (attributs, sku, code-barres, prix)
- [x] Upload d'images vers R2 + route de service avec contrôle d'accès
- [x] Lots (activables par produit via `trackLots`)
- [x] Écrans catalogue (liste, fiche produit, recherche, code-barres)

**Livrable** : catalogue complet consultable et administrable.

### Phase 4 — Moteur de stock
- [x] `stock_movements` (journal append-only) + `stock_levels` (matérialisé)
- [x] `stockService.applyMovements` : batch D1 atomique, garde anti-stock-négatif
- [x] Réceptions fournisseur (draft → received, coûts, création de lots)
- [x] Ajustements manuels tracés
- [x] Alertes stock bas (seuil produit surchargeable par entrepôt)
- [x] Commande de réconciliation journal → niveaux
- [x] Écrans stock (niveaux par entrepôt, journal filtrable, réceptions)

**Livrable** : le stock entre, se consulte et s'audite ; les invariants tiennent sous concurrence.

### Phase 5 — Transferts & inventaires
- [x] Transferts (pending → sent → received, annulation, écarts de réception)
- [x] Stock en transit visible
- [x] Inventaires (ouverture avec quantités figées, comptages, clôture → ajustements)
- [x] Écrans transferts et inventaires

**Livrable** : les mouvements inter-entrepôts et les comptages sont opérationnels.

### Phase 6 — Point de vente
- [x] Mini-brainstorming UI POS (écran de vente, ergonomie tactile/scanner) avant le plan
- [x] Sessions de caisse (ouverture/fond, fermeture/écart)
- [x] Vente atomique (batch : vente + lignes + paiements + mouvements + niveaux), idempotence client
- [x] Paiements cash (rendu de monnaie) et mobile money (référence), paiement mixte
- [x] FEFO pour les produits à péremption
- [x] Dépannage depuis un autre entrepôt (`sourceWarehouseId`)
- [x] Ticket 80 mm (impression navigateur), numérotation séquentielle par boutique
- [x] Écran POS plein écran + historique des tickets du jour + réimpression

**Livrable** : une boutique vend réellement, tickets imprimés, caisse clôturée.

### Phase 7 — Rapports & finitions
- [ ] Rapports ventes (période, boutique, produit), valorisation du stock, marges
- [ ] Tableau de bord (ventes du jour, alertes, transferts en attente)
- [ ] Revue transverse : permissions, messages d'erreur français, performances D1

**Livrable** : v1 complète conforme à la spec.
