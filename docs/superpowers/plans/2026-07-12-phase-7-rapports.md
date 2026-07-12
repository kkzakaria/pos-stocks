# Phase 7 — Rapports, tableau de bord, finitions : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clore la v1 (dernière phase de la roadmap) : coût figé sur les lignes de vente (`sale_items.unitCost`, CMP gelé par sous-requête SQL dans le batch de vente), trois rapports agrégés en SQL (`/api/v1/reports/sales`, `/valuation`, `/margins`) avec exports CSV français, tableau de bord sur la page d'accueil (4 blocs cliquables selon les droits), section back-office « Ventes » (historique multi-jours paginé, détail avec marge, écran Rapports à 3 onglets) — après avoir soldé en tête les différés nommés de la revue finale Phase 6.

**Architecture:** Aucune écriture de stock nouvelle : la Phase 7 LIT. La seule écriture ajoutée est la colonne `sale_items.unit_cost` (migration 0015, simple ALTER standard), posée par sous-requête SQL DANS l'INSERT des lignes du batch de vente existant (routes/sales.ts, motif du gel CMP à l'expédition des transferts). Les rapports sont des agrégats SQL (`GROUP BY`) sur `sales`/`sale_items`/`payments`/`stock_levels`, bornés par les dates UTC du motif existant (`dateCalendaireValide` + `gte`/`lt` borne exclusive) et scopés par un nouveau helper `porteeRapport` composé sur `porteeLectureStock` (matrice §4, ligne « Rapports » : stock_manager = valorisation SEULEMENT). Le CSV est une variante `?format=csv` de chaque route (mêmes gardes, mêmes agrégats), généré par un module pur (`lib/csv.ts` : BOM UTF-8, `;`, RFC 4180). Côté front, toute la logique pure (fetchers typés, presets de période, visibilité des blocs, boutiques lisibles) vit dans `apps/web/src/lib/rapports.ts` testé unitairement ; le composant de rapport le plus riche (`RapportVentes`) est couvert en Testing Library.

**Tech Stack:** existant (Hono 4, Better Auth, Drizzle ORM 0.44 / drizzle-kit 0.31, D1, vitest-pool-workers 0.12, React 19/Vite/TanStack Router + Query, shadcn base-mira, Tailwind 4, Testing Library + jsdom). **Aucune dépendance nouvelle.**

## Global Constraints

- Interface, messages d'erreur et commentaires en **français** ; enveloppe d'erreur `{ code: "MAJUSCULES", message: "français", details? }`. **Aucun nouveau code d'erreur en Phase 7** — réutilisés : `VALIDATION` (400), `ACCES_REFUSE` (403), `INTROUVABLE` (404).
- **Aucune écriture de stock nouvelle.** Le gel du coût (`sale_items.unit_cost`) se fait par **sous-requête SQL DANS le batch existant** de la vente (`tenterVente`, routes/sales.ts) — JAMAIS de lecture JS puis écriture, JAMAIS d'écriture directe `stock_levels`/`stock_movements` hors `applyMovements`. **JAMAIS `db.run(sql)` dans un batch D1** (drizzle 0.44 : `SQLiteRaw` sans `.stmt` casse `batch()`, vérifié en P5).
- Triggers/index custom = migration custom **HORS snapshots** drizzle-kit. La migration **0015 est STANDARD** (`bunx drizzle-kit generate --name=…`, simple `ALTER TABLE`, motif 0011) : pas de trigger, **pas d'index** sur `unit_cost` (jamais un critère de filtre — les rapports lisent les lignes par `sale_id`, déjà indexé `sale_items_sale_idx`, et agrègent). Jamais éditer une migration appliquée.
- Montants en **entiers XOF** (0 décimale), formatés côté web via `formaterMontant` (`apps/web/src/lib/format.ts`). IDs texte `crypto.randomUUID()` ; horodatages UTC ; toutes les tables métier portent `organizationId` ; ressource hors organisation → `404 INTROUVABLE` ; hors portée → `403 ACCES_REFUSE`.
- **Bornes de dates** : toute date de requête est validée par `dateCalendaireValide` (`apps/api/src/lib/dates.ts`) ; les bornes sont UTC, `gte(createdAt, debut)` + `lt(createdAt, finExclue)` avec fin EXCLUSIVE au lendemain (motif exact de routes/sales.ts GET `/` et routes/stock.ts).
- **Rapports = agrégats SQL** (`GROUP BY`), pas de pagination de lignes brutes dans les rapports. Seul GET `/api/v1/sales` (liste de tickets) est paginé.
- **Matrice de permissions (spec §4), ligne « Rapports »** : owner/admin ✅ tous ; auditor org 👁 tous ; **stock_manager = rapport de valorisation SEULEMENT** (tous entrepôts — ni ventes ni marges) ; manager/auditor locaux = leurs entrepôts (via `porteeLectureStock`/`filtrePortee`) ; **cashier exclu (403)**. Le front masque, l'API fait autorité.
- **Exports NOMMÉS** dans `packages/shared/src/index.ts` (jamais `export *`) — Phase 7 n'ajoute d'ailleurs AUCUN schéma Zod partagé (rapports = query params validés à la main comme routes/stock.ts).
- **CSV** : UTF-8 avec BOM (`\uFEFF` — toujours l'échappement, jamais le caractère invisible littéral), séparateur `;`, fins de ligne CRLF, échappement RFC 4180 (guillemets doublés, champ quoté s'il contient `;`, `"`, `\n` ou `\r`), en-têtes en français, `Content-Disposition: attachment` avec nom de fichier daté.
- Tests API sur D1 réelle (`@cloudflare/vitest-pool-workers`), helpers de `apps/api/test/helpers.ts` (`bootstrapOwner`, `createUserWithRole`, `creerEntrepot`, `affecterEntrepot`, `creerProduitSimple`) ; corps typés `res.json<T>()` (pas de cast `as`) ; seed de stock via `applyMovements` direct (motif sales.test.ts). Les migrations sont appliquées automatiquement par `test/apply-migrations.ts`.
- **`apps/api/vitest.config.ts` est INTOUCHABLE** (singleWorker en CI — découverte majeure P6, un runtime workerd par fichier saturait les runners).
- Pièges eslint du dépôt : `no-unnecessary-condition` (annoter `| null` les retours de lookups ; `noUncheckedIndexedAccess` est désactivé — pas de `?.` sur un accès indexé), `import/consistent-type-specifier-style` (types dans un `import type` séparé), `no-irregular-whitespace`. `apps/web/src/routeTree.gen.ts` n'est **jamais** édité à la main (régénéré par `bun run dev`/`build` du web).
- Gestionnaire de paquets : **bun**. Commits fréquents, messages conventionnels en **français**, hooks husky actifs (**jamais `--no-verify`**).
- Branche de travail : `feat/phase-7-rapports` à créer depuis le tronc à jour avant la Task 1 (`git checkout master && git pull && git checkout -b feat/phase-7-rapports`).
- **État de départ vérifié** : Phase 6 mergée (PR #8, merge db943e6) ; suites 245 tests api + 55 tests web vertes ; migrations `0000`–`0014` appliquées ; prod saine.

**Décisions d'architecture prises par ce plan** (à reporter au ledger en fin de phase) :

1. **`sale_items.unitCost` nullable, gelé par sous-requête.** `unit_cost INTEGER` nullable (migration 0015 standard). Posé dans l'INSERT de CHAQUE ligne du batch de vente par `(SELECT avg_cost FROM stock_levels WHERE warehouse_id = <source> AND variant_id = <variante>)` — évalué DANS la transaction, même principe que le gel du CMP à l'expédition des transferts. La ligne `stock_levels` existe forcément pour une vente qui aboutit (le décrément du même batch échouerait sinon au CHECK) ; si elle manquait, la sous-requête rendrait NULL et le batch mourrait de toute façon. Les ventes antérieures à la colonne restent à NULL : les rapports les valorisent au CMP courant et les marquent `estime: true` (spec §3/§6). Pas d'index sur `unit_cost` (jamais filtré).
2. **Format des routes rapports : `?format=csv` sur la MÊME route** (pas de route dédiée) : une seule passe de validation/portée, le CSV sérialise exactement les lignes agrégées du JSON. Trois routes : `GET /api/v1/reports/sales`, `GET /api/v1/reports/valuation`, `GET /api/v1/reports/margins`.
3. **Portée : `porteeRapport(db, orgId, userId, role, rapport)`** (nouveau `lib/reports-acces.ts`), composé sur `porteeLectureStock` : pour `"ventes"`/`"marges"`, `stock_manager` est refusé AVANT (retour `null` → 403) ; pour les trois rapports, une portée staff VIDE (ex. caissier pur) → `null` → 403 (« cashier exclu », matrice §4). Sinon owner/admin/auditor → `{ tous: true }`, staff → ses entrepôts manager/auditor. Les conditions SQL passent par `filtrePortee`/`estDansPortee` existants.
4. **`/reports/sales` : `du`/`au` OBLIGATOIRES** (400 sinon) — les presets jour/semaine/mois sont calculés CÔTÉ FRONT en jours locaux (`periodePreset`, motif `jourLocal`) et envoyés comme `du`/`au` ; l'API ne connaît que la période. `groupe=boutique` (défaut) ou `produit`. La répartition espèces/mobile money n'existe qu'au niveau vente (table `payments`) : elle est fournie par boutique et en total global, PAS par produit.
5. **`/reports/margins`** : groupé par variante (période + `storeId` optionnel) ; `cout = SUM(quantity × COALESCE(unit_cost, avg_cost courant du niveau (source, variante), 0))` via LEFT JOIN `stock_levels` ; `marge = ca − cout` ; `estime: true` dès qu'AU MOINS une ligne agrégée avait `unit_cost` NULL.
6. **`/reports/valuation`** : photographie de `stock_levels` COURANT (pas de période) ; lignes `quantity > 0` seulement ; **produits inactifs INCLUS** (la valeur physique du stock ne disparaît pas quand on retire un produit du catalogue) ; réponse hiérarchique par entrepôt + total global (la valeur par ligne `quantity × avgCost` reste calculée en SQL).
7. **CSV — nom de fichier recalculé côté client.** Le serveur envoie `Content-Disposition: attachment; filename="…"`, mais le front (fetch + blob, cookie inclus) ne LIT PAS cet en-tête : cross-origine, il exigerait `Access-Control-Expose-Headers`. Le client recompose le même nom (`rapport-ventes-boutiques_<du>_<au>.csv`, `rapport-marges_<du>_<au>.csv`, `rapport-valorisation_<jour>.csv`) — zéro changement CORS.
8. **GET `/api/v1/sales` étendu, rétrocompatible** : `jour` (existant) OU `du`+`au` (ensemble), pagination `page` (défaut 1) / `parPage` (défaut 50, max 200), réponse `{ sales, total, page, parPage }` (la clé `sales` est conservée — les consommateurs POS existants continuent de lire `data.sales`). Remplace la limite fixe de 200 sans pagination (différé P6).
9. **Marge du détail de vente** : `GET /api/v1/sales/:id` répond désormais `{ sale, marge }` où `marge = { cout, marge, estime } | null` — `null` si l'appelant n'a pas le droit aux marges sur la boutique (droit = org owner/admin/auditor OU rôle local manager/auditor ; JAMAIS cashier ni stock_manager). Champ additif : les consommateurs POS existants (`{ sale }`) sont intacts.
10. **Tableau de bord — visibilité par fonction pure `blocsTableauDeBord(me)`** : ventes du jour (org owner/admin/auditor ou local manager/auditor), alertes + transferts (idem + stock_manager), valeur du stock (org + stock_manager). La spec §7 dit « valeur totale du stock pour owner/admin » ; la matrice §4 donne la valorisation à auditor et stock_manager — **tranché : le bloc suit la matrice** (le rapport sous-jacent leur est accessible de toute façon). Un utilisateur sans aucun bloc (caissier pur) voit un renvoi vers `/pos`.
11. **Anomalie cache React Query du catalogue POS** (E2E P6 : tuiles incomplètes après navigation répétée, invalidation seulement `onSuccess`) : la query catalogue passe en `refetchOnMount: "always"` (chaque retour sur l'écran de vente repart du serveur) + état `isError` avec « Réessayer » ; l'invalidation `onSuccess` est conservée.
12. **Reports DÉFINITIFS documentés (aucune tâche, à tracer au ledger)** : (a) le mapping route `CONFLIT_CONCURRENT`/`SESSION_FERMEE` de POST /sales reste non testé — séquentiellement inatteignable (les pré-checks intercepteraient : `SESSION_CAISSE_REQUISE` avant le batch ; `CONFLIT_CONCURRENT` exige DEUX `LOT_INSUFFISANT` consécutifs en course réelle), et le harnais vitest-pool-workers est mono-écrivain : un vrai harnais de concurrence est disproportionné en v1. (b) `gelsLignes` = N UPDATE par réception à N lignes (volumétrie, hérité 0008) : accepté v1, limite de taille de batch D1 documentée au ledger.

**Prérequis exécutant** : lire `apps/api/src/routes/sales.ts` (LE batch de vente et ses conventions), `apps/api/src/lib/stock-acces.ts` (`porteeLectureStock`/`estDansPortee`/`filtrePortee`), `apps/api/src/lib/dates.ts`, `apps/api/src/routes/stock.ts:300-365` (modèle de route de lecture scopée + `entrepotDansOrganisation`), `apps/web/src/lib/pos.ts` avant les Tasks 4-13.

---

### Task 1: Différés P6 — tests API de couverture

Quatre gaps de couverture nommés par la revue finale P6, regroupés dans UN nouveau fichier de test (aucun changement de code de production attendu — si un test révèle un écart, c'est un bug réel à corriger, pas un test à adapter) : matrice de lecture élargie des sessions de caisse, `lireLotsDisponibles` multi-entrepôts, variante inactive exclue du catalogue POS, CMP de destination épinglé sur un batch `transfer_in` multi-lignes.

**Files:**
- Create: `apps/api/test/differes-p6.test.ts`

**Interfaces:**
- Consumes: `app` (`apps/api/src/index.ts`), helpers `bootstrapOwner`/`createUserWithRole`/`creerEntrepot`/`affecterEntrepot`/`creerProduitSimple` (`apps/api/test/helpers.ts`), `applyMovements` (`apps/api/src/services/stock.ts`), `lireLotsDisponibles` (`apps/api/src/services/fefo.ts` — signature `(db, warehouseId, variantId) => Promise<Array<{ lotId: string; expiryDate: Date | null; disponible: number }>>`), routes existantes `GET/POST /api/v1/register-sessions`, `GET /api/v1/pos/catalogue`.
- Produces: rien de nouveau — couverture uniquement.

- [ ] **Step 1 : Créer la branche de phase**

```bash
git checkout master && git pull && git checkout -b feat/phase-7-rapports
```

- [ ] **Step 2 : Écrire les tests**

Créer `apps/api/test/differes-p6.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { and, eq } from "drizzle-orm"
import app from "../src/index"
import * as schema from "../src/db/schema"
import { applyMovements } from "../src/services/stock"
import { lireLotsDisponibles } from "../src/services/fefo"
import {
  affecterEntrepot,
  bootstrapOwner,
  createUserWithRole,
  creerEntrepot,
  creerProduitSimple,
} from "./helpers"

function req(cookie: string, method: string, url: string, body?: unknown) {
  return app.request(
    url,
    {
      method,
      headers: { "content-type": "application/json", cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env
  )
}

type Erreur = { code: string }
type Sessions = { sessions: Array<{ id: string; cashierId: string }> }

// Deux sessions OUVERTES par deux caissiers différents sur la même boutique
// (l'index unique partiel 0014 est par (boutique, caissier) : compatible).
async function seedSessions() {
  const { organizationId, ownerCookie } = await bootstrapOwner()
  const storeId = await creerEntrepot(organizationId, "Boutique S", "store")
  const caissierA = await createUserWithRole(organizationId, "staff")
  const caissierB = await createUserWithRole(organizationId, "staff")
  await affecterEntrepot(organizationId, caissierA.userId, storeId, "cashier")
  await affecterEntrepot(organizationId, caissierB.userId, storeId, "cashier")
  for (const caissier of [caissierA, caissierB]) {
    const res = await req(caissier.cookie, "POST", "/api/v1/register-sessions", {
      storeId,
      openingFloat: 1000,
    })
    expect(res.status).toBe(201)
  }
  return { organizationId, ownerCookie, storeId, caissierA, caissierB }
}

describe("lecture élargie des sessions de caisse (matrice §4, différé P6)", () => {
  it("auditor org : POST refusé (403) mais GET / voit TOUTES les sessions", async () => {
    const { organizationId, storeId } = await seedSessions()
    const auditor = await createUserWithRole(organizationId, "auditor")
    const refus = await req(auditor.cookie, "POST", "/api/v1/register-sessions", {
      storeId,
      openingFloat: 0,
    })
    expect(refus.status).toBe(403)
    expect((await refus.json<Erreur>()).code).toBe("ACCES_REFUSE")
    const lecture = await req(
      auditor.cookie,
      "GET",
      `/api/v1/register-sessions?storeId=${storeId}`
    )
    expect(lecture.status).toBe(200)
    expect((await lecture.json<Sessions>()).sessions).toHaveLength(2)
  })

  it("manager local : voit toutes les sessions de SA boutique", async () => {
    const { organizationId, storeId } = await seedSessions()
    const manager = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, manager.userId, storeId, "manager")
    const res = await req(
      manager.cookie,
      "GET",
      `/api/v1/register-sessions?storeId=${storeId}`
    )
    expect(res.status).toBe(200)
    expect((await res.json<Sessions>()).sessions).toHaveLength(2)
  })

  it("auditor local : POST refusé mais GET / voit toutes les sessions de la boutique", async () => {
    const { organizationId, storeId } = await seedSessions()
    const auditorLocal = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, auditorLocal.userId, storeId, "auditor")
    const refus = await req(
      auditorLocal.cookie,
      "POST",
      "/api/v1/register-sessions",
      { storeId, openingFloat: 0 }
    )
    expect(refus.status).toBe(403)
    const lecture = await req(
      auditorLocal.cookie,
      "GET",
      `/api/v1/register-sessions?storeId=${storeId}`
    )
    expect(lecture.status).toBe(200)
    expect((await lecture.json<Sessions>()).sessions).toHaveLength(2)
  })

  it("un caissier ne voit que LES SIENNES", async () => {
    const { storeId, caissierA } = await seedSessions()
    const res = await req(
      caissierA.cookie,
      "GET",
      `/api/v1/register-sessions?storeId=${storeId}`
    )
    expect(res.status).toBe(200)
    const { sessions } = await res.json<Sessions>()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].cashierId).toBe(caissierA.userId)
  })
})

describe("lireLotsDisponibles — multi-entrepôts (différé P6)", () => {
  it("ne compte que les mouvements de l'entrepôt demandé", async () => {
    const { organizationId, ownerId } = await bootstrapOwner()
    const depot1 = await creerEntrepot(organizationId, "Dépôt 1")
    const depot2 = await creerEntrepot(organizationId, "Dépôt 2")
    const { variantId } = await creerProduitSimple(organizationId, {
      trackLots: true,
    })
    const db = drizzle(env.DB, { schema })
    const lotId = crypto.randomUUID()
    await db.insert(schema.lots).values({
      id: lotId,
      organizationId,
      variantId,
      lotNumber: "LOT-MULTI",
      expiryDate: new Date("2027-01-01T00:00:00.000Z"),
      createdAt: new Date(),
    })
    // Le MÊME lot (global à la variante) entre dans deux entrepôts avec des
    // quantités différentes — la somme par lot doit être scopée entrepôt.
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId: depot1, variantId, lotId, delta: 7, type: "purchase", unitCost: 100 },
        { warehouseId: depot2, variantId, lotId, delta: 5, type: "purchase", unitCost: 100 },
      ],
    })
    const lots1 = await lireLotsDisponibles(db, depot1, variantId)
    expect(lots1).toEqual([
      {
        lotId,
        expiryDate: new Date("2027-01-01T00:00:00.000Z"),
        disponible: 7,
      },
    ])
    const lots2 = await lireLotsDisponibles(db, depot2, variantId)
    expect(lots2).toHaveLength(1)
    expect(lots2[0].disponible).toBe(5)
  })
})

describe("catalogue POS — variante inactive (différé P6)", () => {
  it("exclut une variante inactive d'un produit actif", async () => {
    const { organizationId } = await bootstrapOwner()
    const storeId = await creerEntrepot(organizationId, "Boutique V", "store")
    const caissier = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, caissier.userId, storeId, "cashier")
    const { productId, variantId } = await creerProduitSimple(organizationId, {
      nom: "Produit VI",
    })
    const db = drizzle(env.DB, { schema })
    const varianteInactiveId = crypto.randomUUID()
    await db.insert(schema.productVariants).values({
      id: varianteInactiveId,
      organizationId,
      productId,
      name: "Grand",
      attributes: '{"taille":"G"}',
      sku: `TST-${productId.slice(0, 8)}-G`,
      isActive: false,
      createdAt: new Date(),
    })
    const res = await req(
      caissier.cookie,
      "GET",
      `/api/v1/pos/catalogue?storeId=${storeId}`
    )
    expect(res.status).toBe(200)
    const { articles } = await res.json<{
      articles: Array<{ variantId: string }>
    }>()
    const ids = articles.map((a) => a.variantId)
    expect(ids).toContain(variantId)
    expect(ids).not.toContain(varianteInactiveId)
  })
})

describe("CMP destination — batch transfer_in multi-lignes (différé P6)", () => {
  async function lireNiveau(warehouseId: string, variantId: string) {
    const db = drizzle(env.DB, { schema })
    const rows = await db
      .select({
        quantity: schema.stockLevels.quantity,
        avgCost: schema.stockLevels.avgCost,
      })
      .from(schema.stockLevels)
      .where(
        and(
          eq(schema.stockLevels.warehouseId, warehouseId),
          eq(schema.stockLevels.variantId, variantId)
        )
      )
      .limit(1)
    return rows[0] ?? null
  }

  it("pose le CMP de CHAQUE variante à destination dans UN batch", async () => {
    const { organizationId, ownerId } = await bootstrapOwner()
    const destination = await creerEntrepot(organizationId, "Destination M")
    const p1 = await creerProduitSimple(organizationId, { nom: "Var M1" })
    const p2 = await creerProduitSimple(organizationId, { nom: "Var M2" })
    const db = drizzle(env.DB, { schema })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId: destination, variantId: p1.variantId, delta: 10, type: "transfer_in", unitCost: 120 },
        { warehouseId: destination, variantId: p2.variantId, delta: 4, type: "transfer_in", unitCost: 350 },
      ],
    })
    expect(await lireNiveau(destination, p1.variantId)).toEqual({
      quantity: 10,
      avgCost: 120,
    })
    expect(await lireNiveau(destination, p2.variantId)).toEqual({
      quantity: 4,
      avgCost: 350,
    })
  })

  it("absorbe un transfer_in dans un CMP destination PRÉEXISTANT", async () => {
    const { organizationId, ownerId } = await bootstrapOwner()
    const destination = await creerEntrepot(organizationId, "Destination A")
    const { variantId } = await creerProduitSimple(organizationId, {
      nom: "Var A",
    })
    const db = drizzle(env.DB, { schema })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId: destination, variantId, delta: 10, type: "purchase", unitCost: 100 },
      ],
    })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId: destination, variantId, delta: 10, type: "transfer_in", unitCost: 300 },
      ],
    })
    // (10×100 + 10×300) / 20 = 200
    expect(await lireNiveau(destination, variantId)).toEqual({
      quantity: 20,
      avgCost: 200,
    })
  })
})
```

- [ ] **Step 3 : Exécuter — les tests doivent PASSER**

Run: `cd apps/api && bunx vitest run test/differes-p6.test.ts`
Expected: **PASS 8/8** — ce sont des tests de couverture sur du code existant. Un échec révèle un bug réel : le corriger (et le documenter au ledger), ne JAMAIS adapter l'assertion au comportement bogué.

- [ ] **Step 4 : Suite api complète**

Run: `cd apps/api && bun run test`
Expected: 253 tests verts (245 + 8).

- [ ] **Step 5 : Commit**

```bash
git add apps/api/test/differes-p6.test.ts
git commit -m "test: couverture différée P6 (sessions élargies, lots multi-entrepôts, variante inactive, CMP multi-lignes)"
```

---

### Task 2: Différés P6 — front POS : type `MeLike` dérivé et états d'erreur

Solde les différés front nommés : `MeLike` local recopié → dérivé des types partagés (anti-drift) ; `apiFetch` des destinations dans `beforeLoad` sans try/catch → déplacé en composant avec écran d'erreur + Réessayer ; `session.isError` qui dégradait silencieusement en « Ouvrir la caisse » → écran d'erreur explicite ; catalogue POS sans `isError` + anomalie de cache (tuiles incomplètes après navigation, décision 11) → `refetchOnMount: "always"` + état d'erreur ; `TicketsDuJour` sans `isError` → message + Réessayer.

**Files:**
- Modify: `apps/web/src/lib/pos.ts` (type `MeLike`, exporté)
- Modify: `apps/web/src/lib/pos.test.ts` (factory `me` typée)
- Modify: `apps/web/src/routes/pos.tsx` (réécriture : destinations en `useQuery`, écrans d'erreur)
- Modify: `apps/web/src/pos/ecran-vente.tsx` (catalogue `isError` + `refetchOnMount`)
- Modify: `apps/web/src/pos/tickets-du-jour.tsx` (`ventes.isError`)
- Test: `apps/web/src/pos/ecran-vente.test.tsx`, `apps/web/src/pos/tickets-du-jour.test.tsx` (ajouts)

**Interfaces:**
- Consumes: `Me` (`apps/web/src/lib/me.ts`), `CompanyRole`/`WarehouseRole` (`shared`), `boutiquesVendables`/`estCaissierPur` (`apps/web/src/lib/pos.ts`), `fetchSessionCourante`/`fetchCataloguePos`/`fetchVentesDuJour` (`apps/web/src/lib/pos-api.ts`).
- Produces: `export type MeLike = { membership: { role: CompanyRole } | null; assignments: Array<{ warehouseId: string; warehouseName: string; role: WarehouseRole }> }` dans `apps/web/src/lib/pos.ts` — **consommé par la Task 10** (`blocsTableauDeBord`, `boutiquesLisibles`).

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à la FIN de `apps/web/src/pos/ecran-vente.test.tsx` (le helper `renderEcran` et la fixture `article` sont top-level dans ce fichier — réutilisables) :

```tsx
describe("EcranVente — erreur de catalogue (différé P6)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("affiche l'erreur et un bouton Réessayer qui recharge le catalogue", async () => {
    const spy = vi
      .spyOn(posApi, "fetchCataloguePos")
      .mockRejectedValue(new Error("réseau"))
    vi.spyOn(posApi, "fetchReglagesTicket").mockResolvedValue({
      name: "Org",
      currency: "XOF",
      receiptHeader: "",
      receiptFooter: "",
    })
    renderEcran()
    await screen.findByText("Impossible de charger le catalogue.")
    spy.mockResolvedValue({ categories: [], articles: [article] })
    fireEvent.click(screen.getByRole("button", { name: /réessayer/i }))
    await screen.findByText("Coca 50cl")
  })
})
```

Ajouter à la FIN de `apps/web/src/pos/tickets-du-jour.test.tsx` (le helper `rendre` et la fixture `vente` sont top-level) :

```tsx
describe("TicketsDuJour — erreur de chargement (différé P6)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("affiche une erreur et Réessayer quand la liste échoue", async () => {
    const spy = vi
      .spyOn(posApi, "fetchVentesDuJour")
      .mockRejectedValue(new Error("réseau"))
    rendre()
    await screen.findByText("Impossible de charger les tickets du jour.")
    spy.mockResolvedValue({ sales: [vente] })
    fireEvent.click(screen.getByRole("button", { name: /réessayer/i }))
    await screen.findByText(/N° 1/)
  })
})
```

- [ ] **Step 2 : Vérifier que les tests échouent**

Run: `cd apps/web && bunx vitest run src/pos/ecran-vente.test.tsx src/pos/tickets-du-jour.test.tsx`
Expected: FAIL — « Impossible de charger le catalogue. » / « Impossible de charger les tickets du jour. » introuvables (aucun état d'erreur rendu aujourd'hui).

- [ ] **Step 3 : Dériver `MeLike` des types partagés**

Dans `apps/web/src/lib/pos.ts`, ajouter en tête d'imports :

```ts
import type { CompanyRole, WarehouseRole } from "shared"
```

Remplacer le bloc :

```ts
type MeLike = {
  membership: { role: string } | null
  assignments: Array<{
    warehouseId: string
    warehouseName: string
    role: string
  }>
}
```

par :

```ts
// Sous-ensemble de Me (lib/me.ts) réellement consommé ici — DÉRIVÉ des
// mêmes types partagés (différé P6 : l'ancien type local à base de `string`
// pouvait dériver de Me sans erreur de compilation). Exporté : le tableau
// de bord et la section Ventes (Phase 7) réutilisent la même forme.
export type MeLike = {
  membership: { role: CompanyRole } | null
  assignments: Array<{
    warehouseId: string
    warehouseName: string
    role: WarehouseRole
  }>
}
```

Dans `apps/web/src/lib/pos.test.ts`, ajouter l'import de types et typer la factory du describe « rôles et boutiques ». Remplacer :

```ts
  const me = (
    role: string | undefined,
    assignments: Array<{
      warehouseId: string
      warehouseName: string
      role: string
    }>
  ) => ({
    membership: role
      ? { organizationId: "o", organizationName: "O", role }
      : null,
    assignments,
  })
```

par :

```ts
  const me = (
    role: CompanyRole | undefined,
    assignments: Array<{
      warehouseId: string
      warehouseName: string
      role: WarehouseRole
    }>
  ) => ({
    membership: role ? { role } : null,
    assignments,
  })
```

avec, en tête du fichier de test :

```ts
import type { CompanyRole, WarehouseRole } from "shared"
```

- [ ] **Step 4 : Réécrire `apps/web/src/routes/pos.tsx`**

Contenu COMPLET du fichier :

```tsx
import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { authClient } from "@/lib/auth-client"
import { apiFetch } from "@/lib/api"
import { fetchMe } from "@/lib/me"
import type { Me } from "@/lib/me"
import { boutiquesVendables } from "@/lib/pos"
import { fetchSessionCourante } from "@/lib/pos-api"
import { OuvertureCaisse } from "@/pos/ouverture-caisse"
import { EcranVente } from "@/pos/ecran-vente"
import { Button } from "@/components/ui/button"

// /pos vit HORS du layout _app : plein écran, pas de sidebar (spec §7).
// Différés P6 : le fetch des destinations vivait dans beforeLoad sans
// try/catch (erreur réseau = écran d'erreur brut du routeur) — déplacé dans
// le composant (isError → écran avec Réessayer) ; session.isError dégradait
// silencieusement en « Ouvrir la caisse » alors qu'une session est
// peut-être DÉJÀ ouverte — écran d'erreur explicite.
export const Route = createFileRoute("/pos")({
  beforeLoad: async () => {
    const { data } = await authClient.getSession()
    if (!data) throw redirect({ to: "/login" })
    let me: Me
    try {
      me = await fetchMe()
    } catch {
      throw redirect({ to: "/login" })
    }
    if (me.user.mustChangePassword) throw redirect({ to: "/mon-compte" })
    return { me }
  },
  component: PagePos,
})

function EcranErreur({
  message,
  onReessayer,
}: {
  message: string
  onReessayer: () => void
}) {
  return (
    <main className="grid min-h-screen place-items-center">
      <div className="text-center">
        <p role="alert" className="mb-4 text-red-600">
          {message}
        </p>
        <div className="flex items-center justify-center gap-2">
          <Button onClick={onReessayer}>Réessayer</Button>
          <Link to="/" className="rounded border px-4 py-2 text-sm">
            Retour au tableau de bord
          </Link>
        </div>
      </div>
    </main>
  )
}

function PagePos() {
  const { me } = Route.useRouteContext()
  const destinations = useQuery({
    queryKey: ["pos-destinations"],
    queryFn: () =>
      apiFetch<{
        warehouses: Array<{ id: string; name: string; type: string }>
      }>("/api/v1/warehouses/destinations"),
  })
  const boutiques = boutiquesVendables(me, destinations.data?.warehouses ?? [])
  const [boutiqueChoisie, setBoutiqueChoisie] = useState<string | null>(null)
  const premiere = boutiques.length > 0 ? boutiques[0].id : null
  const boutiqueId = boutiqueChoisie ?? premiere
  const boutique = boutiques.find((b) => b.id === boutiqueId) ?? null
  const session = useQuery({
    queryKey: ["session-caisse", boutiqueId],
    queryFn: () => fetchSessionCourante(boutiqueId ?? ""),
    enabled: boutiqueId !== null,
  })

  if (destinations.isPending || (boutiqueId !== null && session.isPending)) {
    return (
      <main className="grid min-h-screen place-items-center">
        <p className="text-gray-500">Chargement de la caisse…</p>
      </main>
    )
  }
  if (destinations.isError) {
    return (
      <EcranErreur
        message="Impossible de charger les boutiques."
        onReessayer={() => void destinations.refetch()}
      />
    )
  }
  if (!boutique || boutiqueId === null) {
    return (
      <EcranErreur
        message="Aucune boutique vendable pour ce compte."
        onReessayer={() => void destinations.refetch()}
      />
    )
  }
  if (session.isError) {
    return (
      <EcranErreur
        message="Impossible de vérifier la session de caisse."
        onReessayer={() => void session.refetch()}
      />
    )
  }
  const ouverte = session.data?.session ?? null
  if (!ouverte) {
    return (
      <OuvertureCaisse
        boutiques={boutiques}
        boutiqueId={boutiqueId}
        onChangeBoutique={setBoutiqueChoisie}
        onOuverte={() => void session.refetch()}
      />
    )
  }
  return (
    <EcranVente
      me={me}
      boutique={boutique}
      session={ouverte}
      onSessionFermee={() => void session.refetch()}
    />
  )
}
```

- [ ] **Step 5 : Catalogue POS — `refetchOnMount` + état d'erreur**

Dans `apps/web/src/pos/ecran-vente.tsx`, remplacer :

```tsx
  const catalogue = useQuery({
    queryKey: ["pos-catalogue", boutique.id],
    queryFn: () => fetchCataloguePos(boutique.id),
  })
```

par :

```tsx
  const catalogue = useQuery({
    queryKey: ["pos-catalogue", boutique.id],
    queryFn: () => fetchCataloguePos(boutique.id),
    // Anomalie E2E P6 : tuiles parfois incomplètes après navigation répétée
    // (l'invalidation ne vivait que dans onSuccess de la vente). Chaque
    // retour sur l'écran repart du serveur — décision 11 du plan.
    refetchOnMount: "always",
  })
```

et remplacer :

```tsx
          {catalogue.isPending ? (
            <p className="p-6 text-gray-500">Chargement du catalogue…</p>
          ) : (
            <GrilleArticles articles={filtres} onChoisir={ajouterAuPanier} />
          )}
```

par :

```tsx
          {catalogue.isPending ? (
            <p className="p-6 text-gray-500">Chargement du catalogue…</p>
          ) : catalogue.isError ? (
            <div className="p-6">
              <p role="alert" className="mb-3 text-sm text-red-600">
                Impossible de charger le catalogue.
              </p>
              <Button
                variant="outline"
                onClick={() => void catalogue.refetch()}
              >
                Réessayer
              </Button>
            </div>
          ) : (
            <GrilleArticles articles={filtres} onChoisir={ajouterAuPanier} />
          )}
```

- [ ] **Step 6 : `TicketsDuJour` — état d'erreur**

Dans `apps/web/src/pos/tickets-du-jour.tsx`, remplacer :

```tsx
          {!ventes.isPending && liste.length === 0 && (
            <p className="p-3 text-sm text-gray-500">
              Aucune vente aujourd'hui.
            </p>
          )}
```

par :

```tsx
          {ventes.isError && (
            <div className="p-3">
              <p role="alert" className="mb-2 text-sm text-red-600">
                Impossible de charger les tickets du jour.
              </p>
              <Button
                variant="outline"
                onClick={() => void ventes.refetch()}
              >
                Réessayer
              </Button>
            </div>
          )}
          {!ventes.isPending && !ventes.isError && liste.length === 0 && (
            <p className="p-3 text-sm text-gray-500">
              Aucune vente aujourd'hui.
            </p>
          )}
```

- [ ] **Step 7 : Vérifier que les tests passent**

Run: `cd apps/web && bunx vitest run src/pos/ecran-vente.test.tsx src/pos/tickets-du-jour.test.tsx src/lib/pos.test.ts`
Expected: PASS (nouveaux tests inclus).

- [ ] **Step 8 : Typecheck + lint + suite web complète**

Run: `bun run --cwd apps/web typecheck && bun run --cwd apps/web test && bun run lint`
Expected: exit 0 partout (la factory typée de pos.test.ts compile avec les littéraux existants).

- [ ] **Step 9 : Commit**

```bash
git add apps/web/src/lib/pos.ts apps/web/src/lib/pos.test.ts apps/web/src/routes/pos.tsx apps/web/src/pos/ecran-vente.tsx apps/web/src/pos/ecran-vente.test.tsx apps/web/src/pos/tickets-du-jour.tsx apps/web/src/pos/tickets-du-jour.test.tsx
git commit -m "fix: différés P6 front POS — MeLike dérivé de shared, états d'erreur destinations/session/catalogue/tickets, refetch catalogue au montage"
```

---

### Task 3: Différés P6 — durcissement du piège de focus de `ModalePaiement`

La revue finale P6 a noté 2 fuites aux bords du piège artisanal : (1) `Shift+Tab` quand le focus est sur le CONTENEUR lui-même (état initial de la modale) sort de la modale ; (2) une échappée POINTEUR (clic sur l'overlay, le fond n'est pas `inert`) puis `Tab` reprend la tabulation dans la page de fond.

**Files:**
- Modify: `apps/web/src/pos/modale-paiement.tsx`
- Test: `apps/web/src/pos/modale-paiement.test.tsx` (ajouts)

**Interfaces:**
- Consumes: composant `ModalePaiement` existant (props `{ total, enCours, erreur, onValider, onFermer }`), sélecteur `SELECTEUR_FOCUSABLES` du fichier.
- Produces: rien de nouveau — comportement durci, mêmes props.

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à la FIN de `apps/web/src/pos/modale-paiement.test.tsx` :

```tsx
describe("ModalePaiement — piège de focus durci (différé P6)", () => {
  it("Shift+Tab depuis le conteneur boucle vers le dernier focusable", () => {
    render(
      <ModalePaiement
        total={1000}
        enCours={false}
        erreur={null}
        onValider={vi.fn()}
        onFermer={vi.fn()}
      />
    )
    const dialogue = screen.getByRole("dialog")
    dialogue.focus()
    fireEvent.keyDown(dialogue, { key: "Tab", shiftKey: true })
    const focusables = dialogue.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    expect(document.activeElement).toBe(focusables[focusables.length - 1])
  })

  it("un focus échappé hors de la modale est ramené sur le conteneur", () => {
    render(
      <>
        <button>Dehors</button>
        <ModalePaiement
          total={1000}
          enCours={false}
          erreur={null}
          onValider={vi.fn()}
          onFermer={vi.fn()}
        />
      </>
    )
    const dehors = screen.getByRole("button", { name: "Dehors" })
    dehors.focus()
    expect(document.activeElement).toBe(screen.getByRole("dialog"))
  })
})
```

- [ ] **Step 2 : Vérifier que les tests échouent**

Run: `cd apps/web && bunx vitest run src/pos/modale-paiement.test.tsx`
Expected: FAIL — Shift+Tab depuis le conteneur ne fait rien (activeElement reste le dialogue), le focus « Dehors » n'est pas rattrapé.

- [ ] **Step 3 : Implémenter les deux fermetures**

Dans `apps/web/src/pos/modale-paiement.tsx`, remplacer le `useEffect` de focus initial :

```tsx
  useEffect(() => {
    conteneurRef.current?.focus()
  }, [])
```

par :

```tsx
  useEffect(() => {
    conteneurRef.current?.focus()
  }, [])

  // Durcissement (différé P6, fuite n° 2) : une échappée POINTEUR (clic sur
  // l'overlay — le fond n'est pas inert) puis Tab reprenait la tabulation
  // dans la page. Tout focus qui atterrit HORS de la modale est ramené sur
  // le conteneur.
  useEffect(() => {
    const rattraper = (e: FocusEvent) => {
      const conteneur = conteneurRef.current
      if (!conteneur) return
      if (e.target instanceof Node && !conteneur.contains(e.target)) {
        conteneur.focus()
      }
    }
    document.addEventListener("focusin", rattraper)
    return () => document.removeEventListener("focusin", rattraper)
  }, [])
```

Puis dans `gererClavier`, remplacer :

```tsx
    if (e.shiftKey && document.activeElement === premier) {
      e.preventDefault()
      dernier.focus()
    } else if (!e.shiftKey && document.activeElement === dernier) {
```

par :

```tsx
    // Fuite n° 1 (différé P6) : Shift+Tab quand le focus est sur le
    // CONTENEUR lui-même (état initial, tabIndex -1) sortait de la modale.
    if (
      e.shiftKey &&
      (document.activeElement === premier ||
        document.activeElement === conteneurRef.current)
    ) {
      e.preventDefault()
      dernier.focus()
    } else if (!e.shiftKey && document.activeElement === dernier) {
```

- [ ] **Step 4 : Vérifier que les tests passent**

Run: `cd apps/web && bunx vitest run src/pos/modale-paiement.test.tsx`
Expected: PASS (nouveaux tests + tests existants du fichier).

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/pos/modale-paiement.tsx apps/web/src/pos/modale-paiement.test.tsx
git commit -m "fix: piège de focus ModalePaiement durci — Shift+Tab depuis le conteneur et rattrapage du focus échappé"
```

---

### Task 4: Coût figé — migration 0015 `sale_items.unit_cost` + sous-requête CMP dans le batch de vente

Le CMP de (entrepôt SOURCE, variante) est gelé sur chaque ligne au moment exact de la vente, par sous-requête SQL DANS l'INSERT du batch existant (décision 1). Les ventes antérieures restent à NULL.

**Files:**
- Modify: `apps/api/src/db/schema/pos.ts` (colonne `unitCost` sur `saleItems`)
- Create: `apps/api/drizzle/0015_sale_item_unit_cost.sql` (GÉNÉRÉ par drizzle-kit — migration standard, PAS custom)
- Modify: `apps/api/src/routes/sales.ts` (`insertLignes` dans `tenterVente`)
- Test: `apps/api/test/sales-cout.test.ts` (nouveau)

**Interfaces:**
- Consumes: `applyMovements` (seed de stock/CMP), batch de vente existant (`tenterVente`, routes/sales.ts — `lignes: Array<typeof schema.saleItems.$inferInsert>` puis `insertLignes`), helpers de test.
- Produces: colonne `schema.saleItems.unitCost: integer("unit_cost")` (nullable) — **consommée par les Tasks 8 (marges + marge du détail)**. Contrat : `unit_cost` = CMP de `stock_levels(source_warehouse_id, variant_id)` au moment de la vente ; NULL = vente antérieure à la colonne.

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `apps/api/test/sales-cout.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { and, eq } from "drizzle-orm"
import app from "../src/index"
import * as schema from "../src/db/schema"
import { applyMovements } from "../src/services/stock"
import {
  affecterEntrepot,
  bootstrapOwner,
  createUserWithRole,
  creerEntrepot,
  creerProduitSimple,
} from "./helpers"

function req(cookie: string, method: string, url: string, body?: unknown) {
  return app.request(
    url,
    {
      method,
      headers: { "content-type": "application/json", cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env
  )
}

type ReponseVente = { sale: { id: string } }

// Boutique CMP 200, réserve CMP 300 (dépannage discriminant), caissier avec
// session ouverte — motif seedVente de sales.test.ts.
async function seedCout() {
  const { organizationId, ownerId } = await bootstrapOwner()
  const storeId = await creerEntrepot(organizationId, "Boutique C", "store")
  const reserveId = await creerEntrepot(organizationId, "Réserve C")
  const caissier = await createUserWithRole(organizationId, "staff")
  await affecterEntrepot(organizationId, caissier.userId, storeId, "cashier")
  const { variantId } = await creerProduitSimple(organizationId, {
    nom: "Produit C",
    prix: 500,
  })
  const db = drizzle(env.DB, { schema })
  await applyMovements(db, {
    organizationId,
    userId: ownerId,
    mouvements: [
      { warehouseId: storeId, variantId, delta: 10, type: "purchase", unitCost: 200 },
      { warehouseId: reserveId, variantId, delta: 20, type: "purchase", unitCost: 300 },
    ],
  })
  const ouverture = await req(
    caissier.cookie,
    "POST",
    "/api/v1/register-sessions",
    { storeId, openingFloat: 0 }
  )
  expect(ouverture.status).toBe(201)
  return { organizationId, ownerId, storeId, reserveId, caissier, variantId, db }
}

async function vendre(
  cookie: string,
  storeId: string,
  variantId: string,
  quantity: number,
  sourceWarehouseId?: string
) {
  const res = await req(cookie, "POST", "/api/v1/sales", {
    storeId,
    clientRequestId: crypto.randomUUID(),
    items: [
      {
        variantId,
        quantity,
        unitPrice: 500,
        ...(sourceWarehouseId ? { sourceWarehouseId } : {}),
      },
    ],
    payments: [{ method: "cash", amount: quantity * 500 }],
  })
  expect(res.status).toBe(201)
  return (await res.json<ReponseVente>()).sale.id
}

async function coutsLigne(saleId: string) {
  const db = drizzle(env.DB, { schema })
  return db
    .select({ unitCost: schema.saleItems.unitCost })
    .from(schema.saleItems)
    .where(eq(schema.saleItems.saleId, saleId))
}

async function cmpNiveau(warehouseId: string, variantId: string) {
  const db = drizzle(env.DB, { schema })
  const rows = await db
    .select({ avgCost: schema.stockLevels.avgCost })
    .from(schema.stockLevels)
    .where(
      and(
        eq(schema.stockLevels.warehouseId, warehouseId),
        eq(schema.stockLevels.variantId, variantId)
      )
    )
    .limit(1)
  return rows[0]?.avgCost ?? null
}

describe("sale_items.unitCost — CMP figé au moment de la vente (Phase 7)", () => {
  it("fige le CMP courant de la boutique sur la ligne", async () => {
    const { storeId, caissier, variantId } = await seedCout()
    const saleId = await vendre(caissier.cookie, storeId, variantId, 2)
    const lignes = await coutsLigne(saleId)
    expect(lignes).toHaveLength(1)
    expect(lignes[0].unitCost).toBe(200)
  })

  it("le unitCost figé ne bouge PAS quand une réception ultérieure change le CMP", async () => {
    const { organizationId, ownerId, storeId, caissier, variantId, db } =
      await seedCout()
    const saleId = await vendre(caissier.cookie, storeId, variantId, 2)
    // Réception à 800 : reste 8 @ 200, +10 @ 800 →
    // ROUND((8×200 + 10×800) / 18) = ROUND(533,33) = 533
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId: storeId, variantId, delta: 10, type: "purchase", unitCost: 800 },
      ],
    })
    expect(await cmpNiveau(storeId, variantId)).toBe(533)
    // La ligne historique est IMMUABLE au coût d'alors…
    const lignes = await coutsLigne(saleId)
    expect(lignes[0].unitCost).toBe(200)
    // …et une NOUVELLE vente gèle le nouveau CMP.
    const saleId2 = await vendre(caissier.cookie, storeId, variantId, 1)
    const lignes2 = await coutsLigne(saleId2)
    expect(lignes2[0].unitCost).toBe(533)
  })

  it("dépannage : gèle le CMP de l'entrepôt SOURCE, pas celui de la boutique", async () => {
    const { storeId, reserveId, caissier, variantId } = await seedCout()
    const saleId = await vendre(
      caissier.cookie,
      storeId,
      variantId,
      3,
      reserveId
    )
    const lignes = await coutsLigne(saleId)
    expect(lignes[0].unitCost).toBe(300)
  })
})
```

- [ ] **Step 2 : Vérifier que les tests échouent**

Run: `cd apps/api && bunx vitest run test/sales-cout.test.ts`
Expected: FAIL en COMPILATION — `Property 'unitCost' does not exist` sur `schema.saleItems` (la colonne n'existe pas encore).

- [ ] **Step 3 : Ajouter la colonne au schéma**

Dans `apps/api/src/db/schema/pos.ts`, table `saleItems`, insérer après le champ `catalogPrice` :

```ts
    // CMP de l'entrepôt SOURCE figé au moment exact de la vente (spec §3,
    // Phase 7) : posé par sous-requête SQL DANS l'INSERT du batch de vente
    // (routes/sales.ts) — même mécanisme que le gel du CMP à l'expédition
    // des transferts. NULL = vente antérieure à la colonne : les rapports
    // la valorisent au CMP courant et la marquent « estimé ».
    unitCost: integer("unit_cost"),
```

- [ ] **Step 4 : Générer la migration 0015 (STANDARD, pas custom)**

```bash
cd apps/api && bunx drizzle-kit generate --name=sale_item_unit_cost
```

Vérifier `apps/api/drizzle/0015_sale_item_unit_cost.sql` — contenu attendu (motif 0011) :

```sql
ALTER TABLE `sale_items` ADD `unit_cost` integer;
```

Pas d'index ajouté (décision 1 : `unit_cost` n'est jamais un critère de filtre — les rapports lisent par `sale_id`, index `sale_items_sale_idx` existant, et agrègent). Vérifier que seul le snapshot 0015 et `meta/_journal.json` ont bougé en plus du .sql.

- [ ] **Step 5 : Poser la sous-requête de gel dans le batch de vente**

Dans `apps/api/src/routes/sales.ts` (`tenterVente`), remplacer :

```ts
    const insertLignes = lignes.map((ligne) =>
      db.insert(schema.saleItems).values(ligne)
    )
```

par :

```ts
    // CMP figé (spec §3, Phase 7) : sous-requête évaluée DANS la
    // transaction du batch — même principe que le gel à l'expédition des
    // transferts, JAMAIS de lecture JS puis écriture. La ligne stock_levels
    // (source, variante) existe forcément pour une vente qui aboutit : le
    // décrément du même batch échouerait sinon au CHECK ; si elle manquait,
    // la sous-requête rendrait NULL et le batch mourrait de toute façon.
    const insertLignes = lignes.map((ligne) =>
      db.insert(schema.saleItems).values({
        ...ligne,
        unitCost: sql`(SELECT avg_cost FROM stock_levels
          WHERE warehouse_id = ${ligne.sourceWarehouseId}
            AND variant_id = ${ligne.variantId})`,
      })
    )
```

(`sql` est déjà importé en tête de fichier ; le type `Array<typeof schema.saleItems.$inferInsert>` de `lignes` ne change pas — la sous-requête est posée au point d'insertion.)

- [ ] **Step 6 : Vérifier que les tests passent**

Run: `cd apps/api && bunx vitest run test/sales-cout.test.ts`
Expected: PASS 3/3.

- [ ] **Step 7 : Suite api complète + migration locale**

Run: `cd apps/api && bun run test && bun run db:migrate:local`
Expected: suite verte (256 tests) ; la migration 0015 s'applique localement sans erreur (puis « No migrations to apply » si relancée).

- [ ] **Step 8 : Commit**

```bash
git add apps/api/src/db/schema/pos.ts apps/api/drizzle apps/api/src/routes/sales.ts apps/api/test/sales-cout.test.ts
git commit -m "feat: CMP figé sur les lignes de vente — colonne sale_items.unit_cost (0015) posée par sous-requête dans le batch"
```

---

### Task 5: Fondations rapports — `bornesPeriode`, `porteeRapport`, module CSV

Trois briques partagées par les trois routes de rapports : bornes de période UTC (extension de `lib/dates.ts`), portée de la matrice §4 ligne « Rapports » (nouveau `lib/reports-acces.ts`), génération CSV pure (nouveau `lib/csv.ts`).

**Files:**
- Modify: `apps/api/src/lib/dates.ts` (+ `bornesPeriode`)
- Create: `apps/api/src/lib/reports-acces.ts`
- Create: `apps/api/src/lib/csv.ts`
- Test: `apps/api/test/reports-fondations.test.ts` (nouveau)

**Interfaces:**
- Consumes: `dateCalendaireValide` (`lib/dates.ts`), `porteeLectureStock` + `PorteeLectureStock` (`lib/stock-acces.ts`), `CompanyRole` (`shared`).
- Produces (consommé par les Tasks 6-9) :
  - `bornesPeriode(du: string, au: string): { debut: Date; finExclue: Date } | null` — null si date invalide ou `du > au` ; `finExclue` = lendemain de `au` à 00:00 UTC.
  - `type TypeRapport = "ventes" | "marges" | "valorisation"` et `porteeRapport(db, organizationId, userId, role, rapport): Promise<PorteeLectureStock | null>` — null ⇒ l'appelant répond 403.
  - `champCsv(valeur: string | number | null): string` et `genererCsv(entetes: string[], lignes: Array<Array<string | number | null>>): string` — BOM + `;` + CRLF + RFC 4180.

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `apps/api/test/reports-fondations.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import * as schema from "../src/db/schema"
import { bornesPeriode } from "../src/lib/dates"
import { porteeRapport } from "../src/lib/reports-acces"
import { champCsv, genererCsv } from "../src/lib/csv"
import {
  affecterEntrepot,
  bootstrapOwner,
  createUserWithRole,
  creerEntrepot,
} from "./helpers"

describe("bornesPeriode", () => {
  it("borne une période valide en UTC, fin EXCLUSIVE au lendemain", () => {
    expect(bornesPeriode("2026-07-01", "2026-07-03")).toEqual({
      debut: new Date("2026-07-01T00:00:00.000Z"),
      finExclue: new Date("2026-07-04T00:00:00.000Z"),
    })
  })

  it("accepte une période d'un seul jour", () => {
    expect(bornesPeriode("2026-07-12", "2026-07-12")).toEqual({
      debut: new Date("2026-07-12T00:00:00.000Z"),
      finExclue: new Date("2026-07-13T00:00:00.000Z"),
    })
  })

  it("rejette les dates calendaires impossibles et l'ordre inversé", () => {
    expect(bornesPeriode("2026-02-30", "2026-03-01")).toBeNull()
    expect(bornesPeriode("2026-07-01", "2026-13-40")).toBeNull()
    expect(bornesPeriode("2026-07-05", "2026-07-01")).toBeNull()
  })
})

describe("champCsv / genererCsv", () => {
  it("échappe selon RFC 4180 (point-virgule, guillemets, retours ligne)", () => {
    expect(champCsv("simple")).toBe("simple")
    expect(champCsv(1500)).toBe("1500")
    expect(champCsv(null)).toBe("")
    expect(champCsv("avec;separateur")).toBe('"avec;separateur"')
    expect(champCsv('Boisson "Cola"')).toBe('"Boisson ""Cola"""')
    expect(champCsv("ligne\ncoupee")).toBe('"ligne\ncoupee"')
  })

  it("génère BOM + en-têtes + lignes en CRLF, séparateur point-virgule", () => {
    const csv = genererCsv(
      ["Boutique", "CA"],
      [
        ["Alpha", 1500],
        ["Beta;Sud", 2000],
      ]
    )
    expect(csv).toBe(
      '\uFEFFBoutique;CA\r\nAlpha;1500\r\n"Beta;Sud";2000\r\n'
    )
  })
})

describe("porteeRapport (matrice §4, ligne Rapports)", () => {
  it("applique la matrice rôle par rôle", async () => {
    const { organizationId, ownerId } = await bootstrapOwner()
    const entrepot = await creerEntrepot(organizationId, "Dépôt P")
    const boutique = await creerEntrepot(organizationId, "Boutique P", "store")
    const db = drizzle(env.DB, { schema })

    // owner : tout, sur les trois rapports
    for (const rapport of ["ventes", "marges", "valorisation"] as const) {
      expect(
        await porteeRapport(db, organizationId, ownerId, "owner", rapport)
      ).toEqual({ tous: true })
    }

    // auditor org : tout (lecture)
    const auditor = await createUserWithRole(organizationId, "auditor")
    expect(
      await porteeRapport(db, organizationId, auditor.userId, "auditor", "marges")
    ).toEqual({ tous: true })

    // stock_manager : valorisation SEULEMENT
    const gestionnaire = await createUserWithRole(organizationId, "stock_manager")
    expect(
      await porteeRapport(
        db,
        organizationId,
        gestionnaire.userId,
        "stock_manager",
        "valorisation"
      )
    ).toEqual({ tous: true })
    expect(
      await porteeRapport(
        db,
        organizationId,
        gestionnaire.userId,
        "stock_manager",
        "ventes"
      )
    ).toBeNull()
    expect(
      await porteeRapport(
        db,
        organizationId,
        gestionnaire.userId,
        "stock_manager",
        "marges"
      )
    ).toBeNull()

    // manager local : SES entrepôts
    const manager = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, manager.userId, boutique, "manager")
    expect(
      await porteeRapport(db, organizationId, manager.userId, "staff", "ventes")
    ).toEqual({ tous: false, warehouseIds: [boutique] })

    // caissier pur : exclu (portée vide → null → 403)
    const caissier = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, caissier.userId, boutique, "cashier")
    expect(
      await porteeRapport(db, organizationId, caissier.userId, "staff", "ventes")
    ).toBeNull()
    expect(
      await porteeRapport(
        db,
        organizationId,
        caissier.userId,
        "staff",
        "valorisation"
      )
    ).toBeNull()

    // staff sans affectation : exclu aussi
    const sansRien = await createUserWithRole(organizationId, "staff")
    expect(
      await porteeRapport(db, organizationId, sansRien.userId, "staff", "ventes")
    ).toBeNull()
    void entrepot
  })
})
```

- [ ] **Step 2 : Vérifier que les tests échouent**

Run: `cd apps/api && bunx vitest run test/reports-fondations.test.ts`
Expected: FAIL en compilation — `bornesPeriode`, `reports-acces` et `csv` n'existent pas.

- [ ] **Step 3 : Implémenter `bornesPeriode`**

Ajouter à la FIN de `apps/api/src/lib/dates.ts` :

```ts
// Bornes UTC d'une période de rapports [du, au] (spec §6) : début inclus à
// 00:00 UTC, fin EXCLUSIVE au lendemain de `au` — le motif exact des bornes
// de journée de routes/sales.ts (gte debut / lt finExclue). null = période
// invalide (date calendaire impossible ou du > au) → 400 côté route.
export function bornesPeriode(
  du: string,
  au: string
): { debut: Date; finExclue: Date } | null {
  if (!dateCalendaireValide(du) || !dateCalendaireValide(au) || du > au) {
    return null
  }
  const debut = new Date(`${du}T00:00:00.000Z`)
  const finExclue = new Date(
    new Date(`${au}T00:00:00.000Z`).getTime() + 86_400_000
  )
  return { debut, finExclue }
}
```

- [ ] **Step 4 : Implémenter `porteeRapport`**

Créer `apps/api/src/lib/reports-acces.ts` :

```ts
import type { DrizzleD1Database } from "drizzle-orm/d1"
import type { CompanyRole } from "shared"
import * as schema from "../db/schema"
import { porteeLectureStock } from "./stock-acces"
import type { PorteeLectureStock } from "./stock-acces"

type Db = DrizzleD1Database<typeof schema>

export type TypeRapport = "ventes" | "marges" | "valorisation"

// Matrice spec §4, ligne « Rapports » : owner/admin ✅ tous ; auditor org 👁
// tous ; stock_manager = rapport de VALORISATION seulement (« ✅ stock » —
// ni ventes ni marges) ; manager/auditor locaux = leurs entrepôts ; cashier
// exclu. Composé sur porteeLectureStock : pour ventes/marges, stock_manager
// est refusé AVANT (sa branche { tous: true } ne vaut que pour le stock) ;
// une portée staff VIDE (caissier pur, staff sans affectation) = exclu.
// Retour null ⇒ l'appelant répond 403 ACCES_REFUSE.
export async function porteeRapport(
  db: Db,
  organizationId: string,
  userId: string,
  role: CompanyRole,
  rapport: TypeRapport
): Promise<PorteeLectureStock | null> {
  if (rapport !== "valorisation" && role === "stock_manager") {
    return null
  }
  const portee = await porteeLectureStock(db, organizationId, userId, role)
  if (!portee.tous && portee.warehouseIds.length === 0) {
    return null
  }
  return portee
}
```

- [ ] **Step 5 : Implémenter le module CSV**

Créer `apps/api/src/lib/csv.ts` :

```ts
// Export CSV des rapports (spec §6) : UTF-8 avec BOM (Excel fr détecte
// l'encodage), séparateur POINT-VIRGULE (convention des locales à virgule
// décimale), fins de ligne CRLF, échappement RFC 4180. Module PUR — les
// routes composent la Response (Content-Type/Content-Disposition).
const BOM = "\uFEFF"

export function champCsv(valeur: string | number | null): string {
  if (valeur === null) return ""
  const texte = String(valeur)
  if (/[";\n\r]/.test(texte)) {
    return `"${texte.replaceAll('"', '""')}"`
  }
  return texte
}

export function genererCsv(
  entetes: string[],
  lignes: Array<Array<string | number | null>>
): string {
  const rangs = [
    entetes.map(champCsv),
    ...lignes.map((ligne) => ligne.map(champCsv)),
  ]
  return BOM + rangs.map((rang) => rang.join(";")).join("\r\n") + "\r\n"
}
```

- [ ] **Step 6 : Vérifier que les tests passent**

Run: `cd apps/api && bunx vitest run test/reports-fondations.test.ts`
Expected: PASS 6/6.

- [ ] **Step 7 : Typecheck + commit**

Run: `bun run --cwd apps/api typecheck`
Expected: exit 0.

```bash
git add apps/api/src/lib/dates.ts apps/api/src/lib/reports-acces.ts apps/api/src/lib/csv.ts apps/api/test/reports-fondations.test.ts
git commit -m "feat: fondations rapports — bornesPeriode, porteeRapport (matrice §4), module CSV RFC 4180"
```

---

### Task 6: `GET /api/v1/reports/sales` — rapport des ventes (+ export CSV)

CA, tickets, panier moyen et répartition espèces/mobile money sur une période, groupés par boutique (défaut) ou par produit (avec quantités et remises consenties). Agrégats SQL, portée matrice §4, variante `?format=csv`.

**Files:**
- Create: `apps/api/src/routes/reports.ts`
- Modify: `apps/api/src/index.ts` (montage `/api/v1/reports`)
- Test: `apps/api/test/reports-sales.test.ts` (nouveau)

**Interfaces:**
- Consumes: `porteeRapport` + `TypeRapport` (Task 5), `bornesPeriode` (Task 5), `genererCsv` (Task 5), `estDansPortee`/`filtrePortee` (`lib/stock-acces.ts`), `requireAuth`/`requireMembership` (middleware), schémas `sales`/`saleItems`/`payments`/`warehouses`/`products`/`productVariants`.
- Produces: `reportsRoute` (export nommé) monté sur `/api/v1/reports` ; helpers locaux `entrepotDansOrganisation` et `conditionsVentes` réutilisés par les Tasks 7-8 dans le même fichier. Contrats JSON (consommés par les Tasks 10-12 côté front) :
  - `GET /reports/sales?du=AAAA-MM-JJ&au=AAAA-MM-JJ[&groupe=boutique|produit][&storeId=…][&format=csv]`
  - groupe=boutique → `{ periode: { du, au }, groupe: "boutique", total: { ca, tickets, panierMoyen, cash, mobileMoney }, lignes: [{ storeId, storeName, ca, tickets, panierMoyen, cash, mobileMoney }] }`
  - groupe=produit → même enveloppe, `lignes: [{ productId, productName, variantId, variantName, sku, quantite, ca, remise, tickets }]`
  - CSV boutique : en-têtes `Boutique;CA;Tickets;Panier moyen;Espèces;Mobile money`, fichier `rapport-ventes-boutiques_<du>_<au>.csv` ; CSV produit : `Produit;Variante;SKU;Quantité;CA;Remises;Tickets`, fichier `rapport-ventes-produits_<du>_<au>.csv`.

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `apps/api/test/reports-sales.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
import app from "../src/index"
import * as schema from "../src/db/schema"
import { applyMovements } from "../src/services/stock"
import {
  affecterEntrepot,
  bootstrapOwner,
  createUserWithRole,
  creerEntrepot,
  creerProduitSimple,
} from "./helpers"

function req(cookie: string, method: string, url: string, body?: unknown) {
  return app.request(
    url,
    {
      method,
      headers: { "content-type": "application/json", cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env
  )
}

type Erreur = { code: string }
type TotalVentes = {
  ca: number
  tickets: number
  panierMoyen: number
  cash: number
  mobileMoney: number
}
type LigneBoutique = TotalVentes & { storeId: string; storeName: string }
type RapportBoutiques = { total: TotalVentes; lignes: LigneBoutique[] }
type LigneProduit = {
  productName: string
  quantite: number
  ca: number
  remise: number
  tickets: number
}
type RapportProduits = { total: TotalVentes; lignes: LigneProduit[] }
type Paiement = {
  method: "cash" | "mobile_money"
  amount: number
  reference?: string
}

// Jour UTC courant : les ventes de test sont créées « maintenant » côté
// serveur, la période [aujourd'hui, aujourd'hui] les couvre.
const JOUR = new Date().toISOString().slice(0, 10)

async function vendre(
  cookie: string,
  storeId: string,
  variantId: string,
  quantity: number,
  unitPrice: number,
  payments: Paiement[]
) {
  const res = await req(cookie, "POST", "/api/v1/sales", {
    storeId,
    clientRequestId: crypto.randomUUID(),
    items: [{ variantId, quantity, unitPrice }],
    payments,
  })
  expect(res.status).toBe(201)
}

// Deux boutiques, un produit négociable (plancher 400), trois ventes :
// Alpha : 2 × 450 cash (remise 100) ; Alpha : 1 × 500 mixte (200 cash +
// 300 mobile) ; Beta : 4 × 500 cash. L'owner vend (bypass) : une session
// par boutique (l'index unique 0014 est par (boutique, caissier)).
async function seedRapport() {
  const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
  const alphaId = await creerEntrepot(organizationId, "Boutique Alpha", "store")
  const betaId = await creerEntrepot(organizationId, "Boutique Beta", "store")
  const { productId, variantId } = await creerProduitSimple(organizationId, {
    nom: "Cola",
    prix: 500,
  })
  const db = drizzle(env.DB, { schema })
  await db
    .update(schema.products)
    .set({ minPrice: 400 })
    .where(eq(schema.products.id, productId))
  await applyMovements(db, {
    organizationId,
    userId: ownerId,
    mouvements: [
      { warehouseId: alphaId, variantId, delta: 50, type: "purchase", unitCost: 200 },
      { warehouseId: betaId, variantId, delta: 50, type: "purchase", unitCost: 200 },
    ],
  })
  for (const storeId of [alphaId, betaId]) {
    const ouverture = await req(
      ownerCookie,
      "POST",
      "/api/v1/register-sessions",
      { storeId, openingFloat: 0 }
    )
    expect(ouverture.status).toBe(201)
  }
  await vendre(ownerCookie, alphaId, variantId, 2, 450, [
    { method: "cash", amount: 900 },
  ])
  await vendre(ownerCookie, alphaId, variantId, 1, 500, [
    { method: "cash", amount: 200 },
    { method: "mobile_money", amount: 300, reference: "MM-1" },
  ])
  await vendre(ownerCookie, betaId, variantId, 4, 500, [
    { method: "cash", amount: 2000 },
  ])
  return { organizationId, ownerCookie, alphaId, betaId, variantId }
}

describe("GET /api/v1/reports/sales", () => {
  it("groupe par boutique : CA, tickets, panier moyen, répartition par méthode", async () => {
    const { ownerCookie, alphaId, betaId } = await seedRapport()
    const res = await req(
      ownerCookie,
      "GET",
      `/api/v1/reports/sales?du=${JOUR}&au=${JOUR}`
    )
    expect(res.status).toBe(200)
    const { total, lignes } = await res.json<RapportBoutiques>()
    expect(total).toEqual({
      ca: 3400,
      tickets: 3,
      panierMoyen: 1133,
      cash: 3100,
      mobileMoney: 300,
    })
    expect(lignes).toHaveLength(2)
    const alpha = lignes.find((l) => l.storeId === alphaId)
    expect(alpha).toEqual({
      storeId: alphaId,
      storeName: "Boutique Alpha",
      ca: 1400,
      tickets: 2,
      panierMoyen: 700,
      cash: 1100,
      mobileMoney: 300,
    })
    const beta = lignes.find((l) => l.storeId === betaId)
    expect(beta?.ca).toBe(2000)
    expect(beta?.tickets).toBe(1)
    expect(beta?.cash).toBe(2000)
    expect(beta?.mobileMoney).toBe(0)
  })

  it("groupe par produit : quantités, CA, remises consenties, tickets", async () => {
    const { ownerCookie } = await seedRapport()
    const res = await req(
      ownerCookie,
      "GET",
      `/api/v1/reports/sales?du=${JOUR}&au=${JOUR}&groupe=produit`
    )
    expect(res.status).toBe(200)
    const { lignes } = await res.json<RapportProduits>()
    expect(lignes).toHaveLength(1)
    expect(lignes[0].productName).toBe("Cola")
    expect(lignes[0].quantite).toBe(7)
    expect(lignes[0].ca).toBe(3400)
    // 2 unités vendues 450 au lieu de 500 catalogue
    expect(lignes[0].remise).toBe(100)
    expect(lignes[0].tickets).toBe(3)
  })

  it("période sans vente : lignes vides, totaux à zéro", async () => {
    const { ownerCookie } = await seedRapport()
    const res = await req(
      ownerCookie,
      "GET",
      "/api/v1/reports/sales?du=2000-01-01&au=2000-01-02"
    )
    expect(res.status).toBe(200)
    const { total, lignes } = await res.json<RapportBoutiques>()
    expect(lignes).toEqual([])
    expect(total.ca).toBe(0)
    expect(total.tickets).toBe(0)
    expect(total.panierMoyen).toBe(0)
  })

  it("valide la période et le groupe", async () => {
    const { ownerCookie } = await seedRapport()
    const sansAu = await req(
      ownerCookie,
      "GET",
      `/api/v1/reports/sales?du=${JOUR}`
    )
    expect(sansAu.status).toBe(400)
    const dateImpossible = await req(
      ownerCookie,
      "GET",
      "/api/v1/reports/sales?du=2026-02-30&au=2026-03-01"
    )
    expect(dateImpossible.status).toBe(400)
    const groupeInvalide = await req(
      ownerCookie,
      "GET",
      `/api/v1/reports/sales?du=${JOUR}&au=${JOUR}&groupe=caissier`
    )
    expect(groupeInvalide.status).toBe(400)
    expect((await groupeInvalide.json<Erreur>()).code).toBe("VALIDATION")
  })

  it("portée : manager local ne voit que SA boutique ; stock_manager et caissier 403 ; auditor org voit tout", async () => {
    const { organizationId, alphaId, betaId } = await seedRapport()
    const manager = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, manager.userId, alphaId, "manager")
    const vueManager = await req(
      manager.cookie,
      "GET",
      `/api/v1/reports/sales?du=${JOUR}&au=${JOUR}`
    )
    expect(vueManager.status).toBe(200)
    const rapportManager = await vueManager.json<RapportBoutiques>()
    expect(rapportManager.lignes).toHaveLength(1)
    expect(rapportManager.lignes[0].storeId).toBe(alphaId)
    expect(rapportManager.total.ca).toBe(1400)
    const horsPortee = await req(
      manager.cookie,
      "GET",
      `/api/v1/reports/sales?du=${JOUR}&au=${JOUR}&storeId=${betaId}`
    )
    expect(horsPortee.status).toBe(403)

    const gestionnaire = await createUserWithRole(
      organizationId,
      "stock_manager"
    )
    const refusGestionnaire = await req(
      gestionnaire.cookie,
      "GET",
      `/api/v1/reports/sales?du=${JOUR}&au=${JOUR}`
    )
    expect(refusGestionnaire.status).toBe(403)

    const caissier = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, caissier.userId, alphaId, "cashier")
    const refusCaissier = await req(
      caissier.cookie,
      "GET",
      `/api/v1/reports/sales?du=${JOUR}&au=${JOUR}`
    )
    expect(refusCaissier.status).toBe(403)

    const auditor = await createUserWithRole(organizationId, "auditor")
    const vueAuditor = await req(
      auditor.cookie,
      "GET",
      `/api/v1/reports/sales?du=${JOUR}&au=${JOUR}`
    )
    expect(vueAuditor.status).toBe(200)
    expect((await vueAuditor.json<RapportBoutiques>()).lignes).toHaveLength(2)
  })

  it("storeId inexistant → 404 INTROUVABLE", async () => {
    const { ownerCookie } = await seedRapport()
    const res = await req(
      ownerCookie,
      "GET",
      `/api/v1/reports/sales?du=${JOUR}&au=${JOUR}&storeId=${crypto.randomUUID()}`
    )
    expect(res.status).toBe(404)
    expect((await res.json<Erreur>()).code).toBe("INTROUVABLE")
  })

  it("format=csv : BOM, point-virgule, en-têtes français, nom de fichier daté", async () => {
    const { ownerCookie } = await seedRapport()
    const res = await req(
      ownerCookie,
      "GET",
      `/api/v1/reports/sales?du=${JOUR}&au=${JOUR}&format=csv`
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/csv")
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="rapport-ventes-boutiques_${JOUR}_${JOUR}.csv"`
    )
    const corps = await res.text()
    expect(corps.startsWith("\uFEFF")).toBe(true)
    const lignes = corps.slice(1).split("\r\n")
    expect(lignes[0]).toBe(
      "Boutique;CA;Tickets;Panier moyen;Espèces;Mobile money"
    )
    expect(lignes).toContain("Boutique Alpha;1400;2;700;1100;300")
    expect(lignes).toContain("Boutique Beta;2000;1;2000;2000;0")
  })
})
```

- [ ] **Step 2 : Vérifier que les tests échouent**

Run: `cd apps/api && bunx vitest run test/reports-sales.test.ts`
Expected: FAIL — `GET /api/v1/reports/sales` répond 404 (route non montée).

- [ ] **Step 3 : Implémenter la route**

Créer `apps/api/src/routes/reports.ts` :

```ts
import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, asc, eq, gte, lt, sql } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import * as schema from "../db/schema"
import { bornesPeriode } from "../lib/dates"
import { porteeRapport } from "../lib/reports-acces"
import { estDansPortee, filtrePortee } from "../lib/stock-acces"
import type { PorteeLectureStock } from "../lib/stock-acces"
import { genererCsv } from "../lib/csv"
import { requireAuth } from "../middleware/require-auth"
import { requireMembership } from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import type { Env } from "../env"

export const reportsRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

reportsRoute.use(requireAuth, requireMembership)

type Db = DrizzleD1Database<typeof schema>

const REPONSE_ACCES_REFUSE = {
  code: "ACCES_REFUSE",
  message: "Accès refusé",
} as const

const REPONSE_PERIODE_INVALIDE = {
  code: "VALIDATION",
  message:
    "Période invalide : paramètres du et au requis (AAAA-MM-JJ, du ≤ au)",
} as const

const ENTETES_CSV = {
  "content-type": "text/csv; charset=utf-8",
} as const

// Entrepôt explicitement demandé : doit exister dans l'organisation —
// contrat 404 cross-org (motif routes/stock.ts), appliqué APRÈS le contrôle
// de portée (403 prioritaire).
async function entrepotDansOrganisation(
  db: Db,
  organizationId: string,
  warehouseId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.warehouses.id })
    .from(schema.warehouses)
    .where(
      and(
        eq(schema.warehouses.id, warehouseId),
        eq(schema.warehouses.organizationId, organizationId)
      )
    )
    .limit(1)
  return rows.length > 0
}

// Conditions communes des rapports assis sur les VENTES (sales, margins) :
// organisation + statut completed + bornes de période + portée/storeId.
async function conditionsVentes(
  db: Db,
  organizationId: string,
  portee: PorteeLectureStock,
  bornes: { debut: Date; finExclue: Date },
  storeId: string | undefined
): Promise<
  { ok: true; conditions: SQL[] } | { ok: false; statut: 403 | 404 }
> {
  const conditions: SQL[] = [
    eq(schema.sales.organizationId, organizationId),
    eq(schema.sales.status, "completed"),
    gte(schema.sales.createdAt, bornes.debut),
    lt(schema.sales.createdAt, bornes.finExclue),
  ]
  if (storeId) {
    if (!estDansPortee(portee, storeId)) {
      return { ok: false, statut: 403 }
    }
    if (!(await entrepotDansOrganisation(db, organizationId, storeId))) {
      return { ok: false, statut: 404 }
    }
    conditions.push(eq(schema.sales.storeId, storeId))
  } else {
    const filtre = filtrePortee(portee, schema.sales.storeId)
    // filtre.vide est impossible ici : porteeRapport rend null (403 amont)
    // quand la portée staff est vide.
    if (filtre.condition) {
      conditions.push(filtre.condition)
    }
  }
  return { ok: true, conditions }
}

function panierMoyen(ca: number, tickets: number): number {
  return tickets > 0 ? Math.round(ca / tickets) : 0
}

reportsRoute.get("/sales", async (c) => {
  const { organizationId, role } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const portee = await porteeRapport(
    db,
    organizationId,
    c.get("user").id,
    role,
    "ventes"
  )
  if (!portee) {
    return c.json(REPONSE_ACCES_REFUSE, 403)
  }
  const du = c.req.query("du")
  const au = c.req.query("au")
  const bornes = du && au ? bornesPeriode(du, au) : null
  if (!du || !au || !bornes) {
    return c.json(REPONSE_PERIODE_INVALIDE, 400)
  }
  const groupe = c.req.query("groupe") ?? "boutique"
  if (groupe !== "boutique" && groupe !== "produit") {
    return c.json(
      {
        code: "VALIDATION",
        message: "Le paramètre groupe doit être boutique ou produit",
      },
      400
    )
  }
  const resolution = await conditionsVentes(
    db,
    organizationId,
    portee,
    bornes,
    c.req.query("storeId")
  )
  if (!resolution.ok) {
    return resolution.statut === 403
      ? c.json(REPONSE_ACCES_REFUSE, 403)
      : c.json({ code: "INTROUVABLE", message: "Boutique introuvable" }, 404)
  }
  const { conditions } = resolution

  // Totaux globaux + répartition par méthode (toujours renvoyés — la
  // répartition n'existe qu'au niveau VENTE, table payments : elle n'a pas
  // de sens par produit).
  const totauxRows = await db
    .select({
      ca: sql<number>`COALESCE(SUM(${schema.sales.total}), 0)`,
      tickets: sql<number>`COUNT(*)`,
    })
    .from(schema.sales)
    .where(and(...conditions))
  const totaux = totauxRows[0] ?? { ca: 0, tickets: 0 }
  const parMethode = await db
    .select({
      method: schema.payments.method,
      montant: sql<number>`COALESCE(SUM(${schema.payments.amount}), 0)`,
    })
    .from(schema.payments)
    .innerJoin(schema.sales, eq(schema.payments.saleId, schema.sales.id))
    .where(and(...conditions))
    .groupBy(schema.payments.method)
  const montantMethode = (methode: "cash" | "mobile_money"): number =>
    parMethode.find((m) => m.method === methode)?.montant ?? 0
  const total = {
    ca: totaux.ca,
    tickets: totaux.tickets,
    panierMoyen: panierMoyen(totaux.ca, totaux.tickets),
    cash: montantMethode("cash"),
    mobileMoney: montantMethode("mobile_money"),
  }

  if (groupe === "produit") {
    const lignes = await db
      .select({
        productId: schema.products.id,
        productName: schema.products.name,
        variantId: schema.saleItems.variantId,
        variantName: schema.productVariants.name,
        sku: schema.productVariants.sku,
        quantite: sql<number>`COALESCE(SUM(${schema.saleItems.quantity}), 0)`,
        ca: sql<number>`COALESCE(SUM(${schema.saleItems.quantity} * ${schema.saleItems.unitPrice}), 0)`,
        remise: sql<number>`COALESCE(SUM(${schema.saleItems.quantity} * (${schema.saleItems.catalogPrice} - ${schema.saleItems.unitPrice})), 0)`,
        tickets: sql<number>`COUNT(DISTINCT ${schema.saleItems.saleId})`,
      })
      .from(schema.saleItems)
      .innerJoin(schema.sales, eq(schema.saleItems.saleId, schema.sales.id))
      .innerJoin(
        schema.productVariants,
        eq(schema.saleItems.variantId, schema.productVariants.id)
      )
      .innerJoin(
        schema.products,
        eq(schema.productVariants.productId, schema.products.id)
      )
      .where(and(...conditions))
      .groupBy(schema.saleItems.variantId)
      .orderBy(asc(schema.products.name), asc(schema.productVariants.name))
    if (c.req.query("format") === "csv") {
      const contenu = genererCsv(
        ["Produit", "Variante", "SKU", "Quantité", "CA", "Remises", "Tickets"],
        lignes.map((l) => [
          l.productName,
          l.variantName,
          l.sku,
          l.quantite,
          l.ca,
          l.remise,
          l.tickets,
        ])
      )
      return c.body(contenu, 200, {
        ...ENTETES_CSV,
        "content-disposition": `attachment; filename="rapport-ventes-produits_${du}_${au}.csv"`,
      })
    }
    return c.json({ periode: { du, au }, groupe, total, lignes })
  }

  const boutiques = await db
    .select({
      storeId: schema.sales.storeId,
      storeName: schema.warehouses.name,
      ca: sql<number>`COALESCE(SUM(${schema.sales.total}), 0)`,
      tickets: sql<number>`COUNT(*)`,
    })
    .from(schema.sales)
    .innerJoin(
      schema.warehouses,
      eq(schema.sales.storeId, schema.warehouses.id)
    )
    .where(and(...conditions))
    .groupBy(schema.sales.storeId)
    .orderBy(asc(schema.warehouses.name))
  const paiementsBoutique = await db
    .select({
      storeId: schema.sales.storeId,
      method: schema.payments.method,
      montant: sql<number>`COALESCE(SUM(${schema.payments.amount}), 0)`,
    })
    .from(schema.payments)
    .innerJoin(schema.sales, eq(schema.payments.saleId, schema.sales.id))
    .where(and(...conditions))
    .groupBy(schema.sales.storeId, schema.payments.method)
  const methodeBoutique = (id: string, methode: string): number =>
    paiementsBoutique.find((p) => p.storeId === id && p.method === methode)
      ?.montant ?? 0
  const lignes = boutiques.map((b) => ({
    ...b,
    panierMoyen: panierMoyen(b.ca, b.tickets),
    cash: methodeBoutique(b.storeId, "cash"),
    mobileMoney: methodeBoutique(b.storeId, "mobile_money"),
  }))
  if (c.req.query("format") === "csv") {
    const contenu = genererCsv(
      ["Boutique", "CA", "Tickets", "Panier moyen", "Espèces", "Mobile money"],
      lignes.map((l) => [
        l.storeName,
        l.ca,
        l.tickets,
        l.panierMoyen,
        l.cash,
        l.mobileMoney,
      ])
    )
    return c.body(contenu, 200, {
      ...ENTETES_CSV,
      "content-disposition": `attachment; filename="rapport-ventes-boutiques_${du}_${au}.csv"`,
    })
  }
  return c.json({ periode: { du, au }, groupe, total, lignes })
})
```

- [ ] **Step 4 : Monter la route**

Dans `apps/api/src/index.ts`, ajouter l'import après celui de `salesRoute` :

```ts
import { reportsRoute } from "./routes/reports"
```

et le montage après `app.route("/api/v1/sales", salesRoute)` :

```ts
app.route("/api/v1/reports", reportsRoute)
```

- [ ] **Step 5 : Vérifier que les tests passent**

Run: `cd apps/api && bunx vitest run test/reports-sales.test.ts`
Expected: PASS 7/7.

- [ ] **Step 6 : Commit**

```bash
git add apps/api/src/routes/reports.ts apps/api/src/index.ts apps/api/test/reports-sales.test.ts
git commit -m "feat: rapport des ventes /api/v1/reports/sales — agrégats boutique/produit, répartition par méthode, export CSV"
```

---

### Task 7: `GET /api/v1/reports/valuation` — valorisation du stock (+ export CSV)

Photographie de `stock_levels` : quantité × CMP par variante, regroupée par entrepôt, avec totaux par entrepôt et global. Le SEUL rapport ouvert à `stock_manager`.

**Files:**
- Modify: `apps/api/src/routes/reports.ts` (nouveau handler)
- Test: `apps/api/test/reports-valuation.test.ts` (nouveau)

**Interfaces:**
- Consumes: `porteeRapport(…, "valorisation")` (Task 5), `entrepotDansOrganisation` + `REPONSE_ACCES_REFUSE` + `ENTETES_CSV` (Task 6, même fichier), `filtrePortee`/`estDansPortee`, `genererCsv`.
- Produces: `GET /reports/valuation[?warehouseId=…][&format=csv]` → `{ entrepots: [{ warehouseId, warehouseName, valeur, lignes: [{ variantId, productName, variantName, sku, quantity, avgCost, valeur }] }], total }`. CSV plat : en-têtes `Entrepôt;Produit;Variante;SKU;Quantité;CMP;Valeur`, fichier `rapport-valorisation_<AAAA-MM-JJ>.csv` (date serveur UTC). Consommé par les Tasks 10-12.

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `apps/api/test/reports-valuation.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import app from "../src/index"
import * as schema from "../src/db/schema"
import { applyMovements } from "../src/services/stock"
import {
  affecterEntrepot,
  bootstrapOwner,
  createUserWithRole,
  creerEntrepot,
  creerProduitSimple,
} from "./helpers"

function req(cookie: string, method: string, url: string) {
  return app.request(url, { method, headers: { cookie } }, env)
}

type LigneValo = {
  variantId: string
  productName: string
  quantity: number
  avgCost: number
  valeur: number
}
type EntrepotValo = {
  warehouseId: string
  warehouseName: string
  valeur: number
  lignes: LigneValo[]
}
type Rapport = { entrepots: EntrepotValo[]; total: number }
type Erreur = { code: string }

// Dépôt : v1 = 10 @ 200 (2000). Boutique : v2 = 5 @ 400 (2000).
// v3 : entré 5 @ 100 puis ajusté à 0 → EXCLU (quantity > 0 seulement).
async function seedValo() {
  const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
  const depotId = await creerEntrepot(organizationId, "Dépôt Central")
  const boutiqueId = await creerEntrepot(organizationId, "Boutique Valo", "store")
  const v1 = await creerProduitSimple(organizationId, { nom: "Article Un" })
  const v2 = await creerProduitSimple(organizationId, { nom: "Article Deux" })
  const v3 = await creerProduitSimple(organizationId, { nom: "Article Vide" })
  const db = drizzle(env.DB, { schema })
  await applyMovements(db, {
    organizationId,
    userId: ownerId,
    mouvements: [
      { warehouseId: depotId, variantId: v1.variantId, delta: 10, type: "purchase", unitCost: 200 },
      { warehouseId: boutiqueId, variantId: v2.variantId, delta: 5, type: "purchase", unitCost: 400 },
      { warehouseId: depotId, variantId: v3.variantId, delta: 5, type: "purchase", unitCost: 100 },
    ],
  })
  await applyMovements(db, {
    organizationId,
    userId: ownerId,
    mouvements: [
      {
        warehouseId: depotId,
        variantId: v3.variantId,
        delta: -5,
        type: "adjustment",
        reason: "vidage test",
      },
    ],
  })
  return { organizationId, ownerCookie, depotId, boutiqueId, v1, v2, v3 }
}

describe("GET /api/v1/reports/valuation", () => {
  it("valorise quantité × CMP par variante, totaux par entrepôt et global ; quantité 0 exclue", async () => {
    const { ownerCookie, depotId, boutiqueId, v1, v3 } = await seedValo()
    const res = await req(ownerCookie, "GET", "/api/v1/reports/valuation")
    expect(res.status).toBe(200)
    const { entrepots, total } = await res.json<Rapport>()
    expect(total).toBe(4000)
    expect(entrepots).toHaveLength(2)
    const depot = entrepots.find((e) => e.warehouseId === depotId)
    expect(depot?.valeur).toBe(2000)
    expect(depot?.lignes).toHaveLength(1)
    expect(depot?.lignes[0]).toEqual({
      variantId: v1.variantId,
      productName: "Article Un",
      variantName: "Standard",
      sku: depot.lignes[0].sku,
      quantity: 10,
      avgCost: 200,
      valeur: 2000,
    })
    const idsDepot = depot?.lignes.map((l) => l.variantId) ?? []
    expect(idsDepot).not.toContain(v3.variantId)
    const boutique = entrepots.find((e) => e.warehouseId === boutiqueId)
    expect(boutique?.valeur).toBe(2000)
  })

  it("stock_manager : 200 sur TOUS les entrepôts (son seul rapport)", async () => {
    const { organizationId } = await seedValo()
    const gestionnaire = await createUserWithRole(
      organizationId,
      "stock_manager"
    )
    const res = await req(
      gestionnaire.cookie,
      "GET",
      "/api/v1/reports/valuation"
    )
    expect(res.status).toBe(200)
    expect((await res.json<Rapport>()).total).toBe(4000)
  })

  it("manager local : SES entrepôts seulement ; warehouseId hors portée 403", async () => {
    const { organizationId, depotId, boutiqueId } = await seedValo()
    const manager = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, manager.userId, boutiqueId, "manager")
    const res = await req(manager.cookie, "GET", "/api/v1/reports/valuation")
    expect(res.status).toBe(200)
    const { entrepots, total } = await res.json<Rapport>()
    expect(total).toBe(2000)
    expect(entrepots).toHaveLength(1)
    expect(entrepots[0].warehouseId).toBe(boutiqueId)
    const horsPortee = await req(
      manager.cookie,
      "GET",
      `/api/v1/reports/valuation?warehouseId=${depotId}`
    )
    expect(horsPortee.status).toBe(403)
  })

  it("caissier pur : 403 ; warehouseId inexistant : 404", async () => {
    const { organizationId, ownerCookie, boutiqueId } = await seedValo()
    const caissier = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, caissier.userId, boutiqueId, "cashier")
    const refus = await req(caissier.cookie, "GET", "/api/v1/reports/valuation")
    expect(refus.status).toBe(403)
    expect((await refus.json<Erreur>()).code).toBe("ACCES_REFUSE")
    const inconnu = await req(
      ownerCookie,
      "GET",
      `/api/v1/reports/valuation?warehouseId=${crypto.randomUUID()}`
    )
    expect(inconnu.status).toBe(404)
  })

  it("format=csv : plat, en-têtes français, nom daté", async () => {
    const { ownerCookie } = await seedValo()
    const res = await req(
      ownerCookie,
      "GET",
      "/api/v1/reports/valuation?format=csv"
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/csv")
    const jour = new Date().toISOString().slice(0, 10)
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="rapport-valorisation_${jour}.csv"`
    )
    const lignes = (await res.text()).slice(1).split("\r\n")
    expect(lignes[0]).toBe("Entrepôt;Produit;Variante;SKU;Quantité;CMP;Valeur")
    expect(
      lignes.some((l) => l.startsWith("Dépôt Central;Article Un;Standard;"))
    ).toBe(true)
  })
})
```

Nota : dans le premier test, TypeScript exigera un garde — écrire `const depot = entrepots.find(…)` puis `if (!depot) throw new Error("dépôt absent du rapport")` avant les assertions sur `depot.lignes[0]` (et remplacer `depot?.` par `depot.`) pour éviter `sku: depot.lignes[0].sku` sur un objet possiblement `undefined`. Version finale du bloc :

```ts
    const depot = entrepots.find((e) => e.warehouseId === depotId)
    if (!depot) throw new Error("dépôt absent du rapport")
    expect(depot.valeur).toBe(2000)
    expect(depot.lignes).toHaveLength(1)
    expect(depot.lignes[0].quantity).toBe(10)
    expect(depot.lignes[0].avgCost).toBe(200)
    expect(depot.lignes[0].valeur).toBe(2000)
    expect(depot.lignes[0].productName).toBe("Article Un")
    const idsDepot = depot.lignes.map((l) => l.variantId)
    expect(idsDepot).not.toContain(v3.variantId)
    void v1
```

- [ ] **Step 2 : Vérifier que les tests échouent**

Run: `cd apps/api && bunx vitest run test/reports-valuation.test.ts`
Expected: FAIL — 404 sur `/api/v1/reports/valuation`.

- [ ] **Step 3 : Implémenter le handler**

Ajouter à la FIN de `apps/api/src/routes/reports.ts` (avant la fin du fichier) :

```ts
type LigneValorisation = {
  variantId: string
  productName: string
  variantName: string
  sku: string
  quantity: number
  avgCost: number
  valeur: number
}

type EntrepotValorisation = {
  warehouseId: string
  warehouseName: string
  valeur: number
  lignes: LigneValorisation[]
}

// Valorisation du stock (spec §6) : photographie de stock_levels COURANT —
// pas de période. quantity > 0 seulement ; produits INACTIFS inclus (la
// valeur physique ne disparaît pas quand un produit quitte le catalogue —
// décision 6 du plan). Seul rapport ouvert à stock_manager.
reportsRoute.get("/valuation", async (c) => {
  const { organizationId, role } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const portee = await porteeRapport(
    db,
    organizationId,
    c.get("user").id,
    role,
    "valorisation"
  )
  if (!portee) {
    return c.json(REPONSE_ACCES_REFUSE, 403)
  }
  const warehouseId = c.req.query("warehouseId")
  const conditions: SQL[] = [
    eq(schema.stockLevels.organizationId, organizationId),
    gt(schema.stockLevels.quantity, 0),
  ]
  if (warehouseId) {
    if (!estDansPortee(portee, warehouseId)) {
      return c.json(REPONSE_ACCES_REFUSE, 403)
    }
    if (!(await entrepotDansOrganisation(db, organizationId, warehouseId))) {
      return c.json(
        { code: "INTROUVABLE", message: "Entrepôt introuvable" },
        404
      )
    }
    conditions.push(eq(schema.stockLevels.warehouseId, warehouseId))
  } else {
    const filtre = filtrePortee(portee, schema.stockLevels.warehouseId)
    if (filtre.condition) {
      conditions.push(filtre.condition)
    }
  }
  const lignes = await db
    .select({
      warehouseId: schema.stockLevels.warehouseId,
      warehouseName: schema.warehouses.name,
      variantId: schema.stockLevels.variantId,
      productName: schema.products.name,
      variantName: schema.productVariants.name,
      sku: schema.productVariants.sku,
      quantity: schema.stockLevels.quantity,
      avgCost: schema.stockLevels.avgCost,
      valeur: sql<number>`${schema.stockLevels.quantity} * ${schema.stockLevels.avgCost}`,
    })
    .from(schema.stockLevels)
    .innerJoin(
      schema.productVariants,
      eq(schema.stockLevels.variantId, schema.productVariants.id)
    )
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id)
    )
    .innerJoin(
      schema.warehouses,
      eq(schema.stockLevels.warehouseId, schema.warehouses.id)
    )
    .where(and(...conditions))
    .orderBy(
      asc(schema.warehouses.name),
      asc(schema.products.name),
      asc(schema.productVariants.name)
    )
  if (c.req.query("format") === "csv") {
    const contenu = genererCsv(
      ["Entrepôt", "Produit", "Variante", "SKU", "Quantité", "CMP", "Valeur"],
      lignes.map((l) => [
        l.warehouseName,
        l.productName,
        l.variantName,
        l.sku,
        l.quantity,
        l.avgCost,
        l.valeur,
      ])
    )
    const jour = new Date().toISOString().slice(0, 10)
    return c.body(contenu, 200, {
      ...ENTETES_CSV,
      "content-disposition": `attachment; filename="rapport-valorisation_${jour}.csv"`,
    })
  }
  // Regroupement hiérarchique par entrepôt (la valeur par ligne reste
  // calculée en SQL ; ici on ne fait que plier la liste triée).
  const entrepots: EntrepotValorisation[] = []
  for (const ligne of lignes) {
    let entrepot = entrepots.find((e) => e.warehouseId === ligne.warehouseId)
    if (!entrepot) {
      entrepot = {
        warehouseId: ligne.warehouseId,
        warehouseName: ligne.warehouseName,
        valeur: 0,
        lignes: [],
      }
      entrepots.push(entrepot)
    }
    entrepot.valeur += ligne.valeur
    entrepot.lignes.push({
      variantId: ligne.variantId,
      productName: ligne.productName,
      variantName: ligne.variantName,
      sku: ligne.sku,
      quantity: ligne.quantity,
      avgCost: ligne.avgCost,
      valeur: ligne.valeur,
    })
  }
  const total = entrepots.reduce((somme, e) => somme + e.valeur, 0)
  return c.json({ entrepots, total })
})
```

et compléter l'import drizzle en tête de fichier : `import { and, asc, eq, gt, gte, lt, sql } from "drizzle-orm"` (ajout de `gt`).

- [ ] **Step 4 : Vérifier que les tests passent**

Run: `cd apps/api && bunx vitest run test/reports-valuation.test.ts`
Expected: PASS 5/5.

- [ ] **Step 5 : Commit**

```bash
git add apps/api/src/routes/reports.ts apps/api/test/reports-valuation.test.ts
git commit -m "feat: rapport de valorisation /api/v1/reports/valuation — quantité × CMP par entrepôt, export CSV, ouvert à stock_manager"
```

---

### Task 8: `GET /api/v1/reports/margins` (+ CSV) et marge sur `GET /api/v1/sales/:id`

Marges = CA − coût au `unitCost` figé ; les lignes historiques `unit_cost` NULL sont valorisées au CMP COURANT du niveau (source, variante) et marquées `estime: true`. Le détail d'une vente expose la même marge à qui y a droit (`marge: null` sinon).

**Files:**
- Modify: `apps/api/src/routes/reports.ts` (handler `/margins`)
- Modify: `apps/api/src/routes/sales.ts` (GET `/:id` → `{ sale, marge }`)
- Test: `apps/api/test/reports-margins.test.ts` (nouveau)

**Interfaces:**
- Consumes: `sale_items.unitCost` (Task 4), `conditionsVentes`/`entrepotDansOrganisation`/`REPONSE_ACCES_REFUSE`/`REPONSE_PERIODE_INVALIDE`/`ENTETES_CSV` (Task 6), `porteeRapport(…, "marges")` (Task 5), `verifierAccesEntrepot`/`warehouseMembers` (existant).
- Produces:
  - `GET /reports/margins?du&au[&storeId][&format=csv]` → `{ periode: { du, au }, total: { ca, cout, marge, estime }, lignes: [{ productId, productName, variantId, variantName, sku, quantite, ca, cout, marge, estime }] }` ; CSV `Produit;Variante;SKU;Quantité;CA;Coût;Marge;Estimé` (colonne Estimé = `oui` ou vide), fichier `rapport-marges_<du>_<au>.csv`.
  - `GET /sales/:id` → `{ sale, marge: { cout, marge, estime } | null }` (champ ADDITIF — les consommateurs POS `{ sale }` sont intacts). Consommé par les Tasks 10-12.

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `apps/api/test/reports-margins.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import app from "../src/index"
import * as schema from "../src/db/schema"
import { applyMovements } from "../src/services/stock"
import {
  affecterEntrepot,
  bootstrapOwner,
  createUserWithRole,
  creerEntrepot,
  creerProduitSimple,
} from "./helpers"

function req(cookie: string, method: string, url: string, body?: unknown) {
  return app.request(
    url,
    {
      method,
      headers: { "content-type": "application/json", cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env
  )
}

type LigneMarge = {
  productName: string
  quantite: number
  ca: number
  cout: number
  marge: number
  estime: boolean
}
type Rapport = {
  total: { ca: number; cout: number; marge: number; estime: boolean }
  lignes: LigneMarge[]
}
type DetailVente = {
  sale: { id: string }
  marge: { cout: number; marge: number; estime: boolean } | null
}

const JOUR = new Date().toISOString().slice(0, 10)

// Boutique CMP 200, produit 500, caissier avec session ouverte ; une vente
// nominale 2 × 500 (coût gelé 2 × 200).
async function seedMarges() {
  const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
  const storeId = await creerEntrepot(organizationId, "Boutique M", "store")
  const caissier = await createUserWithRole(organizationId, "staff")
  await affecterEntrepot(organizationId, caissier.userId, storeId, "cashier")
  const { variantId } = await creerProduitSimple(organizationId, {
    nom: "Produit M",
    prix: 500,
  })
  const db = drizzle(env.DB, { schema })
  await applyMovements(db, {
    organizationId,
    userId: ownerId,
    mouvements: [
      { warehouseId: storeId, variantId, delta: 20, type: "purchase", unitCost: 200 },
    ],
  })
  const ouverture = await req(
    caissier.cookie,
    "POST",
    "/api/v1/register-sessions",
    { storeId, openingFloat: 0 }
  )
  const { id: sessionId } = await ouverture.json<{ id: string }>()
  const vente = await req(caissier.cookie, "POST", "/api/v1/sales", {
    storeId,
    clientRequestId: crypto.randomUUID(),
    items: [{ variantId, quantity: 2, unitPrice: 500 }],
    payments: [{ method: "cash", amount: 1000 }],
  })
  expect(vente.status).toBe(201)
  const { sale } = await vente.json<{ sale: { id: string } }>()
  return {
    organizationId,
    ownerId,
    ownerCookie,
    storeId,
    caissier,
    variantId,
    sessionId,
    saleId: sale.id,
    db,
  }
}

// Vente « historique » (antérieure à la colonne unit_cost) : INSERT direct
// en base avec unit_cost NULL — les triggers 0014 ne bloquent que
// UPDATE/DELETE, et la session du seed est ouverte (sales_session_ouverte).
async function insererVenteHistorique(
  seed: Awaited<ReturnType<typeof seedMarges>>
) {
  const saleId = crypto.randomUUID()
  const maintenant = new Date()
  await seed.db.insert(schema.sales).values({
    id: saleId,
    organizationId: seed.organizationId,
    storeId: seed.storeId,
    registerSessionId: seed.sessionId,
    cashierId: seed.caissier.userId,
    ticketNumber: 9999,
    total: 500,
    currency: "XOF",
    clientRequestId: crypto.randomUUID(),
    createdAt: maintenant,
  })
  await seed.db.insert(schema.saleItems).values({
    id: crypto.randomUUID(),
    organizationId: seed.organizationId,
    saleId,
    variantId: seed.variantId,
    sourceWarehouseId: seed.storeId,
    quantity: 1,
    unitPrice: 500,
    catalogPrice: 500,
    createdAt: maintenant,
  })
  return saleId
}

describe("GET /api/v1/reports/margins", () => {
  it("marge au unitCost FIGÉ, insensible aux réceptions ultérieures", async () => {
    const seed = await seedMarges()
    const avant = await req(
      seed.ownerCookie,
      "GET",
      `/api/v1/reports/margins?du=${JOUR}&au=${JOUR}`
    )
    expect(avant.status).toBe(200)
    const rapportAvant = await avant.json<Rapport>()
    expect(rapportAvant.total).toEqual({
      ca: 1000,
      cout: 400,
      marge: 600,
      estime: false,
    })
    expect(rapportAvant.lignes).toHaveLength(1)
    expect(rapportAvant.lignes[0].quantite).toBe(2)
    // Réception qui change le CMP : la marge de la vente passée NE BOUGE PAS
    await applyMovements(seed.db, {
      organizationId: seed.organizationId,
      userId: seed.ownerId,
      mouvements: [
        {
          warehouseId: seed.storeId,
          variantId: seed.variantId,
          delta: 10,
          type: "purchase",
          unitCost: 800,
        },
      ],
    })
    const apres = await req(
      seed.ownerCookie,
      "GET",
      `/api/v1/reports/margins?du=${JOUR}&au=${JOUR}`
    )
    expect((await apres.json<Rapport>()).total.cout).toBe(400)
  })

  it("ligne historique unit_cost NULL : valorisée au CMP COURANT, marquée estimée", async () => {
    const seed = await seedMarges()
    await insererVenteHistorique(seed)
    const res = await req(
      seed.ownerCookie,
      "GET",
      `/api/v1/reports/margins?du=${JOUR}&au=${JOUR}`
    )
    const rapport = await res.json<Rapport>()
    // 2 × 200 gelés + 1 × 200 (CMP courant, estimé)
    expect(rapport.total).toEqual({
      ca: 1500,
      cout: 600,
      marge: 900,
      estime: true,
    })
    expect(rapport.lignes[0].estime).toBe(true)
  })

  it("portée : stock_manager 403 ; manager local 200 ; caissier 403", async () => {
    const seed = await seedMarges()
    const gestionnaire = await createUserWithRole(
      seed.organizationId,
      "stock_manager"
    )
    expect(
      (
        await req(
          gestionnaire.cookie,
          "GET",
          `/api/v1/reports/margins?du=${JOUR}&au=${JOUR}`
        )
      ).status
    ).toBe(403)
    const manager = await createUserWithRole(seed.organizationId, "staff")
    await affecterEntrepot(
      seed.organizationId,
      manager.userId,
      seed.storeId,
      "manager"
    )
    const vueManager = await req(
      manager.cookie,
      "GET",
      `/api/v1/reports/margins?du=${JOUR}&au=${JOUR}`
    )
    expect(vueManager.status).toBe(200)
    expect((await vueManager.json<Rapport>()).total.marge).toBe(600)
    expect(
      (
        await req(
          seed.caissier.cookie,
          "GET",
          `/api/v1/reports/margins?du=${JOUR}&au=${JOUR}`
        )
      ).status
    ).toBe(403)
  })

  it("format=csv : en-têtes français, colonne Estimé oui/vide", async () => {
    const seed = await seedMarges()
    await insererVenteHistorique(seed)
    const res = await req(
      seed.ownerCookie,
      "GET",
      `/api/v1/reports/margins?du=${JOUR}&au=${JOUR}&format=csv`
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="rapport-marges_${JOUR}_${JOUR}.csv"`
    )
    const lignes = (await res.text()).slice(1).split("\r\n")
    expect(lignes[0]).toBe("Produit;Variante;SKU;Quantité;CA;Coût;Marge;Estimé")
    expect(
      lignes.some((l) => l.startsWith("Produit M;Standard;") && l.endsWith(";oui"))
    ).toBe(true)
  })
})

describe("GET /api/v1/sales/:id — marge du détail", () => {
  it("owner : marge présente ; caissier : marge null (le détail reste lisible)", async () => {
    const seed = await seedMarges()
    const vueOwner = await req(
      seed.ownerCookie,
      "GET",
      `/api/v1/sales/${seed.saleId}`
    )
    expect(vueOwner.status).toBe(200)
    const detailOwner = await vueOwner.json<DetailVente>()
    expect(detailOwner.marge).toEqual({ cout: 400, marge: 600, estime: false })
    const vueCaissier = await req(
      seed.caissier.cookie,
      "GET",
      `/api/v1/sales/${seed.saleId}`
    )
    expect(vueCaissier.status).toBe(200)
    const detailCaissier = await vueCaissier.json<DetailVente>()
    expect(detailCaissier.sale.id).toBe(seed.saleId)
    expect(detailCaissier.marge).toBeNull()
  })

  it("manager local : marge présente", async () => {
    const seed = await seedMarges()
    const manager = await createUserWithRole(seed.organizationId, "staff")
    await affecterEntrepot(
      seed.organizationId,
      manager.userId,
      seed.storeId,
      "manager"
    )
    const res = await req(manager.cookie, "GET", `/api/v1/sales/${seed.saleId}`)
    expect(res.status).toBe(200)
    expect((await res.json<DetailVente>()).marge?.marge).toBe(600)
  })
})
```

- [ ] **Step 2 : Vérifier que les tests échouent**

Run: `cd apps/api && bunx vitest run test/reports-margins.test.ts`
Expected: FAIL — 404 sur `/reports/margins` ; `marge` absent (undefined) du détail de vente.

- [ ] **Step 3 : Implémenter `/margins`**

Ajouter à la FIN de `apps/api/src/routes/reports.ts` :

```ts
// Marges (spec §6) : CA − coût au unitCost FIGÉ (Task 4). Les lignes
// antérieures à la colonne (unit_cost NULL) sont valorisées au CMP COURANT
// du niveau (entrepôt SOURCE, variante) via LEFT JOIN — et le groupe est
// marqué estime: true (décision 5 du plan). Fermé à stock_manager.
reportsRoute.get("/margins", async (c) => {
  const { organizationId, role } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const portee = await porteeRapport(
    db,
    organizationId,
    c.get("user").id,
    role,
    "marges"
  )
  if (!portee) {
    return c.json(REPONSE_ACCES_REFUSE, 403)
  }
  const du = c.req.query("du")
  const au = c.req.query("au")
  const bornes = du && au ? bornesPeriode(du, au) : null
  if (!du || !au || !bornes) {
    return c.json(REPONSE_PERIODE_INVALIDE, 400)
  }
  const resolution = await conditionsVentes(
    db,
    organizationId,
    portee,
    bornes,
    c.req.query("storeId")
  )
  if (!resolution.ok) {
    return resolution.statut === 403
      ? c.json(REPONSE_ACCES_REFUSE, 403)
      : c.json({ code: "INTROUVABLE", message: "Boutique introuvable" }, 404)
  }
  const groupes = await db
    .select({
      productId: schema.products.id,
      productName: schema.products.name,
      variantId: schema.saleItems.variantId,
      variantName: schema.productVariants.name,
      sku: schema.productVariants.sku,
      quantite: sql<number>`COALESCE(SUM(${schema.saleItems.quantity}), 0)`,
      ca: sql<number>`COALESCE(SUM(${schema.saleItems.quantity} * ${schema.saleItems.unitPrice}), 0)`,
      cout: sql<number>`COALESCE(SUM(${schema.saleItems.quantity} * COALESCE(${schema.saleItems.unitCost}, ${schema.stockLevels.avgCost}, 0)), 0)`,
      lignesEstimees: sql<number>`COALESCE(SUM(CASE WHEN ${schema.saleItems.unitCost} IS NULL THEN 1 ELSE 0 END), 0)`,
    })
    .from(schema.saleItems)
    .innerJoin(schema.sales, eq(schema.saleItems.saleId, schema.sales.id))
    .innerJoin(
      schema.productVariants,
      eq(schema.saleItems.variantId, schema.productVariants.id)
    )
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id)
    )
    .leftJoin(
      schema.stockLevels,
      and(
        eq(schema.stockLevels.warehouseId, schema.saleItems.sourceWarehouseId),
        eq(schema.stockLevels.variantId, schema.saleItems.variantId)
      )
    )
    .where(and(...resolution.conditions))
    .groupBy(schema.saleItems.variantId)
    .orderBy(asc(schema.products.name), asc(schema.productVariants.name))
  const lignes = groupes.map((g) => ({
    productId: g.productId,
    productName: g.productName,
    variantId: g.variantId,
    variantName: g.variantName,
    sku: g.sku,
    quantite: g.quantite,
    ca: g.ca,
    cout: g.cout,
    marge: g.ca - g.cout,
    estime: g.lignesEstimees > 0,
  }))
  const totalCa = lignes.reduce((somme, l) => somme + l.ca, 0)
  const totalCout = lignes.reduce((somme, l) => somme + l.cout, 0)
  const total = {
    ca: totalCa,
    cout: totalCout,
    marge: totalCa - totalCout,
    estime: lignes.some((l) => l.estime),
  }
  if (c.req.query("format") === "csv") {
    const contenu = genererCsv(
      ["Produit", "Variante", "SKU", "Quantité", "CA", "Coût", "Marge", "Estimé"],
      lignes.map((l) => [
        l.productName,
        l.variantName,
        l.sku,
        l.quantite,
        l.ca,
        l.cout,
        l.marge,
        l.estime ? "oui" : "",
      ])
    )
    return c.body(contenu, 200, {
      ...ENTETES_CSV,
      "content-disposition": `attachment; filename="rapport-marges_${du}_${au}.csv"`,
    })
  }
  return c.json({ periode: { du, au }, total, lignes })
})
```

- [ ] **Step 4 : Marge sur `GET /sales/:id`**

Dans `apps/api/src/routes/sales.ts`, ajouter APRÈS la fonction `verifierLectureVentes` :

```ts
// Marge du détail de vente (Phase 7, décision 9 du plan) : réservée à qui a
// droit aux marges sur la boutique — org owner/admin/auditor OU rôle local
// manager/auditor. JAMAIS cashier ni stock_manager : la réponse porte
// marge: null pour eux (aucun coût n'est exposé).
async function peutVoirMarge(
  c: Parameters<typeof verifierAccesEntrepot>[0],
  db: Db,
  organizationId: string,
  storeId: string
): Promise<boolean> {
  const { role } = c.get("membership")
  if (role === "owner" || role === "admin" || role === "auditor") {
    return true
  }
  if (role === "stock_manager") {
    return false
  }
  const rows = await db
    .select({ id: schema.warehouseMembers.id })
    .from(schema.warehouseMembers)
    .where(
      and(
        eq(schema.warehouseMembers.warehouseId, storeId),
        eq(schema.warehouseMembers.userId, c.get("user").id),
        eq(schema.warehouseMembers.organizationId, organizationId),
        inArray(schema.warehouseMembers.role, ["manager", "auditor"])
      )
    )
    .limit(1)
  return rows.length > 0
}

// Coût de la vente au unitCost figé, lignes NULL au CMP courant du niveau
// (source, variante) — même formule que /reports/margins.
async function margeVente(
  db: Db,
  saleId: string
): Promise<{ cout: number; marge: number; estime: boolean }> {
  const rows = await db
    .select({
      ca: sql<number>`COALESCE(SUM(${schema.saleItems.quantity} * ${schema.saleItems.unitPrice}), 0)`,
      cout: sql<number>`COALESCE(SUM(${schema.saleItems.quantity} * COALESCE(${schema.saleItems.unitCost}, ${schema.stockLevels.avgCost}, 0)), 0)`,
      lignesEstimees: sql<number>`COALESCE(SUM(CASE WHEN ${schema.saleItems.unitCost} IS NULL THEN 1 ELSE 0 END), 0)`,
    })
    .from(schema.saleItems)
    .leftJoin(
      schema.stockLevels,
      and(
        eq(schema.stockLevels.warehouseId, schema.saleItems.sourceWarehouseId),
        eq(schema.stockLevels.variantId, schema.saleItems.variantId)
      )
    )
    .where(eq(schema.saleItems.saleId, saleId))
  const agregat = rows[0] ?? { ca: 0, cout: 0, lignesEstimees: 0 }
  return {
    cout: agregat.cout,
    marge: agregat.ca - agregat.cout,
    estime: agregat.lignesEstimees > 0,
  }
}
```

puis remplacer le handler GET `/:id` :

```ts
salesRoute.get("/:id", async (c) => {
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const vente = await venteBoutique(db, organizationId, c.req.param("id"))
  if (!vente) {
    return c.json({ code: "INTROUVABLE", message: "Vente introuvable" }, 404)
  }
  const refus = await verifierLectureVentes(c, vente.storeId)
  if (refus) return refus
  return c.json({ sale: await chargerVente(db, organizationId, vente.id) })
})
```

par :

```ts
salesRoute.get("/:id", async (c) => {
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const vente = await venteBoutique(db, organizationId, c.req.param("id"))
  if (!vente) {
    return c.json({ code: "INTROUVABLE", message: "Vente introuvable" }, 404)
  }
  const refus = await verifierLectureVentes(c, vente.storeId)
  if (refus) return refus
  // marge: null si l'appelant n'y a pas droit (champ ADDITIF — les
  // consommateurs POS existants lisent { sale } sans changement).
  const marge = (await peutVoirMarge(c, db, organizationId, vente.storeId))
    ? await margeVente(db, vente.id)
    : null
  return c.json({ sale: await chargerVente(db, organizationId, vente.id), marge })
})
```

- [ ] **Step 5 : Vérifier que les tests passent**

Run: `cd apps/api && bunx vitest run test/reports-margins.test.ts`
Expected: PASS 6/6.

- [ ] **Step 6 : Suite api complète**

Run: `cd apps/api && bun run test`
Expected: tout vert (les tests existants de GET /sales/:id tolèrent le champ additif `marge`).

- [ ] **Step 7 : Commit**

```bash
git add apps/api/src/routes/reports.ts apps/api/src/routes/sales.ts apps/api/test/reports-margins.test.ts
git commit -m "feat: rapport des marges /api/v1/reports/margins (unitCost figé, fallback CMP estimé) + marge sur le détail de vente"
```

---

### Task 9: `GET /api/v1/sales` — période `du`/`au` et pagination (+ tickets du jour paginés)

Solde le différé P6 « limite fixe 200 tickets sans pagination » et ouvre l'historique multi-jours du back-office (Task 10) : `jour` (existant) OU `du`+`au`, `page`/`parPage`, réponse `{ sales, total, page, parPage }` rétrocompatible. La modale POS « Tickets du jour » pagine.

**Files:**
- Modify: `apps/api/src/routes/sales.ts` (handler GET `/`)
- Modify: `apps/web/src/lib/pos-api.ts` (`fetchVentesDuJour` + type `PageVentes`)
- Modify: `apps/web/src/pos/tickets-du-jour.tsx` (état `page` + barre de pagination)
- Modify: `apps/web/src/pos/tickets-du-jour.test.tsx` (mocks au nouveau type + test de pagination)
- Test: `apps/api/test/sales-pagination.test.ts` (nouveau)

**Interfaces:**
- Consumes: `bornesPeriode` (Task 5), handler GET `/` existant (`verifierLectureVentes`, conditions, agrégat `itemCount`).
- Produces: contrat `GET /sales?storeId=…[&jour=…][&du=…&au=…][&sessionId=…][&page=1][&parPage=50]` → `{ sales: VenteListe[], total, page, parPage }` (`parPage` ∈ [1, 200]) — **consommé par la Task 10** (`fetchVentesPeriode`) ; `export type PageVentes = { sales: VenteListe[]; total: number; page: number; parPage: number }` dans `apps/web/src/lib/pos-api.ts` ; `fetchVentesDuJour(storeId: string, jour: string, page = 1): Promise<PageVentes>`.

- [ ] **Step 1 : Écrire les tests API qui échouent**

Créer `apps/api/test/sales-pagination.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import app from "../src/index"
import * as schema from "../src/db/schema"
import { applyMovements } from "../src/services/stock"
import {
  affecterEntrepot,
  bootstrapOwner,
  createUserWithRole,
  creerEntrepot,
  creerProduitSimple,
} from "./helpers"

function req(cookie: string, method: string, url: string, body?: unknown) {
  return app.request(
    url,
    {
      method,
      headers: { "content-type": "application/json", cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env
  )
}

type Page = {
  sales: Array<{ ticketNumber: number }>
  total: number
  page: number
  parPage: number
}

const JOUR = new Date().toISOString().slice(0, 10)

async function seedTrois() {
  const { organizationId, ownerId } = await bootstrapOwner()
  const storeId = await creerEntrepot(organizationId, "Boutique Pg", "store")
  const caissier = await createUserWithRole(organizationId, "staff")
  await affecterEntrepot(organizationId, caissier.userId, storeId, "cashier")
  const { variantId } = await creerProduitSimple(organizationId, {
    nom: "Produit Pg",
    prix: 500,
  })
  const db = drizzle(env.DB, { schema })
  await applyMovements(db, {
    organizationId,
    userId: ownerId,
    mouvements: [
      { warehouseId: storeId, variantId, delta: 30, type: "purchase", unitCost: 100 },
    ],
  })
  const ouverture = await req(
    caissier.cookie,
    "POST",
    "/api/v1/register-sessions",
    { storeId, openingFloat: 0 }
  )
  expect(ouverture.status).toBe(201)
  for (let i = 0; i < 3; i += 1) {
    const res = await req(caissier.cookie, "POST", "/api/v1/sales", {
      storeId,
      clientRequestId: crypto.randomUUID(),
      items: [{ variantId, quantity: 1, unitPrice: 500 }],
      payments: [{ method: "cash", amount: 500 }],
    })
    expect(res.status).toBe(201)
  }
  return { storeId, caissier }
}

describe("GET /api/v1/sales — période et pagination", () => {
  it("pagine avec total (parPage=2 : page 1 → 2 ventes, page 2 → 1)", async () => {
    const { storeId, caissier } = await seedTrois()
    const page1 = await req(
      caissier.cookie,
      "GET",
      `/api/v1/sales?storeId=${storeId}&jour=${JOUR}&page=1&parPage=2`
    )
    expect(page1.status).toBe(200)
    const corps1 = await page1.json<Page>()
    expect(corps1.total).toBe(3)
    expect(corps1.page).toBe(1)
    expect(corps1.parPage).toBe(2)
    expect(corps1.sales).toHaveLength(2)
    // Tri desc conservé : tickets 3 puis 2
    expect(corps1.sales[0].ticketNumber).toBe(3)
    const page2 = await req(
      caissier.cookie,
      "GET",
      `/api/v1/sales?storeId=${storeId}&jour=${JOUR}&page=2&parPage=2`
    )
    const corps2 = await page2.json<Page>()
    expect(corps2.sales).toHaveLength(1)
    expect(corps2.sales[0].ticketNumber).toBe(1)
  })

  it("filtre par période du/au (bornes UTC, fin incluse)", async () => {
    const { storeId, caissier } = await seedTrois()
    const dansPeriode = await req(
      caissier.cookie,
      "GET",
      `/api/v1/sales?storeId=${storeId}&du=${JOUR}&au=${JOUR}`
    )
    expect((await dansPeriode.json<Page>()).total).toBe(3)
    const horsPeriode = await req(
      caissier.cookie,
      "GET",
      `/api/v1/sales?storeId=${storeId}&du=2000-01-01&au=2000-01-02`
    )
    const corpsHors = await horsPeriode.json<Page>()
    expect(corpsHors.total).toBe(0)
    expect(corpsHors.sales).toEqual([])
  })

  it("valide du/au ensemble, dates calendaires, pagination bornée", async () => {
    const { storeId, caissier } = await seedTrois()
    const duSeul = await req(
      caissier.cookie,
      "GET",
      `/api/v1/sales?storeId=${storeId}&du=${JOUR}`
    )
    expect(duSeul.status).toBe(400)
    const dateImpossible = await req(
      caissier.cookie,
      "GET",
      `/api/v1/sales?storeId=${storeId}&du=2026-02-30&au=2026-03-01`
    )
    expect(dateImpossible.status).toBe(400)
    const pageZero = await req(
      caissier.cookie,
      "GET",
      `/api/v1/sales?storeId=${storeId}&jour=${JOUR}&page=0`
    )
    expect(pageZero.status).toBe(400)
    const parPageTrop = await req(
      caissier.cookie,
      "GET",
      `/api/v1/sales?storeId=${storeId}&jour=${JOUR}&parPage=500`
    )
    expect(parPageTrop.status).toBe(400)
  })

  it("rétrocompatible : sans pagination explicite, défauts page=1/parPage=50", async () => {
    const { storeId, caissier } = await seedTrois()
    const res = await req(
      caissier.cookie,
      "GET",
      `/api/v1/sales?storeId=${storeId}&jour=${JOUR}`
    )
    const corps = await res.json<Page>()
    expect(corps.sales).toHaveLength(3)
    expect(corps.total).toBe(3)
    expect(corps.page).toBe(1)
    expect(corps.parPage).toBe(50)
  })
})
```

- [ ] **Step 2 : Vérifier que les tests échouent**

Run: `cd apps/api && bunx vitest run test/sales-pagination.test.ts`
Expected: FAIL — `total`/`page`/`parPage` undefined ; `du` seul répond 200 au lieu de 400 ; `page=0` accepté.

- [ ] **Step 3 : Étendre le handler GET `/`**

Dans `apps/api/src/routes/sales.ts` : ajouter `bornesPeriode` à l'import de `../lib/dates` :

```ts
import { bornesPeriode, dateCalendaireValide } from "../lib/dates"
```

puis remplacer le handler `salesRoute.get("/", …)` COMPLET par :

```ts
salesRoute.get("/", async (c) => {
  const { organizationId } = c.get("membership")
  const storeId = c.req.query("storeId")
  const jour = c.req.query("jour")
  const du = c.req.query("du")
  const au = c.req.query("au")
  const sessionId = c.req.query("sessionId")
  if (!storeId) {
    return c.json(
      { code: "VALIDATION", message: "Le paramètre storeId est requis" },
      400
    )
  }
  if (jour && !dateCalendaireValide(jour)) {
    return c.json(
      { code: "VALIDATION", message: "Date invalide (AAAA-MM-JJ)" },
      400
    )
  }
  // Période multi-jours (Phase 7) : du et au vont ENSEMBLE, calendaires,
  // du ≤ au — bornes UTC, fin exclusive au lendemain (motif bornesPeriode).
  const bornes = du && au ? bornesPeriode(du, au) : null
  if ((du !== undefined || au !== undefined) && !bornes) {
    return c.json(
      {
        code: "VALIDATION",
        message: "Période invalide : du et au vont ensemble (AAAA-MM-JJ, du ≤ au)",
      },
      400
    )
  }
  // Pagination (différé P6 : limite fixe 200 sans pagination)
  const page = Number(c.req.query("page") ?? "1")
  const parPage = Number(c.req.query("parPage") ?? "50")
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(parPage) ||
    parPage < 1 ||
    parPage > 200
  ) {
    return c.json(
      {
        code: "VALIDATION",
        message: "Pagination invalide (page ≥ 1, parPage entre 1 et 200)",
      },
      400
    )
  }
  const refus = await verifierLectureVentes(c, storeId)
  if (refus) return refus
  const db = drizzle(c.env.DB, { schema })
  const conditions: SQL[] = [
    eq(schema.sales.organizationId, organizationId),
    eq(schema.sales.storeId, storeId),
  ]
  if (jour) {
    const debut = new Date(`${jour}T00:00:00.000Z`)
    conditions.push(gte(schema.sales.createdAt, debut))
    conditions.push(
      lt(schema.sales.createdAt, new Date(debut.getTime() + 86_400_000))
    )
  }
  if (bornes) {
    conditions.push(gte(schema.sales.createdAt, bornes.debut))
    conditions.push(lt(schema.sales.createdAt, bornes.finExclue))
  }
  if (sessionId) {
    conditions.push(eq(schema.sales.registerSessionId, sessionId))
  }
  const totalRows = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(schema.sales)
    .where(and(...conditions))
  const total = totalRows[0]?.total ?? 0
  const rows = await db
    .select({
      id: schema.sales.id,
      ticketNumber: schema.sales.ticketNumber,
      total: schema.sales.total,
      currency: schema.sales.currency,
      status: schema.sales.status,
      createdAt: schema.sales.createdAt,
      cashierName: schema.user.name,
    })
    .from(schema.sales)
    .innerJoin(schema.user, eq(schema.sales.cashierId, schema.user.id))
    .where(and(...conditions))
    .orderBy(desc(schema.sales.createdAt), desc(schema.sales.ticketNumber))
    .limit(parPage)
    .offset((page - 1) * parPage)
  const ids = rows.map((r) => r.id)
  const agregats =
    ids.length > 0
      ? await db
          .select({
            saleId: schema.saleItems.saleId,
            itemCount: sql<number>`COUNT(*)`,
          })
          .from(schema.saleItems)
          .where(inArray(schema.saleItems.saleId, ids))
          .groupBy(schema.saleItems.saleId)
      : []
  const ventes = rows.map((r) => ({
    ...r,
    itemCount: agregats.find((a) => a.saleId === r.id)?.itemCount ?? 0,
  }))
  return c.json({ sales: ventes, total, page, parPage })
})
```

- [ ] **Step 4 : Vérifier que les tests API passent**

Run: `cd apps/api && bunx vitest run test/sales-pagination.test.ts test/sales-lecture.test.ts test/sales.test.ts`
Expected: PASS — les tests existants continuent de lire `sales` (clé conservée).

- [ ] **Step 5 : Adapter le client POS (test d'abord)**

Dans `apps/web/src/pos/tickets-du-jour.test.tsx` : mettre à jour TOUTES les occurrences de `mockResolvedValue({ sales: [vente] })` (celle du test « erreurs de réimpression » existant ET celle du test Task 2) en :

```ts
      .mockResolvedValue({ sales: [vente], total: 1, page: 1, parPage: 50 })
```

et ajouter à la fin du fichier :

```tsx
describe("TicketsDuJour — pagination (différé P6)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("masque la pagination à 50 tickets ou moins", async () => {
    vi.spyOn(posApi, "fetchVentesDuJour").mockResolvedValue({
      sales: [vente],
      total: 1,
      page: 1,
      parPage: 50,
    })
    rendre()
    await screen.findByText(/N° 1/)
    expect(screen.queryByRole("button", { name: "Suivant" })).toBeNull()
  })

  it("pagine au-delà de 50 tickets : Suivant recharge la page 2", async () => {
    const spy = vi.spyOn(posApi, "fetchVentesDuJour").mockResolvedValue({
      sales: [vente],
      total: 51,
      page: 1,
      parPage: 50,
    })
    rendre()
    await screen.findByText(/Page 1 \/ 2/)
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }))
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith("store1", expect.any(String), 2)
    )
  })
})
```

Run: `cd apps/web && bunx vitest run src/pos/tickets-du-jour.test.tsx`
Expected: FAIL — le type de retour mocké ne compile pas encore / « Page 1 / 2 » introuvable.

- [ ] **Step 6 : Implémenter côté web**

Dans `apps/web/src/lib/pos-api.ts`, remplacer :

```ts
export function fetchVentesDuJour(storeId: string, jour: string) {
  return apiFetch<{ sales: VenteListe[] }>(
    `/api/v1/sales?storeId=${storeId}&jour=${jour}`
  )
}
```

par :

```ts
export type PageVentes = {
  sales: VenteListe[]
  total: number
  page: number
  parPage: number
}

export function fetchVentesDuJour(storeId: string, jour: string, page = 1) {
  return apiFetch<PageVentes>(
    `/api/v1/sales?storeId=${storeId}&jour=${jour}&page=${page}&parPage=50`
  )
}
```

Dans `apps/web/src/pos/tickets-du-jour.tsx` : ajouter `import { useState } from "react"` en tête, puis remplacer :

```tsx
export function TicketsDuJour({ storeId, onReimprimer, onFermer }: Props) {
  const jour = jourLocal()
  const ventes = useQuery({
    queryKey: ["pos-ventes-jour", storeId, jour],
    queryFn: () => fetchVentesDuJour(storeId, jour),
  })
  const liste = ventes.data?.sales ?? []
```

par :

```tsx
export function TicketsDuJour({ storeId, onReimprimer, onFermer }: Props) {
  const jour = jourLocal()
  const [page, setPage] = useState(1)
  const ventes = useQuery({
    queryKey: ["pos-ventes-jour", storeId, jour, page],
    queryFn: () => fetchVentesDuJour(storeId, jour, page),
  })
  const liste = ventes.data?.sales ?? []
  const total = ventes.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / 50))
```

et insérer la barre de pagination juste APRÈS le `</div>` qui ferme `flex-1 overflow-y-auto p-3` (avant le `</div>` du panneau blanc) :

```tsx
        {pages > 1 && (
          <div className="flex items-center justify-between border-t px-5 py-2 text-sm">
            <Button
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Précédent
            </Button>
            <span className="text-gray-500">
              Page {page} / {pages} — {total} tickets
            </span>
            <Button
              variant="outline"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Suivant
            </Button>
          </div>
        )}
```

- [ ] **Step 7 : Vérifier que tout passe**

Run: `cd apps/web && bunx vitest run src/pos/tickets-du-jour.test.tsx && bun run --cwd apps/web typecheck && cd ../api && bun run test`
Expected: tout vert.

- [ ] **Step 8 : Commit**

```bash
git add apps/api/src/routes/sales.ts apps/api/test/sales-pagination.test.ts apps/web/src/lib/pos-api.ts apps/web/src/pos/tickets-du-jour.tsx apps/web/src/pos/tickets-du-jour.test.tsx
git commit -m "feat: GET /sales — période du/au et pagination { sales, total, page, parPage } ; tickets du jour paginés"
```

---

### Task 10: Front — `lib/rapports.ts` (logique pure testée) + section « Ventes » (sidebar, historique, détail)

La bibliothèque front des rapports (types miroirs des contrats API, fetchers, presets de période, visibilité des blocs, boutiques lisibles, téléchargement CSV) avec ses tests unitaires, puis la section back-office : entrée sidebar « Ventes », historique multi-jours filtrable et paginé, détail d'une vente avec marge.

**Files:**
- Create: `apps/web/src/lib/rapports.ts`
- Create: `apps/web/src/lib/rapports.test.ts`
- Modify: `apps/web/src/routes/_app.tsx` (section sidebar)
- Create: `apps/web/src/routes/_app/ventes/index.tsx`
- Create: `apps/web/src/routes/_app/ventes/$saleId.tsx`

**Interfaces:**
- Consumes: contrats JSON des Tasks 6-9, `MeLike`/`jourLocal` (`lib/pos.ts`, Task 2), `PageVentes`/`VenteListe`/`VenteDetail` (`lib/pos-api.ts`), `apiFetch`/`apiUrl` (`lib/api.ts`), `formaterMontant` (`lib/format.ts`).
- Produces (consommé par les Tasks 11-12) :
  - `fetchRapportVentesBoutiques(du, au, storeId?)`, `fetchRapportVentesProduits(du, au, storeId?)`, `fetchRapportValorisation(warehouseId?)`, `fetchRapportMarges(du, au, storeId?)`, `fetchVentesPeriode({ storeId, du, au, page })`, `fetchVenteDetail(saleId)` ;
  - `periodePreset(preset: "jour" | "semaine" | "mois", maintenant?): { du, au }` ;
  - `blocsTableauDeBord(me: MeLike): { ventes, alertes, transferts, valorisation, aucun }` ;
  - `boutiquesLisibles(me: MeLike, destinations): Array<{ id, name }>` ;
  - `telechargerCsv(path: string, nomFichier: string): Promise<void>` ;
  - types exportés `RapportVentesBoutiques`, `RapportVentesProduits`, `RapportValorisation`, `RapportMarges`, `MargeVente`.

- [ ] **Step 1 : Écrire les tests unitaires qui échouent**

Créer `apps/web/src/lib/rapports.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import {
  blocsTableauDeBord,
  boutiquesLisibles,
  periodePreset,
} from "@/lib/rapports"
import type { MeLike } from "@/lib/pos"
import type { CompanyRole, WarehouseRole } from "shared"

const me = (
  role: CompanyRole | undefined,
  assignments: Array<{
    warehouseId: string
    warehouseName: string
    role: WarehouseRole
  }> = []
): MeLike => ({
  membership: role ? { role } : null,
  assignments,
})

describe("periodePreset", () => {
  // Date fixe : samedi 2026-07-12 (heure locale)
  const maintenant = new Date(2026, 6, 12, 15, 30)

  it("jour : du = au = aujourd'hui", () => {
    expect(periodePreset("jour", maintenant)).toEqual({
      du: "2026-07-12",
      au: "2026-07-12",
    })
  })

  it("semaine : 7 jours glissants (aujourd'hui inclus)", () => {
    expect(periodePreset("semaine", maintenant)).toEqual({
      du: "2026-07-06",
      au: "2026-07-12",
    })
  })

  it("mois : depuis le 1er du mois courant", () => {
    expect(periodePreset("mois", maintenant)).toEqual({
      du: "2026-07-01",
      au: "2026-07-12",
    })
  })

  it("semaine à cheval sur deux mois", () => {
    expect(periodePreset("semaine", new Date(2026, 7, 3))).toEqual({
      du: "2026-07-28",
      au: "2026-08-03",
    })
  })
})

describe("blocsTableauDeBord", () => {
  it("owner/admin/auditor : les 4 blocs", () => {
    for (const role of ["owner", "admin", "auditor"] as const) {
      expect(blocsTableauDeBord(me(role))).toEqual({
        ventes: true,
        alertes: true,
        transferts: true,
        valorisation: true,
        aucun: false,
      })
    }
  })

  it("stock_manager : alertes, transferts, valorisation — pas les ventes", () => {
    expect(blocsTableauDeBord(me("stock_manager"))).toEqual({
      ventes: false,
      alertes: true,
      transferts: true,
      valorisation: true,
      aucun: false,
    })
  })

  it("manager local : ventes, alertes, transferts — pas la valorisation globale", () => {
    expect(
      blocsTableauDeBord(
        me("staff", [{ warehouseId: "b1", warehouseName: "B1", role: "manager" }])
      )
    ).toEqual({
      ventes: true,
      alertes: true,
      transferts: true,
      valorisation: false,
      aucun: false,
    })
  })

  it("caissier pur : aucun bloc", () => {
    expect(
      blocsTableauDeBord(
        me("staff", [{ warehouseId: "b1", warehouseName: "B1", role: "cashier" }])
      ).aucun
    ).toBe(true)
  })
})

describe("boutiquesLisibles", () => {
  const destinations = [
    { id: "b1", name: "Boutique 1", type: "store" },
    { id: "b2", name: "Boutique 2", type: "store" },
    { id: "d1", name: "Dépôt", type: "warehouse" },
  ]

  it("rôles org : toutes les boutiques (jamais les dépôts)", () => {
    expect(boutiquesLisibles(me("owner"), destinations)).toEqual([
      { id: "b1", name: "Boutique 1" },
      { id: "b2", name: "Boutique 2" },
    ])
    expect(boutiquesLisibles(me("auditor"), destinations)).toHaveLength(2)
  })

  it("staff : ses affectations (manager, auditor OU cashier) croisées avec les boutiques", () => {
    expect(
      boutiquesLisibles(
        me("staff", [
          { warehouseId: "b1", warehouseName: "Boutique 1", role: "cashier" },
          { warehouseId: "d1", warehouseName: "Dépôt", role: "manager" },
        ]),
        destinations
      )
    ).toEqual([{ id: "b1", name: "Boutique 1" }])
  })

  it("stock_manager sans affectation : aucune boutique", () => {
    expect(boutiquesLisibles(me("stock_manager"), destinations)).toEqual([])
  })
})
```

- [ ] **Step 2 : Vérifier que les tests échouent**

Run: `cd apps/web && bunx vitest run src/lib/rapports.test.ts`
Expected: FAIL — le module `@/lib/rapports` n'existe pas.

- [ ] **Step 3 : Implémenter `apps/web/src/lib/rapports.ts`**

```ts
import { apiFetch, apiUrl } from "./api"
import { jourLocal } from "./pos"
import type { MeLike } from "./pos"
import type { PageVentes, VenteDetail } from "./pos-api"

// ---- Types miroirs des contrats /api/v1/reports (l'API fait autorité) ----

export type TotalVentes = {
  ca: number
  tickets: number
  panierMoyen: number
  cash: number
  mobileMoney: number
}

export type LigneVentesBoutique = TotalVentes & {
  storeId: string
  storeName: string
}

export type LigneVentesProduit = {
  productId: string
  productName: string
  variantId: string
  variantName: string
  sku: string
  quantite: number
  ca: number
  remise: number
  tickets: number
}

export type RapportVentesBoutiques = {
  periode: { du: string; au: string }
  groupe: "boutique"
  total: TotalVentes
  lignes: LigneVentesBoutique[]
}

export type RapportVentesProduits = {
  periode: { du: string; au: string }
  groupe: "produit"
  total: TotalVentes
  lignes: LigneVentesProduit[]
}

export type LigneValorisation = {
  variantId: string
  productName: string
  variantName: string
  sku: string
  quantity: number
  avgCost: number
  valeur: number
}

export type EntrepotValorisation = {
  warehouseId: string
  warehouseName: string
  valeur: number
  lignes: LigneValorisation[]
}

export type RapportValorisation = {
  entrepots: EntrepotValorisation[]
  total: number
}

export type LigneMarge = {
  productId: string
  productName: string
  variantId: string
  variantName: string
  sku: string
  quantite: number
  ca: number
  cout: number
  marge: number
  estime: boolean
}

export type RapportMarges = {
  periode: { du: string; au: string }
  total: { ca: number; cout: number; marge: number; estime: boolean }
  lignes: LigneMarge[]
}

export type MargeVente = { cout: number; marge: number; estime: boolean }

// ---- Fetchers ----

function suffixeStore(storeId?: string): string {
  return storeId ? `&storeId=${storeId}` : ""
}

export function fetchRapportVentesBoutiques(
  du: string,
  au: string,
  storeId?: string
) {
  return apiFetch<RapportVentesBoutiques>(
    `/api/v1/reports/sales?du=${du}&au=${au}&groupe=boutique${suffixeStore(storeId)}`
  )
}

export function fetchRapportVentesProduits(
  du: string,
  au: string,
  storeId?: string
) {
  return apiFetch<RapportVentesProduits>(
    `/api/v1/reports/sales?du=${du}&au=${au}&groupe=produit${suffixeStore(storeId)}`
  )
}

export function fetchRapportValorisation(warehouseId?: string) {
  return apiFetch<RapportValorisation>(
    `/api/v1/reports/valuation${warehouseId ? `?warehouseId=${warehouseId}` : ""}`
  )
}

export function fetchRapportMarges(du: string, au: string, storeId?: string) {
  return apiFetch<RapportMarges>(
    `/api/v1/reports/margins?du=${du}&au=${au}${suffixeStore(storeId)}`
  )
}

export function fetchVentesPeriode(params: {
  storeId: string
  du: string
  au: string
  page: number
}) {
  return apiFetch<PageVentes>(
    `/api/v1/sales?storeId=${params.storeId}&du=${params.du}&au=${params.au}&page=${params.page}&parPage=50`
  )
}

export function fetchVenteDetail(saleId: string) {
  return apiFetch<{ sale: VenteDetail; marge: MargeVente | null }>(
    `/api/v1/sales/${saleId}`
  )
}

// ---- Logique pure ----

// Presets de période (spec §6) : calculés CÔTÉ CLIENT en jours LOCAUX
// (motif jourLocal) et envoyés comme du/au — l'API ne connaît que la
// période (décision 4 du plan).
export function periodePreset(
  preset: "jour" | "semaine" | "mois",
  maintenant: Date = new Date()
): { du: string; au: string } {
  const au = jourLocal(maintenant)
  if (preset === "jour") {
    return { du: au, au }
  }
  if (preset === "semaine") {
    const debut = new Date(maintenant)
    debut.setDate(debut.getDate() - 6)
    return { du: jourLocal(debut), au }
  }
  return {
    du: jourLocal(new Date(maintenant.getFullYear(), maintenant.getMonth(), 1)),
    au,
  }
}

// Visibilité des blocs du tableau de bord (spec §7) — miroir front, l'API
// fait autorité. Valorisation ouverte aux rôles org ET à stock_manager
// (décision 10 du plan : la matrice §4 prime sur le « owner/admin » du §7).
export type BlocsTableauDeBord = {
  ventes: boolean
  alertes: boolean
  transferts: boolean
  valorisation: boolean
  aucun: boolean
}

export function blocsTableauDeBord(me: MeLike): BlocsTableauDeBord {
  const role = me.membership?.role
  const org = role === "owner" || role === "admin" || role === "auditor"
  const locaux = me.assignments.some(
    (a) => a.role === "manager" || a.role === "auditor"
  )
  const blocs = {
    ventes: org || locaux,
    alertes: org || role === "stock_manager" || locaux,
    transferts: org || role === "stock_manager" || locaux,
    valorisation: org || role === "stock_manager",
  }
  return {
    ...blocs,
    aucun:
      !blocs.ventes && !blocs.alertes && !blocs.transferts && !blocs.valorisation,
  }
}

// Boutiques dont l'HISTORIQUE des ventes est lisible (décision 10 de la
// Phase 6) : rôles org owner/admin/auditor → toutes les boutiques ; sinon
// TOUTE affectation locale (manager, auditor, cashier) croisée avec les
// boutiques. L'API (verifierLectureVentes) fait autorité.
export function boutiquesLisibles(
  me: MeLike,
  destinations: Array<{ id: string; name: string; type: string }>
): Array<{ id: string; name: string }> {
  const boutiques = destinations.filter((d) => d.type === "store")
  const role = me.membership?.role
  if (role === "owner" || role === "admin" || role === "auditor") {
    return boutiques.map((b) => ({ id: b.id, name: b.name }))
  }
  const lisibles = new Set(me.assignments.map((a) => a.warehouseId))
  return boutiques
    .filter((b) => lisibles.has(b.id))
    .map((b) => ({ id: b.id, name: b.name }))
}

// Téléchargement d'un export CSV avec le cookie de session : fetch + blob
// (un simple <a href> cross-origine ne porterait pas credentials). Le nom
// de fichier est recomposé côté client — lire Content-Disposition exigerait
// Access-Control-Expose-Headers (décision 7 du plan).
export async function telechargerCsv(
  path: string,
  nomFichier: string
): Promise<void> {
  const res = await fetch(apiUrl(path), { credentials: "include" })
  if (!res.ok) {
    throw new Error(`Export impossible (erreur ${res.status})`)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const lien = document.createElement("a")
  lien.href = url
  lien.download = nomFichier
  document.body.appendChild(lien)
  lien.click()
  lien.remove()
  URL.revokeObjectURL(url)
}
```

Run: `cd apps/web && bunx vitest run src/lib/rapports.test.ts`
Expected: PASS.

- [ ] **Step 4 : Section sidebar « Ventes »**

Dans `apps/web/src/routes/_app.tsx`, ajouter après la déclaration de `accesPos` :

```tsx
  // Section Ventes (Phase 7) : historique lisible par les rôles org
  // owner/admin/auditor et TOUTE affectation locale (décision 10 P6, un
  // caissier relit ses tickets) ; Rapports ouvert en plus à stock_manager
  // (valorisation seulement — l'écran filtre ses onglets).
  const accesVentes = estAdmin || me.assignments.length > 0
  const accesRapports =
    estAdmin ||
    role === "stock_manager" ||
    me.assignments.some((a) => a.role === "manager" || a.role === "auditor")
```

puis insérer, juste APRÈS le bloc `{accesPos && (…)}` du lien « Point de vente » :

```tsx
            {(accesVentes || accesRapports) && (
              <>
                <p className="mt-4 mb-1 px-2 text-[11px] font-medium tracking-widest text-gray-400 uppercase">
                  Ventes
                </p>
                {accesVentes && (
                  <Link to="/ventes" className={lienClasses}>
                    Historique
                  </Link>
                )}
                {accesRapports && (
                  <Link to="/ventes/rapports" className={lienClasses}>
                    Rapports
                  </Link>
                )}
              </>
            )}
```

(Le lien `/ventes/rapports` ne compilera qu'après la Task 11 qui crée la route — pour garder CETTE tâche verte, créer dès maintenant le squelette `apps/web/src/routes/_app/ventes/rapports.tsx` :)

```tsx
import { createFileRoute } from "@tanstack/react-router"

// Squelette — remplacé par l'écran Rapports complet (Task 11).
export const Route = createFileRoute("/_app/ventes/rapports")({
  component: () => <p className="text-sm text-gray-500">Rapports à venir.</p>,
})
```

- [ ] **Step 5 : Historique des ventes**

Créer `apps/web/src/routes/_app/ventes/index.tsx` :

```tsx
import { createFileRoute, Link, useRouteContext } from "@tanstack/react-router"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { formaterMontant } from "@/lib/format"
import {
  boutiquesLisibles,
  fetchVentesPeriode,
  periodePreset,
} from "@/lib/rapports"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export const Route = createFileRoute("/_app/ventes/")({
  component: HistoriqueVentes,
})

const PRESETS = [
  { id: "jour", libelle: "Aujourd'hui" },
  { id: "semaine", libelle: "7 jours" },
  { id: "mois", libelle: "Ce mois" },
] as const

function HistoriqueVentes() {
  const { me } = useRouteContext({ from: "/_app" })
  const destinations = useQuery({
    queryKey: ["destinations"],
    queryFn: () =>
      apiFetch<{
        warehouses: Array<{ id: string; name: string; type: string }>
      }>("/api/v1/warehouses/destinations"),
  })
  const boutiques = boutiquesLisibles(me, destinations.data?.warehouses ?? [])
  const [boutiqueChoisie, setBoutiqueChoisie] = useState<string | null>(null)
  const [periode, setPeriode] = useState(() => periodePreset("semaine"))
  const [page, setPage] = useState(1)
  const premiere = boutiques.length > 0 ? boutiques[0].id : null
  const boutiqueId = boutiqueChoisie ?? premiere
  const periodeValide = periode.du !== "" && periode.au !== ""
  const ventes = useQuery({
    queryKey: ["ventes-periode", boutiqueId, periode.du, periode.au, page],
    queryFn: () =>
      fetchVentesPeriode({
        storeId: boutiqueId ?? "",
        du: periode.du,
        au: periode.au,
        page,
      }),
    enabled: boutiqueId !== null && periodeValide,
  })
  const liste = ventes.data?.sales ?? []
  const total = ventes.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / 50))

  return (
    <div>
      <h1 className="text-xl font-semibold">Historique des ventes</h1>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Boutique
          <select
            className="mt-1 block rounded border px-2 py-1.5 text-sm"
            value={boutiqueId ?? ""}
            onChange={(e) => {
              setBoutiqueChoisie(e.target.value)
              setPage(1)
            }}
          >
            {boutiques.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Du
          <Input
            type="date"
            className="mt-1"
            value={periode.du}
            onChange={(e) => {
              setPeriode((p) => ({ ...p, du: e.target.value }))
              setPage(1)
            }}
          />
        </label>
        <label className="text-sm">
          Au
          <Input
            type="date"
            className="mt-1"
            value={periode.au}
            onChange={(e) => {
              setPeriode((p) => ({ ...p, au: e.target.value }))
              setPage(1)
            }}
          />
        </label>
        {PRESETS.map((preset) => (
          <Button
            key={preset.id}
            variant="outline"
            onClick={() => {
              setPeriode(periodePreset(preset.id))
              setPage(1)
            }}
          >
            {preset.libelle}
          </Button>
        ))}
      </div>

      {destinations.isSuccess && boutiques.length === 0 && (
        <p className="mt-6 text-sm text-gray-500">
          Aucune boutique lisible pour ce compte.
        </p>
      )}
      {ventes.isPending && boutiqueId !== null && periodeValide && (
        <p className="mt-6 text-sm text-gray-500">Chargement…</p>
      )}
      {ventes.isError && (
        <div className="mt-6">
          <p role="alert" className="mb-2 text-sm text-red-600">
            {ventes.error instanceof Error
              ? ventes.error.message
              : "Impossible de charger les ventes"}
          </p>
          <Button variant="outline" onClick={() => void ventes.refetch()}>
            Réessayer
          </Button>
        </div>
      )}
      {ventes.isSuccess && liste.length === 0 && (
        <p className="mt-6 text-sm text-gray-500">
          Aucune vente sur cette période.
        </p>
      )}
      {ventes.isSuccess && liste.length > 0 && (
        <>
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="py-2">N°</th>
                <th>Date</th>
                <th>Caissier</th>
                <th className="text-right">Articles</th>
                <th className="text-right">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {liste.map((vente) => (
                <tr key={vente.id} className="border-b">
                  <td className="py-2">{vente.ticketNumber}</td>
                  <td>{new Date(vente.createdAt).toLocaleString("fr-FR")}</td>
                  <td>{vente.cashierName}</td>
                  <td className="text-right">{vente.itemCount}</td>
                  <td className="text-right tabular-nums">
                    {formaterMontant(vente.total, vente.currency)}
                  </td>
                  <td className="text-right">
                    <Link
                      to="/ventes/$saleId"
                      params={{ saleId: vente.id }}
                      className="text-blue-600 hover:underline"
                    >
                      Détail
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pages > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm">
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Précédent
              </Button>
              <span className="text-gray-500">
                Page {page} / {pages} — {total} ventes
              </span>
              <Button
                variant="outline"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Suivant
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 6 : Détail d'une vente**

Créer `apps/web/src/routes/_app/ventes/$saleId.tsx` :

```tsx
import { createFileRoute, Link } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { formaterMontant } from "@/lib/format"
import { fetchVenteDetail } from "@/lib/rapports"

export const Route = createFileRoute("/_app/ventes/$saleId")({
  component: DetailVente,
})

const LIBELLES_METHODE: Record<string, string> = {
  cash: "Espèces",
  mobile_money: "Mobile money",
}

function DetailVente() {
  const { saleId } = Route.useParams()
  const detail = useQuery({
    queryKey: ["vente-detail", saleId],
    queryFn: () => fetchVenteDetail(saleId),
  })
  if (detail.isPending) {
    return <p className="text-sm text-gray-500">Chargement…</p>
  }
  if (detail.isError) {
    return (
      <p role="alert" className="text-sm text-red-600">
        Vente introuvable ou inaccessible.
      </p>
    )
  }
  const { sale, marge } = detail.data
  return (
    <div>
      <Link to="/ventes" className="text-sm text-blue-600 hover:underline">
        ← Historique
      </Link>
      <h1 className="mt-2 text-xl font-semibold">
        Ticket n° {sale.ticketNumber} — {sale.storeName}
      </h1>
      <p className="text-sm text-gray-500">
        {new Date(sale.createdAt).toLocaleString("fr-FR")} · {sale.cashierName}
      </p>

      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="py-2">Article</th>
            <th>SKU</th>
            <th className="text-right">Qté</th>
            <th className="text-right">PU appliqué</th>
            <th className="text-right">Prix catalogue</th>
            <th className="text-right">Remise</th>
            <th>Source</th>
            <th>Lot</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((item) => (
            <tr key={item.id} className="border-b">
              <td className="py-2">
                {item.productName}
                {item.variantName !== "Standard" && ` — ${item.variantName}`}
              </td>
              <td className="text-gray-500">{item.sku}</td>
              <td className="text-right">{item.quantity}</td>
              <td className="text-right tabular-nums">
                {formaterMontant(item.unitPrice, sale.currency)}
              </td>
              <td className="text-right tabular-nums">
                {formaterMontant(item.catalogPrice, sale.currency)}
              </td>
              <td className="text-right tabular-nums">
                {formaterMontant(
                  (item.catalogPrice - item.unitPrice) * item.quantity,
                  sale.currency
                )}
              </td>
              <td>{item.sourceWarehouseName}</td>
              <td className="text-gray-500">{item.lotNumber ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-right text-lg font-semibold tabular-nums">
        Total : {formaterMontant(sale.total, sale.currency)}
      </p>

      <section className="mt-4">
        <h2 className="font-semibold">Paiements</h2>
        <ul className="mt-1 space-y-1 text-sm">
          {sale.payments.map((paiement, index) => (
            <li key={index} className="flex justify-between border-b py-1">
              <span>
                {LIBELLES_METHODE[paiement.method] ?? paiement.method}
                {paiement.reference && ` · réf. ${paiement.reference}`}
              </span>
              <span className="tabular-nums">
                {formaterMontant(paiement.amount, sale.currency)}
                {paiement.changeGiven !== null &&
                  paiement.changeGiven > 0 &&
                  ` (rendu ${formaterMontant(paiement.changeGiven, sale.currency)})`}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {marge && (
        <section className="mt-4 rounded border bg-gray-50 p-3 text-sm">
          <h2 className="font-semibold">Marge</h2>
          <p className="mt-1">
            Coût : {formaterMontant(marge.cout, sale.currency)} · Marge :{" "}
            <strong className="tabular-nums">
              {formaterMontant(marge.marge, sale.currency)}
            </strong>
            {marge.estime && (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
                estimée
              </span>
            )}
          </p>
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 7 : Vérifier (tests + typecheck + lint + build)**

Run: `cd apps/web && bun run test && bun run typecheck && cd ../.. && bun run lint && bun run --cwd apps/web build`
Expected: tout vert (le build régénère `routeTree.gen.ts` avec les routes `/ventes`).

- [ ] **Step 8 : Commit**

```bash
git add apps/web/src/lib/rapports.ts apps/web/src/lib/rapports.test.ts apps/web/src/routes/_app.tsx apps/web/src/routes/_app/ventes apps/web/src/routeTree.gen.ts
git commit -m "feat: section Ventes du back-office — lib rapports testée, historique multi-jours paginé, détail de vente avec marge"
```

---

### Task 11: Écran Rapports — 3 onglets + exports CSV (Testing Library sur le rapport le plus riche)

`/ventes/rapports` : onglets Ventes / Marges / Valorisation filtrés par droits (stock_manager ne voit que Valorisation), chaque onglet avec son bouton « Exporter CSV » (fetch + blob avec cookie). Le composant `RapportVentes` (période + presets + bascule boutique/produit + totaux + export) est couvert en Testing Library.

**Files:**
- Modify: `apps/web/src/routes/_app/ventes/rapports.tsx` (remplace le squelette de la Task 10)
- Create: `apps/web/src/rapports/rapport-ventes.tsx`
- Create: `apps/web/src/rapports/rapport-marges.tsx`
- Create: `apps/web/src/rapports/rapport-valorisation.tsx`
- Test: `apps/web/src/rapports/rapport-ventes.test.tsx`

**Interfaces:**
- Consumes: `fetchRapportVentesBoutiques`/`fetchRapportVentesProduits`/`fetchRapportMarges`/`fetchRapportValorisation`/`periodePreset`/`telechargerCsv` + types (Task 10), `jourLocal` (`lib/pos.ts`), `formaterMontant`.
- Produces: composants `RapportVentes`, `RapportMarges`, `RapportValorisation` (sans props — autonomes sur leurs queries) ; route `/ventes/rapports` avec `validateSearch` `{ onglet?: "ventes" | "marges" | "valorisation" }` — **la Task 12 pointe `search={{ onglet: "valorisation" }}`**.

- [ ] **Step 1 : Écrire le test Testing Library qui échoue**

Créer `apps/web/src/rapports/rapport-ventes.test.tsx` :

```tsx
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RapportVentes } from "@/rapports/rapport-ventes"
import * as rapports from "@/lib/rapports"
import { formaterMontant } from "@/lib/format"

const donneesBoutiques: rapports.RapportVentesBoutiques = {
  periode: { du: "2026-07-06", au: "2026-07-12" },
  groupe: "boutique",
  total: { ca: 3400, tickets: 3, panierMoyen: 1133, cash: 3100, mobileMoney: 300 },
  lignes: [
    {
      storeId: "s1",
      storeName: "Boutique Alpha",
      ca: 1400,
      tickets: 2,
      panierMoyen: 700,
      cash: 1100,
      mobileMoney: 300,
    },
  ],
}

const donneesProduits: rapports.RapportVentesProduits = {
  periode: { du: "2026-07-06", au: "2026-07-12" },
  groupe: "produit",
  total: { ca: 3400, tickets: 3, panierMoyen: 1133, cash: 3100, mobileMoney: 300 },
  lignes: [
    {
      productId: "p1",
      productName: "Cola",
      variantId: "v1",
      variantName: "Standard",
      sku: "SKU1",
      quantite: 7,
      ca: 3400,
      remise: 100,
      tickets: 3,
    },
  ],
}

function rendre() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <RapportVentes />
    </QueryClientProvider>
  )
}

describe("RapportVentes", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("affiche totaux et lignes par boutique (montants formatés)", async () => {
    vi.spyOn(rapports, "fetchRapportVentesBoutiques").mockResolvedValue(
      donneesBoutiques
    )
    rendre()
    await screen.findByText("Boutique Alpha")
    // Mêmes montants que l'API, passés par LE formateur du dépôt
    expect(screen.getByText(formaterMontant(3400))).toBeDefined()
    expect(screen.getByText(formaterMontant(1400))).toBeDefined()
    expect(screen.getByText("3 tickets")).toBeDefined()
  })

  it("bascule vers le groupement par produit", async () => {
    vi.spyOn(rapports, "fetchRapportVentesBoutiques").mockResolvedValue(
      donneesBoutiques
    )
    const spyProduits = vi
      .spyOn(rapports, "fetchRapportVentesProduits")
      .mockResolvedValue(donneesProduits)
    rendre()
    await screen.findByText("Boutique Alpha")
    fireEvent.click(screen.getByRole("button", { name: "Par produit" }))
    await screen.findByText("Cola")
    expect(spyProduits).toHaveBeenCalled()
    expect(screen.getByText("7")).toBeDefined()
  })

  it("Exporter CSV appelle telechargerCsv avec le chemin et le nom datés", async () => {
    vi.spyOn(rapports, "fetchRapportVentesBoutiques").mockResolvedValue(
      donneesBoutiques
    )
    const spyCsv = vi
      .spyOn(rapports, "telechargerCsv")
      .mockResolvedValue(undefined)
    rendre()
    await screen.findByText("Boutique Alpha")
    fireEvent.click(screen.getByRole("button", { name: "Exporter CSV" }))
    await waitFor(() => expect(spyCsv).toHaveBeenCalledTimes(1))
    const [path, nom] = spyCsv.mock.calls[0]
    expect(path).toContain("/api/v1/reports/sales?")
    expect(path).toContain("groupe=boutique")
    expect(path).toContain("format=csv")
    expect(nom).toMatch(/^rapport-ventes-boutiques_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/)
  })

  it("affiche l'erreur d'export sans casser l'écran", async () => {
    vi.spyOn(rapports, "fetchRapportVentesBoutiques").mockResolvedValue(
      donneesBoutiques
    )
    vi.spyOn(rapports, "telechargerCsv").mockRejectedValue(
      new Error("Export impossible (erreur 403)")
    )
    rendre()
    await screen.findByText("Boutique Alpha")
    fireEvent.click(screen.getByRole("button", { name: "Exporter CSV" }))
    await screen.findByRole("alert")
    expect(screen.getByText("Export impossible (erreur 403)")).toBeDefined()
  })
})
```

- [ ] **Step 2 : Vérifier que le test échoue**

Run: `cd apps/web && bunx vitest run src/rapports/rapport-ventes.test.tsx`
Expected: FAIL — le module `@/rapports/rapport-ventes` n'existe pas.

- [ ] **Step 3 : Implémenter `RapportVentes`**

Créer `apps/web/src/rapports/rapport-ventes.tsx` :

```tsx
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { formaterMontant } from "@/lib/format"
import {
  fetchRapportVentesBoutiques,
  fetchRapportVentesProduits,
  periodePreset,
  telechargerCsv,
} from "@/lib/rapports"
import type { TotalVentes } from "@/lib/rapports"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const PRESETS = [
  { id: "jour", libelle: "Aujourd'hui" },
  { id: "semaine", libelle: "7 jours" },
  { id: "mois", libelle: "Ce mois" },
] as const

export function SelecteurPeriode({
  periode,
  onChange,
}: {
  periode: { du: string; au: string }
  onChange: (periode: { du: string; au: string }) => void
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-sm">
        Du
        <Input
          type="date"
          className="mt-1"
          value={periode.du}
          onChange={(e) => onChange({ ...periode, du: e.target.value })}
        />
      </label>
      <label className="text-sm">
        Au
        <Input
          type="date"
          className="mt-1"
          value={periode.au}
          onChange={(e) => onChange({ ...periode, au: e.target.value })}
        />
      </label>
      {PRESETS.map((preset) => (
        <Button
          key={preset.id}
          variant="outline"
          onClick={() => onChange(periodePreset(preset.id))}
        >
          {preset.libelle}
        </Button>
      ))}
    </div>
  )
}

export function TuilesTotaux({ total }: { total: TotalVentes }) {
  const tuiles = [
    { libelle: "Chiffre d'affaires", valeur: formaterMontant(total.ca) },
    { libelle: "Tickets", valeur: `${total.tickets} tickets` },
    { libelle: "Panier moyen", valeur: formaterMontant(total.panierMoyen) },
    { libelle: "Espèces", valeur: formaterMontant(total.cash) },
    { libelle: "Mobile money", valeur: formaterMontant(total.mobileMoney) },
  ]
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
      {tuiles.map((tuile) => (
        <div key={tuile.libelle} className="rounded border bg-white p-3">
          <p className="text-xs text-gray-500">{tuile.libelle}</p>
          <p className="mt-1 font-semibold tabular-nums">{tuile.valeur}</p>
        </div>
      ))}
    </div>
  )
}

export function ErreurEtRetry({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="mt-6">
      <p role="alert" className="mb-2 text-sm text-red-600">
        {message}
      </p>
      <Button variant="outline" onClick={onRetry}>
        Réessayer
      </Button>
    </div>
  )
}

export function RapportVentes() {
  const [periode, setPeriode] = useState(() => periodePreset("semaine"))
  const [groupe, setGroupe] = useState<"boutique" | "produit">("boutique")
  const [erreurExport, setErreurExport] = useState<string | null>(null)
  const periodeValide = periode.du !== "" && periode.au !== ""
  const boutiquesQ = useQuery({
    queryKey: ["rapport-ventes", "boutique", periode.du, periode.au],
    queryFn: () => fetchRapportVentesBoutiques(periode.du, periode.au),
    enabled: periodeValide && groupe === "boutique",
  })
  const produitsQ = useQuery({
    queryKey: ["rapport-ventes", "produit", periode.du, periode.au],
    queryFn: () => fetchRapportVentesProduits(periode.du, periode.au),
    enabled: periodeValide && groupe === "produit",
  })
  const active = groupe === "boutique" ? boutiquesQ : produitsQ

  async function exporter() {
    setErreurExport(null)
    const suffixe = groupe === "boutique" ? "boutiques" : "produits"
    try {
      await telechargerCsv(
        `/api/v1/reports/sales?du=${periode.du}&au=${periode.au}&groupe=${groupe}&format=csv`,
        `rapport-ventes-${suffixe}_${periode.du}_${periode.au}.csv`
      )
    } catch (err) {
      setErreurExport(
        err instanceof Error ? err.message : "Export impossible"
      )
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SelecteurPeriode
          periode={periode}
          onChange={(p) => setPeriode(p)}
        />
        <div className="flex gap-2">
          <Button
            variant={groupe === "boutique" ? "default" : "outline"}
            onClick={() => setGroupe("boutique")}
          >
            Par boutique
          </Button>
          <Button
            variant={groupe === "produit" ? "default" : "outline"}
            onClick={() => setGroupe("produit")}
          >
            Par produit
          </Button>
          <Button
            variant="outline"
            disabled={!periodeValide}
            onClick={() => void exporter()}
          >
            Exporter CSV
          </Button>
        </div>
      </div>
      {erreurExport && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {erreurExport}
        </p>
      )}

      {active.isPending && periodeValide && (
        <p className="mt-6 text-sm text-gray-500">Chargement…</p>
      )}
      {active.isError && (
        <ErreurEtRetry
          message={
            active.error instanceof Error
              ? active.error.message
              : "Impossible de charger le rapport"
          }
          onRetry={() => void active.refetch()}
        />
      )}

      {groupe === "boutique" && boutiquesQ.isSuccess && (
        <>
          <TuilesTotaux total={boutiquesQ.data.total} />
          {boutiquesQ.data.lignes.length === 0 ? (
            <p className="mt-6 text-sm text-gray-500">
              Aucune vente sur cette période.
            </p>
          ) : (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2">Boutique</th>
                  <th className="text-right">CA</th>
                  <th className="text-right">Tickets</th>
                  <th className="text-right">Panier moyen</th>
                  <th className="text-right">Espèces</th>
                  <th className="text-right">Mobile money</th>
                </tr>
              </thead>
              <tbody>
                {boutiquesQ.data.lignes.map((ligne) => (
                  <tr key={ligne.storeId} className="border-b">
                    <td className="py-2">{ligne.storeName}</td>
                    <td className="text-right tabular-nums">
                      {formaterMontant(ligne.ca)}
                    </td>
                    <td className="text-right">{ligne.tickets}</td>
                    <td className="text-right tabular-nums">
                      {formaterMontant(ligne.panierMoyen)}
                    </td>
                    <td className="text-right tabular-nums">
                      {formaterMontant(ligne.cash)}
                    </td>
                    <td className="text-right tabular-nums">
                      {formaterMontant(ligne.mobileMoney)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {groupe === "produit" && produitsQ.isSuccess && (
        <>
          <TuilesTotaux total={produitsQ.data.total} />
          {produitsQ.data.lignes.length === 0 ? (
            <p className="mt-6 text-sm text-gray-500">
              Aucune vente sur cette période.
            </p>
          ) : (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2">Produit</th>
                  <th>Variante</th>
                  <th>SKU</th>
                  <th className="text-right">Quantité</th>
                  <th className="text-right">CA</th>
                  <th className="text-right">Remises</th>
                  <th className="text-right">Tickets</th>
                </tr>
              </thead>
              <tbody>
                {produitsQ.data.lignes.map((ligne) => (
                  <tr key={ligne.variantId} className="border-b">
                    <td className="py-2">{ligne.productName}</td>
                    <td>{ligne.variantName}</td>
                    <td className="text-gray-500">{ligne.sku}</td>
                    <td className="text-right">{ligne.quantite}</td>
                    <td className="text-right tabular-nums">
                      {formaterMontant(ligne.ca)}
                    </td>
                    <td className="text-right tabular-nums">
                      {formaterMontant(ligne.remise)}
                    </td>
                    <td className="text-right">{ligne.tickets}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  )
}
```

Run: `cd apps/web && bunx vitest run src/rapports/rapport-ventes.test.tsx`
Expected: PASS 4/4.

- [ ] **Step 4 : Implémenter `RapportMarges`**

Créer `apps/web/src/rapports/rapport-marges.tsx` :

```tsx
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { formaterMontant } from "@/lib/format"
import { fetchRapportMarges, periodePreset, telechargerCsv } from "@/lib/rapports"
import {
  ErreurEtRetry,
  SelecteurPeriode,
} from "@/rapports/rapport-ventes"
import { Button } from "@/components/ui/button"

function BadgeEstime() {
  return (
    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
      estimé
    </span>
  )
}

export function RapportMarges() {
  const [periode, setPeriode] = useState(() => periodePreset("semaine"))
  const [erreurExport, setErreurExport] = useState<string | null>(null)
  const periodeValide = periode.du !== "" && periode.au !== ""
  const rapport = useQuery({
    queryKey: ["rapport-marges", periode.du, periode.au],
    queryFn: () => fetchRapportMarges(periode.du, periode.au),
    enabled: periodeValide,
  })

  async function exporter() {
    setErreurExport(null)
    try {
      await telechargerCsv(
        `/api/v1/reports/margins?du=${periode.du}&au=${periode.au}&format=csv`,
        `rapport-marges_${periode.du}_${periode.au}.csv`
      )
    } catch (err) {
      setErreurExport(err instanceof Error ? err.message : "Export impossible")
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SelecteurPeriode periode={periode} onChange={(p) => setPeriode(p)} />
        <Button
          variant="outline"
          disabled={!periodeValide}
          onClick={() => void exporter()}
        >
          Exporter CSV
        </Button>
      </div>
      {erreurExport && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {erreurExport}
        </p>
      )}
      {rapport.isPending && periodeValide && (
        <p className="mt-6 text-sm text-gray-500">Chargement…</p>
      )}
      {rapport.isError && (
        <ErreurEtRetry
          message={
            rapport.error instanceof Error
              ? rapport.error.message
              : "Impossible de charger le rapport"
          }
          onRetry={() => void rapport.refetch()}
        />
      )}
      {rapport.isSuccess && (
        <>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded border bg-white p-3">
              <p className="text-xs text-gray-500">CA</p>
              <p className="mt-1 font-semibold tabular-nums">
                {formaterMontant(rapport.data.total.ca)}
              </p>
            </div>
            <div className="rounded border bg-white p-3">
              <p className="text-xs text-gray-500">Coût</p>
              <p className="mt-1 font-semibold tabular-nums">
                {formaterMontant(rapport.data.total.cout)}
              </p>
            </div>
            <div className="rounded border bg-white p-3">
              <p className="text-xs text-gray-500">
                Marge
                {rapport.data.total.estime && <BadgeEstime />}
              </p>
              <p className="mt-1 font-semibold tabular-nums">
                {formaterMontant(rapport.data.total.marge)}
              </p>
            </div>
          </div>
          {rapport.data.lignes.length === 0 ? (
            <p className="mt-6 text-sm text-gray-500">
              Aucune vente sur cette période.
            </p>
          ) : (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2">Produit</th>
                  <th>Variante</th>
                  <th>SKU</th>
                  <th className="text-right">Quantité</th>
                  <th className="text-right">CA</th>
                  <th className="text-right">Coût</th>
                  <th className="text-right">Marge</th>
                </tr>
              </thead>
              <tbody>
                {rapport.data.lignes.map((ligne) => (
                  <tr key={ligne.variantId} className="border-b">
                    <td className="py-2">{ligne.productName}</td>
                    <td>{ligne.variantName}</td>
                    <td className="text-gray-500">{ligne.sku}</td>
                    <td className="text-right">{ligne.quantite}</td>
                    <td className="text-right tabular-nums">
                      {formaterMontant(ligne.ca)}
                    </td>
                    <td className="text-right tabular-nums">
                      {formaterMontant(ligne.cout)}
                    </td>
                    <td className="text-right tabular-nums">
                      {formaterMontant(ligne.marge)}
                      {ligne.estime && <BadgeEstime />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 5 : Implémenter `RapportValorisation`**

Créer `apps/web/src/rapports/rapport-valorisation.tsx` :

```tsx
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { formaterMontant } from "@/lib/format"
import { jourLocal } from "@/lib/pos"
import { fetchRapportValorisation, telechargerCsv } from "@/lib/rapports"
import { ErreurEtRetry } from "@/rapports/rapport-ventes"
import { Button } from "@/components/ui/button"

export function RapportValorisation() {
  const [erreurExport, setErreurExport] = useState<string | null>(null)
  const rapport = useQuery({
    queryKey: ["rapport-valorisation"],
    queryFn: () => fetchRapportValorisation(),
  })

  async function exporter() {
    setErreurExport(null)
    try {
      await telechargerCsv(
        "/api/v1/reports/valuation?format=csv",
        `rapport-valorisation_${jourLocal()}.csv`
      )
    } catch (err) {
      setErreurExport(err instanceof Error ? err.message : "Export impossible")
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Photographie du stock courant (quantité × coût moyen pondéré).
        </p>
        <Button variant="outline" onClick={() => void exporter()}>
          Exporter CSV
        </Button>
      </div>
      {erreurExport && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {erreurExport}
        </p>
      )}
      {rapport.isPending && (
        <p className="mt-6 text-sm text-gray-500">Chargement…</p>
      )}
      {rapport.isError && (
        <ErreurEtRetry
          message={
            rapport.error instanceof Error
              ? rapport.error.message
              : "Impossible de charger le rapport"
          }
          onRetry={() => void rapport.refetch()}
        />
      )}
      {rapport.isSuccess && (
        <>
          <div className="mt-4 rounded border bg-white p-3">
            <p className="text-xs text-gray-500">Valeur totale du stock</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {formaterMontant(rapport.data.total)}
            </p>
          </div>
          {rapport.data.entrepots.length === 0 && (
            <p className="mt-6 text-sm text-gray-500">Aucun stock valorisé.</p>
          )}
          {rapport.data.entrepots.map((entrepot) => (
            <section key={entrepot.warehouseId} className="mt-6">
              <h3 className="flex items-baseline justify-between font-semibold">
                {entrepot.warehouseName}
                <span className="text-sm font-normal text-gray-500 tabular-nums">
                  {formaterMontant(entrepot.valeur)}
                </span>
              </h3>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="py-2">Produit</th>
                    <th>Variante</th>
                    <th>SKU</th>
                    <th className="text-right">Quantité</th>
                    <th className="text-right">CMP</th>
                    <th className="text-right">Valeur</th>
                  </tr>
                </thead>
                <tbody>
                  {entrepot.lignes.map((ligne) => (
                    <tr key={ligne.variantId} className="border-b">
                      <td className="py-2">{ligne.productName}</td>
                      <td>{ligne.variantName}</td>
                      <td className="text-gray-500">{ligne.sku}</td>
                      <td className="text-right">{ligne.quantity}</td>
                      <td className="text-right tabular-nums">
                        {formaterMontant(ligne.avgCost)}
                      </td>
                      <td className="text-right tabular-nums">
                        {formaterMontant(ligne.valeur)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 6 : La route à onglets (remplace le squelette)**

Remplacer TOUT le contenu de `apps/web/src/routes/_app/ventes/rapports.tsx` par :

```tsx
import { createFileRoute, useRouteContext } from "@tanstack/react-router"
import { useState } from "react"
import { RapportVentes } from "@/rapports/rapport-ventes"
import { RapportMarges } from "@/rapports/rapport-marges"
import { RapportValorisation } from "@/rapports/rapport-valorisation"
import { Button } from "@/components/ui/button"

type Onglet = "ventes" | "marges" | "valorisation"

export const Route = createFileRoute("/_app/ventes/rapports")({
  validateSearch: (search: Record<string, unknown>): { onglet?: Onglet } => {
    const onglet = search.onglet
    return onglet === "ventes" || onglet === "marges" || onglet === "valorisation"
      ? { onglet }
      : {}
  },
  component: PageRapports,
})

function PageRapports() {
  const { me } = useRouteContext({ from: "/_app" })
  const role = me.membership?.role
  // Matrice §4 : ventes/marges fermés à stock_manager ; valorisation ouverte
  // aux rôles org, à stock_manager et aux manager/auditor locaux. Le front
  // masque, l'API fait autorité.
  const org = role === "owner" || role === "admin" || role === "auditor"
  const locaux = me.assignments.some(
    (a) => a.role === "manager" || a.role === "auditor"
  )
  const accesVentesMarges = org || locaux
  const accesValorisation = org || role === "stock_manager" || locaux
  const onglets: Array<{ id: Onglet; libelle: string; visible: boolean }> = [
    { id: "ventes", libelle: "Ventes", visible: accesVentesMarges },
    { id: "marges", libelle: "Marges", visible: accesVentesMarges },
    {
      id: "valorisation",
      libelle: "Valorisation du stock",
      visible: accesValorisation,
    },
  ]
  const visibles = onglets.filter((o) => o.visible)
  const { onglet: ongletDemande } = Route.useSearch()
  const [onglet, setOnglet] = useState<Onglet>(() => {
    if (ongletDemande && visibles.some((o) => o.id === ongletDemande)) {
      return ongletDemande
    }
    return visibles.length > 0 ? visibles[0].id : "ventes"
  })

  if (visibles.length === 0) {
    return (
      <div>
        <h1 className="text-xl font-semibold">Rapports</h1>
        <p className="mt-2 text-sm text-gray-500">
          Aucun rapport accessible pour ce compte.
        </p>
      </div>
    )
  }
  return (
    <div>
      <h1 className="text-xl font-semibold">Rapports</h1>
      <div className="mt-4 mb-4 flex gap-2">
        {visibles.map((o) => (
          <Button
            key={o.id}
            variant={onglet === o.id ? "default" : "outline"}
            onClick={() => setOnglet(o.id)}
          >
            {o.libelle}
          </Button>
        ))}
      </div>
      {onglet === "ventes" && <RapportVentes />}
      {onglet === "marges" && <RapportMarges />}
      {onglet === "valorisation" && <RapportValorisation />}
    </div>
  )
}
```

- [ ] **Step 7 : Vérifier (tests + typecheck + lint)**

Run: `cd apps/web && bun run test && bun run typecheck && cd ../.. && bun run lint`
Expected: tout vert.

- [ ] **Step 8 : Commit**

```bash
git add apps/web/src/rapports apps/web/src/routes/_app/ventes/rapports.tsx apps/web/src/routeTree.gen.ts
git commit -m "feat: écran Rapports — onglets ventes/marges/valorisation selon les droits, exports CSV fetch+blob, test Testing Library"
```

---

### Task 12: Tableau de bord sur `/`

La page d'accueil devient le tableau de bord (spec §7) : 4 blocs cliquables — ventes du jour par boutique visible, alertes stock bas, transferts en attente (en préparation + en transit), valeur du stock — affichés selon les droits (`blocsTableauDeBord`, décision 10), avec états chargement/erreur/vide propres. Un compte sans aucun bloc (caissier pur) est renvoyé vers le POS.

**Files:**
- Modify: `apps/web/src/routes/_app/index.tsx` (réécriture complète)

**Interfaces:**
- Consumes: `blocsTableauDeBord`/`fetchRapportVentesBoutiques`/`fetchRapportValorisation`/`periodePreset` (Task 10 — la visibilité est DÉJÀ testée unitairement dans rapports.test.ts), routes API existantes `GET /api/v1/stock/alerts` (`{ alerts: […], total }`) et `GET /api/v1/transfers?statut=pending|sent` (`{ transfers: […] }`), routes front `/ventes`, `/ventes/rapports` (Tasks 10-11), `/stock`, `/stock/transferts`, `/pos`.
- Produces: la page d'accueil `/` (aucune API nouvelle).

- [ ] **Step 1 : Réécrire la page d'accueil**

Remplacer TOUT le contenu de `apps/web/src/routes/_app/index.tsx` par :

```tsx
import { createFileRoute, Link, useRouteContext } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { apiFetch } from "@/lib/api"
import { formaterMontant } from "@/lib/format"
import {
  blocsTableauDeBord,
  fetchRapportValorisation,
  fetchRapportVentesBoutiques,
  periodePreset,
} from "@/lib/rapports"

export const Route = createFileRoute("/_app/")({
  component: TableauDeBord,
})

type Alerte = {
  warehouseId: string
  warehouseName: string
  variantId: string
  productName: string
  variantName: string
  sku: string
  quantity: number
  seuilEffectif: number | null
}

type TransfertEnAttente = {
  id: string
  status: string
  fromWarehouseName: string
  toWarehouseName: string
}

const LIBELLES_STATUT_TRANSFERT: Record<string, string> = {
  pending: "En préparation",
  sent: "Expédié",
}

function Bloc({
  titre,
  action,
  children,
}: {
  titre: string
  action: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">{titre}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

const lienBlocClasses = "text-sm text-blue-600 hover:underline"

function BlocVentesDuJour() {
  const { du, au } = periodePreset("jour")
  const ventes = useQuery({
    queryKey: ["dashboard-ventes", du],
    queryFn: () => fetchRapportVentesBoutiques(du, au),
  })
  return (
    <Bloc
      titre="Ventes du jour"
      action={
        <Link to="/ventes" className={lienBlocClasses}>
          Historique →
        </Link>
      }
    >
      {ventes.isPending && (
        <p className="text-sm text-gray-500">Chargement…</p>
      )}
      {ventes.isError && (
        <p role="alert" className="text-sm text-red-600">
          Impossible de charger les ventes du jour.
        </p>
      )}
      {ventes.isSuccess &&
        (ventes.data.lignes.length === 0 ? (
          <p className="text-sm text-gray-500">Aucune vente aujourd'hui.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {ventes.data.lignes.map((ligne) => (
              <li key={ligne.storeId} className="flex justify-between">
                <span>{ligne.storeName}</span>
                <span className="tabular-nums">
                  {formaterMontant(ligne.ca)} · {ligne.tickets} ticket
                  {ligne.tickets > 1 ? "s" : ""}
                </span>
              </li>
            ))}
            <li className="flex justify-between border-t pt-1 font-medium">
              <span>Total</span>
              <span className="tabular-nums">
                {formaterMontant(ventes.data.total.ca)} ·{" "}
                {ventes.data.total.tickets} tickets
              </span>
            </li>
          </ul>
        ))}
    </Bloc>
  )
}

function BlocAlertes() {
  // Même queryKey que le badge de la sidebar (_app.tsx) : même endpoint,
  // cache partagé.
  const alertes = useQuery({
    queryKey: ["stock-alerts"],
    queryFn: () =>
      apiFetch<{ alerts: Alerte[]; total: number }>("/api/v1/stock/alerts"),
  })
  return (
    <Bloc
      titre="Alertes stock bas"
      action={
        <Link to="/stock" className={lienBlocClasses}>
          Niveaux →
        </Link>
      }
    >
      {alertes.isPending && (
        <p className="text-sm text-gray-500">Chargement…</p>
      )}
      {alertes.isError && (
        <p role="alert" className="text-sm text-red-600">
          Impossible de charger les alertes.
        </p>
      )}
      {alertes.isSuccess &&
        (alertes.data.total === 0 ? (
          <p className="text-sm text-gray-500">
            Aucun produit sous le seuil d'alerte.
          </p>
        ) : (
          <>
            <ul className="space-y-1 text-sm">
              {alertes.data.alerts.slice(0, 5).map((alerte) => (
                <li
                  key={`${alerte.warehouseId}-${alerte.variantId}`}
                  className="flex justify-between"
                >
                  <span>
                    {alerte.productName}
                    {alerte.variantName !== "Standard" &&
                      ` — ${alerte.variantName}`}{" "}
                    <span className="text-gray-500">
                      · {alerte.warehouseName}
                    </span>
                  </span>
                  <span className="text-red-600 tabular-nums">
                    {alerte.quantity} / seuil {alerte.seuilEffectif ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
            {alertes.data.total > 5 && (
              <p className="mt-2 text-xs text-gray-500">
                + {alertes.data.total - 5} autres alertes
              </p>
            )}
          </>
        ))}
    </Bloc>
  )
}

function BlocTransferts() {
  const enPreparation = useQuery({
    queryKey: ["dashboard-transferts", "pending"],
    queryFn: () =>
      apiFetch<{ transfers: TransfertEnAttente[] }>(
        "/api/v1/transfers?statut=pending"
      ),
  })
  const enTransit = useQuery({
    queryKey: ["dashboard-transferts", "sent"],
    queryFn: () =>
      apiFetch<{ transfers: TransfertEnAttente[] }>(
        "/api/v1/transfers?statut=sent"
      ),
  })
  const lignes = [
    ...(enPreparation.data?.transfers ?? []),
    ...(enTransit.data?.transfers ?? []),
  ]
  return (
    <Bloc
      titre="Transferts en attente"
      action={
        <Link to="/stock/transferts" className={lienBlocClasses}>
          Transferts →
        </Link>
      }
    >
      {(enPreparation.isPending || enTransit.isPending) && (
        <p className="text-sm text-gray-500">Chargement…</p>
      )}
      {(enPreparation.isError || enTransit.isError) && (
        <p role="alert" className="text-sm text-red-600">
          Impossible de charger les transferts.
        </p>
      )}
      {enPreparation.isSuccess &&
        enTransit.isSuccess &&
        (lignes.length === 0 ? (
          <p className="text-sm text-gray-500">Aucun transfert en attente.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {lignes.slice(0, 5).map((transfert) => (
              <li key={transfert.id} className="flex justify-between">
                <span>
                  {transfert.fromWarehouseName} → {transfert.toWarehouseName}
                </span>
                <span className="text-gray-500">
                  {LIBELLES_STATUT_TRANSFERT[transfert.status] ??
                    transfert.status}
                </span>
              </li>
            ))}
            {lignes.length > 5 && (
              <li className="text-xs text-gray-500">
                + {lignes.length - 5} autres transferts
              </li>
            )}
          </ul>
        ))}
    </Bloc>
  )
}

function BlocValorisation() {
  const valorisation = useQuery({
    queryKey: ["dashboard-valorisation"],
    queryFn: () => fetchRapportValorisation(),
  })
  return (
    <Bloc
      titre="Valeur du stock"
      action={
        <Link
          to="/ventes/rapports"
          search={{ onglet: "valorisation" }}
          className={lienBlocClasses}
        >
          Rapport →
        </Link>
      }
    >
      {valorisation.isPending && (
        <p className="text-sm text-gray-500">Chargement…</p>
      )}
      {valorisation.isError && (
        <p role="alert" className="text-sm text-red-600">
          Impossible de charger la valorisation.
        </p>
      )}
      {valorisation.isSuccess &&
        (valorisation.data.entrepots.length === 0 ? (
          <p className="text-sm text-gray-500">Aucun stock valorisé.</p>
        ) : (
          <>
            <p className="text-2xl font-semibold tabular-nums">
              {formaterMontant(valorisation.data.total)}
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {valorisation.data.entrepots.map((entrepot) => (
                <li key={entrepot.warehouseId} className="flex justify-between">
                  <span>{entrepot.warehouseName}</span>
                  <span className="tabular-nums">
                    {formaterMontant(entrepot.valeur)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ))}
    </Bloc>
  )
}

function TableauDeBord() {
  const { me } = useRouteContext({ from: "/_app" })
  const blocs = blocsTableauDeBord(me)
  if (blocs.aucun) {
    return (
      <div>
        <h1 className="text-xl font-semibold">Tableau de bord</h1>
        <p className="mt-2 text-sm text-gray-500">
          Votre poste de travail est le point de vente.
        </p>
        <Link
          to="/pos"
          className="mt-3 inline-block rounded bg-black px-4 py-2 text-sm text-white"
        >
          Aller au point de vente
        </Link>
      </div>
    )
  }
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Tableau de bord</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        {blocs.ventes && <BlocVentesDuJour />}
        {blocs.alertes && <BlocAlertes />}
        {blocs.transferts && <BlocTransferts />}
        {blocs.valorisation && <BlocValorisation />}
      </div>
    </div>
  )
}
```

- [ ] **Step 2 : Vérifier (tests + typecheck + lint + build)**

Run: `cd apps/web && bun run test && bun run typecheck && bun run build && cd ../.. && bun run lint`
Expected: tout vert (la visibilité des blocs est couverte par `rapports.test.ts` de la Task 10 ; la page elle-même est de la composition de queries déjà testées côté API).

- [ ] **Step 3 : Vérification manuelle rapide (optionnelle mais recommandée)**

Avec `bun run dev:api` + `bun run dev:web` et un compte owner seedé : la page `/` affiche les 4 blocs ; chaque lien mène au bon écran ; un compte caissier pur voit le renvoi vers `/pos`.

- [ ] **Step 4 : Commit**

```bash
git add apps/web/src/routes/_app/index.tsx
git commit -m "feat: tableau de bord — ventes du jour, alertes stock bas, transferts en attente, valeur du stock selon les droits"
```

---

### Task 13: Vérifications finales de phase et clôture de la roadmap

Dernière tâche de la DERNIÈRE phase : suites complètes, build, migrations idempotentes, generate idempotent, roadmap cochée avec le bilan « 7 phases terminées », décisions reportées au ledger.

**Files:**
- Modify: `docs/superpowers/plans/2026-07-08-pos-stocks-roadmap.md`
- Modify: `.superpowers/sdd/progress.md` (report des décisions — selon le processus d'exécution en cours)

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: roadmap v1 close.

- [ ] **Step 1 : Suites complètes**

Run: `bun run test && bun run typecheck && bun run lint && bun run --cwd apps/web build`
Expected: tout vert — repère attendu ≈ 275 tests api (245 + ~30 nouveaux) et ≈ 64 tests web (55 + ~9 nouveaux) ; les chiffres exacts font foi, aucun test rouge ni skippé.

- [ ] **Step 2 : Migrations et schéma idempotents**

Run: `cd apps/api && bun run db:migrate:local && bun run db:migrate:local && bun run db:generate`
Expected: la première application pose 0015 si absente, la seconde répond « No migrations to apply » ; `db:generate` répond « No schema changes, nothing to migrate » (aucune fuite d'index/trigger custom dans les snapshots).

- [ ] **Step 3 : Cocher la Phase 7 dans la roadmap**

Dans `docs/superpowers/plans/2026-07-08-pos-stocks-roadmap.md`, remplacer la ligne du tableau :

```markdown
| 7 | Rapports, tableau de bord, finitions (valorisation, marges, alertes visibles) | à rédiger | — |
```

par (adapter la date au jour du merge) :

```markdown
| 7 | Rapports, tableau de bord, finitions (valorisation, marges, alertes visibles) | `2026-07-12-phase-7-rapports.md` | ✅ terminée (2026-07-12) |
```

et remplacer le bloc « Phase 7 » :

```markdown
### Phase 7 — Rapports & finitions
- [ ] Rapports ventes (période, boutique, produit), valorisation du stock, marges
- [ ] Tableau de bord (ventes du jour, alertes, transferts en attente)
- [ ] Revue transverse : permissions, messages d'erreur français, performances D1

**Livrable** : v1 complète conforme à la spec.
```

par :

```markdown
### Phase 7 — Rapports & finitions
- [x] Rapports ventes (période, boutique, produit), valorisation du stock, marges — `/api/v1/reports/*` + CSV
- [x] Tableau de bord (ventes du jour, alertes, transferts en attente, valeur du stock)
- [x] Revue transverse : permissions (matrice §4 pinnée par tests sur les rapports et les sessions), messages d'erreur français (aucun nouveau code, enveloppe uniforme), performances D1 (agrégats SQL sur index existants, pagination de GET /sales, aucun index nouveau nécessaire)

**Livrable** : v1 complète conforme à la spec. **Bilan : 7 phases terminées** — coût figé sur les ventes (0015), 3 rapports agrégés + exports CSV, tableau de bord, section Ventes du back-office, différés P6 soldés (2 reports définitifs documentés au ledger : harnais de concurrence CONFLIT_CONCURRENT/SESSION_FERMEE ; volumétrie gelsLignes).
```

- [ ] **Step 4 : Reporter au ledger**

Ajouter au ledger de phase (`.superpowers/sdd/progress.md`) les décisions d'architecture 1-12 du header de CE plan (dont les deux reports DÉFINITIFS de la décision 12) — selon le processus d'exécution en cours.

- [ ] **Step 5 : Commit de clôture**

```bash
git add docs/superpowers/plans/2026-07-08-pos-stocks-roadmap.md .superpowers/sdd/progress.md
git commit -m "docs: clôture Phase 7 — roadmap cochée, bilan v1 complète (7 phases terminées)"
```

- [ ] **Step 6 : Fin de branche**

La suite (E2E navigateur de phase, revue finale whole-branch, PR, merge, déploiement — migration 0015 en prod via le workflow existant) suit le processus des phases précédentes (skill superpowers:finishing-a-development-branch) — hors périmètre de ce plan.

---

## Self-review (fait à la rédaction, tracé ici)

1. **Couverture spec** : §3 `sale_items.unitCost` Phase 7 → Task 4 ; §4 ligne Rapports (stock_manager = valorisation seulement, cashier exclu) → Tasks 5-8 (helper + tests par rôle) ; §6 `/reports` trois rapports agrégés SQL + presets (front) + CSV (BOM, `;`, en-têtes français) → Tasks 5-8, 10-11 ; §7 tableau de bord 4 blocs cliquables portée selon droits → Task 12 ; §7 ventes back-office (historique filtrable, détail avec marge pour qui a le droit, écran Rapports 3 onglets + CSV) → Tasks 9-11 ; roadmap « revue transverse » → Tasks 1-3 (différés P6) + Task 13 (bilan). Différés nommés du ledger P6 : pagination tickets (T9), tests matrice sessions élargie (T1), test variante inactive (T1), test multi-entrepôts lireLotsDisponibles (T1), avgCost multi-lignes (T1), MeLike vs Me (T2), apiFetch beforeLoad try/catch (T2), session.isError (T2), TicketsDuJour isError (T2), anomalie cache catalogue (T2), piège de focus 2 fuites (T3), mapping CONFLIT_CONCURRENT/SESSION_FERMEE + gelsLignes volumétrie → reports définitifs documentés (décision 12, ledger en T13). Les « ignorés » de la revue P6 ne reviennent pas.
2. **Placeholder scan** : aucun TBD/TODO/« similaire à » ; chaque étape code porte le code complet ; les deux seules références externes sont des motifs de fichiers existants cités avec leur chemin.
3. **Cohérence des types** : `porteeRapport(db, organizationId, userId, role, rapport)` (T5) = usage T6/T7/T8 ; `conditionsVentes`/`entrepotDansOrganisation`/`REPONSE_ACCES_REFUSE`/`ENTETES_CSV` définis T6, consommés T7/T8 dans le même fichier ; `PageVentes` défini T9 (`pos-api.ts`), réexploité T10 (`fetchVentesPeriode`) ; `MeLike` exporté T2, consommé T10 (`blocsTableauDeBord`, `boutiquesLisibles`) et ses tests ; `SelecteurPeriode`/`TuilesTotaux`/`ErreurEtRetry` exportés de `rapport-ventes.tsx` (T11) et consommés par `rapport-marges.tsx`/`rapport-valorisation.tsx` ; la recherche `{ onglet: "valorisation" }` du T12 correspond au `validateSearch` du T11 ; les noms de fichiers CSV côté client (T10-T11) reproduisent exactement ceux du serveur (T6-T8).








