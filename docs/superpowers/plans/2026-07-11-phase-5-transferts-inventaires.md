# Phase 5 — Transferts & inventaires : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Les mouvements inter-entrepôts et les comptages sont opérationnels : transferts `pending → sent → received` (annulables avant expédition, écarts de réception tracés en ajustement, valorisés au CMP de l'origine figé sur la ligne à l'expédition), stock en transit visible (dérivé, non matérialisé), inventaires complets par entrepôt (ouverture qui fige les quantités attendues, saisies de comptage multi-sessions, clôture en mouvements `count` calculés sur le mouvement net), écrans web `/stock/transferts` et `/stock/inventaires` — après avoir soldé les différés du ledger Phase 4.

**Architecture:** Les deux nouveaux couples de tables (`transfers`+`transfer_items`, `inventory_counts`+`inventory_count_items`) suivent EXACTEMENT le motif des réceptions Phase 4 : document brouillon modifiable → transitions d'état par UPDATE **sans filtre de statut** (les triggers SQLite posés en migration custom 0007 tuent les courses en faisant échouer le batch entier), toute écriture de stock passant par `stockService.applyMovements` dans UN SEUL `db.batch()` D1 (instructionsAvant = mises à jour du document + gels de CMP, puis mouvements + niveaux). `applyMovements` est étendu : les mouvements `transfer_in` deviennent, comme `purchase`, des « apports valorisés » qui portent un `unitCost` et alimentent le CMP de destination. Le CMP d'origine est figé sur chaque ligne PAR UNE SOUS-REQUÊTE SQL dans le batch d'expédition (photographie au moment exact de la transaction, aucune course). L'écart de réception (reçu < expédié) entre en `transfer_in` total puis ressort en `adjustment` négatif à destination dans le même batch : la différence « reste sortie » en net et la perte est journalisée. Le stock en transit est dérivé (`transfers.status = 'sent'`) et exposé par un endpoint dédié `GET /stock/transit`. L'inventaire est toujours complet (v1) : l'ouverture fige une ligne par niveau de l'entrepôt, la clôture calcule l'écart contre la quantité COURANTE (= attendu + mouvement net, spec §5). Un index unique partiel garantit un seul inventaire ouvert par entrepôt. Les Tasks 1 et 2 soldent d'abord les différés Phase 4 (contrat 404 cross-org, ancrage `estErreurDeclencheur`, règle expiryDate divergent, matrice reconcile, isError/beforeLoad web, UI de retrait d'affectation).

**Tech Stack:** existant (Hono 4, Better Auth, Drizzle ORM 0.44 / drizzle-kit 0.31, D1, vitest-pool-workers 0.12, React/Vite/TanStack Router + Query, shadcn base-mira sur @base-ui/react, Tailwind 4). Aucune dépendance nouvelle.

## Global Constraints

- Interface, messages d'erreur et commentaires en **français** ; enveloppe d'erreur `{ code: "MAJUSCULES", message: "français", details? }`. Nouveaux codes de cette phase : `TRANSFERT_MEME_ENTREPOT` (400), `TRANSFERT_EXPEDIE` (409, document immuable après expédition pour l'édition), `QUANTITE_RECUE_INVALIDE` (400, reçu > expédié), `INVENTAIRE_OUVERT` (409, un seul inventaire ouvert par entrepôt), `INVENTAIRE_CLOS` (409). Réutilisés : `VALIDATION`, `INTROUVABLE`, `ACCES_REFUSE`, `STOCK_INSUFFISANT`, `LOT_REQUIS`, `LOTS_NON_SUIVIS`, `STATUT_INVALIDE` (409, transition interdite : double expédition, réception avant expédition, annulation après expédition, double clôture…).
- **Toute écriture de stock passe par `stockService.applyMovements`** — UN SEUL `db.batch()` D1 par opération métier : document + mouvements + niveaux réussissent ou échouent ensemble. Batch hétérogène = tableau construit **directement** (littéral ou spread), jamais de push + cast.
- `stock_movements` est **append-only** ; les documents terminés (`received`/`cancelled`/`closed`) sont immuables **PAR TRIGGER** (même défense en profondeur que les réceptions, migration custom 0007) ; les UPDATE de transition ne filtrent **PAS** sur le statut — le trigger tue la course.
- Montants en **entiers XOF** (0 décimale), formatés côté web via `formaterMontant` (`apps/web/src/lib/format.ts`) ; le CMP est arrondi à l'entier.
- IDs texte via `crypto.randomUUID()` ; horodatages UTC ; toutes les tables métier portent `organizationId` ; ressource hors organisation → `404 INTROUVABLE` ; entrepôt hors organisation via middleware/`verifierAccesEntrepot` → `403 ACCES_REFUSE`.
- **Matrice de permissions (spec §4)** : écriture transferts/inventaires = `owner`/`admin`/`stock_manager` partout + rôle local `manager` sur l'entrepôt concerné. **Pour un transfert : la création, l'édition du brouillon, l'expédition et l'annulation exigent le rôle sur l'ORIGINE ; la réception exige le rôle sur la DESTINATION** (décision de cette phase, documentée). Lecture selon `porteeLectureStock` : un transfert est visible si l'un de ses deux entrepôts est dans la portée ; un inventaire si son entrepôt l'est. `cashier` n'a pas accès au back-office stock.
- Tests API sur D1 réelle (`@cloudflare/vitest-pool-workers`) pour chaque tâche : cas de succès, matrice de permissions (dont manager local origine/destination), atomicité (échec = rien d'écrit, état vérifié post-échec en lecture DB directe), transitions interdites, courses (double send/receive/clôture tuées par trigger). Dans les tests, typer les corps avec `res.json<T>()` (pas de cast `as`).
- **Le schéma Better Auth est GÉNÉRÉ** (`src/db/schema/auth.ts`) : ne pas y toucher. Les tables de cette phase vivent dans `src/db/schema/stock.ts`.
- drizzle-kit : les index/triggers custom restent **HORS des snapshots** (`drizzle/meta/*.json`). Migration custom via `bunx drizzle-kit generate --custom --name=…` (même motif que `0005_stock_guards.sql`). La prochaine migration générée est la **0006** ; la custom de cette phase sera la **0007**.
- Pièges eslint du dépôt : `no-unnecessary-condition` (annoter explicitement `| null` les retours de lookups), `import/consistent-type-specifier-style` (imports de types dans un `import type` séparé), `no-irregular-whitespace` (pas d'espaces insécables dans le code). Dialog base-ui : `<DialogTrigger render={<Button />}>` — jamais `asChild`. `apps/web/src/routeTree.gen.ts` n'est **jamais** édité à la main (régénéré par `bun run dev`/`build` du web).
- Gestionnaire de paquets : **bun**. Commits fréquents, messages conventionnels en **français**, hooks husky actifs (pas de `--no-verify`).
- Branche de travail : `feat/phase-5-transferts-inventaires` (déjà créée et courante).
- **État de départ vérifié** : suites 119 tests api + 16 tests web vertes ; migrations `0000`–`0005` appliquées ; `main` contient la Phase 4 mergée (PR #5) ; la spec (commit `9f1ebf0`) acte : inventaires toujours complets en v1, transferts valorisés au CMP de l'origine.

**Décisions d'architecture prises par ce plan** (à reporter au ledger en fin de phase) :
1. **expiryDate divergent** (différé P4 Task 9) : à la validation d'une réception, deux lignes du même couple (variantId, lotNumber) portant des `expiryDate` différents → `400 VALIDATION` « Dates de péremption incohérentes pour le lot X ». On refuse plutôt que de laisser la première ligne gagner silencieusement.
2. **Ancrage `estErreurDeclencheur`** (différé P4) : format d'erreur D1 vérifié empiriquement pour `RAISE(ABORT, 'CODE')` → message `D1_ERROR: CODE: SQLITE_CONSTRAINT` (la cause imbriquée porte `CODE: SQLITE_CONSTRAINT`). L'ancrage devient `messageDansCauses(err, \`${code}: SQLITE_CONSTRAINT\`)`.
3. **Écart de réception** : mouvement `transfer_in` de la quantité expédiée TOTALE (valorisé au CMP origine figé) + mouvement `adjustment` négatif de l'écart à destination, dans le même batch. Net = quantité reçue ; la perte est journalisée et valorisée au CMP de destination après absorption (biais assumé, documenté en commentaire).
4. **Stock en transit** : endpoint dédié `GET /stock/transit?warehouseId=` (transit ENTRANT vers l'entrepôt) plutôt qu'un enrichissement de `/levels` — couvre aussi les variantes jamais stockées à destination, sans UNION.
5. **Lot d'un transfert** : `lotId` optionnel en brouillon sur la ligne (mais s'il est fourni : il doit appartenir à la variante ; interdit si le produit ne suit pas les lots → `LOTS_NON_SUIVIS`), **exigé à l'expédition** (`LOT_REQUIS`) pour les produits `trackLots`. Le lot est global à la variante (index unique `lots_variant_lot_uidx (variant_id, lot_number)`) : le MÊME `lotId` suit la ligne jusqu'au mouvement `transfer_in` de destination — aucune création de lot côté destination.
6. **Destination d'un transfert** : champ de document (pas un contrôle d'accès) → destination inconnue ou hors org = `404 INTROUVABLE` (motif `fournisseurExiste`). L'origine passe par `verifierAccesEntrepot` → `403`.
7. **Pas de DELETE sur un transfert** : l'annulation (`cancelled`) trace l'historique — contrairement aux brouillons de réception (supprimables), un transfert annulé reste consultable.
8. **Clôture d'inventaire** : lignes non comptées ignorées (aucun mouvement, compteur `nonComptes` dans la réponse) ; écart calculé contre la quantité COURANTE lue juste avant le batch — LIMITE ASSUMÉE (v1) documentée : un mouvement commité dans cette fenêtre de quelques ms fausse l'écart d'autant, mais l'invariant journal = niveaux reste garanti (delta appliqué relativement) et `/stock/reconcile` permet de vérifier. Ouverture refusée (`400 VALIDATION`) sur un entrepôt sans aucune ligne de niveau. Les mouvements `count` ne portent pas de `lotId` (inventaire par variante en v1).
9. **`/alerts` accepte désormais `?warehouseId=`** (filtre optionnel) pour porter le même contrat 403/404 que `/levels` et `/movements` (l'alignement 404 cross-org du ticket « harmonisation contrat lecture stock » n'a de sens qu'avec ce paramètre).
10. **Web — destination d'un transfert** : la liste des destinations proposées est celle des entrepôts visibles de l'utilisateur (`useEntrepotsVisibles`) ; un staff manager ne peut donc viser que ses entrepôts visibles côté écran (l'API, elle, accepte toute destination de l'organisation). Limitation v1 documentée.

**Prérequis exécutant** : lire `apps/api/src/routes/purchases.ts` (LE modèle de document draft→validé), `apps/api/src/services/stock.ts` (applyMovements) et `apps/api/drizzle/0005_stock_guards.sql` (motif des triggers) avant les Tasks 3–10.

---

### Task 1: Prep API — solder les différés Phase 4 côté API

Solde le ticket « harmonisation contrat lecture stock » (404 cross-org sur `/movements` et `/alerts`), ancre `estErreurDeclencheur` sur la forme d'erreur réelle des triggers SQLite, tranche la règle métier « expiryDate divergent » à la validation de réception, pinne la matrice de `/reconcile` par des tests admin/auditor, et expose l'`id` des affectations dans `GET /users` (préalable API de l'UI de retrait d'affectation, Task 2).

**Files:**
- Modify: `apps/api/src/lib/db-errors.ts` (fonction `estErreurDeclencheur`, lignes 42-46)
- Modify: `apps/api/src/routes/stock.ts` (helper `entrepotDansOrganisation` + `/levels`, `/movements`, `/alerts`)
- Modify: `apps/api/src/routes/purchases.ts` (route `POST /:id/receive`, garde expiryDate divergent)
- Modify: `apps/api/src/routes/users.ts` (lignes 137-160 : `id` dans les affectations)
- Test: `apps/api/test/db-errors.test.ts` (nouveau)
- Test: `apps/api/test/phase5-prep.test.ts` (nouveau)

**Interfaces:**
- Consomme : helpers de test existants (`bootstrapOwner`, `createUserWithRole`, `creerEntrepot`, `creerProduitSimple`, `affecterEntrepot` — `apps/api/test/helpers.ts`).
- Produit : `estErreurDeclencheur(err: unknown, code: string): boolean` ancré sur `` `${code}: SQLITE_CONSTRAINT` `` (signature inchangée, comportement resserré — toutes les tâches suivantes s'y fient) ; `entrepotDansOrganisation(db, organizationId, warehouseId): Promise<boolean>` (local à `routes/stock.ts`, réutilisé par la Task 8) ; `GET /users` renvoie `assignments: Array<{ id, warehouseId, warehouseName, role }>` (consommé par la Task 2) ; `GET /stock/alerts` accepte `?warehouseId=` (403 hors portée, 404 hors org, filtre sinon).

- [ ] **Step 1 : Écrire les tests qui échouent — ancrage `estErreurDeclencheur`**

Créer `apps/api/test/db-errors.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { estErreurDeclencheur, estViolationUnicite } from "../src/lib/db-errors"

async function erreurDe(promesse: Promise<unknown>): Promise<unknown> {
  try {
    await promesse
  } catch (err) {
    return err
  }
  throw new Error("l'instruction aurait dû échouer")
}

describe("estErreurDeclencheur — ancrage sur la forme d'erreur trigger D1", () => {
  it("reconnaît le code exact d'un RAISE(ABORT) et rejette les autres codes", async () => {
    // Trigger jetable : reproduit la forme d'erreur réelle des triggers
    // custom (0005/0007) sans dépendre d'un document métier.
    await env.DB.prepare("CREATE TABLE scratch_declencheur (id integer)").run()
    await env.DB.prepare(
      "CREATE TRIGGER scratch_declencheur_tr BEFORE INSERT ON scratch_declencheur BEGIN SELECT RAISE(ABORT, 'CODE_DE_TEST'); END"
    ).run()
    const err = await erreurDe(
      env.DB.prepare("INSERT INTO scratch_declencheur VALUES (1)").run()
    )
    // Format observé (vérifié empiriquement) :
    // « D1_ERROR: CODE_DE_TEST: SQLITE_CONSTRAINT », cause imbriquée
    // « CODE_DE_TEST: SQLITE_CONSTRAINT ».
    expect(estErreurDeclencheur(err, "CODE_DE_TEST")).toBe(true)
    expect(estErreurDeclencheur(err, "AUTRE_CODE")).toBe(false)
    // Un préfixe du code ne matche plus : l'ancrage exige
    // « <code>: SQLITE_CONSTRAINT » en entier.
    expect(estErreurDeclencheur(err, "CODE_DE")).toBe(false)
  })

  it("ne confond pas une violation d'unicité avec une erreur de déclencheur", async () => {
    await env.DB.prepare(
      "CREATE TABLE scratch_unicite (id integer PRIMARY KEY)"
    ).run()
    await env.DB.prepare("INSERT INTO scratch_unicite VALUES (1)").run()
    const err = await erreurDe(
      env.DB.prepare("INSERT INTO scratch_unicite VALUES (1)").run()
    )
    expect(estViolationUnicite(err)).toBe(true)
    expect(estErreurDeclencheur(err, "RECEPTION_VALIDEE")).toBe(false)
  })
})
```

- [ ] **Step 2 : Vérifier que le test échoue**

Run: `cd apps/api && bunx vitest run test/db-errors.test.ts`
Expected: FAIL — `estErreurDeclencheur(err, "CODE_DE")` renvoie `true` (l'implémentation actuelle matche un fragment libre, `"CODE_DE"` est contenu dans `"CODE_DE_TEST"`... attention : `messageDansCauses(err, "CODE_DE")` matche car `CODE_DE` est une sous-chaîne de `CODE_DE_TEST`). Le premier `it` échoue sur l'assertion `toBe(false)` de `"CODE_DE"`.

- [ ] **Step 3 : Ancrer `estErreurDeclencheur`**

Dans `apps/api/src/lib/db-errors.ts`, remplacer la fonction existante :

```ts
// RAISE(ABORT, code) émis par un trigger de 0005_stock_guards
// (RECEPTION_VALIDEE, JOURNAL_IMMUABLE).
export function estErreurDeclencheur(err: unknown, code: string): boolean {
  return messageDansCauses(err, code)
}
```

par :

```ts
// RAISE(ABORT, code) émis par un trigger custom (0005_stock_guards,
// 0007_transfer_inventory_guards). Forme d'erreur D1 vérifiée
// empiriquement : « D1_ERROR: <code>: SQLITE_CONSTRAINT » (la cause
// imbriquée porte « <code>: SQLITE_CONSTRAINT »). Ancrer sur le format
// complet « <code>: SQLITE_CONSTRAINT » — et non sur le code seul —
// évite qu'un code court (ex. « VALIDATION ») matche par accident un
// fragment d'un message d'erreur sans rapport.
export function estErreurDeclencheur(err: unknown, code: string): boolean {
  return messageDansCauses(err, `${code}: SQLITE_CONSTRAINT`)
}
```

- [ ] **Step 4 : Vérifier que le test passe, ainsi que toute la suite existante**

Run: `cd apps/api && bunx vitest run test/db-errors.test.ts`
Expected: PASS (2 tests).

Run: `bun run --cwd apps/api test`
Expected: PASS — les tests existants qui provoquent RECEPTION_VALIDEE/JOURNAL_IMMUABLE (purchases-receive, stock-guards) passent toujours : le message réel contient bien `RECEPTION_VALIDEE: SQLITE_CONSTRAINT`.

- [ ] **Step 5 : Écrire les tests qui échouent — contrat lecture stock, expiryDate, reconcile, affectations**

Créer `apps/api/test/phase5-prep.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import app from "../src/index"
import * as schema from "../src/db/schema"
import {
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

// Seconde organisation insérée directement en base (le setup public est
// mono-organisation) — même motif que permissions.test.ts.
async function creerAutreOrgAvecEntrepot(): Promise<string> {
  const db = drizzle(env.DB, { schema })
  const autreOrgId = crypto.randomUUID()
  await db.insert(schema.organization).values({
    id: autreOrgId,
    name: "Autre Société",
    slug: `autre-${autreOrgId.slice(0, 8)}`,
    createdAt: new Date(),
  })
  return creerEntrepot(autreOrgId, "Entrepôt étranger")
}

describe("prep Phase 5 — harmonisation du contrat de lecture stock", () => {
  it("GET /stock/movements?warehouseId cross-org ou inconnu → 404 (aligné sur /levels)", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const entrepotEtranger = await creerAutreOrgAvecEntrepot()
    const cross = await req(
      ownerCookie,
      "GET",
      `/api/v1/stock/movements?warehouseId=${entrepotEtranger}`
    )
    expect(cross.status).toBe(404)
    expect((await cross.json<{ code: string }>()).code).toBe("INTROUVABLE")
    const inconnu = await req(
      ownerCookie,
      "GET",
      `/api/v1/stock/movements?warehouseId=${crypto.randomUUID()}`
    )
    expect(inconnu.status).toBe(404)
  })

  it("GET /stock/alerts?warehouseId : 404 cross-org, filtre par entrepôt sinon", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const entrepotEtranger = await creerAutreOrgAvecEntrepot()
    expect(
      (
        await req(
          ownerCookie,
          "GET",
          `/api/v1/stock/alerts?warehouseId=${entrepotEtranger}`
        )
      ).status
    ).toBe(404)

    // Une alerte dans w1 (stock 1 <= seuil 5), rien dans w2 (stock 100)
    const w1 = await creerEntrepot(organizationId, "Alerte")
    const w2 = await creerEntrepot(organizationId, "Calme")
    const { variantId } = await creerProduitSimple(organizationId, {
      defaultMinStock: 5,
    })
    expect(
      (
        await req(
          ownerCookie,
          "POST",
          `/api/v1/stock/warehouses/${w1}/adjustments`,
          { variantId, delta: 1, reason: "seed" }
        )
      ).status
    ).toBe(201)
    expect(
      (
        await req(
          ownerCookie,
          "POST",
          `/api/v1/stock/warehouses/${w2}/adjustments`,
          { variantId, delta: 100, reason: "seed" }
        )
      ).status
    ).toBe(201)

    const alertesW1 = await req(
      ownerCookie,
      "GET",
      `/api/v1/stock/alerts?warehouseId=${w1}`
    )
    expect(alertesW1.status).toBe(200)
    expect((await alertesW1.json<{ total: number }>()).total).toBe(1)
    const alertesW2 = await req(
      ownerCookie,
      "GET",
      `/api/v1/stock/alerts?warehouseId=${w2}`
    )
    expect((await alertesW2.json<{ total: number }>()).total).toBe(0)
  })

  it("un staff hors portée reçoit 403 (et non 404) sur un warehouseId qu'il ne lit pas", async () => {
    const { organizationId } = await bootstrapOwner()
    const w1 = await creerEntrepot(organizationId)
    const staff = await createUserWithRole(organizationId, "staff")
    const res = await req(
      staff.cookie,
      "GET",
      `/api/v1/stock/movements?warehouseId=${w1}`
    )
    expect(res.status).toBe(403)
  })
})

describe("prep Phase 5 — expiryDate divergent à la validation de réception", () => {
  async function brouillonAvecDeuxLignes(
    peremption1: string,
    peremption2: string
  ) {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const warehouseId = await creerEntrepot(organizationId)
    const fournisseur = await req(ownerCookie, "POST", "/api/v1/suppliers", {
      name: "Sodeci",
    })
    const { id: supplierId } = await fournisseur.json<{ id: string }>()
    const { variantId } = await creerProduitSimple(organizationId, {
      trackLots: true,
    })
    const creation = await req(ownerCookie, "POST", "/api/v1/purchases", {
      warehouseId,
      supplierId,
    })
    const { id } = await creation.json<{ id: string }>()
    for (const expiryDate of [peremption1, peremption2]) {
      const ajout = await req(
        ownerCookie,
        "POST",
        `/api/v1/purchases/${id}/items`,
        {
          variantId,
          quantity: 5,
          unitCost: 100,
          lotNumber: "LOT-A",
          expiryDate,
        }
      )
      expect(ajout.status).toBe(201)
    }
    return { ownerCookie, purchaseId: id }
  }

  it("deux lignes du même lot avec des dates différentes → 400 VALIDATION, rien n'est écrit", async () => {
    const { ownerCookie, purchaseId } = await brouillonAvecDeuxLignes(
      "2027-01-01",
      "2027-06-30"
    )
    const res = await req(
      ownerCookie,
      "POST",
      `/api/v1/purchases/${purchaseId}/receive`
    )
    expect(res.status).toBe(400)
    const corps = await res.json<{ code: string; message: string }>()
    expect(corps.code).toBe("VALIDATION")
    expect(corps.message).toContain("LOT-A")
    // Le document est resté brouillon
    const detail = await req(
      ownerCookie,
      "GET",
      `/api/v1/purchases/${purchaseId}`
    )
    expect(
      (await detail.json<{ purchase: { status: string } }>()).purchase.status
    ).toBe("draft")
  })

  it("deux lignes du même lot avec la même date → validation acceptée", async () => {
    const { ownerCookie, purchaseId } = await brouillonAvecDeuxLignes(
      "2027-01-01",
      "2027-01-01"
    )
    expect(
      (
        await req(
          ownerCookie,
          "POST",
          `/api/v1/purchases/${purchaseId}/receive`
        )
      ).status
    ).toBe(200)
  })
})

describe("prep Phase 5 — matrice de /stock/reconcile pinnée", () => {
  it("admin 200 (dry-run), auditor 403, stock_manager 403", async () => {
    const { organizationId } = await bootstrapOwner()
    const admin = await createUserWithRole(organizationId, "admin")
    const auditor = await createUserWithRole(organizationId, "auditor")
    const gestionnaire = await createUserWithRole(
      organizationId,
      "stock_manager"
    )
    const resAdmin = await req(admin.cookie, "POST", "/api/v1/stock/reconcile")
    expect(resAdmin.status).toBe(200)
    expect(
      await resAdmin.json<{ ecarts: unknown[]; applique: boolean }>()
    ).toEqual({ ecarts: [], applique: false })
    expect(
      (await req(auditor.cookie, "POST", "/api/v1/stock/reconcile")).status
    ).toBe(403)
    expect(
      (await req(gestionnaire.cookie, "POST", "/api/v1/stock/reconcile"))
        .status
    ).toBe(403)
  })
})

describe("prep Phase 5 — GET /users expose l'id des affectations", () => {
  it("chaque affectation porte l'id de warehouse_members (pour le retrait côté web)", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const warehouseId = await creerEntrepot(organizationId)
    const staff = await createUserWithRole(organizationId, "staff")
    const creation = await req(ownerCookie, "POST", "/api/v1/warehouse-members", {
      userId: staff.userId,
      warehouseId,
      role: "manager",
    })
    expect(creation.status).toBe(201)
    const { id: assignmentId } = await creation.json<{ id: string }>()

    const liste = await req(ownerCookie, "GET", "/api/v1/users")
    const { users } = await liste.json<{
      users: Array<{
        id: string
        assignments: Array<{ id: string; warehouseId: string }>
      }>
    }>()
    const utilisateur = users.find((u) => u.id === staff.userId)
    expect(utilisateur?.assignments).toEqual([
      expect.objectContaining({ id: assignmentId, warehouseId }),
    ])
  })
})
```

- [ ] **Step 6 : Vérifier que les nouveaux tests échouent**

Run: `cd apps/api && bunx vitest run test/phase5-prep.test.ts`
Expected: FAIL — movements/alerts cross-org renvoient 200 (pas de 404), `alerts?warehouseId` ne filtre pas, expiryDate divergent passe en 200, l'affectation ne porte pas d'`id`. Le test reconcile (admin/auditor) peut déjà passer — c'est un test de pinnage.

- [ ] **Step 7 : Implémenter — helper + 404 cross-org dans `routes/stock.ts`**

Dans `apps/api/src/routes/stock.ts`, ajouter après la définition de `seuilEffectif` (ligne ~59) :

```ts
// Garde partagée /levels, /movements, /alerts, /transit (Phase 5) : un
// warehouseId explicitement demandé doit exister dans l'organisation —
// contrat 404 cross-org identique aux autres ressources. S'applique APRÈS
// le contrôle de portée (403 prioritaire pour un staff hors portée).
async function entrepotDansOrganisation(
  db: DrizzleD1Database<typeof schema>,
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
```

Dans `GET /levels`, remplacer le bloc existant (lignes ~80-92) :

```ts
  const entrepots = await db
    .select({ id: schema.warehouses.id })
    .from(schema.warehouses)
    .where(
      and(
        eq(schema.warehouses.id, warehouseId),
        eq(schema.warehouses.organizationId, organizationId)
      )
    )
    .limit(1)
  if (entrepots.length === 0) {
    return c.json({ code: "INTROUVABLE", message: "Entrepôt introuvable" }, 404)
  }
```

par :

```ts
  if (!(await entrepotDansOrganisation(db, organizationId, warehouseId))) {
    return c.json({ code: "INTROUVABLE", message: "Entrepôt introuvable" }, 404)
  }
```

Dans `GET /movements`, dans le bloc `if (warehouseId) { … }` (ligne ~185), juste après le contrôle de portée 403 et avant le `conditions.push(...)` :

```ts
    if (!(await entrepotDansOrganisation(db, organizationId, warehouseId))) {
      return c.json(
        { code: "INTROUVABLE", message: "Entrepôt introuvable" },
        404
      )
    }
```

Dans `GET /alerts`, après le calcul de `portee` (ligne ~304), lire le paramètre et restructurer le filtrage : remplacer le bloc existant

```ts
  if (!portee.tous) {
    if (portee.warehouseIds.length === 0) {
      return c.json({ alerts: [], total: 0 })
    }
    conditions.push(
      inArray(schema.stockLevels.warehouseId, portee.warehouseIds)
    )
  }
```

par :

```ts
  const warehouseId = c.req.query("warehouseId")
  if (warehouseId) {
    if (!portee.tous && !portee.warehouseIds.includes(warehouseId)) {
      return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
    }
    if (!(await entrepotDansOrganisation(db, organizationId, warehouseId))) {
      return c.json(
        { code: "INTROUVABLE", message: "Entrepôt introuvable" },
        404
      )
    }
    conditions.push(eq(schema.stockLevels.warehouseId, warehouseId))
  } else if (!portee.tous) {
    if (portee.warehouseIds.length === 0) {
      return c.json({ alerts: [], total: 0 })
    }
    conditions.push(
      inArray(schema.stockLevels.warehouseId, portee.warehouseIds)
    )
  }
```

- [ ] **Step 8 : Implémenter — garde expiryDate divergent dans `routes/purchases.ts`**

Dans `POST /:id/receive`, juste après le contrôle `items.length === 0` (ligne ~535) et avant `const maintenant = new Date()` :

```ts
  // Décision métier (Phase 5) : deux lignes du même couple (variantId,
  // lotNumber) portant des dates de péremption différentes sont un conflit
  // de saisie — on refuse la validation plutôt que de laisser la première
  // ligne gagner silencieusement (comportement hérité de la Phase 4).
  const peremptionParLot = new Map<string, number | null>()
  for (const item of items) {
    if (item.lotNumber === null) continue
    const cle = `${item.variantId} ${item.lotNumber}`
    const valeur = item.expiryDate ? item.expiryDate.getTime() : null
    if (!peremptionParLot.has(cle)) {
      peremptionParLot.set(cle, valeur)
      continue
    }
    if (peremptionParLot.get(cle) !== valeur) {
      return c.json(
        {
          code: "VALIDATION",
          message: `Dates de péremption incohérentes pour le lot ${item.lotNumber}`,
        },
        400
      )
    }
  }
```

- [ ] **Step 9 : Implémenter — id des affectations dans `routes/users.ts`**

Dans `GET /` (lignes 137-160), ajouter `id` au select des affectations et au mapping :

```ts
  const affectations = await db
    .select({
      id: schema.warehouseMembers.id,
      userId: schema.warehouseMembers.userId,
      warehouseId: schema.warehouseMembers.warehouseId,
      warehouseName: schema.warehouses.name,
      role: schema.warehouseMembers.role,
    })
    .from(schema.warehouseMembers)
    .innerJoin(
      schema.warehouses,
      eq(schema.warehouseMembers.warehouseId, schema.warehouses.id)
    )
    .where(eq(schema.warehouseMembers.organizationId, organizationId))

  const users = rows.map((u) => ({
    ...u,
    assignments: affectations
      .filter((a) => a.userId === u.id)
      .map(({ id, warehouseId, warehouseName, role }) => ({
        id,
        warehouseId,
        warehouseName,
        role,
      })),
  }))
```

- [ ] **Step 10 : Vérifier que tout passe**

Run: `cd apps/api && bunx vitest run test/phase5-prep.test.ts test/db-errors.test.ts`
Expected: PASS (tous les tests des deux fichiers).

Run: `bun run --cwd apps/api test && bun run typecheck && bun run lint`
Expected: PASS — aucune régression (les suites stock-read/purchases existantes couvrent les chemins modifiés).

- [ ] **Step 11 : Commit**

```bash
git add apps/api/src/lib/db-errors.ts apps/api/src/routes/stock.ts apps/api/src/routes/purchases.ts apps/api/src/routes/users.ts apps/api/test/db-errors.test.ts apps/api/test/phase5-prep.test.ts
git commit -m "fix(api): solder les différés Phase 4 — 404 cross-org movements/alerts, ancrage estErreurDeclencheur, expiryDate divergent, matrice reconcile, id des affectations"
```

---

### Task 2: Prep Web — isError/retry transverses, garde /stock, retrait d'affectation

Solde la dette web du ledger : les quatre écrans stock n'affichent rien d'utile quand une requête échoue (`isError` ignoré), le sous-arbre `/stock` n'a pas de garde `beforeLoad` (un employé sans accès stock atteint des écrans en erreur), et l'écran Utilisateurs ne permet pas de retirer une affectation d'entrepôt (dette Phase 2, l'API `DELETE /warehouse-members/:id` existe déjà).

**Files:**
- Create: `apps/web/src/components/erreur-chargement.tsx`
- Test: `apps/web/src/components/erreur-chargement.test.tsx`
- Create: `apps/web/src/routes/_app/stock.tsx` (layout de garde)
- Modify: `apps/web/src/routes/_app/stock/index.tsx` (ligne ~173)
- Modify: `apps/web/src/routes/_app/stock/mouvements.tsx` (ligne ~141)
- Modify: `apps/web/src/routes/_app/stock/receptions/index.tsx` (ligne ~197)
- Modify: `apps/web/src/routes/_app/stock/receptions/$purchaseId.tsx` (lignes ~76-80 et ~226)
- Modify: `apps/web/src/routes/_app/administration/utilisateurs.tsx` (type `Utilisateur`, mutation, cellule Affectations)

**Interfaces:**
- Consomme : `GET /users` avec `assignments[].id` (Task 1) ; `DELETE /api/v1/warehouse-members/:id` (existant, 200 `{ ok: true }` / 404).
- Produit : composant `ErreurChargement({ message?: string; onRetry: () => void })` — réutilisé par les écrans des Tasks 11 et 12 ; route layout `/_app/stock` avec garde `beforeLoad` (toutes les nouvelles pages `/stock/*` en héritent automatiquement).

- [ ] **Step 1 : Écrire le test du composant (échoue : composant absent)**

Créer `apps/web/src/components/erreur-chargement.test.tsx` :

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ErreurChargement } from "./erreur-chargement"

describe("ErreurChargement", () => {
  it("affiche le message par défaut et relance au clic", () => {
    const onRetry = vi.fn()
    render(<ErreurChargement onRetry={onRetry} />)
    expect(screen.getByRole("alert").textContent).toContain(
      "Impossible de charger les données."
    )
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("affiche un message personnalisé", () => {
    render(
      <ErreurChargement
        message="Impossible de charger les transferts."
        onRetry={() => undefined}
      />
    )
    expect(screen.getByRole("alert").textContent).toContain(
      "Impossible de charger les transferts."
    )
  })
})
```

Run: `bun run --cwd apps/web test`
Expected: FAIL — module `./erreur-chargement` introuvable.

- [ ] **Step 2 : Créer le composant**

Créer `apps/web/src/components/erreur-chargement.tsx` :

```tsx
import { Button } from "@/components/ui/button"

// État d'erreur transverse des écrans (différé Phase 4) : message en
// français + bouton de relance de la requête TanStack Query.
export function ErreurChargement({
  message = "Impossible de charger les données.",
  onRetry,
}: {
  message?: string
  onRetry: () => void
}) {
  return (
    <div
      role="alert"
      className="flex items-center gap-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
    >
      <span>{message}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Réessayer
      </Button>
    </div>
  )
}
```

Run: `bun run --cwd apps/web test`
Expected: PASS.

- [ ] **Step 3 : Garde beforeLoad du sous-arbre /stock**

Créer `apps/web/src/routes/_app/stock.tsx` :

```tsx
import { Outlet, createFileRoute, redirect } from "@tanstack/react-router"

// Garde d'accès du sous-arbre /stock (différé Phase 4) : le back-office
// stock est réservé aux rôles d'entreprise owner/admin/auditor/stock_manager
// et aux staff affectés manager/auditor d'au moins un entrepôt — miroir de
// porteeLectureStock côté API (le front masque, l'API fait autorité).
export const Route = createFileRoute("/_app/stock")({
  beforeLoad: ({ context }) => {
    const role = context.me.membership?.role
    const lectureTous =
      role === "owner" ||
      role === "admin" ||
      role === "auditor" ||
      role === "stock_manager"
    const aUnEntrepotLisible = context.me.assignments.some(
      (a) => a.role === "manager" || a.role === "auditor"
    )
    if (!lectureTous && !aUnEntrepotLisible) {
      throw redirect({ to: "/" })
    }
  },
  component: Outlet,
})
```

Note : ce fichier devient le parent layout des routes `/_app/stock/*` existantes (TanStack file routing) — `routeTree.gen.ts` se régénère seul au prochain `dev`/`build`, ne pas l'éditer.

- [ ] **Step 4 : isError sur les quatre écrans stock**

Dans `apps/web/src/routes/_app/stock/index.tsx` : ajouter l'import `import { ErreurChargement } from "@/components/erreur-chargement"` puis remplacer (ligne ~173) :

```tsx
      {entrepotsEnCours || niveaux.isPending ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : (
```

par :

```tsx
      {entrepotsEnCours || niveaux.isPending ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : niveaux.isError ? (
        <ErreurChargement
          message="Impossible de charger les niveaux de stock."
          onRetry={() => void niveaux.refetch()}
        />
      ) : (
```

Dans `apps/web/src/routes/_app/stock/mouvements.tsx` : même import, puis remplacer (ligne ~141) :

```tsx
      {mouvements.isPending ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : (
```

par :

```tsx
      {mouvements.isPending ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : mouvements.isError ? (
        <ErreurChargement
          message="Impossible de charger le journal des mouvements."
          onRetry={() => void mouvements.refetch()}
        />
      ) : (
```

Dans `apps/web/src/routes/_app/stock/receptions/index.tsx` : même import, puis remplacer (ligne ~197) :

```tsx
      {receptions.isPending ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : (
```

par :

```tsx
      {receptions.isPending ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : receptions.isError ? (
        <ErreurChargement
          message="Impossible de charger les réceptions."
          onRetry={() => void receptions.refetch()}
        />
      ) : (
```

Dans `apps/web/src/routes/_app/stock/receptions/$purchaseId.tsx` : même import, puis remplacer (lignes ~76-80) :

```tsx
  const { data } = useQuery({
    queryKey: ["purchase", purchaseId],
    queryFn: () =>
      apiFetch<{ purchase: Reception }>(`/api/v1/purchases/${purchaseId}`),
  })
```

par :

```tsx
  const { data, isError, refetch } = useQuery({
    queryKey: ["purchase", purchaseId],
    queryFn: () =>
      apiFetch<{ purchase: Reception }>(`/api/v1/purchases/${purchaseId}`),
  })
```

et remplacer (ligne ~226) :

```tsx
  if (!data) {
    return <p className="text-sm text-gray-500">Chargement…</p>
  }
```

par :

```tsx
  if (isError) {
    return (
      <ErreurChargement
        message="Impossible de charger la réception."
        onRetry={() => void refetch()}
      />
    )
  }
  if (!data) {
    return <p className="text-sm text-gray-500">Chargement…</p>
  }
```

- [ ] **Step 5 : UI de retrait d'affectation (utilisateurs.tsx)**

Dans `apps/web/src/routes/_app/administration/utilisateurs.tsx` :

1. Ajouter `id: string` au type des affectations (lignes 43-47) :

```tsx
  assignments: Array<{
    id: string
    warehouseId: string
    warehouseName: string
    role: WarehouseRole
  }>
```

2. Ajouter la mutation après `affecter` (ligne ~156) :

```tsx
  const retirerAffectation = useMutation({
    mutationFn: (assignmentId: string) =>
      apiFetch(`/api/v1/warehouse-members/${assignmentId}`, {
        method: "DELETE",
      }),
    onSuccess: invalider,
    onError: (err) => alert(err instanceof Error ? err.message : "Erreur"),
  })
```

3. Remplacer la cellule Affectations (lignes ~276-285) :

```tsx
                <TableCell className="text-sm">
                  {u.assignments.length === 0
                    ? "—"
                    : u.assignments
                        .map(
                          (a) =>
                            `${a.warehouseName} (${ROLES_ENTREPOT_FR[a.role]})`
                        )
                        .join(", ")}
                </TableCell>
```

par :

```tsx
                <TableCell className="text-sm">
                  {u.assignments.length === 0 ? (
                    "—"
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {u.assignments.map((a) => (
                        <Badge key={a.id} variant="secondary">
                          {a.warehouseName} ({ROLES_ENTREPOT_FR[a.role]})
                          {peutEcrire && (
                            <button
                              type="button"
                              aria-label={`Retirer l'affectation ${a.warehouseName}`}
                              className="ml-1 font-semibold hover:text-red-700"
                              disabled={retirerAffectation.isPending}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Retirer l'affectation « ${a.warehouseName} » de ${u.name} ?`
                                  )
                                ) {
                                  retirerAffectation.mutate(a.id)
                                }
                              }}
                            >
                              ×
                            </button>
                          )}
                        </Badge>
                      ))}
                    </span>
                  )}
                </TableCell>
```

- [ ] **Step 6 : Vérifier**

Run: `bun run --cwd apps/web build`
Expected: build OK, `routeTree.gen.ts` régénéré avec la route layout `/_app/stock`.

Run: `bun run --cwd apps/web test && bun run typecheck && bun run lint`
Expected: PASS (18 tests web — 16 existants + 2 nouveaux).

- [ ] **Step 7 : Commit**

```bash
git add apps/web/src/components/erreur-chargement.tsx apps/web/src/components/erreur-chargement.test.tsx apps/web/src/routes/_app/stock.tsx apps/web/src/routes/_app/stock/index.tsx apps/web/src/routes/_app/stock/mouvements.tsx apps/web/src/routes/_app/stock/receptions/index.tsx "apps/web/src/routes/_app/stock/receptions/\$purchaseId.tsx" apps/web/src/routes/_app/administration/utilisateurs.tsx apps/web/src/routeTree.gen.ts
git commit -m "fix(web): solder les différés Phase 4 — états d'erreur avec relance, garde beforeLoad /stock, retrait d'affectation entrepôt"
```

---

### Task 3: Schémas transferts/inventaires, migrations 0006 + 0007, schémas Zod, verrous testés

Crée les quatre tables (`transfers`, `transfer_items`, `inventory_counts`, `inventory_count_items`), la migration générée 0006, la migration custom 0007 (triggers d'immuabilité adaptés au cycle `pending → sent → received`/`cancelled` et `open → closed`, index unique partiel « un seul inventaire ouvert par entrepôt »), et les schémas Zod partagés. Les verrous sont pinnés par des tests en accès DB direct — ils protègent toutes les routes des Tasks 5-10 contre les courses.

**Files:**
- Modify: `apps/api/src/db/schema/stock.ts` (ajout en fin de fichier)
- Create: `apps/api/drizzle/0006_<nom-généré>.sql` (via `bunx drizzle-kit generate`)
- Create: `apps/api/drizzle/0007_transfer_inventory_guards.sql` (via `--custom`)
- Modify: `packages/shared/src/schemas/stock.ts` (ajout en fin de fichier)
- Test: `apps/api/test/phase5-guards.test.ts` (nouveau)

**Interfaces:**
- Consomme : `estErreurDeclencheur` ancré (Task 1) ; tables `warehouses`, `productVariants`, `lots`, `user`, `organization` existantes.
- Produit — schéma Drizzle (exports de `apps/api/src/db/schema/stock.ts`, réexportés par `db/schema/index.ts`) :
  - `TRANSFER_STATUSES = ["pending", "sent", "received", "cancelled"] as const`
  - `INVENTORY_COUNT_STATUSES = ["open", "closed"] as const`
  - `transfers` : `{ id, organizationId, fromWarehouseId, toWarehouseId, status, reference, createdBy, sentBy, sentAt, receivedBy, receivedAt, cancelledBy, cancelledAt, createdAt, updatedAt }`
  - `transferItems` : `{ id, organizationId, transferId, variantId, lotId, quantity, unitCost (nullable — CMP origine figé à l'expédition), receivedQuantity (nullable — renseignée à la réception), createdAt }`
  - `inventoryCounts` : `{ id, organizationId, warehouseId, status, openedBy, openedAt, closedBy, closedAt, createdAt, updatedAt }`
  - `inventoryCountItems` : `{ id, organizationId, countId, variantId, expectedQuantity, countedQuantity (nullable), createdAt }`
- Produit — codes de trigger (attrapés par `estErreurDeclencheur`) : `TRANSFERT_EXPEDIE` (document/lignes figés à l'état `sent`), `TRANSFERT_TERMINE` (état terminal `received`/`cancelled`), `INVENTAIRE_CLOS`. Index unique partiel `inventory_counts_open_wh_uidx` → violation détectée via `estViolationUnicite(err, "inventory_counts.warehouse_id")`.
- Produit — schémas Zod (exportés de `shared`) : `transferCreateSchema`, `transferItemCreateSchema`, `transferItemUpdateSchema`, `transferReceiveSchema`, `inventoryCountCreateSchema`, `inventoryCountItemUpdateSchema` (types inférés `TransferCreateInput`, etc.).

- [ ] **Step 1 : Ajouter les tables au schéma Drizzle**

Ajouter à la fin de `apps/api/src/db/schema/stock.ts` :

```ts
export const TRANSFER_STATUSES = [
  "pending",
  "sent",
  "received",
  "cancelled",
] as const

export const INVENTORY_COUNT_STATUSES = ["open", "closed"] as const

// Transfert inter-entrepôts : pending (brouillon éditable, annulable) →
// sent (stock sorti de l'origine, lignes figées, CMP origine gelé sur
// unit_cost) → received (stock entré à destination, terminal). Terminal
// aussi : cancelled (avant expédition seulement). Immuabilité par triggers
// (0007_transfer_inventory_guards).
export const transfers = sqliteTable(
  "transfers",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    fromWarehouseId: text("from_warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    toWarehouseId: text("to_warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    status: text("status", { enum: TRANSFER_STATUSES })
      .notNull()
      .default("pending"),
    // Référence libre (n° de bon de transfert interne)
    reference: text("reference"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    sentBy: text("sent_by").references(() => user.id),
    sentAt: integer("sent_at", { mode: "timestamp" }),
    receivedBy: text("received_by").references(() => user.id),
    receivedAt: integer("received_at", { mode: "timestamp" }),
    cancelledBy: text("cancelled_by").references(() => user.id),
    cancelledAt: integer("cancelled_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("transfers_org_status_idx").on(t.organizationId, t.status)]
)

export const transferItems = sqliteTable(
  "transfer_items",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    transferId: text("transfer_id")
      .notNull()
      .references(() => transfers.id, { onDelete: "cascade" }),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id),
    // Lot choisi côté origine (optionnel en brouillon, exigé à l'expédition
    // pour un produit trackLots). Le lot est GLOBAL à la variante
    // (lots_variant_lot_uidx) : le même lotId sert au transfer_in de
    // destination, aucune création de lot côté destination.
    lotId: text("lot_id").references(() => lots.id),
    quantity: integer("quantity").notNull(),
    // CMP de l'entrepôt d'origine, entier XOF, figé PAR SOUS-REQUÊTE SQL
    // dans le batch d'expédition ; null tant que le transfert est pending.
    unitCost: integer("unit_cost"),
    // Quantité acceptée à destination (<= quantity) ; null avant réception.
    receivedQuantity: integer("received_quantity"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("transfer_items_transfer_idx").on(t.transferId)]
)

// Inventaire TOUJOURS COMPLET (v1, spec) : l'ouverture fige une ligne par
// niveau de l'entrepôt (expected_quantity), les comptages s'étalent sur
// plusieurs sessions, la clôture génère les mouvements `count`.
// L'index unique partiel « un seul inventaire ouvert par entrepôt » est posé
// en migration custom 0007 (index partiel : HORS snapshot drizzle).
export const inventoryCounts = sqliteTable(
  "inventory_counts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    status: text("status", { enum: INVENTORY_COUNT_STATUSES })
      .notNull()
      .default("open"),
    openedBy: text("opened_by")
      .notNull()
      .references(() => user.id),
    openedAt: integer("opened_at", { mode: "timestamp" }).notNull(),
    closedBy: text("closed_by").references(() => user.id),
    closedAt: integer("closed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("inventory_counts_org_status_idx").on(t.organizationId, t.status),
  ]
)

export const inventoryCountItems = sqliteTable(
  "inventory_count_items",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    countId: text("count_id")
      .notNull()
      .references(() => inventoryCounts.id, { onDelete: "cascade" }),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id),
    // Quantité figée à l'ouverture (photographie de stock_levels.quantity)
    expectedQuantity: integer("expected_quantity").notNull(),
    // Quantité comptée ; null = pas encore comptée (ignorée à la clôture)
    countedQuantity: integer("counted_quantity"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("inventory_count_items_count_idx").on(t.countId),
    uniqueIndex("inventory_count_items_count_variant_uidx").on(
      t.countId,
      t.variantId
    ),
  ]
)
```

- [ ] **Step 2 : Générer la migration 0006 et l'inspecter**

Run: `cd apps/api && bunx drizzle-kit generate`
Expected: un fichier `drizzle/0006_<nom-aléatoire>.sql` contenant UNIQUEMENT `CREATE TABLE transfers`, `CREATE TABLE transfer_items`, `CREATE TABLE inventory_counts`, `CREATE TABLE inventory_count_items` et leurs index (`transfers_org_status_idx`, `transfer_items_transfer_idx`, `inventory_counts_org_status_idx`, `inventory_count_items_count_idx`, `inventory_count_items_count_variant_uidx`). AUCUN `DROP` — si un `DROP INDEX` apparaît, un index custom a fui dans les snapshots : STOP, corriger avant de continuer.

- [ ] **Step 3 : Créer la migration custom 0007**

Run: `cd apps/api && bunx drizzle-kit generate --custom --name=transfer_inventory_guards`
Expected: fichier vide `drizzle/0007_transfer_inventory_guards.sql` créé et enregistré dans `drizzle/meta/_journal.json`.

Remplir `apps/api/drizzle/0007_transfer_inventory_guards.sql` :

```sql
-- Custom SQL migration file, put your code below! --

-- 1) Un seul inventaire ouvert par entrepôt (index partiel : HORS snapshot
--    drizzle-kit, comme les index barcode de 0005). La violation remonte
--    « UNIQUE constraint failed: inventory_counts.warehouse_id » →
--    estViolationUnicite(err, 'inventory_counts.warehouse_id').
CREATE UNIQUE INDEX IF NOT EXISTS inventory_counts_open_wh_uidx
  ON inventory_counts(warehouse_id) WHERE status = 'open';--> statement-breakpoint

-- 2) Transferts — mêmes garanties que purchases_recu_immuable (0005) :
--    le RAISE(ABORT) annule le STATEMENT ET SA TRANSACTION (tout db.batch
--    en cours), ce qui rend les courses double-send / double-receive /
--    cancel-après-send atomiquement impossibles.
-- 2a) Un transfert terminé (received/cancelled) est immuable.
CREATE TRIGGER IF NOT EXISTS transfers_termine_immuable
BEFORE UPDATE ON transfers
WHEN old.status IN ('received', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'TRANSFERT_TERMINE');
END;--> statement-breakpoint
-- 2b) Un transfert expédié n'accepte plus qu'UNE transition : received.
--     Tue le double-send (sent -> sent), l'annulation après expédition
--     (sent -> cancelled) et toute édition du document une fois expédié.
CREATE TRIGGER IF NOT EXISTS transfers_expedie_fige
BEFORE UPDATE ON transfers
WHEN old.status = 'sent' AND new.status <> 'received'
BEGIN
  SELECT RAISE(ABORT, 'TRANSFERT_EXPEDIE');
END;--> statement-breakpoint

-- 3) Lignes de transfert.
-- 3a) État terminal : plus aucune écriture.
CREATE TRIGGER IF NOT EXISTS transfer_items_termine_insert
BEFORE INSERT ON transfer_items
WHEN (SELECT status FROM transfers WHERE id = new.transfer_id)
  IN ('received', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'TRANSFERT_TERMINE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS transfer_items_termine_update
BEFORE UPDATE ON transfer_items
WHEN (SELECT status FROM transfers WHERE id = old.transfer_id)
  IN ('received', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'TRANSFERT_TERMINE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS transfer_items_termine_delete
BEFORE DELETE ON transfer_items
WHEN (SELECT status FROM transfers WHERE id = old.transfer_id)
  IN ('received', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'TRANSFERT_TERMINE');
END;--> statement-breakpoint
-- 3b) État sent : pas d'ajout ni de retrait de ligne…
CREATE TRIGGER IF NOT EXISTS transfer_items_expedie_insert
BEFORE INSERT ON transfer_items
WHEN (SELECT status FROM transfers WHERE id = new.transfer_id) = 'sent'
BEGIN
  SELECT RAISE(ABORT, 'TRANSFERT_EXPEDIE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS transfer_items_expedie_delete
BEFORE DELETE ON transfer_items
WHEN (SELECT status FROM transfers WHERE id = old.transfer_id) = 'sent'
BEGIN
  SELECT RAISE(ABORT, 'TRANSFERT_EXPEDIE');
END;--> statement-breakpoint
-- 3c) …et seule received_quantity peut changer (écrite par la réception,
--     dont le batch met à jour les lignes AVANT le passage received).
--     `IS NOT` et non `<>` : lot_id/unit_cost sont nullables.
--     NB : le gel du CMP à l'expédition met à jour unit_cost PENDANT que le
--     parent est encore 'pending' (ordre du batch : lignes puis statut) —
--     ce trigger ne le concerne donc pas.
CREATE TRIGGER IF NOT EXISTS transfer_items_expedie_update
BEFORE UPDATE ON transfer_items
WHEN (SELECT status FROM transfers WHERE id = old.transfer_id) = 'sent'
  AND (new.quantity IS NOT old.quantity
    OR new.variant_id IS NOT old.variant_id
    OR new.lot_id IS NOT old.lot_id
    OR new.unit_cost IS NOT old.unit_cost
    OR new.transfer_id IS NOT old.transfer_id)
BEGIN
  SELECT RAISE(ABORT, 'TRANSFERT_EXPEDIE');
END;--> statement-breakpoint

-- 4) Inventaires : un document clos est immuable, lignes comprises.
CREATE TRIGGER IF NOT EXISTS inventory_counts_clos_immuable
BEFORE UPDATE ON inventory_counts
WHEN old.status = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'INVENTAIRE_CLOS');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS inventory_count_items_clos_insert
BEFORE INSERT ON inventory_count_items
WHEN (SELECT status FROM inventory_counts WHERE id = new.count_id) = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'INVENTAIRE_CLOS');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS inventory_count_items_clos_update
BEFORE UPDATE ON inventory_count_items
WHEN (SELECT status FROM inventory_counts WHERE id = old.count_id) = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'INVENTAIRE_CLOS');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS inventory_count_items_clos_delete
BEFORE DELETE ON inventory_count_items
WHEN (SELECT status FROM inventory_counts WHERE id = old.count_id) = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'INVENTAIRE_CLOS');
END;
```

- [ ] **Step 4 : Ajouter les schémas Zod partagés**

Ajouter à la fin de `packages/shared/src/schemas/stock.ts` (le fichier est déjà réexporté par `packages/shared/src/index.ts` — vérifier, aucune modification d'index attendue) :

```ts
export const transferCreateSchema = z.object({
  fromWarehouseId: z.string().min(1, "L'entrepôt d'origine est requis"),
  toWarehouseId: z.string().min(1, "L'entrepôt de destination est requis"),
  reference: z.string().trim().min(1).optional(),
})

export const transferItemCreateSchema = z.object({
  variantId: z.string().min(1, "La variante est requise"),
  quantity: z
    .number()
    .int("La quantité doit être un entier")
    .positive("La quantité doit être positive"),
  lotId: z.string().min(1).optional(),
})

export const transferItemUpdateSchema = z
  .object({
    quantity: z
      .number()
      .int("La quantité doit être un entier")
      .positive("La quantité doit être positive")
      .optional(),
    lotId: z.string().min(1).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Aucun champ à modifier",
  })

// Corps OPTIONNEL de la réception : lignes absentes = tout est reçu.
export const transferReceiveSchema = z.object({
  items: z
    .array(
      z.object({
        itemId: z.string().min(1, "La ligne est requise"),
        receivedQuantity: z
          .number()
          .int("La quantité reçue doit être un entier")
          .nonnegative("La quantité reçue doit être positive ou nulle"),
      })
    )
    .optional(),
})

export const inventoryCountCreateSchema = z.object({
  warehouseId: z.string().min(1, "L'entrepôt est requis"),
})

export const inventoryCountItemUpdateSchema = z.object({
  countedQuantity: z
    .number()
    .int("La quantité comptée doit être un entier")
    .nonnegative("La quantité comptée doit être positive ou nulle")
    .nullable(),
})

export type TransferCreateInput = z.infer<typeof transferCreateSchema>
export type TransferItemCreateInput = z.infer<typeof transferItemCreateSchema>
export type TransferItemUpdateInput = z.infer<typeof transferItemUpdateSchema>
export type TransferReceiveInput = z.infer<typeof transferReceiveSchema>
export type InventoryCountCreateInput = z.infer<
  typeof inventoryCountCreateSchema
>
export type InventoryCountItemUpdateInput = z.infer<
  typeof inventoryCountItemUpdateSchema
>
```

- [ ] **Step 5 : Écrire les tests de verrous (échouent tant que la migration n'est pas rejouée — puis passent : les tests rejouent TOUTES les migrations à chaque run via `apply-migrations.ts`)**

Créer `apps/api/test/phase5-guards.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
import * as schema from "../src/db/schema"
import { estErreurDeclencheur, estViolationUnicite } from "../src/lib/db-errors"
import { bootstrapOwner, creerEntrepot, creerProduitSimple } from "./helpers"

async function erreurDe(promesse: Promise<unknown>): Promise<unknown> {
  try {
    await promesse
  } catch (err) {
    return err
  }
  throw new Error("l'instruction aurait dû échouer")
}

type Seed = {
  organizationId: string
  ownerId: string
  origineId: string
  destinationId: string
  variantId: string
}

async function seed(): Promise<Seed> {
  const { organizationId, ownerId } = await bootstrapOwner()
  const origineId = await creerEntrepot(organizationId, "Origine")
  const destinationId = await creerEntrepot(organizationId, "Destination")
  const { variantId } = await creerProduitSimple(organizationId)
  return { organizationId, ownerId, origineId, destinationId, variantId }
}

// Insère un transfert + une ligne en 'pending' puis force le statut voulu
// (les triggers n'entravent jamais la sortie de 'pending').
async function insererTransfert(
  s: Seed,
  status: (typeof schema.TRANSFER_STATUSES)[number]
): Promise<{ transferId: string; itemId: string }> {
  const db = drizzle(env.DB, { schema })
  const transferId = crypto.randomUUID()
  const itemId = crypto.randomUUID()
  const maintenant = new Date()
  await db.insert(schema.transfers).values({
    id: transferId,
    organizationId: s.organizationId,
    fromWarehouseId: s.origineId,
    toWarehouseId: s.destinationId,
    createdBy: s.ownerId,
    createdAt: maintenant,
    updatedAt: maintenant,
  })
  await db.insert(schema.transferItems).values({
    id: itemId,
    organizationId: s.organizationId,
    transferId,
    variantId: s.variantId,
    quantity: 5,
    createdAt: maintenant,
  })
  if (status !== "pending") {
    await db
      .update(schema.transfers)
      .set({ status })
      .where(eq(schema.transfers.id, transferId))
  }
  return { transferId, itemId }
}

async function insererInventaire(
  s: Seed,
  warehouseId: string,
  status: (typeof schema.INVENTORY_COUNT_STATUSES)[number]
): Promise<{ countId: string; itemId: string }> {
  const db = drizzle(env.DB, { schema })
  const countId = crypto.randomUUID()
  const itemId = crypto.randomUUID()
  const maintenant = new Date()
  await db.insert(schema.inventoryCounts).values({
    id: countId,
    organizationId: s.organizationId,
    warehouseId,
    openedBy: s.ownerId,
    openedAt: maintenant,
    createdAt: maintenant,
    updatedAt: maintenant,
  })
  await db.insert(schema.inventoryCountItems).values({
    id: itemId,
    organizationId: s.organizationId,
    countId,
    variantId: s.variantId,
    expectedQuantity: 10,
    createdAt: maintenant,
  })
  if (status === "closed") {
    await db
      .update(schema.inventoryCounts)
      .set({ status: "closed" })
      .where(eq(schema.inventoryCounts.id, countId))
  }
  return { countId, itemId }
}

describe("verrous 0007 — transferts", () => {
  it("un transfert terminé est immuable, document et lignes", async () => {
    const s = await seed()
    const db = drizzle(env.DB, { schema })
    for (const statut of ["received", "cancelled"] as const) {
      const { transferId, itemId } = await insererTransfert(s, statut)
      expect(
        estErreurDeclencheur(
          await erreurDe(
            db
              .update(schema.transfers)
              .set({ reference: "X" })
              .where(eq(schema.transfers.id, transferId))
          ),
          "TRANSFERT_TERMINE"
        )
      ).toBe(true)
      expect(
        estErreurDeclencheur(
          await erreurDe(
            db
              .update(schema.transferItems)
              .set({ quantity: 9 })
              .where(eq(schema.transferItems.id, itemId))
          ),
          "TRANSFERT_TERMINE"
        )
      ).toBe(true)
      expect(
        estErreurDeclencheur(
          await erreurDe(
            db
              .delete(schema.transferItems)
              .where(eq(schema.transferItems.id, itemId))
          ),
          "TRANSFERT_TERMINE"
        )
      ).toBe(true)
      expect(
        estErreurDeclencheur(
          await erreurDe(
            db.insert(schema.transferItems).values({
              id: crypto.randomUUID(),
              organizationId: s.organizationId,
              transferId,
              variantId: s.variantId,
              quantity: 1,
              createdAt: new Date(),
            })
          ),
          "TRANSFERT_TERMINE"
        )
      ).toBe(true)
    }
  })

  it("expédié : document et lignes figés, sauf received_quantity et la transition received", async () => {
    const s = await seed()
    const db = drizzle(env.DB, { schema })
    const { transferId, itemId } = await insererTransfert(s, "sent")
    // Édition du document (sans changer le statut) → refus
    expect(
      estErreurDeclencheur(
        await erreurDe(
          db
            .update(schema.transfers)
            .set({ reference: "X" })
            .where(eq(schema.transfers.id, transferId))
        ),
        "TRANSFERT_EXPEDIE"
      )
    ).toBe(true)
    // Double expédition (sent -> sent) → refus
    expect(
      estErreurDeclencheur(
        await erreurDe(
          db
            .update(schema.transfers)
            .set({ status: "sent" })
            .where(eq(schema.transfers.id, transferId))
        ),
        "TRANSFERT_EXPEDIE"
      )
    ).toBe(true)
    // Annulation après expédition → refus
    expect(
      estErreurDeclencheur(
        await erreurDe(
          db
            .update(schema.transfers)
            .set({ status: "cancelled" })
            .where(eq(schema.transfers.id, transferId))
        ),
        "TRANSFERT_EXPEDIE"
      )
    ).toBe(true)
    // Lignes : quantité figée, ajout/retrait interdits
    expect(
      estErreurDeclencheur(
        await erreurDe(
          db
            .update(schema.transferItems)
            .set({ quantity: 9 })
            .where(eq(schema.transferItems.id, itemId))
        ),
        "TRANSFERT_EXPEDIE"
      )
    ).toBe(true)
    expect(
      estErreurDeclencheur(
        await erreurDe(
          db
            .delete(schema.transferItems)
            .where(eq(schema.transferItems.id, itemId))
        ),
        "TRANSFERT_EXPEDIE"
      )
    ).toBe(true)
    // …mais la saisie de réception passe
    await db
      .update(schema.transferItems)
      .set({ receivedQuantity: 4 })
      .where(eq(schema.transferItems.id, itemId))
    // …et la transition received passe
    await db
      .update(schema.transfers)
      .set({ status: "received" })
      .where(eq(schema.transfers.id, transferId))
  })
})

describe("verrous 0007 — inventaires", () => {
  it("un seul inventaire ouvert par entrepôt (index partiel)", async () => {
    const s = await seed()
    const db = drizzle(env.DB, { schema })
    await insererInventaire(s, s.origineId, "open")
    const err = await erreurDe(
      db.insert(schema.inventoryCounts).values({
        id: crypto.randomUUID(),
        organizationId: s.organizationId,
        warehouseId: s.origineId,
        openedBy: s.ownerId,
        openedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    )
    expect(estViolationUnicite(err, "inventory_counts.warehouse_id")).toBe(
      true
    )
    // Un autre entrepôt reste libre, et un doc clos libère le sien
    await insererInventaire(s, s.destinationId, "open")
  })

  it("un inventaire clos est immuable, document et lignes", async () => {
    const s = await seed()
    const db = drizzle(env.DB, { schema })
    const { countId, itemId } = await insererInventaire(
      s,
      s.origineId,
      "closed"
    )
    expect(
      estErreurDeclencheur(
        await erreurDe(
          db
            .update(schema.inventoryCounts)
            .set({ status: "open" })
            .where(eq(schema.inventoryCounts.id, countId))
        ),
        "INVENTAIRE_CLOS"
      )
    ).toBe(true)
    expect(
      estErreurDeclencheur(
        await erreurDe(
          db
            .update(schema.inventoryCountItems)
            .set({ countedQuantity: 3 })
            .where(eq(schema.inventoryCountItems.id, itemId))
        ),
        "INVENTAIRE_CLOS"
      )
    ).toBe(true)
    expect(
      estErreurDeclencheur(
        await erreurDe(
          db
            .delete(schema.inventoryCountItems)
            .where(eq(schema.inventoryCountItems.id, itemId))
        ),
        "INVENTAIRE_CLOS"
      )
    ).toBe(true)
    // Un inventaire clos n'empêche pas d'en rouvrir un sur l'entrepôt
    await insererInventaire(s, s.origineId, "open")
  })
})
```

- [ ] **Step 6 : Vérifier**

Run: `cd apps/api && bunx vitest run test/phase5-guards.test.ts`
Expected: PASS — les migrations 0006/0007 sont rejouées automatiquement par le setup de tests (`readD1Migrations`), les triggers et l'index partiel sont actifs.

Run: `bun run --cwd apps/api test && bun run typecheck && bun run lint`
Expected: PASS — aucune régression.

- [ ] **Step 7 : Vérifier que les snapshots n'embarquent pas les objets custom**

Run: `grep -l "inventory_counts_open_wh_uidx\|transfers_termine" apps/api/drizzle/meta/*.json || echo "OK — hors snapshots"`
Expected: `OK — hors snapshots`.

- [ ] **Step 8 : Commit**

```bash
git add apps/api/src/db/schema/stock.ts apps/api/drizzle packages/shared/src/schemas/stock.ts apps/api/test/phase5-guards.test.ts
git commit -m "feat(api): tables transferts et inventaires, migrations 0006-0007 (triggers d'immuabilité, inventaire ouvert unique), schémas Zod partagés"
```

---

### Task 4: Service stock — `transfer_in` devient un apport valorisé (CMP)

`applyMovements` ne recalcule aujourd'hui le CMP que pour les mouvements `purchase`. La spec Phase 5 exige que la réception d'un transfert absorbe le CMP d'origine figé dans le CMP de destination : `transfer_in` rejoint `purchase` dans la catégorie « apport valorisé » (delta positif + `unitCost` obligatoires, contribution au CMP dans le même CASE SQL).

**Files:**
- Modify: `apps/api/src/services/stock.ts` (type `MouvementStock`, validation d'entrée, `agregerParNiveau`)
- Test: `apps/api/test/stock-service-transferts.test.ts` (nouveau)

**Interfaces:**
- Consomme : `applyMovements(db, { organizationId, userId, mouvements, instructionsAvant?, date? })` existant ; helpers de test.
- Produit : `applyMovements` accepte `{ type: "transfer_in", delta > 0, unitCost: entier >= 0 }` et met à jour `avgCost` exactement comme un `purchase` ; `transfer_out`/`count` restent des mouvements non valorisés (CMP intact). Signature INCHANGÉE — les Tasks 6, 7 et 10 appellent ce service.

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `apps/api/test/stock-service-transferts.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { and, eq } from "drizzle-orm"
import * as schema from "../src/db/schema"
import { applyMovements } from "../src/services/stock"
import { bootstrapOwner, creerEntrepot, creerProduitSimple } from "./helpers"

// Retour annoté `| null` (piège eslint no-unnecessary-condition)
async function lireNiveau(
  warehouseId: string,
  variantId: string
): Promise<{ quantity: number; avgCost: number } | null> {
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

async function seed() {
  const { organizationId, ownerId } = await bootstrapOwner()
  const entrepotId = await creerEntrepot(organizationId)
  const { variantId } = await creerProduitSimple(organizationId)
  return { organizationId, ownerId, entrepotId, variantId }
}

describe("applyMovements — transfer_in est un apport valorisé", () => {
  it("absorbe l'unitCost dans le CMP existant (formule CMP identique à purchase)", async () => {
    const { organizationId, ownerId, entrepotId, variantId } = await seed()
    const db = drizzle(env.DB, { schema })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId: entrepotId,
          variantId,
          delta: 10,
          type: "purchase",
          unitCost: 100,
        },
      ],
    })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId: entrepotId,
          variantId,
          delta: 10,
          type: "transfer_in",
          unitCost: 200,
        },
      ],
    })
    // (10 × 100 + 10 × 200) / 20 = 150
    expect(await lireNiveau(entrepotId, variantId)).toEqual({
      quantity: 20,
      avgCost: 150,
    })
  })

  it("initialise le CMP d'un niveau vierge à l'unitCost de l'apport", async () => {
    const { organizationId, ownerId, entrepotId, variantId } = await seed()
    const db = drizzle(env.DB, { schema })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId: entrepotId,
          variantId,
          delta: 8,
          type: "transfer_in",
          unitCost: 250,
        },
      ],
    })
    expect(await lireNiveau(entrepotId, variantId)).toEqual({
      quantity: 8,
      avgCost: 250,
    })
  })

  it("transfer_out ne modifie jamais le CMP", async () => {
    const { organizationId, ownerId, entrepotId, variantId } = await seed()
    const db = drizzle(env.DB, { schema })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId: entrepotId,
          variantId,
          delta: 10,
          type: "purchase",
          unitCost: 100,
        },
      ],
    })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        { warehouseId: entrepotId, variantId, delta: -4, type: "transfer_out" },
      ],
    })
    expect(await lireNiveau(entrepotId, variantId)).toEqual({
      quantity: 6,
      avgCost: 100,
    })
  })

  it("refuse un transfer_in sans unitCost, avant toute écriture", async () => {
    const { organizationId, ownerId, entrepotId, variantId } = await seed()
    const db = drizzle(env.DB, { schema })
    await expect(
      applyMovements(db, {
        organizationId,
        userId: ownerId,
        mouvements: [
          { warehouseId: entrepotId, variantId, delta: 5, type: "transfer_in" },
        ],
      })
    ).rejects.toThrow(/apport valorisé/)
    expect(await lireNiveau(entrepotId, variantId)).toBeNull()
  })
})
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd apps/api && bunx vitest run test/stock-service-transferts.test.ts`
Expected: FAIL — le premier test trouve `avgCost: 100` (le `transfer_in` n'a pas alimenté le CMP), le dernier ne rejette pas.

- [ ] **Step 3 : Étendre le service**

Dans `apps/api/src/services/stock.ts` :

1. Ajouter après la définition de `TypeMouvement` (ligne ~11) :

```ts
// Entrées « apport valorisé » : elles portent un unitCost et alimentent le
// CMP du niveau de destination. `purchase` depuis la Phase 4 ; `transfer_in`
// depuis la Phase 5 (spec : le transfert est valorisé au CMP de l'origine,
// figé sur la ligne à l'expédition et absorbé ici, à la réception).
const TYPES_APPORT_VALORISE: ReadonlySet<TypeMouvement> = new Set([
  "purchase",
  "transfer_in",
])
```

2. Dans `MouvementStock`, remplacer le commentaire de `unitCost` :

```ts
  // Requis pour type "purchase" : alimente le CMP
  unitCost?: number
```

par :

```ts
  // Requis pour les apports valorisés ("purchase", "transfer_in") :
  // alimente le CMP
  unitCost?: number
```

3. Dans le type `Agregat`, remplacer les deux commentaires :

```ts
  // Somme des deltas des mouvements `purchase` du groupe
  qtyRecue: number
  // Somme des quantité × coût unitaire des mouvements `purchase` du groupe
  coutTotalApport: number
```

par :

```ts
  // Somme des deltas des mouvements d'apport valorisé du groupe
  qtyRecue: number
  // Somme des quantité × coût unitaire des apports valorisés du groupe
  coutTotalApport: number
```

4. Dans `agregerParNiveau`, remplacer :

```ts
    if (m.type === "purchase") {
```

par :

```ts
    if (TYPES_APPORT_VALORISE.has(m.type)) {
```

5. Dans la boucle de validation d'`applyMovements`, remplacer :

```ts
    if (m.type === "purchase") {
      if (m.delta <= 0 || m.unitCost === undefined) {
        throw new Error(
          "Un mouvement purchase exige un delta positif et un unitCost"
        )
      }
      if (!Number.isInteger(m.unitCost) || m.unitCost < 0) {
        throw new Error("unitCost doit être un entier positif ou nul")
      }
    }
```

par :

```ts
    if (TYPES_APPORT_VALORISE.has(m.type)) {
      if (m.delta <= 0 || m.unitCost === undefined) {
        throw new Error(
          "Un mouvement d'apport valorisé (purchase, transfer_in) exige un delta positif et un unitCost"
        )
      }
      if (!Number.isInteger(m.unitCost) || m.unitCost < 0) {
        throw new Error("unitCost doit être un entier positif ou nul")
      }
    }
```

6. Dans le grand commentaire au-dessus d'`applyMovements`, remplacer la ligne « CMP (coût moyen pondéré, entier XOF), pour les mouvements `purchase`, » par « CMP (coût moyen pondéré, entier XOF), pour les apports valorisés (`purchase`, `transfer_in`), ».

- [ ] **Step 4 : Vérifier**

Run: `cd apps/api && bunx vitest run test/stock-service-transferts.test.ts test/stock-service.test.ts`
Expected: PASS — nouveaux tests verts, tests service existants inchangés.

Run: `bun run --cwd apps/api test`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add apps/api/src/services/stock.ts apps/api/test/stock-service-transferts.test.ts
git commit -m "feat(api): transfer_in devient un apport valorisé dans applyMovements (CMP de destination)"
```

---

### Task 5: Transferts — brouillon (création, lignes, lecture, annulation)

Le CRUD du document `pending`, calqué sur `apps/api/src/routes/purchases.ts` : portée de lecture bi-entrepôt (un transfert est visible si l'origine OU la destination est dans la portée), écriture réservée au rôle sur l'ORIGINE, règles de lot par ligne, annulation avant expédition. Les transitions `send`/`receive` arrivent aux Tasks 6-7 — cette tâche pose déjà les gardes de statut et les réponses d'erreur qu'elles réutilisent.

**Files:**
- Create: `apps/api/src/routes/transfers.ts`
- Modify: `apps/api/src/lib/org-scope.ts` (ajout `entrepotExiste`)
- Modify: `apps/api/src/index.ts` (montage `/api/v1/transfers`)
- Test: `apps/api/test/transfers-draft.test.ts` (nouveau)

**Interfaces:**
- Consomme : `transferCreateSchema`, `transferItemCreateSchema`, `transferItemUpdateSchema` (Task 3) ; `verifierAccesEntrepot`, `porteeLectureStock`, `validerCorps`, `varianteScope`, `estErreurDeclencheur` ; tables Task 3.
- Produit — routes montées sous `/api/v1/transfers` :
  - `GET /` → `{ transfers: Array<{ id, fromWarehouseId, fromWarehouseName, toWarehouseId, toWarehouseName, reference, status, createdAt, sentAt, receivedAt, itemCount, totalQuantity }> }` (filtres `?statut=`, `?warehouseId=` — origine ou destination)
  - `POST /` corps `TransferCreateInput` → `201 { id }` | `400 TRANSFERT_MEME_ENTREPOT` | `403` (origine) | `404 INTROUVABLE` (destination)
  - `GET /:id` → `{ transfer: { id, fromWarehouseId, fromWarehouseName, toWarehouseId, toWarehouseName, reference, status, createdAt, sentAt, receivedAt, cancelledAt, items: Array<{ id, variantId, productId, productName, variantName, sku, trackLots, lotId, lotNumber, quantity, unitCost, receivedQuantity }> } }`
  - `POST /:id/items`, `PATCH /:id/items/:itemId`, `DELETE /:id/items/:itemId` (statut `pending` uniquement, sinon `409 TRANSFERT_EXPEDIE`)
  - `POST /:id/cancel` → `200 { ok: true }` | `409 STATUT_INVALIDE`
- Produit — helpers internes réutilisés par les Tasks 6-7 (même fichier) : `transfertScope(db, organizationId, id): Promise<typeof schema.transfers.$inferSelect | null>`, `REPONSE_TRANSFERT_EXPEDIE`, `verifierReglesLot(db, variantProductId, variantId, lotId)` ; helper partagé `entrepotExiste(db, organizationId, id): Promise<boolean>` (`lib/org-scope.ts`).

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `apps/api/test/transfers-draft.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
import app from "../src/index"
import * as schema from "../src/db/schema"
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

async function creerLot(
  organizationId: string,
  variantId: string,
  lotNumber = "LOT-1"
): Promise<string> {
  const db = drizzle(env.DB, { schema })
  const id = crypto.randomUUID()
  await db.insert(schema.lots).values({
    id,
    organizationId,
    variantId,
    lotNumber,
    expiryDate: null,
    createdAt: new Date(),
  })
  return id
}

async function seed() {
  const { organizationId, ownerCookie } = await bootstrapOwner()
  const origineId = await creerEntrepot(organizationId, "Origine")
  const destinationId = await creerEntrepot(organizationId, "Destination")
  const { variantId } = await creerProduitSimple(organizationId)
  return { organizationId, ownerCookie, origineId, destinationId, variantId }
}

describe("transferts — brouillon", () => {
  it("création, ajout/édition/retrait de ligne, détail complet", async () => {
    const { ownerCookie, origineId, destinationId, variantId } = await seed()
    const creation = await req(ownerCookie, "POST", "/api/v1/transfers", {
      fromWarehouseId: origineId,
      toWarehouseId: destinationId,
      reference: "BT-001",
    })
    expect(creation.status).toBe(201)
    const { id } = await creation.json<{ id: string }>()

    const ajout = await req(ownerCookie, "POST", `/api/v1/transfers/${id}/items`, {
      variantId,
      quantity: 4,
    })
    expect(ajout.status).toBe(201)
    const { id: itemId } = await ajout.json<{ id: string }>()

    expect(
      (
        await req(
          ownerCookie,
          "PATCH",
          `/api/v1/transfers/${id}/items/${itemId}`,
          { quantity: 6 }
        )
      ).status
    ).toBe(200)

    const detail = await req(ownerCookie, "GET", `/api/v1/transfers/${id}`)
    expect(detail.status).toBe(200)
    const { transfer } = await detail.json<{
      transfer: {
        status: string
        reference: string | null
        fromWarehouseName: string
        toWarehouseName: string
        items: Array<{
          id: string
          quantity: number
          unitCost: number | null
          receivedQuantity: number | null
        }>
      }
    }>()
    expect(transfer.status).toBe("pending")
    expect(transfer.reference).toBe("BT-001")
    expect(transfer.fromWarehouseName).toBe("Origine")
    expect(transfer.toWarehouseName).toBe("Destination")
    expect(transfer.items).toEqual([
      expect.objectContaining({
        id: itemId,
        quantity: 6,
        unitCost: null,
        receivedQuantity: null,
      }),
    ])

    expect(
      (
        await req(
          ownerCookie,
          "DELETE",
          `/api/v1/transfers/${id}/items/${itemId}`
        )
      ).status
    ).toBe(200)
  })

  it("refuse origine = destination (TRANSFERT_MEME_ENTREPOT)", async () => {
    const { ownerCookie, origineId } = await seed()
    const res = await req(ownerCookie, "POST", "/api/v1/transfers", {
      fromWarehouseId: origineId,
      toWarehouseId: origineId,
    })
    expect(res.status).toBe(400)
    expect((await res.json<{ code: string }>()).code).toBe(
      "TRANSFERT_MEME_ENTREPOT"
    )
  })

  it("destination inconnue ou d'une autre organisation → 404 ; origine d'une autre organisation → 403", async () => {
    const { ownerCookie, origineId } = await seed()
    const db = drizzle(env.DB, { schema })
    const autreOrgId = crypto.randomUUID()
    await db.insert(schema.organization).values({
      id: autreOrgId,
      name: "Autre Société",
      slug: `autre-${autreOrgId.slice(0, 8)}`,
      createdAt: new Date(),
    })
    const entrepotEtranger = await creerEntrepot(autreOrgId, "Étranger")

    const versEtranger = await req(ownerCookie, "POST", "/api/v1/transfers", {
      fromWarehouseId: origineId,
      toWarehouseId: entrepotEtranger,
    })
    expect(versEtranger.status).toBe(404)
    const depuisEtranger = await req(ownerCookie, "POST", "/api/v1/transfers", {
      fromWarehouseId: entrepotEtranger,
      toWarehouseId: origineId,
    })
    expect(depuisEtranger.status).toBe(403)
  })

  it("matrice d'écriture : manager ORIGINE crée, manager destination seule 403, cashier 403, auditor d'entreprise 403", async () => {
    const { organizationId, origineId, destinationId } = await seed()
    const managerOrigine = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      managerOrigine.userId,
      origineId,
      "manager"
    )
    const managerDestination = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      managerDestination.userId,
      destinationId,
      "manager"
    )
    const caissier = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, caissier.userId, origineId, "cashier")
    const auditeur = await createUserWithRole(organizationId, "auditor")

    const corps = { fromWarehouseId: origineId, toWarehouseId: destinationId }
    expect(
      (await req(managerOrigine.cookie, "POST", "/api/v1/transfers", corps))
        .status
    ).toBe(201)
    expect(
      (await req(managerDestination.cookie, "POST", "/api/v1/transfers", corps))
        .status
    ).toBe(403)
    expect(
      (await req(caissier.cookie, "POST", "/api/v1/transfers", corps)).status
    ).toBe(403)
    expect(
      (await req(auditeur.cookie, "POST", "/api/v1/transfers", corps)).status
    ).toBe(403)
  })

  it("règles de lot en brouillon : lotId interdit sans trackLots, lot d'une autre variante introuvable, lot valide accepté", async () => {
    const { organizationId, ownerCookie, origineId, destinationId, variantId } =
      await seed()
    const suivie = await creerProduitSimple(organizationId, { trackLots: true })
    const lotId = await creerLot(organizationId, suivie.variantId)

    const creation = await req(ownerCookie, "POST", "/api/v1/transfers", {
      fromWarehouseId: origineId,
      toWarehouseId: destinationId,
    })
    const { id } = await creation.json<{ id: string }>()

    // lotId sur un produit sans suivi → 400 LOTS_NON_SUIVIS
    const nonSuivi = await req(
      ownerCookie,
      "POST",
      `/api/v1/transfers/${id}/items`,
      { variantId, quantity: 1, lotId }
    )
    expect(nonSuivi.status).toBe(400)
    expect((await nonSuivi.json<{ code: string }>()).code).toBe(
      "LOTS_NON_SUIVIS"
    )

    // lot d'une AUTRE variante → 404 INTROUVABLE
    const autreLot = await creerLot(organizationId, variantId, "LOT-AUTRE")
    const mauvaisLot = await req(
      ownerCookie,
      "POST",
      `/api/v1/transfers/${id}/items`,
      { variantId: suivie.variantId, quantity: 1, lotId: autreLot }
    )
    expect(mauvaisLot.status).toBe(404)

    // lot valide, et brouillon SANS lot accepté aussi (LOT_REQUIS attendra l'expédition)
    expect(
      (
        await req(ownerCookie, "POST", `/api/v1/transfers/${id}/items`, {
          variantId: suivie.variantId,
          quantity: 2,
          lotId,
        })
      ).status
    ).toBe(201)
    expect(
      (
        await req(ownerCookie, "POST", `/api/v1/transfers/${id}/items`, {
          variantId: suivie.variantId,
          quantity: 3,
        })
      ).status
    ).toBe(201)
  })

  it("un transfert non-pending refuse toute édition de ligne (409 TRANSFERT_EXPEDIE)", async () => {
    const { ownerCookie, origineId, destinationId, variantId } = await seed()
    const creation = await req(ownerCookie, "POST", "/api/v1/transfers", {
      fromWarehouseId: origineId,
      toWarehouseId: destinationId,
    })
    const { id } = await creation.json<{ id: string }>()
    const ajout = await req(ownerCookie, "POST", `/api/v1/transfers/${id}/items`, {
      variantId,
      quantity: 2,
    })
    const { id: itemId } = await ajout.json<{ id: string }>()
    // Force le statut hors route (les triggers laissent sortir de pending)
    const db = drizzle(env.DB, { schema })
    await db
      .update(schema.transfers)
      .set({ status: "sent" })
      .where(eq(schema.transfers.id, id))

    const refus = await req(
      ownerCookie,
      "POST",
      `/api/v1/transfers/${id}/items`,
      { variantId, quantity: 1 }
    )
    expect(refus.status).toBe(409)
    expect((await refus.json<{ code: string }>()).code).toBe(
      "TRANSFERT_EXPEDIE"
    )
    expect(
      (
        await req(
          ownerCookie,
          "PATCH",
          `/api/v1/transfers/${id}/items/${itemId}`,
          { quantity: 9 }
        )
      ).status
    ).toBe(409)
    expect(
      (
        await req(
          ownerCookie,
          "DELETE",
          `/api/v1/transfers/${id}/items/${itemId}`
        )
      ).status
    ).toBe(409)
  })

  it("annulation : pending → cancelled, puis toute ré-annulation 409 STATUT_INVALIDE", async () => {
    const { ownerCookie, origineId, destinationId } = await seed()
    const creation = await req(ownerCookie, "POST", "/api/v1/transfers", {
      fromWarehouseId: origineId,
      toWarehouseId: destinationId,
    })
    const { id } = await creation.json<{ id: string }>()
    expect(
      (await req(ownerCookie, "POST", `/api/v1/transfers/${id}/cancel`)).status
    ).toBe(200)
    const detail = await req(ownerCookie, "GET", `/api/v1/transfers/${id}`)
    expect(
      (await detail.json<{ transfer: { status: string } }>()).transfer.status
    ).toBe("cancelled")
    expect(
      (await req(ownerCookie, "POST", `/api/v1/transfers/${id}/cancel`)).status
    ).toBe(409)
  })

  it("portée de lecture bi-entrepôt : visible par le manager de l'origine ET l'auditeur de la destination, invisible pour un staff sans lien, 404 cross-org", async () => {
    const { organizationId, ownerCookie, origineId, destinationId } =
      await seed()
    const creation = await req(ownerCookie, "POST", "/api/v1/transfers", {
      fromWarehouseId: origineId,
      toWarehouseId: destinationId,
    })
    const { id } = await creation.json<{ id: string }>()

    const managerOrigine = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      managerOrigine.userId,
      origineId,
      "manager"
    )
    const auditeurDestination = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      auditeurDestination.userId,
      destinationId,
      "auditor"
    )
    const sansLien = await createUserWithRole(organizationId, "staff")

    for (const cookie of [managerOrigine.cookie, auditeurDestination.cookie]) {
      const liste = await req(cookie, "GET", "/api/v1/transfers")
      const { transfers } = await liste.json<{
        transfers: Array<{ id: string }>
      }>()
      expect(transfers.map((t) => t.id)).toContain(id)
      expect((await req(cookie, "GET", `/api/v1/transfers/${id}`)).status).toBe(
        200
      )
    }

    const listeVide = await req(sansLien.cookie, "GET", "/api/v1/transfers")
    expect(
      (await listeVide.json<{ transfers: unknown[] }>()).transfers
    ).toEqual([])
    expect(
      (await req(sansLien.cookie, "GET", `/api/v1/transfers/${id}`)).status
    ).toBe(403)
    expect(
      (
        await req(
          ownerCookie,
          "GET",
          `/api/v1/transfers/${crypto.randomUUID()}`
        )
      ).status
    ).toBe(404)
  })

  it("liste : filtre statut, agrégats itemCount/totalQuantity", async () => {
    const { ownerCookie, origineId, destinationId, variantId } = await seed()
    const creation = await req(ownerCookie, "POST", "/api/v1/transfers", {
      fromWarehouseId: origineId,
      toWarehouseId: destinationId,
    })
    const { id } = await creation.json<{ id: string }>()
    await req(ownerCookie, "POST", `/api/v1/transfers/${id}/items`, {
      variantId,
      quantity: 4,
    })
    await req(ownerCookie, "POST", `/api/v1/transfers/${id}/items`, {
      variantId,
      quantity: 6,
    })
    const liste = await req(
      ownerCookie,
      "GET",
      "/api/v1/transfers?statut=pending"
    )
    const { transfers } = await liste.json<{
      transfers: Array<{ id: string; itemCount: number; totalQuantity: number }>
    }>()
    expect(transfers).toEqual([
      expect.objectContaining({ id, itemCount: 2, totalQuantity: 10 }),
    ])
    const listeVide = await req(
      ownerCookie,
      "GET",
      "/api/v1/transfers?statut=received"
    )
    expect((await listeVide.json<{ transfers: unknown[] }>()).transfers).toEqual(
      []
    )
    expect(
      (await req(ownerCookie, "GET", "/api/v1/transfers?statut=zzz")).status
    ).toBe(400)
  })
})
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd apps/api && bunx vitest run test/transfers-draft.test.ts`
Expected: FAIL — 404 sur toutes les routes (`/api/v1/transfers` n'existe pas).

- [ ] **Step 3 : Ajouter `entrepotExiste` à `lib/org-scope.ts`**

Ajouter à la fin de `apps/api/src/lib/org-scope.ts` :

```ts
export async function entrepotExiste(
  db: Db,
  organizationId: string,
  id: string
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.warehouses.id })
    .from(schema.warehouses)
    .where(
      and(
        eq(schema.warehouses.id, id),
        eq(schema.warehouses.organizationId, organizationId)
      )
    )
    .limit(1)
  return rows.length > 0
}
```

- [ ] **Step 4 : Créer `apps/api/src/routes/transfers.ts` (partie brouillon)**

```ts
import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"
import type { SQL } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import {
  transferCreateSchema,
  transferItemCreateSchema,
  transferItemUpdateSchema,
} from "shared"
import * as schema from "../db/schema"
import { validerCorps } from "../lib/validation"
import { estErreurDeclencheur } from "../lib/db-errors"
import { entrepotExiste, varianteScope } from "../lib/org-scope"
import { porteeLectureStock } from "../lib/stock-acces"
import { requireAuth } from "../middleware/require-auth"
import {
  requireMembership,
  verifierAccesEntrepot,
} from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import type { Env } from "../env"

export const transfersRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

transfersRoute.use(requireAuth, requireMembership)

type Db = DrizzleD1Database<typeof schema>

// Retour annoté `| null` (piège eslint no-unnecessary-condition)
async function transfertScope(
  db: Db,
  organizationId: string,
  id: string
): Promise<typeof schema.transfers.$inferSelect | null> {
  const rows = await db
    .select()
    .from(schema.transfers)
    .where(
      and(
        eq(schema.transfers.id, id),
        eq(schema.transfers.organizationId, organizationId)
      )
    )
    .limit(1)
  return rows[0] ?? null
}

const REPONSE_TRANSFERT_EXPEDIE = {
  code: "TRANSFERT_EXPEDIE",
  message: "Ce transfert n'est plus en brouillon et ne peut plus être modifié",
} as const

// Règles de lot d'une ligne de transfert : le lot est OPTIONNEL en brouillon
// (LOT_REQUIS n'est vérifié qu'à l'expédition, Task 6) mais, s'il est fourni,
// il doit appartenir à la variante ; il est interdit si le produit ne suit
// pas les lots. Renvoie la réponse d'erreur à retourner, ou null si OK.
async function verifierReglesLot(
  db: Db,
  variantProductId: string,
  variantId: string,
  lotId: string | null
): Promise<{ code: string; message: string; statut: 400 | 404 } | null> {
  const produits = await db
    .select({ trackLots: schema.products.trackLots })
    .from(schema.products)
    .where(eq(schema.products.id, variantProductId))
    .limit(1)
  const suitLots = produits[0]?.trackLots === true
  if (!suitLots && lotId) {
    return {
      code: "LOTS_NON_SUIVIS",
      message: "Le suivi par lots n'est pas activé pour ce produit",
      statut: 400,
    }
  }
  if (lotId) {
    const lot = await db
      .select({ id: schema.lots.id })
      .from(schema.lots)
      .where(and(eq(schema.lots.id, lotId), eq(schema.lots.variantId, variantId)))
      .limit(1)
    if (lot.length === 0) {
      return { code: "INTROUVABLE", message: "Lot introuvable", statut: 404 }
    }
  }
  return null
}

// Un transfert est LISIBLE si l'un de ses deux entrepôts est dans la portée.
function transfertLisible(
  portee: Awaited<ReturnType<typeof porteeLectureStock>>,
  transfert: { fromWarehouseId: string; toWarehouseId: string }
): boolean {
  return (
    portee.tous ||
    portee.warehouseIds.includes(transfert.fromWarehouseId) ||
    portee.warehouseIds.includes(transfert.toWarehouseId)
  )
}

transfersRoute.get("/", async (c) => {
  const { organizationId, role } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const portee = await porteeLectureStock(
    db,
    organizationId,
    c.get("user").id,
    role
  )
  const statut = c.req.query("statut")
  const warehouseId = c.req.query("warehouseId")
  if (
    statut &&
    !(schema.TRANSFER_STATUSES as readonly string[]).includes(statut)
  ) {
    return c.json({ code: "VALIDATION", message: "Statut invalide" }, 400)
  }
  const conditions: SQL[] = [
    eq(schema.transfers.organizationId, organizationId),
  ]
  if (statut) {
    conditions.push(
      eq(
        schema.transfers.status,
        statut as (typeof schema.TRANSFER_STATUSES)[number]
      )
    )
  }
  if (warehouseId) {
    if (!portee.tous && !portee.warehouseIds.includes(warehouseId)) {
      return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
    }
    const filtre = or(
      eq(schema.transfers.fromWarehouseId, warehouseId),
      eq(schema.transfers.toWarehouseId, warehouseId)
    )
    if (filtre) {
      conditions.push(filtre)
    }
  } else if (!portee.tous) {
    if (portee.warehouseIds.length === 0) {
      return c.json({ transfers: [] })
    }
    const filtre = or(
      inArray(schema.transfers.fromWarehouseId, portee.warehouseIds),
      inArray(schema.transfers.toWarehouseId, portee.warehouseIds)
    )
    if (filtre) {
      conditions.push(filtre)
    }
  }

  const origine = alias(schema.warehouses, "origine")
  const destination = alias(schema.warehouses, "destination")
  const rows = await db
    .select({
      id: schema.transfers.id,
      fromWarehouseId: schema.transfers.fromWarehouseId,
      fromWarehouseName: origine.name,
      toWarehouseId: schema.transfers.toWarehouseId,
      toWarehouseName: destination.name,
      reference: schema.transfers.reference,
      status: schema.transfers.status,
      createdAt: schema.transfers.createdAt,
      sentAt: schema.transfers.sentAt,
      receivedAt: schema.transfers.receivedAt,
    })
    .from(schema.transfers)
    .innerJoin(origine, eq(schema.transfers.fromWarehouseId, origine.id))
    .innerJoin(destination, eq(schema.transfers.toWarehouseId, destination.id))
    .where(and(...conditions))
    .orderBy(desc(schema.transfers.createdAt))

  const ids = rows.map((r) => r.id)
  const agregats =
    ids.length > 0
      ? await db
          .select({
            transferId: schema.transferItems.transferId,
            itemCount: sql<number>`COUNT(*)`,
            totalQuantity: sql<number>`COALESCE(SUM(${schema.transferItems.quantity}), 0)`,
          })
          .from(schema.transferItems)
          .where(inArray(schema.transferItems.transferId, ids))
          .groupBy(schema.transferItems.transferId)
      : []
  const transfers = rows.map((r) => {
    const agregat = agregats.find((a) => a.transferId === r.id)
    return {
      ...r,
      itemCount: agregat?.itemCount ?? 0,
      totalQuantity: agregat?.totalQuantity ?? 0,
    }
  })
  return c.json({ transfers })
})

transfersRoute.post("/", async (c) => {
  const corps = await validerCorps(c, transferCreateSchema)
  if (!corps.ok) return corps.reponse
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  if (corps.data.fromWarehouseId === corps.data.toWarehouseId) {
    return c.json(
      {
        code: "TRANSFERT_MEME_ENTREPOT",
        message: "L'origine et la destination doivent être différentes",
      },
      400
    )
  }
  // Écriture = rôle sur l'ORIGINE (décision de phase) : owner/admin/
  // stock_manager (bypass) ou manager local de l'entrepôt d'origine.
  // Couvre aussi le cross-tenant sur l'origine : 403.
  const refus = await verifierAccesEntrepot(c, corps.data.fromWarehouseId, [
    "manager",
  ])
  if (refus) return refus
  // La destination est un CHAMP DE DOCUMENT (aucun rôle exigé) : simple
  // existence dans l'organisation, sinon 404 — même motif que le
  // fournisseur d'une réception.
  if (!(await entrepotExiste(db, organizationId, corps.data.toWarehouseId))) {
    return c.json(
      { code: "INTROUVABLE", message: "Entrepôt de destination introuvable" },
      404
    )
  }
  const id = crypto.randomUUID()
  const maintenant = new Date()
  await db.insert(schema.transfers).values({
    id,
    organizationId,
    fromWarehouseId: corps.data.fromWarehouseId,
    toWarehouseId: corps.data.toWarehouseId,
    reference: corps.data.reference ?? null,
    createdBy: c.get("user").id,
    createdAt: maintenant,
    updatedAt: maintenant,
  })
  return c.json({ id }, 201)
})

transfersRoute.get("/:id", async (c) => {
  const { organizationId, role } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const transfert = await transfertScope(db, organizationId, c.req.param("id"))
  if (!transfert) {
    return c.json({ code: "INTROUVABLE", message: "Transfert introuvable" }, 404)
  }
  const portee = await porteeLectureStock(
    db,
    organizationId,
    c.get("user").id,
    role
  )
  if (!transfertLisible(portee, transfert)) {
    return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
  }
  const origine = alias(schema.warehouses, "origine")
  const destination = alias(schema.warehouses, "destination")
  const entetes = await db
    .select({
      fromWarehouseName: origine.name,
      toWarehouseName: destination.name,
    })
    .from(schema.transfers)
    .innerJoin(origine, eq(schema.transfers.fromWarehouseId, origine.id))
    .innerJoin(destination, eq(schema.transfers.toWarehouseId, destination.id))
    .where(eq(schema.transfers.id, transfert.id))
    .limit(1)
  const items = await db
    .select({
      id: schema.transferItems.id,
      variantId: schema.transferItems.variantId,
      productId: schema.products.id,
      productName: schema.products.name,
      variantName: schema.productVariants.name,
      sku: schema.productVariants.sku,
      trackLots: schema.products.trackLots,
      lotId: schema.transferItems.lotId,
      lotNumber: schema.lots.lotNumber,
      quantity: schema.transferItems.quantity,
      unitCost: schema.transferItems.unitCost,
      receivedQuantity: schema.transferItems.receivedQuantity,
    })
    .from(schema.transferItems)
    .innerJoin(
      schema.productVariants,
      eq(schema.transferItems.variantId, schema.productVariants.id)
    )
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id)
    )
    .leftJoin(schema.lots, eq(schema.transferItems.lotId, schema.lots.id))
    .where(eq(schema.transferItems.transferId, transfert.id))
    .orderBy(asc(schema.products.name), asc(schema.productVariants.name))
  return c.json({
    transfer: {
      id: transfert.id,
      fromWarehouseId: transfert.fromWarehouseId,
      fromWarehouseName: entetes[0]?.fromWarehouseName ?? "",
      toWarehouseId: transfert.toWarehouseId,
      toWarehouseName: entetes[0]?.toWarehouseName ?? "",
      reference: transfert.reference,
      status: transfert.status,
      createdAt: transfert.createdAt,
      sentAt: transfert.sentAt,
      receivedAt: transfert.receivedAt,
      cancelledAt: transfert.cancelledAt,
      items,
    },
  })
})

transfersRoute.post("/:id/items", async (c) => {
  const corps = await validerCorps(c, transferItemCreateSchema)
  if (!corps.ok) return corps.reponse
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const transfert = await transfertScope(db, organizationId, c.req.param("id"))
  if (!transfert) {
    return c.json({ code: "INTROUVABLE", message: "Transfert introuvable" }, 404)
  }
  const refus = await verifierAccesEntrepot(c, transfert.fromWarehouseId, [
    "manager",
  ])
  if (refus) return refus
  if (transfert.status !== "pending") {
    return c.json(REPONSE_TRANSFERT_EXPEDIE, 409)
  }
  const variante = await varianteScope(db, organizationId, corps.data.variantId)
  if (!variante) {
    return c.json({ code: "INTROUVABLE", message: "Variante introuvable" }, 404)
  }
  const erreurLot = await verifierReglesLot(
    db,
    variante.productId,
    variante.id,
    corps.data.lotId ?? null
  )
  if (erreurLot) {
    return c.json(
      { code: erreurLot.code, message: erreurLot.message },
      erreurLot.statut
    )
  }
  const id = crypto.randomUUID()
  const maintenant = new Date()
  try {
    // Ligne + updatedAt du document, atomiquement. Si une expédition
    // concurrente vient de passer, le trigger transfer_items_expedie_insert
    // fait échouer le batch → 409 propre au lieu d'une ligne fantôme.
    await db.batch([
      db.insert(schema.transferItems).values({
        id,
        organizationId,
        transferId: transfert.id,
        variantId: variante.id,
        lotId: corps.data.lotId ?? null,
        quantity: corps.data.quantity,
        createdAt: maintenant,
      }),
      db
        .update(schema.transfers)
        .set({ updatedAt: maintenant })
        .where(eq(schema.transfers.id, transfert.id)),
    ])
  } catch (err) {
    if (
      estErreurDeclencheur(err, "TRANSFERT_EXPEDIE") ||
      estErreurDeclencheur(err, "TRANSFERT_TERMINE")
    ) {
      return c.json(REPONSE_TRANSFERT_EXPEDIE, 409)
    }
    throw err
  }
  return c.json({ id }, 201)
})

transfersRoute.patch("/:id/items/:itemId", async (c) => {
  const corps = await validerCorps(c, transferItemUpdateSchema)
  if (!corps.ok) return corps.reponse
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const transfert = await transfertScope(db, organizationId, c.req.param("id"))
  if (!transfert) {
    return c.json({ code: "INTROUVABLE", message: "Transfert introuvable" }, 404)
  }
  const refus = await verifierAccesEntrepot(c, transfert.fromWarehouseId, [
    "manager",
  ])
  if (refus) return refus
  if (transfert.status !== "pending") {
    return c.json(REPONSE_TRANSFERT_EXPEDIE, 409)
  }
  const items = await db
    .select()
    .from(schema.transferItems)
    .where(
      and(
        eq(schema.transferItems.id, c.req.param("itemId")),
        eq(schema.transferItems.transferId, transfert.id)
      )
    )
    .limit(1)
  if (items.length === 0) {
    return c.json({ code: "INTROUVABLE", message: "Ligne introuvable" }, 404)
  }
  const item = items[0]
  // Règles de lot évaluées sur la valeur EFFECTIVE après fusion
  const lotEffectif =
    corps.data.lotId !== undefined ? corps.data.lotId : item.lotId
  const variantes = await db
    .select({ productId: schema.productVariants.productId })
    .from(schema.productVariants)
    .where(eq(schema.productVariants.id, item.variantId))
    .limit(1)
  const erreurLot = await verifierReglesLot(
    db,
    variantes[0]?.productId ?? "",
    item.variantId,
    lotEffectif
  )
  if (erreurLot) {
    return c.json(
      { code: erreurLot.code, message: erreurLot.message },
      erreurLot.statut
    )
  }
  const maintenant = new Date()
  try {
    await db.batch([
      db
        .update(schema.transferItems)
        .set({
          ...(corps.data.quantity !== undefined
            ? { quantity: corps.data.quantity }
            : {}),
          ...(corps.data.lotId !== undefined ? { lotId: corps.data.lotId } : {}),
        })
        .where(eq(schema.transferItems.id, item.id)),
      db
        .update(schema.transfers)
        .set({ updatedAt: maintenant })
        .where(eq(schema.transfers.id, transfert.id)),
    ])
  } catch (err) {
    if (
      estErreurDeclencheur(err, "TRANSFERT_EXPEDIE") ||
      estErreurDeclencheur(err, "TRANSFERT_TERMINE")
    ) {
      return c.json(REPONSE_TRANSFERT_EXPEDIE, 409)
    }
    throw err
  }
  return c.json({ ok: true })
})

transfersRoute.delete("/:id/items/:itemId", async (c) => {
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const transfert = await transfertScope(db, organizationId, c.req.param("id"))
  if (!transfert) {
    return c.json({ code: "INTROUVABLE", message: "Transfert introuvable" }, 404)
  }
  const refus = await verifierAccesEntrepot(c, transfert.fromWarehouseId, [
    "manager",
  ])
  if (refus) return refus
  if (transfert.status !== "pending") {
    return c.json(REPONSE_TRANSFERT_EXPEDIE, 409)
  }
  // Pré-lecture : un 404 ne doit pas bumper updatedAt (leçon P4 Task 8)
  const items = await db
    .select({ id: schema.transferItems.id })
    .from(schema.transferItems)
    .where(
      and(
        eq(schema.transferItems.id, c.req.param("itemId")),
        eq(schema.transferItems.transferId, transfert.id)
      )
    )
    .limit(1)
  if (items.length === 0) {
    return c.json({ code: "INTROUVABLE", message: "Ligne introuvable" }, 404)
  }
  const maintenant = new Date()
  try {
    await db.batch([
      db
        .delete(schema.transferItems)
        .where(eq(schema.transferItems.id, c.req.param("itemId"))),
      db
        .update(schema.transfers)
        .set({ updatedAt: maintenant })
        .where(eq(schema.transfers.id, transfert.id)),
    ])
  } catch (err) {
    if (
      estErreurDeclencheur(err, "TRANSFERT_EXPEDIE") ||
      estErreurDeclencheur(err, "TRANSFERT_TERMINE")
    ) {
      return c.json(REPONSE_TRANSFERT_EXPEDIE, 409)
    }
    throw err
  }
  return c.json({ ok: true })
})

transfersRoute.post("/:id/cancel", async (c) => {
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const transfert = await transfertScope(db, organizationId, c.req.param("id"))
  if (!transfert) {
    return c.json({ code: "INTROUVABLE", message: "Transfert introuvable" }, 404)
  }
  const refus = await verifierAccesEntrepot(c, transfert.fromWarehouseId, [
    "manager",
  ])
  if (refus) return refus
  if (transfert.status !== "pending") {
    return c.json(
      {
        code: "STATUT_INVALIDE",
        message: "Seul un transfert en attente peut être annulé",
      },
      409
    )
  }
  const maintenant = new Date()
  try {
    // UPDATE SANS filtre de statut : si une expédition concurrente vient de
    // passer, transfers_expedie_fige (sent -> cancelled) tue la transition.
    await db
      .update(schema.transfers)
      .set({
        status: "cancelled",
        cancelledBy: c.get("user").id,
        cancelledAt: maintenant,
        updatedAt: maintenant,
      })
      .where(eq(schema.transfers.id, transfert.id))
  } catch (err) {
    if (
      estErreurDeclencheur(err, "TRANSFERT_EXPEDIE") ||
      estErreurDeclencheur(err, "TRANSFERT_TERMINE")
    ) {
      return c.json(
        {
          code: "STATUT_INVALIDE",
          message: "Seul un transfert en attente peut être annulé",
        },
        409
      )
    }
    throw err
  }
  return c.json({ ok: true })
})
```

- [ ] **Step 5 : Monter la route**

Dans `apps/api/src/index.ts`, ajouter l'import après celui de `purchasesRoute` :

```ts
import { transfersRoute } from "./routes/transfers"
```

et le montage après `app.route("/api/v1/purchases", purchasesRoute)` :

```ts
app.route("/api/v1/transfers", transfersRoute)
```

- [ ] **Step 6 : Vérifier**

Run: `cd apps/api && bunx vitest run test/transfers-draft.test.ts`
Expected: PASS (9 tests).

Run: `bun run --cwd apps/api test && bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 7 : Commit**

```bash
git add apps/api/src/routes/transfers.ts apps/api/src/lib/org-scope.ts apps/api/src/index.ts apps/api/test/transfers-draft.test.ts
git commit -m "feat(api): transferts en brouillon — création, lignes, portée bi-entrepôt, annulation"
```

---

### Task 6: Expédition d'un transfert (`POST /transfers/:id/send`)

Le stock sort de l'origine dans UN batch atomique : gel du CMP d'origine sur chaque ligne (sous-requête SQL dans le batch — photographie exacte, pas de course), passage `sent` sans filtre de statut, mouvements `transfer_out` via `applyMovements`. `LOT_REQUIS` pour les lignes `trackLots` sans lot. Au passage, `reponseStockInsuffisant` est extrait de `routes/stock.ts` vers un lib partagé.

**Files:**
- Create: `apps/api/src/lib/stock-erreurs.ts`
- Modify: `apps/api/src/routes/stock.ts` (supprimer la fonction locale `reponseStockInsuffisant`, lignes ~350-384, et l'importer du lib)
- Modify: `apps/api/src/routes/transfers.ts` (ajout route `send`)
- Test: `apps/api/test/transfers-send.test.ts` (nouveau)

**Interfaces:**
- Consomme : `transfertScope`, `REPONSE_TRANSFERT_EXPEDIE` (Task 5) ; `applyMovements`, `ErreurStockInsuffisant`, types `InstructionBatch`/`MouvementStock` (Task 4) ; triggers 0007 (Task 3).
- Produit : `POST /transfers/:id/send` (sans corps) → `200 { ok: true }` | `400 VALIDATION` (aucune ligne) | `400 LOT_REQUIS` (details : lignes fautives) | `409 STATUT_INVALIDE` | `409 STOCK_INSUFFISANT` (details enrichis) | `403`/`404` ; helper partagé `reponseStockInsuffisant(c, db, err)` exporté de `apps/api/src/lib/stock-erreurs.ts` (consommé par les Tasks 7 et 10).

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `apps/api/test/transfers-send.test.ts` :

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

// Retour annoté `| null` (piège eslint no-unnecessary-condition)
async function lireNiveau(
  warehouseId: string,
  variantId: string
): Promise<{ quantity: number; avgCost: number } | null> {
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

async function seed() {
  const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
  const origineId = await creerEntrepot(organizationId, "Origine")
  const destinationId = await creerEntrepot(organizationId, "Destination")
  const { variantId } = await creerProduitSimple(organizationId)
  // Stock valorisé à l'origine : 20 unités à CMP 100
  const db = drizzle(env.DB, { schema })
  await applyMovements(db, {
    organizationId,
    userId: ownerId,
    mouvements: [
      {
        warehouseId: origineId,
        variantId,
        delta: 20,
        type: "purchase",
        unitCost: 100,
      },
    ],
  })
  return {
    organizationId,
    ownerId,
    ownerCookie,
    origineId,
    destinationId,
    variantId,
  }
}

async function creerBrouillon(
  ownerCookie: string,
  origineId: string,
  destinationId: string,
  items: Array<Record<string, unknown>>
): Promise<string> {
  const creation = await req(ownerCookie, "POST", "/api/v1/transfers", {
    fromWarehouseId: origineId,
    toWarehouseId: destinationId,
  })
  const { id } = await creation.json<{ id: string }>()
  for (const item of items) {
    const ajout = await req(
      ownerCookie,
      "POST",
      `/api/v1/transfers/${id}/items`,
      item
    )
    expect(ajout.status).toBe(201)
  }
  return id
}

describe("transferts — expédition", () => {
  it("expédie : statut sent, stock origine décrémenté, transfer_out journalisés, CMP origine figé sur les lignes", async () => {
    const { ownerCookie, origineId, destinationId, variantId } = await seed()
    const id = await creerBrouillon(ownerCookie, origineId, destinationId, [
      { variantId, quantity: 8 },
    ])
    const res = await req(ownerCookie, "POST", `/api/v1/transfers/${id}/send`)
    expect(res.status).toBe(200)

    expect(await lireNiveau(origineId, variantId)).toEqual({
      quantity: 12,
      avgCost: 100,
    })

    const detail = await req(ownerCookie, "GET", `/api/v1/transfers/${id}`)
    const { transfer } = await detail.json<{
      transfer: {
        status: string
        sentAt: string | null
        items: Array<{ unitCost: number | null }>
      }
    }>()
    expect(transfer.status).toBe("sent")
    expect(transfer.sentAt).not.toBeNull()
    // CMP origine (100) figé sur la ligne au moment de l'expédition
    expect(transfer.items[0]?.unitCost).toBe(100)

    const db = drizzle(env.DB, { schema })
    const mouvements = await db
      .select()
      .from(schema.stockMovements)
      .where(
        and(
          eq(schema.stockMovements.refType, "transfer"),
          eq(schema.stockMovements.refId, id)
        )
      )
    expect(mouvements).toEqual([
      expect.objectContaining({
        warehouseId: origineId,
        variantId,
        delta: -8,
        type: "transfer_out",
      }),
    ])
  })

  it("variante jamais valorisée (stock entré par ajustement) : CMP figé à 0", async () => {
    const { organizationId, ownerId, ownerCookie, origineId, destinationId } =
      await seed()
    const { variantId } = await creerProduitSimple(organizationId, {
      nom: "Sans valorisation",
    })
    // Stock présent mais jamais valorisé (les ajustements ne touchent pas le CMP)
    const db = drizzle(env.DB, { schema })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId: origineId,
          variantId,
          delta: 10,
          type: "adjustment",
          reason: "seed sans valorisation",
        },
      ],
    })
    const id = await creerBrouillon(ownerCookie, origineId, destinationId, [
      { variantId, quantity: 2 },
    ])
    expect(
      (await req(ownerCookie, "POST", `/api/v1/transfers/${id}/send`)).status
    ).toBe(200)
    const lignes = await db
      .select({ unitCost: schema.transferItems.unitCost })
      .from(schema.transferItems)
      .where(eq(schema.transferItems.transferId, id))
    expect(lignes).toEqual([{ unitCost: 0 }])
  })

  it("stock insuffisant : 409 avec détail, RIEN n'est écrit (statut, unit_cost, journal, niveaux)", async () => {
    const { ownerCookie, origineId, destinationId, variantId } = await seed()
    const id = await creerBrouillon(ownerCookie, origineId, destinationId, [
      { variantId, quantity: 25 },
    ])
    const res = await req(ownerCookie, "POST", `/api/v1/transfers/${id}/send`)
    expect(res.status).toBe(409)
    const corps = await res.json<{
      code: string
      details: Array<{ disponible: number; demande: number }>
    }>()
    expect(corps.code).toBe("STOCK_INSUFFISANT")
    expect(corps.details).toEqual([
      expect.objectContaining({ disponible: 20, demande: 25 }),
    ])
    // Atomicité vérifiée en lecture DB directe
    const db = drizzle(env.DB, { schema })
    const transferts = await db
      .select()
      .from(schema.transfers)
      .where(eq(schema.transfers.id, id))
    expect(transferts[0]?.status).toBe("pending")
    expect(transferts[0]?.sentAt).toBeNull()
    const lignes = await db
      .select()
      .from(schema.transferItems)
      .where(eq(schema.transferItems.transferId, id))
    expect(lignes[0]?.unitCost).toBeNull()
    const mouvements = await db
      .select()
      .from(schema.stockMovements)
      .where(eq(schema.stockMovements.refId, id))
    expect(mouvements).toEqual([])
    expect(await lireNiveau(origineId, variantId)).toEqual({
      quantity: 20,
      avgCost: 100,
    })
  })

  it("LOT_REQUIS : une ligne trackLots sans lot bloque l'expédition, rien n'est écrit", async () => {
    const { organizationId, ownerId, ownerCookie, origineId, destinationId } =
      await seed()
    const suivie = await creerProduitSimple(organizationId, {
      trackLots: true,
    })
    // Stock pour la variante suivie
    const db = drizzle(env.DB, { schema })
    await applyMovements(db, {
      organizationId,
      userId: ownerId,
      mouvements: [
        {
          warehouseId: origineId,
          variantId: suivie.variantId,
          delta: 10,
          type: "purchase",
          unitCost: 50,
        },
      ],
    })
    const id = await creerBrouillon(ownerCookie, origineId, destinationId, [
      { variantId: suivie.variantId, quantity: 2 },
    ])
    const res = await req(ownerCookie, "POST", `/api/v1/transfers/${id}/send`)
    expect(res.status).toBe(400)
    expect((await res.json<{ code: string }>()).code).toBe("LOT_REQUIS")
    const transferts = await db
      .select()
      .from(schema.transfers)
      .where(eq(schema.transfers.id, id))
    expect(transferts[0]?.status).toBe("pending")
  })

  it("transfert sans ligne → 400 VALIDATION ; double expédition → 409 STATUT_INVALIDE et stock décrémenté une seule fois", async () => {
    const { ownerCookie, origineId, destinationId, variantId } = await seed()
    const vide = await creerBrouillon(ownerCookie, origineId, destinationId, [])
    expect(
      (await req(ownerCookie, "POST", `/api/v1/transfers/${vide}/send`)).status
    ).toBe(400)

    const id = await creerBrouillon(ownerCookie, origineId, destinationId, [
      { variantId, quantity: 5 },
    ])
    expect(
      (await req(ownerCookie, "POST", `/api/v1/transfers/${id}/send`)).status
    ).toBe(200)
    const rejoue = await req(ownerCookie, "POST", `/api/v1/transfers/${id}/send`)
    expect(rejoue.status).toBe(409)
    expect((await rejoue.json<{ code: string }>()).code).toBe("STATUT_INVALIDE")
    expect(await lireNiveau(origineId, variantId)).toEqual({
      quantity: 15,
      avgCost: 100,
    })
    // Annulation après expédition → 409 aussi
    expect(
      (await req(ownerCookie, "POST", `/api/v1/transfers/${id}/cancel`)).status
    ).toBe(409)
  })

  it("matrice : manager ORIGINE expédie, manager destination 403, cashier origine 403", async () => {
    const { organizationId, ownerCookie, origineId, destinationId, variantId } =
      await seed()
    const id = await creerBrouillon(ownerCookie, origineId, destinationId, [
      { variantId, quantity: 1 },
    ])
    const managerDestination = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      managerDestination.userId,
      destinationId,
      "manager"
    )
    const caissier = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(organizationId, caissier.userId, origineId, "cashier")
    const managerOrigine = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      managerOrigine.userId,
      origineId,
      "manager"
    )
    expect(
      (
        await req(
          managerDestination.cookie,
          "POST",
          `/api/v1/transfers/${id}/send`
        )
      ).status
    ).toBe(403)
    expect(
      (await req(caissier.cookie, "POST", `/api/v1/transfers/${id}/send`))
        .status
    ).toBe(403)
    expect(
      (await req(managerOrigine.cookie, "POST", `/api/v1/transfers/${id}/send`))
        .status
    ).toBe(200)
  })
})
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd apps/api && bunx vitest run test/transfers-send.test.ts`
Expected: FAIL — `POST /:id/send` renvoie 404 (route absente).

- [ ] **Step 3 : Extraire `reponseStockInsuffisant` vers un lib partagé**

Créer `apps/api/src/lib/stock-erreurs.ts` (contenu déplacé depuis `routes/stock.ts` lignes ~350-384, inchangé hors imports) :

```ts
import { inArray } from "drizzle-orm"
import type { Context } from "hono"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import * as schema from "../db/schema"
import type { ErreurStockInsuffisant } from "../services/stock"

// Enrichit l'erreur du service avec le SKU et le nom de variante pour un
// message actionnable côté écran. Partagé entre ajustements (stock.ts),
// expédition de transfert et clôture d'inventaire.
export async function reponseStockInsuffisant(
  c: Context,
  db: DrizzleD1Database<typeof schema>,
  err: ErreurStockInsuffisant
) {
  const variantIds = err.details.map((d) => d.variantId)
  const variantes =
    variantIds.length > 0
      ? await db
          .select({
            id: schema.productVariants.id,
            sku: schema.productVariants.sku,
            name: schema.productVariants.name,
          })
          .from(schema.productVariants)
          .where(inArray(schema.productVariants.id, variantIds))
      : []
  return c.json(
    {
      code: "STOCK_INSUFFISANT",
      message: "Stock insuffisant pour valider l'opération",
      details: err.details.map((d) => {
        const variante = variantes.find((v) => v.id === d.variantId)
        return {
          ...d,
          sku: variante?.sku ?? null,
          variantName: variante?.name ?? null,
        }
      }),
    },
    409
  )
}
```

Dans `apps/api/src/routes/stock.ts` : supprimer la fonction locale `reponseStockInsuffisant` (et les imports devenus inutiles : `Context` de hono, `DrizzleD1Database` s'il ne sert plus qu'à elle — attention, `entrepotDansOrganisation` de la Task 1 l'utilise aussi, le garder) et ajouter :

```ts
import { reponseStockInsuffisant } from "../lib/stock-erreurs"
```

L'appel existant dans la route ajustements reste identique.

- [ ] **Step 4 : Ajouter la route `send` dans `routes/transfers.ts`**

Compléter les imports en tête de fichier :

```ts
import { applyMovements, ErreurStockInsuffisant } from "../services/stock"
import type { InstructionBatch, MouvementStock } from "../services/stock"
import { reponseStockInsuffisant } from "../lib/stock-erreurs"
```

Ajouter la route (après `POST /:id/items`, avant `cancel` — l'ordre des routes Hono est sans incidence ici) :

```ts
transfersRoute.post("/:id/send", async (c) => {
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const transfert = await transfertScope(db, organizationId, c.req.param("id"))
  if (!transfert) {
    return c.json({ code: "INTROUVABLE", message: "Transfert introuvable" }, 404)
  }
  // Expédition = rôle sur l'ORIGINE (décision de phase)
  const refus = await verifierAccesEntrepot(c, transfert.fromWarehouseId, [
    "manager",
  ])
  if (refus) return refus
  if (transfert.status !== "pending") {
    return c.json(
      {
        code: "STATUT_INVALIDE",
        message: "Ce transfert a déjà été expédié ou annulé",
      },
      409
    )
  }
  const items = await db
    .select()
    .from(schema.transferItems)
    .where(eq(schema.transferItems.transferId, transfert.id))
  if (items.length === 0) {
    return c.json(
      {
        code: "VALIDATION",
        message: "Impossible d'expédier un transfert sans ligne",
      },
      400
    )
  }

  // LOT_REQUIS à l'expédition : chaque ligne d'un produit trackLots doit
  // porter son lot (choisi en brouillon) AVANT de sortir du stock — le lot
  // suit la ligne jusqu'au transfer_in de destination.
  const variantIds = [...new Set(items.map((i) => i.variantId))]
  const suivis = await db
    .select({
      variantId: schema.productVariants.id,
      trackLots: schema.products.trackLots,
    })
    .from(schema.productVariants)
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id)
    )
    .where(inArray(schema.productVariants.id, variantIds))
  const lignesSansLot = items.filter(
    (i) =>
      i.lotId === null &&
      suivis.find((s) => s.variantId === i.variantId)?.trackLots === true
  )
  if (lignesSansLot.length > 0) {
    return c.json(
      {
        code: "LOT_REQUIS",
        message:
          "Le numéro de lot est requis pour expédier un produit suivi par lots",
        details: lignesSansLot.map((i) => ({
          itemId: i.id,
          variantId: i.variantId,
        })),
      },
      400
    )
  }

  const maintenant = new Date()
  // CMP de l'origine FIGÉ sur chaque ligne PAR SOUS-REQUÊTE, dans le batch :
  // la valeur est photographiée au moment exact de la transaction (jamais la
  // valeur lue côté JS — même principe que la réconciliation P4). Ces UPDATE
  // passent AVANT le changement de statut : le trigger
  // transfer_items_expedie_update ne s'applique pas (parent encore pending) ;
  // en cas de double expédition concurrente, le premier statement du second
  // batch voit le parent 'sent' et échoue si le CMP a bougé — et de toute
  // façon la mise à jour de statut (sent -> sent) tue le batch entier.
  const gelsCmp = items.map((item) =>
    db
      .update(schema.transferItems)
      .set({
        unitCost: sql`COALESCE((SELECT avg_cost FROM stock_levels
          WHERE warehouse_id = ${transfert.fromWarehouseId}
            AND variant_id = ${item.variantId}), 0)`,
      })
      .where(eq(schema.transferItems.id, item.id))
  )
  // Passage sent SANS filtre de statut : le trigger transfers_expedie_fige /
  // transfers_termine_immuable fait échouer CE batch ENTIER en cas de course.
  const majStatut = db
    .update(schema.transfers)
    .set({
      status: "sent",
      sentBy: c.get("user").id,
      sentAt: maintenant,
      updatedAt: maintenant,
    })
    .where(eq(schema.transfers.id, transfert.id))

  const mouvements: MouvementStock[] = items.map((item) => ({
    warehouseId: transfert.fromWarehouseId,
    variantId: item.variantId,
    lotId: item.lotId,
    delta: -item.quantity,
    type: "transfer_out",
    refType: "transfer",
    refId: transfert.id,
  }))

  // Batch hétérogène construit directement (spread, pas de push + cast)
  const instructionsAvant: InstructionBatch[] = [...gelsCmp, majStatut]
  try {
    await applyMovements(db, {
      organizationId,
      userId: c.get("user").id,
      mouvements,
      instructionsAvant,
      date: maintenant,
    })
  } catch (err) {
    if (err instanceof ErreurStockInsuffisant) {
      return reponseStockInsuffisant(c, db, err)
    }
    if (
      estErreurDeclencheur(err, "TRANSFERT_EXPEDIE") ||
      estErreurDeclencheur(err, "TRANSFERT_TERMINE")
    ) {
      return c.json(
        {
          code: "STATUT_INVALIDE",
          message: "Ce transfert a déjà été expédié ou annulé",
        },
        409
      )
    }
    throw err
  }
  return c.json({ ok: true })
})
```

- [ ] **Step 5 : Vérifier**

Run: `cd apps/api && bunx vitest run test/transfers-send.test.ts test/transfers-draft.test.ts test/stock-adjustments.test.ts`
Expected: PASS — nouveaux tests verts, ajustements (qui utilisent `reponseStockInsuffisant` désormais importé) inchangés.

Run: `bun run --cwd apps/api test && bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add apps/api/src/lib/stock-erreurs.ts apps/api/src/routes/stock.ts apps/api/src/routes/transfers.ts apps/api/test/transfers-send.test.ts
git commit -m "feat(api): expédition de transfert — CMP origine figé en SQL, transfer_out atomiques, LOT_REQUIS"
```

---

### Task 7: Réception d'un transfert (`POST /transfers/:id/receive`)

Le stock entre à destination dans UN batch : `transfer_in` de la quantité expédiée TOTALE au CMP d'origine figé (absorbé par le CMP destination, Task 4), écart éventuel ressorti en `adjustment` négatif documenté, `receivedQuantity` écrite sur chaque ligne, passage `received` sans filtre. La réception exige le rôle sur la DESTINATION.

**Files:**
- Modify: `apps/api/src/routes/transfers.ts` (ajout route `receive` + import `transferReceiveSchema`)
- Test: `apps/api/test/transfers-receive.test.ts` (nouveau)

**Interfaces:**
- Consomme : `transferReceiveSchema` (Task 3 — corps optionnel `{ items?: [{ itemId, receivedQuantity }] }`) ; `transfertScope`, `applyMovements`, `reponseStockInsuffisant`, triggers 0007.
- Produit : `POST /transfers/:id/receive` corps optionnel → `200 { ok: true }` | `400 QUANTITE_RECUE_INVALIDE` | `404 INTROUVABLE` (ligne étrangère) | `409 STATUT_INVALIDE` | `403`/`404`. Ligne sans saisie = intégralement reçue.

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `apps/api/test/transfers-receive.test.ts` :

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

// Retour annoté `| null` (piège eslint no-unnecessary-condition)
async function lireNiveau(
  warehouseId: string,
  variantId: string
): Promise<{ quantity: number; avgCost: number } | null> {
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

async function seed() {
  const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
  const origineId = await creerEntrepot(organizationId, "Origine")
  const destinationId = await creerEntrepot(organizationId, "Destination")
  const { variantId } = await creerProduitSimple(organizationId)
  const db = drizzle(env.DB, { schema })
  // Origine : 20 unités à CMP 150
  await applyMovements(db, {
    organizationId,
    userId: ownerId,
    mouvements: [
      {
        warehouseId: origineId,
        variantId,
        delta: 20,
        type: "purchase",
        unitCost: 150,
      },
    ],
  })
  return {
    organizationId,
    ownerId,
    ownerCookie,
    origineId,
    destinationId,
    variantId,
  }
}

// Crée + remplit + expédie un transfert, renvoie id et lignes
async function transfertExpedie(
  s: Awaited<ReturnType<typeof seed>>,
  quantity: number,
  lotId?: string
): Promise<{ id: string; itemId: string }> {
  const creation = await req(s.ownerCookie, "POST", "/api/v1/transfers", {
    fromWarehouseId: s.origineId,
    toWarehouseId: s.destinationId,
  })
  const { id } = await creation.json<{ id: string }>()
  const ajout = await req(s.ownerCookie, "POST", `/api/v1/transfers/${id}/items`, {
    variantId: s.variantId,
    quantity,
    ...(lotId ? { lotId } : {}),
  })
  const { id: itemId } = await ajout.json<{ id: string }>()
  expect(
    (await req(s.ownerCookie, "POST", `/api/v1/transfers/${id}/send`)).status
  ).toBe(200)
  return { id, itemId }
}

describe("transferts — réception", () => {
  it("réception totale sans corps : stock destination +qty au CMP figé, receivedQuantity = quantity", async () => {
    const s = await seed()
    const { id, itemId } = await transfertExpedie(s, 8)
    const res = await req(s.ownerCookie, "POST", `/api/v1/transfers/${id}/receive`)
    expect(res.status).toBe(200)

    // Destination vierge : CMP initialisé au coût figé de l'origine (150)
    expect(await lireNiveau(s.destinationId, s.variantId)).toEqual({
      quantity: 8,
      avgCost: 150,
    })
    const detail = await req(s.ownerCookie, "GET", `/api/v1/transfers/${id}`)
    const { transfer } = await detail.json<{
      transfer: {
        status: string
        receivedAt: string | null
        items: Array<{ id: string; receivedQuantity: number | null }>
      }
    }>()
    expect(transfer.status).toBe("received")
    expect(transfer.receivedAt).not.toBeNull()
    expect(transfer.items).toEqual([
      expect.objectContaining({ id: itemId, receivedQuantity: 8 }),
    ])
  })

  it("le CMP de destination absorbe l'apport (destination déjà valorisée)", async () => {
    const s = await seed()
    const db = drizzle(env.DB, { schema })
    // Destination : 10 unités à CMP 50
    await applyMovements(db, {
      organizationId: s.organizationId,
      userId: s.ownerId,
      mouvements: [
        {
          warehouseId: s.destinationId,
          variantId: s.variantId,
          delta: 10,
          type: "purchase",
          unitCost: 50,
        },
      ],
    })
    const { id } = await transfertExpedie(s, 10)
    await req(s.ownerCookie, "POST", `/api/v1/transfers/${id}/receive`)
    // (10 × 50 + 10 × 150) / 20 = 100
    expect(await lireNiveau(s.destinationId, s.variantId)).toEqual({
      quantity: 20,
      avgCost: 100,
    })
  })

  it("réception partielle : niveau net +reçu, journal = transfer_in total + adjustment négatif documenté", async () => {
    const s = await seed()
    const { id, itemId } = await transfertExpedie(s, 10)
    const res = await req(
      s.ownerCookie,
      "POST",
      `/api/v1/transfers/${id}/receive`,
      { items: [{ itemId, receivedQuantity: 7 }] }
    )
    expect(res.status).toBe(200)
    expect(await lireNiveau(s.destinationId, s.variantId)).toEqual({
      quantity: 7,
      avgCost: 150,
    })
    const db = drizzle(env.DB, { schema })
    const mouvements = await db
      .select()
      .from(schema.stockMovements)
      .where(
        and(
          eq(schema.stockMovements.refId, id),
          eq(schema.stockMovements.warehouseId, s.destinationId)
        )
      )
    expect(mouvements).toHaveLength(2)
    expect(mouvements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "transfer_in", delta: 10 }),
        expect.objectContaining({
          type: "adjustment",
          delta: -3,
          reason: "Écart de réception du transfert (10 expédié, 7 reçu)",
        }),
      ])
    )
    const detail = await req(s.ownerCookie, "GET", `/api/v1/transfers/${id}`)
    const { transfer } = await detail.json<{
      transfer: { items: Array<{ receivedQuantity: number | null }> }
    }>()
    expect(transfer.items[0]?.receivedQuantity).toBe(7)
  })

  it("reçu > expédié → 400 QUANTITE_RECUE_INVALIDE, ligne étrangère → 404, rien n'est écrit", async () => {
    const s = await seed()
    const { id, itemId } = await transfertExpedie(s, 5)
    const trop = await req(
      s.ownerCookie,
      "POST",
      `/api/v1/transfers/${id}/receive`,
      { items: [{ itemId, receivedQuantity: 6 }] }
    )
    expect(trop.status).toBe(400)
    expect((await trop.json<{ code: string }>()).code).toBe(
      "QUANTITE_RECUE_INVALIDE"
    )
    const etrangere = await req(
      s.ownerCookie,
      "POST",
      `/api/v1/transfers/${id}/receive`,
      { items: [{ itemId: crypto.randomUUID(), receivedQuantity: 1 }] }
    )
    expect(etrangere.status).toBe(404)
    // Toujours sent, aucun mouvement à destination
    const db = drizzle(env.DB, { schema })
    const transferts = await db
      .select()
      .from(schema.transfers)
      .where(eq(schema.transfers.id, id))
    expect(transferts[0]?.status).toBe("sent")
    expect(await lireNiveau(s.destinationId, s.variantId)).toBeNull()
  })

  it("transitions interdites : réception d'un pending 409, double réception 409 et stock crédité une seule fois", async () => {
    const s = await seed()
    // pending
    const creation = await req(s.ownerCookie, "POST", "/api/v1/transfers", {
      fromWarehouseId: s.origineId,
      toWarehouseId: s.destinationId,
    })
    const { id: enAttente } = await creation.json<{ id: string }>()
    const avantEnvoi = await req(
      s.ownerCookie,
      "POST",
      `/api/v1/transfers/${enAttente}/receive`
    )
    expect(avantEnvoi.status).toBe(409)
    expect((await avantEnvoi.json<{ code: string }>()).code).toBe(
      "STATUT_INVALIDE"
    )
    // double réception
    const { id } = await transfertExpedie(s, 4)
    expect(
      (await req(s.ownerCookie, "POST", `/api/v1/transfers/${id}/receive`))
        .status
    ).toBe(200)
    expect(
      (await req(s.ownerCookie, "POST", `/api/v1/transfers/${id}/receive`))
        .status
    ).toBe(409)
    expect(await lireNiveau(s.destinationId, s.variantId)).toEqual({
      quantity: 4,
      avgCost: 150,
    })
  })

  it("matrice : manager DESTINATION réceptionne, manager origine 403", async () => {
    const s = await seed()
    const { id } = await transfertExpedie(s, 3)
    const managerOrigine = await createUserWithRole(s.organizationId, "staff")
    await affecterEntrepot(
      s.organizationId,
      managerOrigine.userId,
      s.origineId,
      "manager"
    )
    const managerDestination = await createUserWithRole(
      s.organizationId,
      "staff"
    )
    await affecterEntrepot(
      s.organizationId,
      managerDestination.userId,
      s.destinationId,
      "manager"
    )
    expect(
      (
        await req(
          managerOrigine.cookie,
          "POST",
          `/api/v1/transfers/${id}/receive`
        )
      ).status
    ).toBe(403)
    expect(
      (
        await req(
          managerDestination.cookie,
          "POST",
          `/api/v1/transfers/${id}/receive`
        )
      ).status
    ).toBe(200)
  })

  it("le lot suit la ligne : le transfer_in de destination porte le lotId choisi à l'origine", async () => {
    const s = await seed()
    const db = drizzle(env.DB, { schema })
    const suivie = await creerProduitSimple(s.organizationId, {
      trackLots: true,
    })
    const lotId = crypto.randomUUID()
    await db.insert(schema.lots).values({
      id: lotId,
      organizationId: s.organizationId,
      variantId: suivie.variantId,
      lotNumber: "LOT-T",
      expiryDate: null,
      createdAt: new Date(),
    })
    await applyMovements(db, {
      organizationId: s.organizationId,
      userId: s.ownerId,
      mouvements: [
        {
          warehouseId: s.origineId,
          variantId: suivie.variantId,
          delta: 6,
          type: "purchase",
          unitCost: 80,
          lotId,
        },
      ],
    })
    const creation = await req(s.ownerCookie, "POST", "/api/v1/transfers", {
      fromWarehouseId: s.origineId,
      toWarehouseId: s.destinationId,
    })
    const { id } = await creation.json<{ id: string }>()
    await req(s.ownerCookie, "POST", `/api/v1/transfers/${id}/items`, {
      variantId: suivie.variantId,
      quantity: 6,
      lotId,
    })
    expect(
      (await req(s.ownerCookie, "POST", `/api/v1/transfers/${id}/send`)).status
    ).toBe(200)
    expect(
      (await req(s.ownerCookie, "POST", `/api/v1/transfers/${id}/receive`))
        .status
    ).toBe(200)
    const entrees = await db
      .select()
      .from(schema.stockMovements)
      .where(
        and(
          eq(schema.stockMovements.refId, id),
          eq(schema.stockMovements.type, "transfer_in")
        )
      )
    expect(entrees).toEqual([expect.objectContaining({ lotId })])
  })
})
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd apps/api && bunx vitest run test/transfers-receive.test.ts`
Expected: FAIL — `POST /:id/receive` renvoie 404 (route absente).

- [ ] **Step 3 : Ajouter la route `receive`**

Dans `apps/api/src/routes/transfers.ts`, compléter l'import `shared` :

```ts
import {
  transferCreateSchema,
  transferItemCreateSchema,
  transferItemUpdateSchema,
  transferReceiveSchema,
} from "shared"
```

Ajouter la route après `send` :

```ts
transfersRoute.post("/:id/receive", async (c) => {
  // Corps OPTIONNEL (lignes absentes = tout est reçu) : validerCorps exige un
  // JSON, on parse donc tolérant ici — un POST sans corps vaut {}.
  const brut: unknown = await c.req.json().catch(() => ({}))
  const parsed = transferReceiveSchema.safeParse(brut)
  if (!parsed.success) {
    return c.json(
      {
        code: "VALIDATION",
        message: "Données invalides",
        details: parsed.error.flatten(),
      },
      400
    )
  }
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const transfert = await transfertScope(db, organizationId, c.req.param("id"))
  if (!transfert) {
    return c.json({ code: "INTROUVABLE", message: "Transfert introuvable" }, 404)
  }
  // Réception = rôle sur la DESTINATION (décision de phase)
  const refus = await verifierAccesEntrepot(c, transfert.toWarehouseId, [
    "manager",
  ])
  if (refus) return refus
  if (transfert.status !== "sent") {
    return c.json(
      {
        code: "STATUT_INVALIDE",
        message: "Seul un transfert expédié peut être réceptionné",
      },
      409
    )
  }
  const items = await db
    .select()
    .from(schema.transferItems)
    .where(eq(schema.transferItems.transferId, transfert.id))

  const recus = new Map<string, number>()
  for (const saisie of parsed.data.items ?? []) {
    const item = items.find((i) => i.id === saisie.itemId)
    if (!item) {
      return c.json({ code: "INTROUVABLE", message: "Ligne introuvable" }, 404)
    }
    if (saisie.receivedQuantity > item.quantity) {
      return c.json(
        {
          code: "QUANTITE_RECUE_INVALIDE",
          message: `La quantité reçue (${saisie.receivedQuantity}) dépasse la quantité expédiée (${item.quantity})`,
        },
        400
      )
    }
    recus.set(saisie.itemId, saisie.receivedQuantity)
  }

  const maintenant = new Date()
  // Ordre du batch : lignes d'abord (le trigger transfer_items_expedie_update
  // n'autorise QUE received_quantity tant que le parent est 'sent'), puis le
  // passage received SANS filtre — une double réception concurrente échoue
  // sur l'une OU l'autre instruction et le batch entier est annulé.
  const majLignes = items.map((item) =>
    db
      .update(schema.transferItems)
      .set({ receivedQuantity: recus.get(item.id) ?? item.quantity })
      .where(eq(schema.transferItems.id, item.id))
  )
  const majStatut = db
    .update(schema.transfers)
    .set({
      status: "received",
      receivedBy: c.get("user").id,
      receivedAt: maintenant,
      updatedAt: maintenant,
    })
    .where(eq(schema.transfers.id, transfert.id))

  // Décision de phase (documentée en tête de plan) : l'entrée à destination
  // porte la quantité EXPÉDIÉE totale, valorisée au CMP d'origine figé
  // (unit_cost, non-null après expédition) ; l'écart éventuel ressort en
  // adjustment négatif dans le MÊME batch. Net = quantité reçue, la perte
  // est journalisée et valorisée au CMP de destination après absorption
  // (biais assumé : la perte absorbe sa part de valeur).
  const mouvements: MouvementStock[] = items.flatMap((item) => {
    const recu = recus.get(item.id) ?? item.quantity
    const entree: MouvementStock = {
      warehouseId: transfert.toWarehouseId,
      variantId: item.variantId,
      lotId: item.lotId,
      delta: item.quantity,
      type: "transfer_in",
      refType: "transfer",
      refId: transfert.id,
      unitCost: item.unitCost ?? 0,
    }
    if (recu === item.quantity) {
      return [entree]
    }
    const ecart: MouvementStock = {
      warehouseId: transfert.toWarehouseId,
      variantId: item.variantId,
      lotId: item.lotId,
      delta: recu - item.quantity,
      type: "adjustment",
      reason: `Écart de réception du transfert (${item.quantity} expédié, ${recu} reçu)`,
      refType: "transfer",
      refId: transfert.id,
    }
    return [entree, ecart]
  })

  const instructionsAvant: InstructionBatch[] = [...majLignes, majStatut]
  try {
    await applyMovements(db, {
      organizationId,
      userId: c.get("user").id,
      mouvements,
      instructionsAvant,
      date: maintenant,
    })
  } catch (err) {
    if (
      estErreurDeclencheur(err, "TRANSFERT_TERMINE") ||
      estErreurDeclencheur(err, "TRANSFERT_EXPEDIE")
    ) {
      return c.json(
        {
          code: "STATUT_INVALIDE",
          message: "Ce transfert a déjà été réceptionné ou annulé",
        },
        409
      )
    }
    throw err
  }
  return c.json({ ok: true })
})
```

- [ ] **Step 4 : Vérifier**

Run: `cd apps/api && bunx vitest run test/transfers-receive.test.ts test/transfers-send.test.ts test/transfers-draft.test.ts`
Expected: PASS.

Run: `bun run --cwd apps/api test && bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add apps/api/src/routes/transfers.ts apps/api/test/transfers-receive.test.ts
git commit -m "feat(api): réception de transfert — transfer_in valorisé au CMP figé, écarts tracés en ajustement"
```

---

### Task 8: Stock en transit visible (`GET /stock/transit`)

Le transit est DÉRIVÉ des transferts `sent` non encore `received` — aucune matérialisation. Endpoint dédié listant le transit ENTRANT vers un entrepôt (décision de phase : couvre aussi les variantes jamais stockées à destination). Contrat de lecture identique à `/levels` : `warehouseId` requis (400), portée (403), existence org (404).

**Files:**
- Modify: `apps/api/src/routes/stock.ts` (route `GET /transit` + import `alias`)
- Test: `apps/api/test/stock-transit.test.ts` (nouveau)

**Interfaces:**
- Consomme : `entrepotDansOrganisation` (Task 1, même fichier) ; tables `transfers`/`transferItems` (Task 3) ; routes transferts (Tasks 5-7) pour les seeds de test.
- Produit : `GET /stock/transit?warehouseId=` → `{ transit: Array<{ transferId, reference, fromWarehouseId, fromWarehouseName, sentAt, variantId, productName, variantName, sku, lotNumber, quantity }> }` (consommé par l'écran des niveaux, Task 12).

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `apps/api/test/stock-transit.test.ts` :

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

type LigneTransit = {
  transferId: string
  fromWarehouseName: string
  variantId: string
  sku: string
  quantity: number
}

async function seed() {
  const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
  const origineId = await creerEntrepot(organizationId, "Origine")
  const destinationId = await creerEntrepot(organizationId, "Destination")
  const { variantId } = await creerProduitSimple(organizationId)
  const db = drizzle(env.DB, { schema })
  await applyMovements(db, {
    organizationId,
    userId: ownerId,
    mouvements: [
      {
        warehouseId: origineId,
        variantId,
        delta: 20,
        type: "purchase",
        unitCost: 100,
      },
    ],
  })
  return { organizationId, ownerCookie, origineId, destinationId, variantId }
}

async function creerTransfert(
  s: Awaited<ReturnType<typeof seed>>,
  quantity: number
): Promise<string> {
  const creation = await req(s.ownerCookie, "POST", "/api/v1/transfers", {
    fromWarehouseId: s.origineId,
    toWarehouseId: s.destinationId,
  })
  const { id } = await creation.json<{ id: string }>()
  await req(s.ownerCookie, "POST", `/api/v1/transfers/${id}/items`, {
    variantId: s.variantId,
    quantity,
  })
  return id
}

describe("stock en transit — dérivé des transferts sent", () => {
  it("un transfert apparaît en transit entrant après send et disparaît après receive (pending invisible)", async () => {
    const s = await seed()
    const id = await creerTransfert(s, 6)

    const url = `/api/v1/stock/transit?warehouseId=${s.destinationId}`
    // pending : rien
    let transit = await (
      await req(s.ownerCookie, "GET", url)
    ).json<{ transit: LigneTransit[] }>()
    expect(transit.transit).toEqual([])

    await req(s.ownerCookie, "POST", `/api/v1/transfers/${id}/send`)
    transit = await (
      await req(s.ownerCookie, "GET", url)
    ).json<{ transit: LigneTransit[] }>()
    expect(transit.transit).toEqual([
      expect.objectContaining({
        transferId: id,
        fromWarehouseName: "Origine",
        variantId: s.variantId,
        quantity: 6,
      }),
    ])
    // Le transit est ENTRANT : rien côté origine
    const transitOrigine = await (
      await req(
        s.ownerCookie,
        "GET",
        `/api/v1/stock/transit?warehouseId=${s.origineId}`
      )
    ).json<{ transit: LigneTransit[] }>()
    expect(transitOrigine.transit).toEqual([])

    await req(s.ownerCookie, "POST", `/api/v1/transfers/${id}/receive`)
    transit = await (
      await req(s.ownerCookie, "GET", url)
    ).json<{ transit: LigneTransit[] }>()
    expect(transit.transit).toEqual([])
  })

  it("contrat de lecture : warehouseId requis 400, hors portée 403, cross-org 404", async () => {
    const s = await seed()
    expect(
      (await req(s.ownerCookie, "GET", "/api/v1/stock/transit")).status
    ).toBe(400)

    const sansLien = await createUserWithRole(s.organizationId, "staff")
    expect(
      (
        await req(
          sansLien.cookie,
          "GET",
          `/api/v1/stock/transit?warehouseId=${s.destinationId}`
        )
      ).status
    ).toBe(403)

    const managerDestination = await createUserWithRole(
      s.organizationId,
      "staff"
    )
    await affecterEntrepot(
      s.organizationId,
      managerDestination.userId,
      s.destinationId,
      "manager"
    )
    expect(
      (
        await req(
          managerDestination.cookie,
          "GET",
          `/api/v1/stock/transit?warehouseId=${s.destinationId}`
        )
      ).status
    ).toBe(200)

    expect(
      (
        await req(
          s.ownerCookie,
          "GET",
          `/api/v1/stock/transit?warehouseId=${crypto.randomUUID()}`
        )
      ).status
    ).toBe(404)
  })
})
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd apps/api && bunx vitest run test/stock-transit.test.ts`
Expected: FAIL — `GET /stock/transit` renvoie 404.

- [ ] **Step 3 : Ajouter la route**

Dans `apps/api/src/routes/stock.ts`, ajouter l'import :

```ts
import { alias } from "drizzle-orm/sqlite-core"
```

puis la route, après `GET /alerts` :

```ts
// Stock en transit ENTRANT : dérivé des transferts `sent` non réceptionnés —
// aucune matérialisation (spec Phase 5). Même contrat de lecture que /levels.
stockRoute.get("/transit", async (c) => {
  const { organizationId, role } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const warehouseId = c.req.query("warehouseId")
  if (!warehouseId) {
    return c.json(
      { code: "VALIDATION", message: "Le paramètre warehouseId est requis" },
      400
    )
  }
  const portee = await porteeLectureStock(
    db,
    organizationId,
    c.get("user").id,
    role
  )
  if (!portee.tous && !portee.warehouseIds.includes(warehouseId)) {
    return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
  }
  if (!(await entrepotDansOrganisation(db, organizationId, warehouseId))) {
    return c.json({ code: "INTROUVABLE", message: "Entrepôt introuvable" }, 404)
  }
  const origine = alias(schema.warehouses, "origine")
  const transit = await db
    .select({
      transferId: schema.transfers.id,
      reference: schema.transfers.reference,
      fromWarehouseId: schema.transfers.fromWarehouseId,
      fromWarehouseName: origine.name,
      sentAt: schema.transfers.sentAt,
      variantId: schema.transferItems.variantId,
      productName: schema.products.name,
      variantName: schema.productVariants.name,
      sku: schema.productVariants.sku,
      lotNumber: schema.lots.lotNumber,
      quantity: schema.transferItems.quantity,
    })
    .from(schema.transferItems)
    .innerJoin(
      schema.transfers,
      eq(schema.transferItems.transferId, schema.transfers.id)
    )
    .innerJoin(origine, eq(schema.transfers.fromWarehouseId, origine.id))
    .innerJoin(
      schema.productVariants,
      eq(schema.transferItems.variantId, schema.productVariants.id)
    )
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id)
    )
    .leftJoin(schema.lots, eq(schema.transferItems.lotId, schema.lots.id))
    .where(
      and(
        eq(schema.transfers.organizationId, organizationId),
        eq(schema.transfers.status, "sent"),
        eq(schema.transfers.toWarehouseId, warehouseId)
      )
    )
    .orderBy(desc(schema.transfers.sentAt), asc(schema.products.name))
  return c.json({ transit })
})
```

- [ ] **Step 4 : Vérifier**

Run: `cd apps/api && bunx vitest run test/stock-transit.test.ts`
Expected: PASS.

Run: `bun run --cwd apps/api test && bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add apps/api/src/routes/stock.ts apps/api/test/stock-transit.test.ts
git commit -m "feat(api): stock en transit entrant dérivé des transferts expédiés (GET /stock/transit)"
```

---

### Task 9: Inventaires — ouverture (quantités figées) et saisie de comptage

Document `inventory_counts` : l'ouverture fige, dans UN batch, une ligne par niveau de l'entrepôt (inventaire complet v1) ; les comptages se saisissent ligne à ligne, en plusieurs sessions, tant que le document est `open`. Un seul inventaire ouvert par entrepôt (pré-contrôle + index partiel pour la course).

**Files:**
- Create: `apps/api/src/routes/inventory-counts.ts`
- Modify: `apps/api/src/index.ts` (montage `/api/v1/inventory-counts`)
- Test: `apps/api/test/inventory-draft.test.ts` (nouveau)

**Interfaces:**
- Consomme : `inventoryCountCreateSchema`, `inventoryCountItemUpdateSchema` (Task 3) ; `verifierAccesEntrepot`, `porteeLectureStock`, `validerCorps`, `estErreurDeclencheur`, `estViolationUnicite` ; tables Task 3.
- Produit — routes montées sous `/api/v1/inventory-counts` :
  - `GET /` → `{ counts: Array<{ id, warehouseId, warehouseName, status, openedAt, closedAt, itemCount, countedCount }> }` (filtres `?statut=`, `?warehouseId=`)
  - `POST /` corps `{ warehouseId }` → `201 { id }` | `409 INVENTAIRE_OUVERT` | `400 VALIDATION` (entrepôt sans stock) | `403`
  - `GET /:id` → `{ count: { id, warehouseId, warehouseName, status, openedAt, closedAt, items: Array<{ id, variantId, productName, variantName, sku, expectedQuantity, countedQuantity }> } }`
  - `PATCH /:id/items/:itemId` corps `{ countedQuantity: number | null }` → `200 { ok: true }` | `409 INVENTAIRE_CLOS` | `404`
- Produit — helper interne réutilisé par la Task 10 (même fichier) : `inventaireScope(db, organizationId, id): Promise<typeof schema.inventoryCounts.$inferSelect | null>` et `REPONSE_INVENTAIRE_CLOS`.

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `apps/api/test/inventory-draft.test.ts` :

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

type LigneInventaire = {
  id: string
  variantId: string
  expectedQuantity: number
  countedQuantity: number | null
}

async function seed() {
  const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
  const entrepotId = await creerEntrepot(organizationId, "Principal")
  const produitA = await creerProduitSimple(organizationId, { nom: "A" })
  const produitB = await creerProduitSimple(organizationId, { nom: "B" })
  const db = drizzle(env.DB, { schema })
  await applyMovements(db, {
    organizationId,
    userId: ownerId,
    mouvements: [
      {
        warehouseId: entrepotId,
        variantId: produitA.variantId,
        delta: 10,
        type: "purchase",
        unitCost: 100,
      },
      {
        warehouseId: entrepotId,
        variantId: produitB.variantId,
        delta: 5,
        type: "purchase",
        unitCost: 200,
      },
    ],
  })
  return {
    organizationId,
    ownerId,
    ownerCookie,
    entrepotId,
    variantA: produitA.variantId,
    variantB: produitB.variantId,
  }
}

describe("inventaires — ouverture et saisie", () => {
  it("l'ouverture fige TOUT l'entrepôt : une ligne par niveau, quantités attendues photographiées", async () => {
    const s = await seed()
    const creation = await req(s.ownerCookie, "POST", "/api/v1/inventory-counts", {
      warehouseId: s.entrepotId,
    })
    expect(creation.status).toBe(201)
    const { id } = await creation.json<{ id: string }>()

    // Un mouvement APRÈS ouverture ne change pas les quantités figées
    const db = drizzle(env.DB, { schema })
    await applyMovements(db, {
      organizationId: s.organizationId,
      userId: s.ownerId,
      mouvements: [
        {
          warehouseId: s.entrepotId,
          variantId: s.variantA,
          delta: -3,
          type: "adjustment",
          reason: "vente pendant inventaire",
        },
      ],
    })

    const detail = await req(
      s.ownerCookie,
      "GET",
      `/api/v1/inventory-counts/${id}`
    )
    expect(detail.status).toBe(200)
    const { count } = await detail.json<{
      count: { status: string; items: LigneInventaire[] }
    }>()
    expect(count.status).toBe("open")
    expect(count.items).toHaveLength(2)
    expect(count.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variantId: s.variantA,
          expectedQuantity: 10,
          countedQuantity: null,
        }),
        expect.objectContaining({
          variantId: s.variantB,
          expectedQuantity: 5,
          countedQuantity: null,
        }),
      ])
    )
  })

  it("un seul inventaire ouvert par entrepôt ; un entrepôt sans stock est refusé", async () => {
    const s = await seed()
    expect(
      (
        await req(s.ownerCookie, "POST", "/api/v1/inventory-counts", {
          warehouseId: s.entrepotId,
        })
      ).status
    ).toBe(201)
    const doublon = await req(s.ownerCookie, "POST", "/api/v1/inventory-counts", {
      warehouseId: s.entrepotId,
    })
    expect(doublon.status).toBe(409)
    expect((await doublon.json<{ code: string }>()).code).toBe(
      "INVENTAIRE_OUVERT"
    )

    const vide = await creerEntrepot(s.organizationId, "Vide")
    const sansStock = await req(s.ownerCookie, "POST", "/api/v1/inventory-counts", {
      warehouseId: vide,
    })
    expect(sansStock.status).toBe(400)
    expect((await sansStock.json<{ code: string }>()).code).toBe("VALIDATION")
  })

  it("saisie de comptage : plusieurs sessions, correction, effacement à null", async () => {
    const s = await seed()
    const creation = await req(s.ownerCookie, "POST", "/api/v1/inventory-counts", {
      warehouseId: s.entrepotId,
    })
    const { id } = await creation.json<{ id: string }>()
    const detail = await req(
      s.ownerCookie,
      "GET",
      `/api/v1/inventory-counts/${id}`
    )
    const { count } = await detail.json<{ count: { items: LigneInventaire[] } }>()
    const ligneA = count.items.find((i) => i.variantId === s.variantA)

    // Première session de comptage
    expect(
      (
        await req(
          s.ownerCookie,
          "PATCH",
          `/api/v1/inventory-counts/${id}/items/${ligneA?.id ?? ""}`,
          { countedQuantity: 9 }
        )
      ).status
    ).toBe(200)
    // Seconde session : correction
    expect(
      (
        await req(
          s.ownerCookie,
          "PATCH",
          `/api/v1/inventory-counts/${id}/items/${ligneA?.id ?? ""}`,
          { countedQuantity: 8 }
        )
      ).status
    ).toBe(200)
    // Effacement
    expect(
      (
        await req(
          s.ownerCookie,
          "PATCH",
          `/api/v1/inventory-counts/${id}/items/${ligneA?.id ?? ""}`,
          { countedQuantity: null }
        )
      ).status
    ).toBe(200)
    // Ligne étrangère → 404
    expect(
      (
        await req(
          s.ownerCookie,
          "PATCH",
          `/api/v1/inventory-counts/${id}/items/${crypto.randomUUID()}`,
          { countedQuantity: 1 }
        )
      ).status
    ).toBe(404)
    // Négatif → 400 (Zod)
    expect(
      (
        await req(
          s.ownerCookie,
          "PATCH",
          `/api/v1/inventory-counts/${id}/items/${ligneA?.id ?? ""}`,
          { countedQuantity: -1 }
        )
      ).status
    ).toBe(400)
  })

  it("un inventaire clos refuse la saisie (409 INVENTAIRE_CLOS) et libère l'entrepôt pour une réouverture", async () => {
    const s = await seed()
    const creation = await req(s.ownerCookie, "POST", "/api/v1/inventory-counts", {
      warehouseId: s.entrepotId,
    })
    const { id } = await creation.json<{ id: string }>()
    const detail = await req(
      s.ownerCookie,
      "GET",
      `/api/v1/inventory-counts/${id}`
    )
    const { count } = await detail.json<{ count: { items: LigneInventaire[] } }>()
    // Clôture hors route (la route close arrive en Task 10)
    const db = drizzle(env.DB, { schema })
    await db
      .update(schema.inventoryCounts)
      .set({ status: "closed" })
      .where(eq(schema.inventoryCounts.id, id))

    const refus = await req(
      s.ownerCookie,
      "PATCH",
      `/api/v1/inventory-counts/${id}/items/${count.items[0]?.id ?? ""}`,
      { countedQuantity: 1 }
    )
    expect(refus.status).toBe(409)
    expect((await refus.json<{ code: string }>()).code).toBe("INVENTAIRE_CLOS")

    expect(
      (
        await req(s.ownerCookie, "POST", "/api/v1/inventory-counts", {
          warehouseId: s.entrepotId,
        })
      ).status
    ).toBe(201)
  })

  it("matrice : manager de l'entrepôt ouvre et compte, manager d'un autre entrepôt 403, auditeur d'entrepôt lecture seule", async () => {
    const s = await seed()
    const autreEntrepot = await creerEntrepot(s.organizationId, "Autre")
    const manager = await createUserWithRole(s.organizationId, "staff")
    await affecterEntrepot(s.organizationId, manager.userId, s.entrepotId, "manager")
    const managerAilleurs = await createUserWithRole(s.organizationId, "staff")
    await affecterEntrepot(
      s.organizationId,
      managerAilleurs.userId,
      autreEntrepot,
      "manager"
    )
    const auditeurLocal = await createUserWithRole(s.organizationId, "staff")
    await affecterEntrepot(
      s.organizationId,
      auditeurLocal.userId,
      s.entrepotId,
      "auditor"
    )

    expect(
      (
        await req(managerAilleurs.cookie, "POST", "/api/v1/inventory-counts", {
          warehouseId: s.entrepotId,
        })
      ).status
    ).toBe(403)
    expect(
      (
        await req(auditeurLocal.cookie, "POST", "/api/v1/inventory-counts", {
          warehouseId: s.entrepotId,
        })
      ).status
    ).toBe(403)

    const creation = await req(manager.cookie, "POST", "/api/v1/inventory-counts", {
      warehouseId: s.entrepotId,
    })
    expect(creation.status).toBe(201)
    const { id } = await creation.json<{ id: string }>()

    // Lecture : l'auditeur local voit, le manager d'ailleurs ne voit pas
    expect(
      (await req(auditeurLocal.cookie, "GET", `/api/v1/inventory-counts/${id}`))
        .status
    ).toBe(200)
    expect(
      (
        await req(
          managerAilleurs.cookie,
          "GET",
          `/api/v1/inventory-counts/${id}`
        )
      ).status
    ).toBe(403)
    // Liste filtrée par portée
    const liste = await req(
      managerAilleurs.cookie,
      "GET",
      "/api/v1/inventory-counts"
    )
    expect((await liste.json<{ counts: unknown[] }>()).counts).toEqual([])
    // Cross-org → 404
    expect(
      (
        await req(
          s.ownerCookie,
          "GET",
          `/api/v1/inventory-counts/${crypto.randomUUID()}`
        )
      ).status
    ).toBe(404)
  })

  it("liste : statut, agrégats itemCount/countedCount", async () => {
    const s = await seed()
    const creation = await req(s.ownerCookie, "POST", "/api/v1/inventory-counts", {
      warehouseId: s.entrepotId,
    })
    const { id } = await creation.json<{ id: string }>()
    const detail = await req(
      s.ownerCookie,
      "GET",
      `/api/v1/inventory-counts/${id}`
    )
    const { count } = await detail.json<{ count: { items: LigneInventaire[] } }>()
    await req(
      s.ownerCookie,
      "PATCH",
      `/api/v1/inventory-counts/${id}/items/${count.items[0]?.id ?? ""}`,
      { countedQuantity: 4 }
    )
    const liste = await req(
      s.ownerCookie,
      "GET",
      "/api/v1/inventory-counts?statut=open"
    )
    const { counts } = await liste.json<{
      counts: Array<{ id: string; itemCount: number; countedCount: number }>
    }>()
    expect(counts).toEqual([
      expect.objectContaining({ id, itemCount: 2, countedCount: 1 }),
    ])
    expect(
      (await req(s.ownerCookie, "GET", "/api/v1/inventory-counts?statut=zzz"))
        .status
    ).toBe(400)
  })
})
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd apps/api && bunx vitest run test/inventory-draft.test.ts`
Expected: FAIL — 404 (routes absentes).

- [ ] **Step 3 : Créer `apps/api/src/routes/inventory-counts.ts`**

```ts
import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import {
  inventoryCountCreateSchema,
  inventoryCountItemUpdateSchema,
} from "shared"
import * as schema from "../db/schema"
import { validerCorps } from "../lib/validation"
import { estErreurDeclencheur, estViolationUnicite } from "../lib/db-errors"
import { porteeLectureStock } from "../lib/stock-acces"
import { requireAuth } from "../middleware/require-auth"
import {
  requireMembership,
  verifierAccesEntrepot,
} from "../middleware/permissions"
import type { PermissionVariables } from "../middleware/permissions"
import type { Env } from "../env"

export const inventoryCountsRoute = new Hono<{
  Bindings: Env
  Variables: PermissionVariables
}>()

inventoryCountsRoute.use(requireAuth, requireMembership)

type Db = DrizzleD1Database<typeof schema>

// Retour annoté `| null` (piège eslint no-unnecessary-condition)
async function inventaireScope(
  db: Db,
  organizationId: string,
  id: string
): Promise<typeof schema.inventoryCounts.$inferSelect | null> {
  const rows = await db
    .select()
    .from(schema.inventoryCounts)
    .where(
      and(
        eq(schema.inventoryCounts.id, id),
        eq(schema.inventoryCounts.organizationId, organizationId)
      )
    )
    .limit(1)
  return rows[0] ?? null
}

const REPONSE_INVENTAIRE_CLOS = {
  code: "INVENTAIRE_CLOS",
  message: "Cet inventaire est clos et ne peut plus être modifié",
} as const

inventoryCountsRoute.get("/", async (c) => {
  const { organizationId, role } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const portee = await porteeLectureStock(
    db,
    organizationId,
    c.get("user").id,
    role
  )
  const statut = c.req.query("statut")
  const warehouseId = c.req.query("warehouseId")
  if (
    statut &&
    !(schema.INVENTORY_COUNT_STATUSES as readonly string[]).includes(statut)
  ) {
    return c.json({ code: "VALIDATION", message: "Statut invalide" }, 400)
  }
  const conditions: SQL[] = [
    eq(schema.inventoryCounts.organizationId, organizationId),
  ]
  if (statut) {
    conditions.push(
      eq(
        schema.inventoryCounts.status,
        statut as (typeof schema.INVENTORY_COUNT_STATUSES)[number]
      )
    )
  }
  if (warehouseId) {
    if (!portee.tous && !portee.warehouseIds.includes(warehouseId)) {
      return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
    }
    conditions.push(eq(schema.inventoryCounts.warehouseId, warehouseId))
  } else if (!portee.tous) {
    if (portee.warehouseIds.length === 0) {
      return c.json({ counts: [] })
    }
    conditions.push(
      inArray(schema.inventoryCounts.warehouseId, portee.warehouseIds)
    )
  }
  const rows = await db
    .select({
      id: schema.inventoryCounts.id,
      warehouseId: schema.inventoryCounts.warehouseId,
      warehouseName: schema.warehouses.name,
      status: schema.inventoryCounts.status,
      openedAt: schema.inventoryCounts.openedAt,
      closedAt: schema.inventoryCounts.closedAt,
    })
    .from(schema.inventoryCounts)
    .innerJoin(
      schema.warehouses,
      eq(schema.inventoryCounts.warehouseId, schema.warehouses.id)
    )
    .where(and(...conditions))
    .orderBy(desc(schema.inventoryCounts.openedAt))
  const ids = rows.map((r) => r.id)
  const agregats =
    ids.length > 0
      ? await db
          .select({
            countId: schema.inventoryCountItems.countId,
            itemCount: sql<number>`COUNT(*)`,
            countedCount: sql<number>`SUM(CASE WHEN ${schema.inventoryCountItems.countedQuantity} IS NOT NULL THEN 1 ELSE 0 END)`,
          })
          .from(schema.inventoryCountItems)
          .where(inArray(schema.inventoryCountItems.countId, ids))
          .groupBy(schema.inventoryCountItems.countId)
      : []
  const counts = rows.map((r) => {
    const agregat = agregats.find((a) => a.countId === r.id)
    return {
      ...r,
      itemCount: agregat?.itemCount ?? 0,
      countedCount: agregat?.countedCount ?? 0,
    }
  })
  return c.json({ counts })
})

inventoryCountsRoute.post("/", async (c) => {
  const corps = await validerCorps(c, inventoryCountCreateSchema)
  if (!corps.ok) return corps.reponse
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  // Écriture : owner/admin/stock_manager (bypass) ou manager de l'entrepôt.
  const refus = await verifierAccesEntrepot(c, corps.data.warehouseId, [
    "manager",
  ])
  if (refus) return refus
  const ouverts = await db
    .select({ id: schema.inventoryCounts.id })
    .from(schema.inventoryCounts)
    .where(
      and(
        eq(schema.inventoryCounts.warehouseId, corps.data.warehouseId),
        eq(schema.inventoryCounts.status, "open")
      )
    )
    .limit(1)
  if (ouverts.length > 0) {
    return c.json(
      {
        code: "INVENTAIRE_OUVERT",
        message: "Un inventaire est déjà ouvert pour cet entrepôt",
      },
      409
    )
  }
  // Inventaire COMPLET (v1, spec) : une ligne par niveau existant de
  // l'entrepôt — les variantes jamais stockées ici n'ont pas de ligne de
  // niveau, donc rien à compter.
  const niveaux = await db
    .select({
      variantId: schema.stockLevels.variantId,
      quantity: schema.stockLevels.quantity,
    })
    .from(schema.stockLevels)
    .where(
      and(
        eq(schema.stockLevels.organizationId, organizationId),
        eq(schema.stockLevels.warehouseId, corps.data.warehouseId)
      )
    )
  if (niveaux.length === 0) {
    return c.json(
      {
        code: "VALIDATION",
        message: "Aucun article en stock à inventorier pour cet entrepôt",
      },
      400
    )
  }
  const id = crypto.randomUUID()
  const maintenant = new Date()
  const insertionDoc = db.insert(schema.inventoryCounts).values({
    id,
    organizationId,
    warehouseId: corps.data.warehouseId,
    openedBy: c.get("user").id,
    openedAt: maintenant,
    createdAt: maintenant,
    updatedAt: maintenant,
  })
  const insertionsLignes = niveaux.map((n) =>
    db.insert(schema.inventoryCountItems).values({
      id: crypto.randomUUID(),
      organizationId,
      countId: id,
      variantId: n.variantId,
      expectedQuantity: n.quantity,
      createdAt: maintenant,
    })
  )
  try {
    // Document + photographie des quantités dans UN batch atomique.
    await db.batch([insertionDoc, ...insertionsLignes])
  } catch (err) {
    // Course : deux ouvertures simultanées — l'index unique partiel
    // inventory_counts_open_wh_uidx (0007) tue la seconde. SQLite rapporte
    // les COLONNES de l'index, jamais son nom.
    if (estViolationUnicite(err, "inventory_counts.warehouse_id")) {
      return c.json(
        {
          code: "INVENTAIRE_OUVERT",
          message: "Un inventaire est déjà ouvert pour cet entrepôt",
        },
        409
      )
    }
    throw err
  }
  return c.json({ id }, 201)
})

inventoryCountsRoute.get("/:id", async (c) => {
  const { organizationId, role } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const inventaire = await inventaireScope(db, organizationId, c.req.param("id"))
  if (!inventaire) {
    return c.json(
      { code: "INTROUVABLE", message: "Inventaire introuvable" },
      404
    )
  }
  const portee = await porteeLectureStock(
    db,
    organizationId,
    c.get("user").id,
    role
  )
  if (!portee.tous && !portee.warehouseIds.includes(inventaire.warehouseId)) {
    return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
  }
  const entetes = await db
    .select({ warehouseName: schema.warehouses.name })
    .from(schema.warehouses)
    .where(eq(schema.warehouses.id, inventaire.warehouseId))
    .limit(1)
  const items = await db
    .select({
      id: schema.inventoryCountItems.id,
      variantId: schema.inventoryCountItems.variantId,
      productName: schema.products.name,
      variantName: schema.productVariants.name,
      sku: schema.productVariants.sku,
      expectedQuantity: schema.inventoryCountItems.expectedQuantity,
      countedQuantity: schema.inventoryCountItems.countedQuantity,
    })
    .from(schema.inventoryCountItems)
    .innerJoin(
      schema.productVariants,
      eq(schema.inventoryCountItems.variantId, schema.productVariants.id)
    )
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id)
    )
    .where(eq(schema.inventoryCountItems.countId, inventaire.id))
    .orderBy(asc(schema.products.name), asc(schema.productVariants.name))
  return c.json({
    count: {
      id: inventaire.id,
      warehouseId: inventaire.warehouseId,
      warehouseName: entetes[0]?.warehouseName ?? "",
      status: inventaire.status,
      openedAt: inventaire.openedAt,
      closedAt: inventaire.closedAt,
      items,
    },
  })
})

inventoryCountsRoute.patch("/:id/items/:itemId", async (c) => {
  const corps = await validerCorps(c, inventoryCountItemUpdateSchema)
  if (!corps.ok) return corps.reponse
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const inventaire = await inventaireScope(db, organizationId, c.req.param("id"))
  if (!inventaire) {
    return c.json(
      { code: "INTROUVABLE", message: "Inventaire introuvable" },
      404
    )
  }
  const refus = await verifierAccesEntrepot(c, inventaire.warehouseId, [
    "manager",
  ])
  if (refus) return refus
  if (inventaire.status !== "open") {
    return c.json(REPONSE_INVENTAIRE_CLOS, 409)
  }
  const items = await db
    .select({ id: schema.inventoryCountItems.id })
    .from(schema.inventoryCountItems)
    .where(
      and(
        eq(schema.inventoryCountItems.id, c.req.param("itemId")),
        eq(schema.inventoryCountItems.countId, inventaire.id)
      )
    )
    .limit(1)
  if (items.length === 0) {
    return c.json({ code: "INTROUVABLE", message: "Ligne introuvable" }, 404)
  }
  const maintenant = new Date()
  try {
    // Saisie + updatedAt du document, atomiquement. Si une clôture
    // concurrente vient de passer, inventory_count_items_clos_update fait
    // échouer le batch → 409 propre.
    await db.batch([
      db
        .update(schema.inventoryCountItems)
        .set({ countedQuantity: corps.data.countedQuantity })
        .where(eq(schema.inventoryCountItems.id, c.req.param("itemId"))),
      db
        .update(schema.inventoryCounts)
        .set({ updatedAt: maintenant })
        .where(eq(schema.inventoryCounts.id, inventaire.id)),
    ])
  } catch (err) {
    if (estErreurDeclencheur(err, "INVENTAIRE_CLOS")) {
      return c.json(REPONSE_INVENTAIRE_CLOS, 409)
    }
    throw err
  }
  return c.json({ ok: true })
})
```

- [ ] **Step 4 : Monter la route**

Dans `apps/api/src/index.ts`, ajouter l'import et le montage après `transfersRoute` :

```ts
import { inventoryCountsRoute } from "./routes/inventory-counts"
```

```ts
app.route("/api/v1/inventory-counts", inventoryCountsRoute)
```

- [ ] **Step 5 : Vérifier**

Run: `cd apps/api && bunx vitest run test/inventory-draft.test.ts`
Expected: PASS (6 tests).

Run: `bun run --cwd apps/api test && bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add apps/api/src/routes/inventory-counts.ts apps/api/src/index.ts apps/api/test/inventory-draft.test.ts
git commit -m "feat(api): inventaires — ouverture avec quantités figées (complet v1), saisie de comptage multi-sessions"
```

---

### Task 10: Inventaires — clôture (écarts sur mouvement net, mouvements `count`)

La clôture calcule l'écart de chaque ligne comptée contre la quantité COURANTE du niveau (= attendu à l'ouverture + mouvement net depuis — spec §5 : les ventes pendant l'inventaire ne créent pas de faux écarts), génère les mouvements `count` via `applyMovements` (document + mouvements + niveaux dans UN batch), rend le récapitulatif des écarts, et laisse le document immuable (trigger `INVENTAIRE_CLOS`).

**Files:**
- Modify: `apps/api/src/routes/inventory-counts.ts` (ajout route `close`)
- Test: `apps/api/test/inventory-close.test.ts` (nouveau)

**Interfaces:**
- Consomme : `inventaireScope`, `REPONSE_INVENTAIRE_CLOS` (Task 9) ; `applyMovements`, `ErreurStockInsuffisant` (Task 4) ; `reponseStockInsuffisant` (Task 6) ; trigger `inventory_counts_clos_immuable` (Task 3).
- Produit : `POST /inventory-counts/:id/close` (sans corps) → `200 { ok: true, ecarts: Array<{ variantId, productName, variantName, sku, attendu, compte, quantiteAvantCloture, delta }>, nonComptes: number, mouvements: number }` | `409 INVENTAIRE_CLOS` | `409 STOCK_INSUFFISANT` (course rarissime) | `403`/`404` (consommé par l'écran de clôture, Task 12).

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `apps/api/test/inventory-close.test.ts` :

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

// Retour annoté `| null` (piège eslint no-unnecessary-condition)
async function lireNiveau(
  warehouseId: string,
  variantId: string
): Promise<{ quantity: number; avgCost: number } | null> {
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

type ReponseCloture = {
  ok: boolean
  ecarts: Array<{
    variantId: string
    attendu: number
    compte: number
    quantiteAvantCloture: number
    delta: number
  }>
  nonComptes: number
  mouvements: number
}

async function seed() {
  const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
  const entrepotId = await creerEntrepot(organizationId, "Principal")
  const produitA = await creerProduitSimple(organizationId, { nom: "A" })
  const produitB = await creerProduitSimple(organizationId, { nom: "B" })
  const db = drizzle(env.DB, { schema })
  await applyMovements(db, {
    organizationId,
    userId: ownerId,
    mouvements: [
      {
        warehouseId: entrepotId,
        variantId: produitA.variantId,
        delta: 10,
        type: "purchase",
        unitCost: 100,
      },
      {
        warehouseId: entrepotId,
        variantId: produitB.variantId,
        delta: 5,
        type: "purchase",
        unitCost: 200,
      },
    ],
  })
  return {
    organizationId,
    ownerId,
    ownerCookie,
    entrepotId,
    variantA: produitA.variantId,
    variantB: produitB.variantId,
  }
}

async function ouvrir(
  s: Awaited<ReturnType<typeof seed>>
): Promise<{ id: string; lignes: Map<string, string> }> {
  const creation = await req(s.ownerCookie, "POST", "/api/v1/inventory-counts", {
    warehouseId: s.entrepotId,
  })
  const { id } = await creation.json<{ id: string }>()
  const detail = await req(s.ownerCookie, "GET", `/api/v1/inventory-counts/${id}`)
  const { count } = await detail.json<{
    count: { items: Array<{ id: string; variantId: string }> }
  }>()
  return {
    id,
    lignes: new Map(count.items.map((i) => [i.variantId, i.id])),
  }
}

async function compter(
  s: Awaited<ReturnType<typeof seed>>,
  countId: string,
  itemId: string,
  countedQuantity: number
): Promise<void> {
  const res = await req(
    s.ownerCookie,
    "PATCH",
    `/api/v1/inventory-counts/${countId}/items/${itemId}`,
    { countedQuantity }
  )
  expect(res.status).toBe(200)
}

describe("inventaires — clôture", () => {
  it("écart simple : compté 8 pour 10 → mouvement count -2, niveau 8, récapitulatif", async () => {
    const s = await seed()
    const { id, lignes } = await ouvrir(s)
    await compter(s, id, lignes.get(s.variantA) ?? "", 8)

    const res = await req(
      s.ownerCookie,
      "POST",
      `/api/v1/inventory-counts/${id}/close`
    )
    expect(res.status).toBe(200)
    const corps = await res.json<ReponseCloture>()
    expect(corps.ecarts).toEqual([
      expect.objectContaining({
        variantId: s.variantA,
        attendu: 10,
        compte: 8,
        quantiteAvantCloture: 10,
        delta: -2,
      }),
    ])
    expect(corps.nonComptes).toBe(1)
    expect(corps.mouvements).toBe(1)

    expect(await lireNiveau(s.entrepotId, s.variantA)).toEqual({
      quantity: 8,
      avgCost: 100,
    })
    // La ligne non comptée (variantB) n'a pas bougé
    expect(await lireNiveau(s.entrepotId, s.variantB)).toEqual({
      quantity: 5,
      avgCost: 200,
    })

    const db = drizzle(env.DB, { schema })
    const mouvements = await db
      .select()
      .from(schema.stockMovements)
      .where(
        and(
          eq(schema.stockMovements.refType, "inventory_count"),
          eq(schema.stockMovements.refId, id)
        )
      )
    expect(mouvements).toEqual([
      expect.objectContaining({
        type: "count",
        delta: -2,
        variantId: s.variantA,
        warehouseId: s.entrepotId,
        reason: "Clôture d'inventaire",
      }),
    ])

    const detail = await req(s.ownerCookie, "GET", `/api/v1/inventory-counts/${id}`)
    const { count } = await detail.json<{
      count: { status: string; closedAt: string | null }
    }>()
    expect(count.status).toBe("closed")
    expect(count.closedAt).not.toBeNull()
  })

  it("pas de faux écart : une vente pendant l'inventaire, compté = stock réel → aucun mouvement", async () => {
    const s = await seed()
    const { id, lignes } = await ouvrir(s)
    // « Vente » pendant l'inventaire : -3 sur A (10 → 7)
    const db = drizzle(env.DB, { schema })
    await applyMovements(db, {
      organizationId: s.organizationId,
      userId: s.ownerId,
      mouvements: [
        {
          warehouseId: s.entrepotId,
          variantId: s.variantA,
          delta: -3,
          type: "adjustment",
          reason: "vente pendant inventaire",
        },
      ],
    })
    // Le magasinier compte 7 : c'est exact, malgré l'attendu figé à 10
    await compter(s, id, lignes.get(s.variantA) ?? "", 7)

    const res = await req(
      s.ownerCookie,
      "POST",
      `/api/v1/inventory-counts/${id}/close`
    )
    const corps = await res.json<ReponseCloture>()
    expect(corps.ecarts).toEqual([])
    expect(corps.mouvements).toBe(0)
    expect(await lireNiveau(s.entrepotId, s.variantA)).toEqual({
      quantity: 7,
      avgCost: 100,
    })
  })

  it("écart sur mouvement net : vente -3 pendant l'inventaire, compté 6 → delta -1 (pas -4)", async () => {
    const s = await seed()
    const { id, lignes } = await ouvrir(s)
    const db = drizzle(env.DB, { schema })
    await applyMovements(db, {
      organizationId: s.organizationId,
      userId: s.ownerId,
      mouvements: [
        {
          warehouseId: s.entrepotId,
          variantId: s.variantA,
          delta: -3,
          type: "adjustment",
          reason: "vente pendant inventaire",
        },
      ],
    })
    await compter(s, id, lignes.get(s.variantA) ?? "", 6)
    const res = await req(
      s.ownerCookie,
      "POST",
      `/api/v1/inventory-counts/${id}/close`
    )
    const corps = await res.json<ReponseCloture>()
    expect(corps.ecarts).toEqual([
      expect.objectContaining({
        attendu: 10,
        compte: 6,
        quantiteAvantCloture: 7,
        delta: -1,
      }),
    ])
    expect(await lireNiveau(s.entrepotId, s.variantA)).toEqual({
      quantity: 6,
      avgCost: 100,
    })
  })

  it("surplus : compté 12 pour 10 → delta +2, le CMP ne bouge pas", async () => {
    const s = await seed()
    const { id, lignes } = await ouvrir(s)
    await compter(s, id, lignes.get(s.variantA) ?? "", 12)
    const res = await req(
      s.ownerCookie,
      "POST",
      `/api/v1/inventory-counts/${id}/close`
    )
    const corps = await res.json<ReponseCloture>()
    expect(corps.ecarts).toEqual([
      expect.objectContaining({ delta: 2 }),
    ])
    expect(await lireNiveau(s.entrepotId, s.variantA)).toEqual({
      quantity: 12,
      avgCost: 100,
    })
  })

  it("clôture sans aucun écart ni comptage : document clos, zéro mouvement", async () => {
    const s = await seed()
    const { id } = await ouvrir(s)
    const res = await req(
      s.ownerCookie,
      "POST",
      `/api/v1/inventory-counts/${id}/close`
    )
    expect(res.status).toBe(200)
    const corps = await res.json<ReponseCloture>()
    expect(corps).toEqual(
      expect.objectContaining({ ecarts: [], nonComptes: 2, mouvements: 0 })
    )
  })

  it("double clôture → 409 INVENTAIRE_CLOS, et les mouvements ne sont pas rejoués", async () => {
    const s = await seed()
    const { id, lignes } = await ouvrir(s)
    await compter(s, id, lignes.get(s.variantA) ?? "", 8)
    expect(
      (
        await req(s.ownerCookie, "POST", `/api/v1/inventory-counts/${id}/close`)
      ).status
    ).toBe(200)
    const rejoue = await req(
      s.ownerCookie,
      "POST",
      `/api/v1/inventory-counts/${id}/close`
    )
    expect(rejoue.status).toBe(409)
    expect((await rejoue.json<{ code: string }>()).code).toBe(
      "INVENTAIRE_CLOS"
    )
    expect(await lireNiveau(s.entrepotId, s.variantA)).toEqual({
      quantity: 8,
      avgCost: 100,
    })
  })

  it("matrice : manager de l'entrepôt clôt, manager d'un autre entrepôt 403", async () => {
    const s = await seed()
    const { id } = await ouvrir(s)
    const autreEntrepot = await creerEntrepot(s.organizationId, "Autre")
    const managerAilleurs = await createUserWithRole(s.organizationId, "staff")
    await affecterEntrepot(
      s.organizationId,
      managerAilleurs.userId,
      autreEntrepot,
      "manager"
    )
    const manager = await createUserWithRole(s.organizationId, "staff")
    await affecterEntrepot(s.organizationId, manager.userId, s.entrepotId, "manager")
    expect(
      (
        await req(
          managerAilleurs.cookie,
          "POST",
          `/api/v1/inventory-counts/${id}/close`
        )
      ).status
    ).toBe(403)
    expect(
      (
        await req(manager.cookie, "POST", `/api/v1/inventory-counts/${id}/close`)
      ).status
    ).toBe(200)
  })
})
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd apps/api && bunx vitest run test/inventory-close.test.ts`
Expected: FAIL — `POST /:id/close` renvoie 404.

- [ ] **Step 3 : Ajouter la route `close`**

Dans `apps/api/src/routes/inventory-counts.ts`, compléter les imports :

```ts
import { applyMovements, ErreurStockInsuffisant } from "../services/stock"
import type { MouvementStock } from "../services/stock"
import { reponseStockInsuffisant } from "../lib/stock-erreurs"
```

Ajouter la route après le PATCH :

```ts
inventoryCountsRoute.post("/:id/close", async (c) => {
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const inventaire = await inventaireScope(db, organizationId, c.req.param("id"))
  if (!inventaire) {
    return c.json(
      { code: "INTROUVABLE", message: "Inventaire introuvable" },
      404
    )
  }
  const refus = await verifierAccesEntrepot(c, inventaire.warehouseId, [
    "manager",
  ])
  if (refus) return refus
  if (inventaire.status !== "open") {
    return c.json(REPONSE_INVENTAIRE_CLOS, 409)
  }
  const items = await db
    .select()
    .from(schema.inventoryCountItems)
    .where(eq(schema.inventoryCountItems.countId, inventaire.id))
  const niveaux = await db
    .select({
      variantId: schema.stockLevels.variantId,
      quantity: schema.stockLevels.quantity,
    })
    .from(schema.stockLevels)
    .where(
      and(
        eq(schema.stockLevels.organizationId, organizationId),
        eq(schema.stockLevels.warehouseId, inventaire.warehouseId)
      )
    )
  const quantiteParVariante = new Map(
    niveaux.map((n) => [n.variantId, n.quantity])
  )

  // Écart calculé contre la quantité COURANTE (= attendu à l'ouverture +
  // mouvement net depuis — spec §5) : les ventes pendant l'inventaire ne
  // créent pas de faux écarts. LIMITE ASSUMÉE (v1) : la quantité courante
  // est lue juste avant le batch — un mouvement commité dans cette fenêtre
  // de quelques millisecondes fausserait l'écart d'autant ; l'invariant
  // journal = niveaux reste, lui, garanti (le delta est appliqué
  // RELATIVEMENT par applyMovements), et /stock/reconcile permet de
  // vérifier. Les lignes non comptées (countedQuantity null) sont ignorées.
  type Ecart = {
    variantId: string
    attendu: number
    compte: number
    quantiteAvantCloture: number
    delta: number
  }
  const ecarts: Ecart[] = []
  let nonComptes = 0
  for (const item of items) {
    if (item.countedQuantity === null) {
      nonComptes += 1
      continue
    }
    const quantiteAvantCloture = quantiteParVariante.get(item.variantId) ?? 0
    const delta = item.countedQuantity - quantiteAvantCloture
    if (delta === 0) continue
    ecarts.push({
      variantId: item.variantId,
      attendu: item.expectedQuantity,
      compte: item.countedQuantity,
      quantiteAvantCloture,
      delta,
    })
  }

  const maintenant = new Date()
  // Passage closed SANS filtre de statut : une clôture concurrente est tuée
  // par le trigger inventory_counts_clos_immuable, batch entier annulé.
  const majStatut = db
    .update(schema.inventoryCounts)
    .set({
      status: "closed",
      closedBy: c.get("user").id,
      closedAt: maintenant,
      updatedAt: maintenant,
    })
    .where(eq(schema.inventoryCounts.id, inventaire.id))

  if (ecarts.length === 0) {
    // Aucun mouvement à écrire : applyMovements exige au moins un mouvement,
    // on clôt le document seul (le trigger protège toujours la course).
    try {
      await db.batch([majStatut])
    } catch (err) {
      if (estErreurDeclencheur(err, "INVENTAIRE_CLOS")) {
        return c.json(REPONSE_INVENTAIRE_CLOS, 409)
      }
      throw err
    }
    return c.json({ ok: true, ecarts: [], nonComptes, mouvements: 0 })
  }

  const mouvements: MouvementStock[] = ecarts.map((e) => ({
    warehouseId: inventaire.warehouseId,
    variantId: e.variantId,
    delta: e.delta,
    type: "count",
    reason: "Clôture d'inventaire",
    refType: "inventory_count",
    refId: inventaire.id,
  }))
  try {
    await applyMovements(db, {
      organizationId,
      userId: c.get("user").id,
      mouvements,
      instructionsAvant: [majStatut],
      date: maintenant,
    })
  } catch (err) {
    if (estErreurDeclencheur(err, "INVENTAIRE_CLOS")) {
      return c.json(REPONSE_INVENTAIRE_CLOS, 409)
    }
    if (err instanceof ErreurStockInsuffisant) {
      // Course rarissime : un mouvement concurrent a rendu un delta négatif
      // inapplicable entre notre lecture et le batch. Rejouable sans risque.
      return reponseStockInsuffisant(c, db, err)
    }
    throw err
  }

  // Récapitulatif enrichi (noms, SKU) pour l'écran de clôture
  const variantIds = ecarts.map((e) => e.variantId)
  const variantes = await db
    .select({
      id: schema.productVariants.id,
      sku: schema.productVariants.sku,
      variantName: schema.productVariants.name,
      productName: schema.products.name,
    })
    .from(schema.productVariants)
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id)
    )
    .where(inArray(schema.productVariants.id, variantIds))
  return c.json({
    ok: true,
    ecarts: ecarts.map((e) => {
      const variante = variantes.find((v) => v.id === e.variantId)
      return {
        ...e,
        sku: variante?.sku ?? null,
        variantName: variante?.variantName ?? null,
        productName: variante?.productName ?? null,
      }
    }),
    nonComptes,
    mouvements: mouvements.length,
  })
})
```

- [ ] **Step 4 : Vérifier**

Run: `cd apps/api && bunx vitest run test/inventory-close.test.ts test/inventory-draft.test.ts`
Expected: PASS.

Run: `bun run --cwd apps/api test && bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add apps/api/src/routes/inventory-counts.ts apps/api/test/inventory-close.test.ts
git commit -m "feat(api): clôture d'inventaire — écarts sur mouvement net, mouvements count atomiques, récapitulatif"
```

---

### Task 11: Web — écrans transferts (liste, brouillon, expédition, réception, annulation)

Deux écrans calqués sur les réceptions (`apps/web/src/routes/_app/stock/receptions/*`) : liste avec filtre de statut et dialogue de création, détail avec édition des lignes en brouillon (lot sélectionnable pour les produits suivis), expédition, réception avec saisie des quantités reçues (écarts), annulation. La logique de préparation de la réception est un helper pur testé.

**Files:**
- Create: `apps/web/src/lib/transferts.ts`
- Test: `apps/web/src/lib/transferts.test.ts`
- Create: `apps/web/src/routes/_app/stock/transferts/index.tsx`
- Create: `apps/web/src/routes/_app/stock/transferts/$transferId.tsx`
- Modify: `apps/web/src/routes/_app.tsx` (lien « Transferts » dans la nav, après « Réceptions »)

**Interfaces:**
- Consomme : API transferts (Tasks 5-7) ; `useAccesStock`, `useEntrepotsVisibles`, `ErreurChargement` (Task 2) ; `formaterMontant`, `apiFetch` ; `GET /products` (recherche) et `GET /products/:id` (lots par variante).
- Produit : lib `transferts.ts` — `type StatutTransfert`, `STATUTS_TRANSFERT_FR: Record<StatutTransfert, string>`, `varianteBadgeStatut(statut): "default" | "secondary" | "destructive" | "outline"`, `preparerReception(lignes, saisies)` ; routes web `/stock/transferts` et `/stock/transferts/$transferId` (protégées par la garde Task 2).

- [ ] **Step 1 : Écrire le test du helper pur (échoue : module absent)**

Créer `apps/web/src/lib/transferts.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { preparerReception, STATUTS_TRANSFERT_FR } from "./transferts"

describe("preparerReception", () => {
  const lignes = [
    { id: "l1", quantity: 10 },
    { id: "l2", quantity: 5 },
  ]

  it("saisie vide ou égale à l'expédié = tout reçu (aucun item envoyé)", () => {
    expect(preparerReception(lignes, {})).toEqual({ ok: true, items: [] })
    expect(preparerReception(lignes, { l1: "10", l2: "" })).toEqual({
      ok: true,
      items: [],
    })
  })

  it("ne transmet que les écarts", () => {
    expect(preparerReception(lignes, { l1: "7", l2: "5" })).toEqual({
      ok: true,
      items: [{ itemId: "l1", receivedQuantity: 7 }],
    })
  })

  it("zéro reçu est une saisie valide", () => {
    expect(preparerReception(lignes, { l1: "0" })).toEqual({
      ok: true,
      items: [{ itemId: "l1", receivedQuantity: 0 }],
    })
  })

  it("refuse un reçu supérieur à l'expédié ou une saisie non entière", () => {
    const trop = preparerReception(lignes, { l2: "6" })
    expect(trop.ok).toBe(false)
    const decimal = preparerReception(lignes, { l1: "2.5" })
    expect(decimal.ok).toBe(false)
    const negatif = preparerReception(lignes, { l1: "-1" })
    expect(negatif.ok).toBe(false)
  })
})

describe("STATUTS_TRANSFERT_FR", () => {
  it("couvre les quatre statuts", () => {
    expect(Object.keys(STATUTS_TRANSFERT_FR).sort()).toEqual([
      "cancelled",
      "pending",
      "received",
      "sent",
    ])
  })
})
```

Run: `bun run --cwd apps/web test`
Expected: FAIL — module `./transferts` introuvable.

- [ ] **Step 2 : Créer `apps/web/src/lib/transferts.ts`**

```ts
export type StatutTransfert = "pending" | "sent" | "received" | "cancelled"

export const STATUTS_TRANSFERT_FR: Record<StatutTransfert, string> = {
  pending: "En attente",
  sent: "Expédié",
  received: "Réceptionné",
  cancelled: "Annulé",
}

export function varianteBadgeStatut(
  statut: StatutTransfert
): "default" | "secondary" | "destructive" | "outline" {
  switch (statut) {
    case "pending":
      return "secondary"
    case "sent":
      return "outline"
    case "received":
      return "default"
    case "cancelled":
      return "destructive"
  }
}

export type LigneTransfert = {
  id: string
  variantId: string
  productId: string
  productName: string
  variantName: string
  sku: string
  trackLots: boolean
  lotId: string | null
  lotNumber: string | null
  quantity: number
  unitCost: number | null
  receivedQuantity: number | null
}

export type TransfertDetail = {
  id: string
  fromWarehouseId: string
  fromWarehouseName: string
  toWarehouseId: string
  toWarehouseName: string
  reference: string | null
  status: StatutTransfert
  createdAt: string
  sentAt: string | null
  receivedAt: string | null
  cancelledAt: string | null
  items: LigneTransfert[]
}

export type TransfertListe = {
  id: string
  fromWarehouseId: string
  fromWarehouseName: string
  toWarehouseId: string
  toWarehouseName: string
  reference: string | null
  status: StatutTransfert
  createdAt: string
  sentAt: string | null
  receivedAt: string | null
  itemCount: number
  totalQuantity: number
}

// Valide la saisie des quantités reçues (chaînes brutes des inputs) contre
// les quantités expédiées et construit le corps de POST /receive : seuls les
// écarts sont transmis (ligne vide ou égale à l'expédié = tout reçu).
export function preparerReception(
  lignes: Array<{ id: string; quantity: number }>,
  saisies: Record<string, string>
):
  | { ok: true; items: Array<{ itemId: string; receivedQuantity: number }> }
  | { ok: false; erreur: string } {
  const items: Array<{ itemId: string; receivedQuantity: number }> = []
  for (const ligne of lignes) {
    const brut = saisies[ligne.id]
    if (brut === undefined || brut === "") continue
    const valeur = Number(brut)
    if (!Number.isInteger(valeur) || valeur < 0) {
      return {
        ok: false,
        erreur:
          "Les quantités reçues doivent être des entiers positifs ou nuls",
      }
    }
    if (valeur > ligne.quantity) {
      return {
        ok: false,
        erreur: `Quantité reçue supérieure à la quantité expédiée (${ligne.quantity})`,
      }
    }
    if (valeur !== ligne.quantity) {
      items.push({ itemId: ligne.id, receivedQuantity: valeur })
    }
  }
  return { ok: true, items }
}
```

Run: `bun run --cwd apps/web test`
Expected: PASS.

- [ ] **Step 3 : Écran liste — `apps/web/src/routes/_app/stock/transferts/index.tsx`**

```tsx
import { useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { useAccesStock } from "@/lib/permissions"
import { useEntrepotsVisibles } from "@/lib/stock"
import { STATUTS_TRANSFERT_FR, varianteBadgeStatut } from "@/lib/transferts"
import type { TransfertListe } from "@/lib/transferts"
import { ErreurChargement } from "@/components/erreur-chargement"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const Route = createFileRoute("/_app/stock/transferts/")({
  component: TransfertsPage,
})

function TransfertsPage() {
  const acces = useAccesStock()
  const { options: entrepots } = useEntrepotsVisibles()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Origines où l'utilisateur peut CRÉER un transfert (rôle sur l'ORIGINE).
  // Destinations proposées : les entrepôts visibles (limitation v1
  // documentée — l'API accepte toute destination de l'organisation).
  const entrepotsOrigine = acces.ecritureTous
    ? entrepots
    : entrepots.filter((w) => acces.entrepotsEcriture.includes(w.id))
  const peutCreer = entrepotsOrigine.length > 0

  const [statut, setStatut] = useState("")
  const transferts = useQuery({
    queryKey: ["transfers", statut],
    queryFn: () =>
      apiFetch<{ transfers: TransfertListe[] }>(
        `/api/v1/transfers${statut ? `?statut=${statut}` : ""}`
      ),
  })

  const [dialogOuvert, setDialogOuvert] = useState(false)
  const [origineId, setOrigineId] = useState("")
  const [destinationId, setDestinationId] = useState("")
  const [reference, setReference] = useState("")
  const [erreur, setErreur] = useState<string | null>(null)

  const creer = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string }>("/api/v1/transfers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromWarehouseId: origineId,
          toWarehouseId: destinationId,
          reference: reference || undefined,
        }),
      }),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ["transfers"] })
      setDialogOuvert(false)
      void navigate({
        to: "/stock/transferts/$transferId",
        params: { transferId: res.id },
      })
    },
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Transferts</h1>
        {peutCreer && (
          <Dialog open={dialogOuvert} onOpenChange={setDialogOuvert}>
            <DialogTrigger render={<Button />}>Nouveau transfert</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nouveau transfert</DialogTitle>
              </DialogHeader>
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  setErreur(null)
                  creer.mutate()
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="t-origine">Entrepôt d'origine</Label>
                  <select
                    id="t-origine"
                    required
                    value={origineId}
                    onChange={(e) => setOrigineId(e.target.value)}
                    className="h-10 rounded-md border px-2 text-sm"
                  >
                    <option value="">— choisir —</option>
                    {entrepotsOrigine.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="t-destination">Entrepôt de destination</Label>
                  <select
                    id="t-destination"
                    required
                    value={destinationId}
                    onChange={(e) => setDestinationId(e.target.value)}
                    className="h-10 rounded-md border px-2 text-sm"
                  >
                    <option value="">— choisir —</option>
                    {entrepots
                      .filter((w) => w.id !== origineId)
                      .map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="t-reference">Référence (optionnel)</Label>
                  <Input
                    id="t-reference"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </div>
                {erreur && (
                  <p role="alert" className="text-sm text-red-700">
                    {erreur}
                  </p>
                )}
                <Button type="submit" disabled={creer.isPending}>
                  {creer.isPending ? "Création…" : "Créer le brouillon"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="mb-4 flex flex-col gap-1.5">
        <Label htmlFor="t-statut">Statut</Label>
        <select
          id="t-statut"
          value={statut}
          onChange={(e) => setStatut(e.target.value)}
          className="h-10 w-48 rounded-md border px-2 text-sm"
        >
          <option value="">Tous</option>
          {Object.entries(STATUTS_TRANSFERT_FR).map(([valeur, libelle]) => (
            <option key={valeur} value={valeur}>
              {libelle}
            </option>
          ))}
        </select>
      </div>

      {transferts.isPending ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : transferts.isError ? (
        <ErreurChargement
          message="Impossible de charger les transferts."
          onRetry={() => void transferts.refetch()}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Origine</TableHead>
              <TableHead>Destination</TableHead>
              <TableHead>Référence</TableHead>
              <TableHead>Lignes</TableHead>
              <TableHead>Quantité</TableHead>
              <TableHead>Statut</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(transferts.data?.transfers ?? []).map((t) => (
              <TableRow
                key={t.id}
                className="cursor-pointer"
                onClick={() =>
                  void navigate({
                    to: "/stock/transferts/$transferId",
                    params: { transferId: t.id },
                  })
                }
              >
                <TableCell className="text-sm whitespace-nowrap">
                  {new Date(t.createdAt).toLocaleDateString("fr-FR")}
                </TableCell>
                <TableCell>{t.fromWarehouseName}</TableCell>
                <TableCell className="font-medium">
                  {t.toWarehouseName}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {t.reference ?? "—"}
                </TableCell>
                <TableCell>{t.itemCount}</TableCell>
                <TableCell>{t.totalQuantity}</TableCell>
                <TableCell>
                  <Badge variant={varianteBadgeStatut(t.status)}>
                    {STATUTS_TRANSFERT_FR[t.status]}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
            {transferts.data?.transfers.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-sm text-gray-500"
                >
                  Aucun transfert.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
```

- [ ] **Step 4 : Écran détail — `apps/web/src/routes/_app/stock/transferts/$transferId.tsx`**

```tsx
import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { formaterMontant } from "@/lib/format"
import { useAccesStock } from "@/lib/permissions"
import {
  STATUTS_TRANSFERT_FR,
  preparerReception,
  varianteBadgeStatut,
} from "@/lib/transferts"
import type { LigneTransfert, TransfertDetail } from "@/lib/transferts"
import { ErreurChargement } from "@/components/erreur-chargement"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const Route = createFileRoute("/_app/stock/transferts/$transferId")({
  component: TransfertDetailPage,
})

type ProduitCatalogue = {
  id: string
  name: string
  trackLots: boolean
  variants: Array<{ id: string; name: string; sku: string; isActive: boolean }>
}

type VarianteCatalogue = {
  variantId: string
  productId: string
  libelle: string
  trackLots: boolean
}

type ProduitAvecLots = {
  product: {
    variants: Array<{
      id: string
      lots: Array<{ id: string; lotNumber: string }>
    }>
  }
}

function TransfertDetailPage() {
  const { transferId } = Route.useParams()
  const acces = useAccesStock()
  const queryClient = useQueryClient()

  const { data, isError, refetch } = useQuery({
    queryKey: ["transfer", transferId],
    queryFn: () =>
      apiFetch<{ transfer: TransfertDetail }>(`/api/v1/transfers/${transferId}`),
  })

  const invalider = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["transfer", transferId] }),
      queryClient.invalidateQueries({ queryKey: ["transfers"] }),
      queryClient.invalidateQueries({ queryKey: ["stock-levels"] }),
      queryClient.invalidateQueries({ queryKey: ["stock-alerts"] }),
      queryClient.invalidateQueries({ queryKey: ["stock-movements"] }),
      queryClient.invalidateQueries({ queryKey: ["stock-transit"] }),
    ])

  // Recherche d'article pour l'ajout de ligne
  const [rechercheArticle, setRechercheArticle] = useState("")
  const [rechercheDebouncee, setRechercheDebouncee] = useState("")
  useEffect(() => {
    const timer = setTimeout(() => setRechercheDebouncee(rechercheArticle), 300)
    return () => clearTimeout(timer)
  }, [rechercheArticle])
  const catalogue = useQuery({
    queryKey: ["products", rechercheDebouncee, "actifs"],
    queryFn: () => {
      const params = new URLSearchParams({ actifs: "true" })
      if (rechercheDebouncee) params.set("recherche", rechercheDebouncee)
      return apiFetch<{ products: ProduitCatalogue[] }>(
        `/api/v1/products?${params.toString()}`
      )
    },
  })
  const variantes: VarianteCatalogue[] = (
    catalogue.data?.products ?? []
  ).flatMap((p) =>
    p.variants
      .filter((v) => v.isActive)
      .map((v) => ({
        variantId: v.id,
        productId: p.id,
        libelle: `${p.name} — ${v.name} (${v.sku})`,
        trackLots: p.trackLots,
      }))
  )

  // Dialogue de ligne (création si ligneEditee === null, édition sinon)
  const [dialogLigne, setDialogLigne] = useState(false)
  const [ligneEditee, setLigneEditee] = useState<LigneTransfert | null>(null)
  const [variantId, setVariantId] = useState("")
  const [quantite, setQuantite] = useState("")
  const [lotId, setLotId] = useState("")
  const [erreurLigne, setErreurLigne] = useState<string | null>(null)

  const varianteChoisie = variantes.find((v) => v.variantId === variantId)
  const suitLots = ligneEditee
    ? ligneEditee.trackLots
    : (varianteChoisie?.trackLots ?? false)
  // Lots disponibles pour la variante de la ligne (le lot est global à la
  // variante) : chargés depuis la fiche produit.
  const produitIdPourLots = ligneEditee
    ? ligneEditee.trackLots
      ? ligneEditee.productId
      : ""
    : varianteChoisie?.trackLots
      ? varianteChoisie.productId
      : ""
  const varianteIdPourLots = ligneEditee ? ligneEditee.variantId : variantId
  const produitLots = useQuery({
    queryKey: ["product", produitIdPourLots],
    queryFn: () =>
      apiFetch<ProduitAvecLots>(`/api/v1/products/${produitIdPourLots}`),
    enabled: produitIdPourLots !== "",
  })
  const lotsDisponibles =
    produitLots.data?.product.variants.find((v) => v.id === varianteIdPourLots)
      ?.lots ?? []

  function ouvrirCreation() {
    setLigneEditee(null)
    setVariantId("")
    setQuantite("")
    setLotId("")
    setErreurLigne(null)
    setDialogLigne(true)
  }

  function ouvrirEdition(ligne: LigneTransfert) {
    setLigneEditee(ligne)
    setVariantId(ligne.variantId)
    setQuantite(String(ligne.quantity))
    setLotId(ligne.lotId ?? "")
    setErreurLigne(null)
    setDialogLigne(true)
  }

  const enregistrerLigne = useMutation({
    mutationFn: () => {
      if (ligneEditee) {
        return apiFetch(
          `/api/v1/transfers/${transferId}/items/${ligneEditee.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              quantity: Number(quantite),
              ...(ligneEditee.trackLots ? { lotId: lotId || null } : {}),
            }),
          }
        )
      }
      return apiFetch(`/api/v1/transfers/${transferId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          variantId,
          quantity: Number(quantite),
          lotId: suitLots && lotId ? lotId : undefined,
        }),
      })
    },
    onSuccess: async () => {
      await invalider()
      setDialogLigne(false)
    },
    onError: (err) =>
      setErreurLigne(err instanceof Error ? err.message : "Erreur"),
  })

  const supprimerLigne = useMutation({
    mutationFn: (itemId: string) =>
      apiFetch(`/api/v1/transfers/${transferId}/items/${itemId}`, {
        method: "DELETE",
      }),
    onSuccess: invalider,
    onError: (err) => alert(err instanceof Error ? err.message : "Erreur"),
  })

  const [erreurAction, setErreurAction] = useState<string | null>(null)
  const expedier = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/transfers/${transferId}/send`, { method: "POST" }),
    onSuccess: invalider,
    onError: (err) =>
      setErreurAction(err instanceof Error ? err.message : "Erreur"),
  })
  const annuler = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/transfers/${transferId}/cancel`, { method: "POST" }),
    onSuccess: invalider,
    onError: (err) =>
      setErreurAction(err instanceof Error ? err.message : "Erreur"),
  })

  // Dialogue de réception : saisie des quantités reçues par ligne
  const [dialogReception, setDialogReception] = useState(false)
  const [saisiesRecues, setSaisiesRecues] = useState<Record<string, string>>({})
  const [erreurReception, setErreurReception] = useState<string | null>(null)
  const receptionner = useMutation({
    mutationFn: (corps: {
      items: Array<{ itemId: string; receivedQuantity: number }>
    }) =>
      apiFetch(`/api/v1/transfers/${transferId}/receive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corps),
      }),
    onSuccess: async () => {
      await invalider()
      setDialogReception(false)
    },
    onError: (err) =>
      setErreurReception(err instanceof Error ? err.message : "Erreur"),
  })

  if (isError) {
    return (
      <ErreurChargement
        message="Impossible de charger le transfert."
        onRetry={() => void refetch()}
      />
    )
  }
  if (!data) {
    return <p className="text-sm text-gray-500">Chargement…</p>
  }
  const transfert = data.transfer
  const brouillon = transfert.status === "pending"
  const expedie = transfert.status === "sent"
  const peutEcrireOrigine =
    acces.ecritureTous ||
    acces.entrepotsEcriture.includes(transfert.fromWarehouseId)
  const peutEcrireDestination =
    acces.ecritureTous ||
    acces.entrepotsEcriture.includes(transfert.toWarehouseId)

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <h1 className="text-xl font-semibold">
          Transfert — {transfert.fromWarehouseName} →{" "}
          {transfert.toWarehouseName}
        </h1>
        <Badge variant={varianteBadgeStatut(transfert.status)}>
          {STATUTS_TRANSFERT_FR[transfert.status]}
        </Badge>
      </div>
      <p className="mb-6 text-sm text-gray-500">
        {transfert.reference ? `Réf. ${transfert.reference} — ` : ""}
        créé le {new Date(transfert.createdAt).toLocaleString("fr-FR")}
        {transfert.sentAt
          ? ` — expédié le ${new Date(transfert.sentAt).toLocaleString("fr-FR")}`
          : ""}
        {transfert.receivedAt
          ? ` — réceptionné le ${new Date(transfert.receivedAt).toLocaleString("fr-FR")}`
          : ""}
        {transfert.cancelledAt
          ? ` — annulé le ${new Date(transfert.cancelledAt).toLocaleString("fr-FR")}`
          : ""}
      </p>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">Lignes</h2>
        {brouillon && peutEcrireOrigine && (
          <Button variant="outline" size="sm" onClick={ouvrirCreation}>
            Ajouter une ligne
          </Button>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Article</TableHead>
            <TableHead>Quantité</TableHead>
            <TableHead>Lot</TableHead>
            <TableHead>CMP figé</TableHead>
            <TableHead>Reçu</TableHead>
            {brouillon && peutEcrireOrigine && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {transfert.items.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <span className="font-medium">{item.productName}</span>{" "}
                <span className="text-sm text-gray-500">
                  {item.variantName} ({item.sku})
                </span>
              </TableCell>
              <TableCell>{item.quantity}</TableCell>
              <TableCell className="font-mono text-xs">
                {item.lotNumber ?? "—"}
              </TableCell>
              <TableCell>
                {item.unitCost === null ? "—" : formaterMontant(item.unitCost)}
              </TableCell>
              <TableCell>
                {item.receivedQuantity === null ? (
                  "—"
                ) : (
                  <span className="flex items-center gap-2">
                    {item.receivedQuantity}
                    {item.receivedQuantity < item.quantity && (
                      <Badge variant="destructive">
                        Écart −{item.quantity - item.receivedQuantity}
                      </Badge>
                    )}
                  </span>
                )}
              </TableCell>
              {brouillon && peutEcrireOrigine && (
                <TableCell>
                  <span className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => ouvrirEdition(item)}
                    >
                      Modifier
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => supprimerLigne.mutate(item.id)}
                    >
                      Retirer
                    </Button>
                  </span>
                </TableCell>
              )}
            </TableRow>
          ))}
          {transfert.items.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={brouillon && peutEcrireOrigine ? 6 : 5}
                className="text-center text-sm text-gray-500"
              >
                Aucune ligne.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {brouillon && peutEcrireOrigine && (
        <div className="mt-6 flex items-center gap-3">
          <Button
            disabled={expedier.isPending || transfert.items.length === 0}
            onClick={() => {
              setErreurAction(null)
              if (
                window.confirm(
                  "Expédier le transfert ? Le stock sortira de l'entrepôt d'origine et les lignes seront figées."
                )
              ) {
                expedier.mutate()
              }
            }}
          >
            {expedier.isPending ? "Expédition…" : "Expédier"}
          </Button>
          <Button
            variant="outline"
            disabled={annuler.isPending}
            onClick={() => {
              setErreurAction(null)
              if (window.confirm("Annuler ce transfert ?")) {
                annuler.mutate()
              }
            }}
          >
            Annuler le transfert
          </Button>
          {erreurAction && (
            <p role="alert" className="text-sm text-red-700">
              {erreurAction}
            </p>
          )}
        </div>
      )}

      {expedie && peutEcrireDestination && (
        <div className="mt-6">
          <Button
            onClick={() => {
              setErreurReception(null)
              setSaisiesRecues({})
              setDialogReception(true)
            }}
          >
            Réceptionner
          </Button>
        </div>
      )}

      {dialogLigne && (
        <Dialog
          open
          onOpenChange={(ouvert) => {
            if (!ouvert) setDialogLigne(false)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {ligneEditee ? "Modifier la ligne" : "Ajouter une ligne"}
              </DialogTitle>
            </DialogHeader>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                setErreurLigne(null)
                enregistrerLigne.mutate()
              }}
            >
              {ligneEditee ? (
                <p className="text-sm font-medium">
                  {ligneEditee.productName} — {ligneEditee.variantName} (
                  {ligneEditee.sku})
                </p>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="tl-recherche">Rechercher un article</Label>
                    <Input
                      id="tl-recherche"
                      placeholder="nom, SKU ou code-barres"
                      value={rechercheArticle}
                      onChange={(e) => setRechercheArticle(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="tl-variante">Article</Label>
                    <select
                      id="tl-variante"
                      required
                      value={variantId}
                      onChange={(e) => {
                        setVariantId(e.target.value)
                        setLotId("")
                      }}
                      className="h-10 rounded-md border px-2 text-sm"
                    >
                      <option value="">— choisir —</option>
                      {variantes.map((v) => (
                        <option key={v.variantId} value={v.variantId}>
                          {v.libelle}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tl-quantite">Quantité</Label>
                <Input
                  id="tl-quantite"
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={quantite}
                  onChange={(e) => setQuantite(e.target.value)}
                />
              </div>
              {suitLots && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="tl-lot">
                    Lot (requis avant expédition)
                  </Label>
                  <select
                    id="tl-lot"
                    value={lotId}
                    onChange={(e) => setLotId(e.target.value)}
                    className="h-10 rounded-md border px-2 text-sm"
                  >
                    <option value="">— à choisir avant expédition —</option>
                    {lotsDisponibles.map((lot) => (
                      <option key={lot.id} value={lot.id}>
                        {lot.lotNumber}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {erreurLigne && (
                <p role="alert" className="text-sm text-red-700">
                  {erreurLigne}
                </p>
              )}
              <Button type="submit" disabled={enregistrerLigne.isPending}>
                {enregistrerLigne.isPending
                  ? "Enregistrement…"
                  : ligneEditee
                    ? "Enregistrer"
                    : "Ajouter la ligne"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {dialogReception && (
        <Dialog
          open
          onOpenChange={(ouvert) => {
            if (!ouvert) setDialogReception(false)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Réceptionner le transfert</DialogTitle>
            </DialogHeader>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                setErreurReception(null)
                const prepare = preparerReception(
                  transfert.items,
                  saisiesRecues
                )
                if (!prepare.ok) {
                  setErreurReception(prepare.erreur)
                  return
                }
                receptionner.mutate({ items: prepare.items })
              }}
            >
              <p className="text-sm text-gray-500">
                Laissez vide (ou égal à l'expédié) pour une réception totale.
                Une quantité moindre trace l'écart en ajustement.
              </p>
              {transfert.items.map((item) => (
                <div key={item.id} className="flex items-center gap-3">
                  <span className="flex-1 text-sm">
                    {item.productName} — {item.variantName} (expédié :{" "}
                    {item.quantity})
                  </span>
                  <Input
                    aria-label={`Quantité reçue — ${item.sku}`}
                    type="number"
                    min={0}
                    max={item.quantity}
                    step={1}
                    className="w-24"
                    placeholder={String(item.quantity)}
                    value={saisiesRecues[item.id] ?? ""}
                    onChange={(e) =>
                      setSaisiesRecues((s) => ({
                        ...s,
                        [item.id]: e.target.value,
                      }))
                    }
                  />
                </div>
              ))}
              {erreurReception && (
                <p role="alert" className="text-sm text-red-700">
                  {erreurReception}
                </p>
              )}
              <Button type="submit" disabled={receptionner.isPending}>
                {receptionner.isPending
                  ? "Réception…"
                  : "Valider la réception"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
```

- [ ] **Step 5 : Lien de navigation**

Dans `apps/web/src/routes/_app.tsx`, après le lien « Réceptions » (ligne ~81-83) :

```tsx
                <Link to="/stock/transferts" className={lienClasses}>
                  Transferts
                </Link>
```

- [ ] **Step 6 : Vérifier**

Run: `bun run --cwd apps/web build`
Expected: build OK, routes `/stock/transferts` et `/stock/transferts/$transferId` dans `routeTree.gen.ts`.

Run: `bun run --cwd apps/web test && bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 7 : Commit**

```bash
git add apps/web/src/lib/transferts.ts apps/web/src/lib/transferts.test.ts apps/web/src/routes/_app/stock/transferts apps/web/src/routes/_app.tsx apps/web/src/routeTree.gen.ts
git commit -m "feat(web): écrans transferts — liste, brouillon, expédition, réception avec écarts, annulation"
```

---

### Task 12: Web — écrans inventaires et transit visible sur les niveaux

Liste des inventaires avec ouverture, écran de saisie de comptage (enregistrement ligne à ligne, multi-sessions), clôture avec récapitulatif des écarts (réponse de l'API affichée en dialogue), et section « En transit entrant » sur l'écran des niveaux.

**Files:**
- Create: `apps/web/src/routes/_app/stock/inventaires/index.tsx`
- Create: `apps/web/src/routes/_app/stock/inventaires/$countId.tsx`
- Modify: `apps/web/src/routes/_app/stock/index.tsx` (section transit)
- Modify: `apps/web/src/routes/_app.tsx` (lien « Inventaires » après « Transferts »)

**Interfaces:**
- Consomme : API inventaires (Tasks 9-10 — dont la réponse de clôture `{ ok, ecarts, nonComptes, mouvements }`) ; `GET /stock/transit` (Task 8) ; `useAccesStock`, `useEntrepotsVisibles`, `ErreurChargement`.
- Produit : routes web `/stock/inventaires` et `/stock/inventaires/$countId` ; la queryKey `["stock-transit"]` (invalidée par le détail transfert, Task 11).

- [ ] **Step 1 : Écran liste + ouverture — `apps/web/src/routes/_app/stock/inventaires/index.tsx`**

```tsx
import { useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { useAccesStock } from "@/lib/permissions"
import { useEntrepotsVisibles } from "@/lib/stock"
import { ErreurChargement } from "@/components/erreur-chargement"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const Route = createFileRoute("/_app/stock/inventaires/")({
  component: InventairesPage,
})

type InventaireListe = {
  id: string
  warehouseId: string
  warehouseName: string
  status: "open" | "closed"
  openedAt: string
  closedAt: string | null
  itemCount: number
  countedCount: number
}

function InventairesPage() {
  const acces = useAccesStock()
  const { options: entrepots } = useEntrepotsVisibles()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const entrepotsEcriture = acces.ecritureTous
    ? entrepots
    : entrepots.filter((w) => acces.entrepotsEcriture.includes(w.id))
  const peutOuvrir = entrepotsEcriture.length > 0

  const [statut, setStatut] = useState("")
  const inventaires = useQuery({
    queryKey: ["inventory-counts", statut],
    queryFn: () =>
      apiFetch<{ counts: InventaireListe[] }>(
        `/api/v1/inventory-counts${statut ? `?statut=${statut}` : ""}`
      ),
  })

  const [dialogOuvert, setDialogOuvert] = useState(false)
  const [entrepotId, setEntrepotId] = useState("")
  const [erreur, setErreur] = useState<string | null>(null)

  const ouvrir = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string }>("/api/v1/inventory-counts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ warehouseId: entrepotId }),
      }),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ["inventory-counts"] })
      setDialogOuvert(false)
      void navigate({
        to: "/stock/inventaires/$countId",
        params: { countId: res.id },
      })
    },
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Inventaires</h1>
        {peutOuvrir && (
          <Dialog open={dialogOuvert} onOpenChange={setDialogOuvert}>
            <DialogTrigger render={<Button />}>
              Ouvrir un inventaire
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Ouvrir un inventaire complet</DialogTitle>
              </DialogHeader>
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  setErreur(null)
                  ouvrir.mutate()
                }}
              >
                <p className="text-sm text-gray-500">
                  Les quantités attendues de TOUT l'entrepôt sont figées à
                  l'ouverture. Les ventes restent possibles pendant
                  l'inventaire.
                </p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="i-entrepot">Entrepôt</Label>
                  <select
                    id="i-entrepot"
                    required
                    value={entrepotId}
                    onChange={(e) => setEntrepotId(e.target.value)}
                    className="h-10 rounded-md border px-2 text-sm"
                  >
                    <option value="">— choisir —</option>
                    {entrepotsEcriture.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                {erreur && (
                  <p role="alert" className="text-sm text-red-700">
                    {erreur}
                  </p>
                )}
                <Button type="submit" disabled={ouvrir.isPending}>
                  {ouvrir.isPending ? "Ouverture…" : "Ouvrir l'inventaire"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="mb-4 flex flex-col gap-1.5">
        <Label htmlFor="i-statut">Statut</Label>
        <select
          id="i-statut"
          value={statut}
          onChange={(e) => setStatut(e.target.value)}
          className="h-10 w-48 rounded-md border px-2 text-sm"
        >
          <option value="">Tous</option>
          <option value="open">Ouverts</option>
          <option value="closed">Clos</option>
        </select>
      </div>

      {inventaires.isPending ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : inventaires.isError ? (
        <ErreurChargement
          message="Impossible de charger les inventaires."
          onRetry={() => void inventaires.refetch()}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ouvert le</TableHead>
              <TableHead>Entrepôt</TableHead>
              <TableHead>Avancement</TableHead>
              <TableHead>Clos le</TableHead>
              <TableHead>Statut</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(inventaires.data?.counts ?? []).map((i) => (
              <TableRow
                key={i.id}
                className="cursor-pointer"
                onClick={() =>
                  void navigate({
                    to: "/stock/inventaires/$countId",
                    params: { countId: i.id },
                  })
                }
              >
                <TableCell className="text-sm whitespace-nowrap">
                  {new Date(i.openedAt).toLocaleString("fr-FR")}
                </TableCell>
                <TableCell className="font-medium">{i.warehouseName}</TableCell>
                <TableCell>
                  {i.countedCount} / {i.itemCount} compté
                  {i.countedCount > 1 ? "s" : ""}
                </TableCell>
                <TableCell className="text-sm whitespace-nowrap">
                  {i.closedAt
                    ? new Date(i.closedAt).toLocaleString("fr-FR")
                    : "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={i.status === "open" ? "secondary" : "default"}>
                    {i.status === "open" ? "Ouvert" : "Clos"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
            {inventaires.data?.counts.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-sm text-gray-500"
                >
                  Aucun inventaire.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
```

- [ ] **Step 2 : Écran de saisie + clôture — `apps/web/src/routes/_app/stock/inventaires/$countId.tsx`**

```tsx
import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { useAccesStock } from "@/lib/permissions"
import { ErreurChargement } from "@/components/erreur-chargement"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const Route = createFileRoute("/_app/stock/inventaires/$countId")({
  component: InventaireDetailPage,
})

type LigneInventaire = {
  id: string
  variantId: string
  productName: string
  variantName: string
  sku: string
  expectedQuantity: number
  countedQuantity: number | null
}

type Inventaire = {
  id: string
  warehouseId: string
  warehouseName: string
  status: "open" | "closed"
  openedAt: string
  closedAt: string | null
  items: LigneInventaire[]
}

type EcartCloture = {
  variantId: string
  productName: string | null
  variantName: string | null
  sku: string | null
  attendu: number
  compte: number
  quantiteAvantCloture: number
  delta: number
}

type ReponseCloture = {
  ok: boolean
  ecarts: EcartCloture[]
  nonComptes: number
  mouvements: number
}

function InventaireDetailPage() {
  const { countId } = Route.useParams()
  const acces = useAccesStock()
  const queryClient = useQueryClient()

  const { data, isError, refetch } = useQuery({
    queryKey: ["inventory-count", countId],
    queryFn: () =>
      apiFetch<{ count: Inventaire }>(`/api/v1/inventory-counts/${countId}`),
  })

  const invalider = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["inventory-count", countId] }),
      queryClient.invalidateQueries({ queryKey: ["inventory-counts"] }),
      queryClient.invalidateQueries({ queryKey: ["stock-levels"] }),
      queryClient.invalidateQueries({ queryKey: ["stock-alerts"] }),
      queryClient.invalidateQueries({ queryKey: ["stock-movements"] }),
    ])

  // Saisies locales (chaînes brutes) par ligne ; la valeur serveur reste la
  // référence tant que la ligne n'est pas enregistrée.
  const [saisies, setSaisies] = useState<Record<string, string>>({})
  const [erreurLigne, setErreurLigne] = useState<string | null>(null)
  const enregistrer = useMutation({
    mutationFn: (v: { itemId: string; countedQuantity: number | null }) =>
      apiFetch(`/api/v1/inventory-counts/${countId}/items/${v.itemId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ countedQuantity: v.countedQuantity }),
      }),
    onSuccess: async (_res, v) => {
      await invalider()
      setSaisies((s) => {
        const reste = { ...s }
        // La valeur serveur fraîchement invalidée redevient la référence
        delete reste[v.itemId]
        return reste
      })
    },
    onError: (err) =>
      setErreurLigne(err instanceof Error ? err.message : "Erreur"),
  })

  const [recap, setRecap] = useState<ReponseCloture | null>(null)
  const [erreurCloture, setErreurCloture] = useState<string | null>(null)
  const cloturer = useMutation({
    mutationFn: () =>
      apiFetch<ReponseCloture>(`/api/v1/inventory-counts/${countId}/close`, {
        method: "POST",
      }),
    onSuccess: async (res) => {
      await invalider()
      setRecap(res)
    },
    onError: (err) =>
      setErreurCloture(err instanceof Error ? err.message : "Erreur"),
  })

  if (isError) {
    return (
      <ErreurChargement
        message="Impossible de charger l'inventaire."
        onRetry={() => void refetch()}
      />
    )
  }
  if (!data) {
    return <p className="text-sm text-gray-500">Chargement…</p>
  }
  const inventaire = data.count
  const ouvert = inventaire.status === "open"
  const peutEcrire =
    acces.ecritureTous ||
    acces.entrepotsEcriture.includes(inventaire.warehouseId)
  const nonComptes = inventaire.items.filter(
    (i) => i.countedQuantity === null
  ).length

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <h1 className="text-xl font-semibold">
          Inventaire — {inventaire.warehouseName}
        </h1>
        <Badge variant={ouvert ? "secondary" : "default"}>
          {ouvert ? "Ouvert" : "Clos"}
        </Badge>
      </div>
      <p className="mb-6 text-sm text-gray-500">
        Ouvert le {new Date(inventaire.openedAt).toLocaleString("fr-FR")}
        {inventaire.closedAt
          ? ` — clos le ${new Date(inventaire.closedAt).toLocaleString("fr-FR")}`
          : ` — ${nonComptes} ligne${nonComptes > 1 ? "s" : ""} restant à compter`}
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Article</TableHead>
            <TableHead>Attendu (à l'ouverture)</TableHead>
            <TableHead>Compté</TableHead>
            {ouvert && peutEcrire && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {inventaire.items.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <span className="font-medium">{item.productName}</span>{" "}
                <span className="text-sm text-gray-500">
                  {item.variantName} ({item.sku})
                </span>
              </TableCell>
              <TableCell>{item.expectedQuantity}</TableCell>
              <TableCell>
                {ouvert && peutEcrire ? (
                  <Input
                    aria-label={`Quantité comptée — ${item.sku}`}
                    type="number"
                    min={0}
                    step={1}
                    className="w-24"
                    value={
                      saisies[item.id] ??
                      (item.countedQuantity === null
                        ? ""
                        : String(item.countedQuantity))
                    }
                    onChange={(e) =>
                      setSaisies((s) => ({ ...s, [item.id]: e.target.value }))
                    }
                  />
                ) : item.countedQuantity === null ? (
                  "— (non compté)"
                ) : (
                  item.countedQuantity
                )}
              </TableCell>
              {ouvert && peutEcrire && (
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      enregistrer.isPending || saisies[item.id] === undefined
                    }
                    onClick={() => {
                      setErreurLigne(null)
                      const brut = saisies[item.id] ?? ""
                      enregistrer.mutate({
                        itemId: item.id,
                        countedQuantity: brut === "" ? null : Number(brut),
                      })
                    }}
                  >
                    Enregistrer
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {erreurLigne && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {erreurLigne}
        </p>
      )}

      {ouvert && peutEcrire && (
        <div className="mt-6 flex items-center gap-3">
          <Button
            disabled={cloturer.isPending}
            onClick={() => {
              setErreurCloture(null)
              if (
                window.confirm(
                  `Clôturer l'inventaire ? Les écarts génèreront des mouvements de stock.${
                    nonComptes > 0
                      ? ` ${nonComptes} ligne(s) non comptée(s) seront ignorées.`
                      : ""
                  }`
                )
              ) {
                cloturer.mutate()
              }
            }}
          >
            {cloturer.isPending ? "Clôture…" : "Clôturer l'inventaire"}
          </Button>
          {erreurCloture && (
            <p role="alert" className="text-sm text-red-700">
              {erreurCloture}
            </p>
          )}
        </div>
      )}

      {recap !== null && (
        <Dialog
          open
          onOpenChange={(ouvertDialog) => {
            if (!ouvertDialog) setRecap(null)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Récapitulatif de clôture</DialogTitle>
            </DialogHeader>
            {recap.ecarts.length === 0 ? (
              <p className="text-sm">
                Aucun écart : le stock correspond au comptage.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Article</TableHead>
                    <TableHead>Compté</TableHead>
                    <TableHead>Stock avant clôture</TableHead>
                    <TableHead>Écart appliqué</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recap.ecarts.map((e) => (
                    <TableRow key={e.variantId}>
                      <TableCell className="text-sm">
                        {e.productName ?? e.variantId}{" "}
                        <span className="text-gray-500">
                          {e.sku ? `(${e.sku})` : ""}
                        </span>
                      </TableCell>
                      <TableCell>{e.compte}</TableCell>
                      <TableCell>{e.quantiteAvantCloture}</TableCell>
                      <TableCell
                        className={
                          e.delta > 0
                            ? "font-medium text-green-700"
                            : "font-medium text-red-700"
                        }
                      >
                        {e.delta > 0 ? `+${e.delta}` : e.delta}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <p className="text-sm text-gray-500">
              {recap.mouvements} mouvement{recap.mouvements > 1 ? "s" : ""} de
              stock généré{recap.mouvements > 1 ? "s" : ""}
              {recap.nonComptes > 0
                ? ` — ${recap.nonComptes} ligne(s) non comptée(s) ignorée(s)`
                : ""}
              .
            </p>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
```

- [ ] **Step 3 : Transit sur l'écran des niveaux**

Dans `apps/web/src/routes/_app/stock/index.tsx` :

1. Ajouter la requête après la requête `niveaux` (ligne ~65) :

```tsx
  type LigneTransit = {
    transferId: string
    reference: string | null
    fromWarehouseName: string
    sentAt: string | null
    variantId: string
    productName: string
    variantName: string
    sku: string
    lotNumber: string | null
    quantity: number
  }
  const transit = useQuery({
    queryKey: ["stock-transit", entrepotId],
    queryFn: () =>
      apiFetch<{ transit: LigneTransit[] }>(
        `/api/v1/stock/transit?warehouseId=${entrepotId}`
      ),
    enabled: entrepotId !== "",
  })
```

2. Insérer la section juste au-dessus du bloc `{entrepotsEnCours || niveaux.isPending ? (` :

```tsx
      {(transit.data?.transit.length ?? 0) > 0 && (
        <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 p-4">
          <h2 className="mb-2 text-sm font-semibold">
            En transit entrant ({transit.data?.transit.length})
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {(transit.data?.transit ?? []).map((l, index) => (
              <li key={`${l.transferId}-${l.variantId}-${index}`}>
                <span className="font-medium">{l.quantity}</span> ×{" "}
                {l.productName} — {l.variantName} ({l.sku})
                {l.lotNumber ? ` — lot ${l.lotNumber}` : ""} depuis{" "}
                {l.fromWarehouseName}
                {l.sentAt
                  ? `, expédié le ${new Date(l.sentAt).toLocaleDateString("fr-FR")}`
                  : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
```

- [ ] **Step 4 : Lien de navigation**

Dans `apps/web/src/routes/_app.tsx`, après le lien « Transferts » (Task 11) :

```tsx
                <Link to="/stock/inventaires" className={lienClasses}>
                  Inventaires
                </Link>
```

- [ ] **Step 5 : Vérifier**

Run: `bun run --cwd apps/web build`
Expected: build OK, routes `/stock/inventaires` et `/stock/inventaires/$countId` générées.

Run: `bun run --cwd apps/web test && bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add apps/web/src/routes/_app/stock/inventaires apps/web/src/routes/_app/stock/index.tsx apps/web/src/routes/_app.tsx apps/web/src/routeTree.gen.ts
git commit -m "feat(web): écrans inventaires (ouverture, comptage, clôture avec récapitulatif) et transit entrant sur les niveaux"
```

---

### Task 13: Vérification complète, E2E navigateur, roadmap, ledger, PR

Vérification de bout en bout : suites complètes, typecheck, lint, migrations locales, scénario E2E navigateur owner + staff, mise à jour de la roadmap et du ledger, ouverture de la PR.

**Files:**
- Modify: `docs/superpowers/plans/2026-07-08-pos-stocks-roadmap.md` (cocher la Phase 5)
- Modify: `.superpowers/sdd/progress.md` (ledger Phase 5)

**Interfaces:**
- Consomme : tout le travail des Tasks 1-12.
- Produit : PR `feat/phase-5-transferts-inventaires` → `main`.

- [ ] **Step 1 : Suites complètes**

Run: `bun run test`
Expected: PASS — les 16+ suites api (≈ 165 tests attendus : 119 existants + ~46 nouveaux) et les suites web (≈ 22 tests : 16 existants + ~6 nouveaux) sont vertes. Noter les décomptes exacts pour le ledger.

Run: `bun run typecheck && bun run lint`
Expected: exit 0 partout.

- [ ] **Step 2 : Migrations locales**

Run: `bun run --cwd apps/api db:migrate:local`
Expected: migrations `0006_*` et `0007_transfer_inventory_guards` appliquées sans erreur sur la base D1 locale (les 0000-0005 sont déjà là). En cas de base locale vierge, toutes s'appliquent.

- [ ] **Step 3 : Lancer l'app en local**

Run (deux terminaux, ou en arrière-plan) : `bun run dev:api` puis `bun run dev:web`
Expected: API sur `http://localhost:8787`, SPA sur `http://localhost:3000` (proxy Vite `/api` → API locale).

- [ ] **Step 4 : E2E navigateur — parcours owner**

Avec le navigateur (compte owner existant de la base locale, ou setup complet si base vierge : organisation + entrepôts « Boutique » et « Réserve » + produit avec stock via une réception) :

1. **Prep vérifiée** : ouvrir `/administration/utilisateurs` → chaque affectation s'affiche en badge avec un bouton « × » ; retirer une affectation → elle disparaît (la recréer ensuite pour le parcours staff : employé staff **manager de « Réserve »**).
2. **Transfert brouillon** : `/stock/transferts` → « Nouveau transfert » (origine Réserve, destination Boutique, réf. `BT-E2E`) → détail : ajouter une ligne (produit standard, quantité 5) → modifier la quantité (4) → la retirer → la remettre (4).
3. **Produit suivi par lots** : ajouter une ligne d'un produit trackLots SANS lot → « Expédier » → l'erreur `LOT_REQUIS` s'affiche en français → éditer la ligne, choisir le lot → « Expédier » → statut « Expédié », CMP figé visible dans la colonne « CMP figé ».
4. **Transit** : `/stock` (entrepôt Boutique) → la section « En transit entrant » liste les lignes du transfert avec origine et date d'expédition.
5. **Réception avec écart** : détail du transfert → « Réceptionner » → saisir une quantité moindre sur une ligne (ex. 3 reçu pour 4) → valider → statut « Réceptionné », badge « Écart −1 » sur la ligne ; `/stock/mouvements` filtré sur la Boutique montre `Transfert (entrée)` +4 ET `Ajustement` −1 avec le motif d'écart ; `/stock` Boutique : quantité +3, transit disparu.
6. **Annulation** : créer un second transfert brouillon → « Annuler le transfert » → statut « Annulé », aucune écriture de stock dans `/stock/mouvements`.
7. **Inventaire** : `/stock/inventaires` → « Ouvrir un inventaire » (Réserve) → l'écran de saisie liste TOUTES les lignes de niveau avec les quantités attendues → compter une ligne juste (aucun écart attendu) et une ligne avec écart (−2) → pendant l'inventaire, faire un ajustement (−1) sur une TROISIÈME ligne via `/stock` puis la compter à sa valeur réelle → « Clôturer » → le récapitulatif n'affiche QUE la ligne en écart (−2), pas de faux écart sur la ligne ajustée ; `/stock/mouvements` montre le mouvement `Inventaire` −2 ; l'inventaire passe « Clos » et la saisie est verrouillée.
8. **Doublon d'inventaire** : tenter d'ouvrir un second inventaire sur la Réserve pendant qu'un est ouvert (avant l'étape de clôture) → message `INVENTAIRE_OUVERT` en français. (Faire ce point AVANT la clôture du 7.)

- [ ] **Step 5 : E2E navigateur — parcours staff (manager local)**

Se connecter avec l'employé staff manager de « Réserve » :

1. `/stock/transferts` : il voit les transferts touchant la Réserve ; « Nouveau transfert » ne propose que la Réserve en origine.
2. Créer un transfert Réserve → Boutique, ajouter une ligne, expédier → OK (rôle origine).
3. Ouvrir le détail : le bouton « Réceptionner » n'apparaît PAS (il n'est pas manager de la Boutique) — vérifier aussi côté API : un POST direct serait 403 (déjà pinné par les tests).
4. `/stock/inventaires` : il peut ouvrir/compter/clôturer un inventaire sur la Réserve uniquement.
5. Se connecter avec un staff SANS affectation : le menu « Stock » est absent et `/stock/transferts` en URL directe redirige vers `/` (garde beforeLoad).

Corriger tout écart découvert (fix + test si API) avant de continuer.

- [ ] **Step 6 : Roadmap et ledger**

Dans `docs/superpowers/plans/2026-07-08-pos-stocks-roadmap.md`, cocher les quatre items de la Phase 5 (`- [x]`).

Dans `.superpowers/sdd/progress.md`, ajouter le ledger Phase 5 : une ligne par task (statut, commits, verdicts de review), les décisions actées (les 10 décisions du header de ce plan, en particulier : règle expiryDate divergent, ancrage `estErreurDeclencheur` sur `<code>: SQLITE_CONSTRAINT`, permissions origine/destination, écart de réception en `transfer_in` total + `adjustment`, LIMITE ASSUMÉE fenêtre de clôture d'inventaire, destination web limitée aux entrepôts visibles), les différés éventuels, et le bilan chiffré (tests, E2E).

- [ ] **Step 7 : Commit final et PR**

```bash
git add docs/superpowers/plans/2026-07-08-pos-stocks-roadmap.md .superpowers/sdd/progress.md
git commit -m "docs: Phase 5 terminée — roadmap cochée et ledger complété"
git push -u origin feat/phase-5-transferts-inventaires
gh pr create --base main --title "Phase 5 — Transferts & inventaires" --body "$(cat <<'EOF'
## Contenu

- Prep : différés Phase 4 soldés (contrat 404 cross-org movements/alerts, ancrage estErreurDeclencheur, règle expiryDate divergent, matrice reconcile pinnée, isError/retry + garde beforeLoad /stock, UI de retrait d'affectation)
- Transferts pending → sent → received : CMP origine figé en SQL à l'expédition et absorbé à destination, écarts de réception tracés en ajustement, annulation avant expédition, lots suivis de bout en bout, triggers d'immuabilité (0007)
- Stock en transit entrant dérivé (GET /stock/transit) et visible sur l'écran des niveaux
- Inventaires complets (v1) : ouverture figée, comptages multi-sessions, clôture en mouvements count calculés sur le mouvement net (pas de faux écarts), un seul inventaire ouvert par entrepôt (index partiel)
- Écrans web /stock/transferts et /stock/inventaires

## Vérification

- Suites api + web, typecheck, lint verts (décomptes dans le ledger)
- Migrations 0006/0007 appliquées en local
- E2E navigateur owner + staff (transfert avec lot et écart, transit, inventaire sans faux écart, permissions origine/destination, garde /stock)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR ouverte vers `main`. Ne pas merger — revue finale d'abord (motif des phases précédentes : revue whole-branch + CodeRabbit).

---

## Self-review (fait à la rédaction du plan)

- **Couverture spec/roadmap** : transferts pending→sent→received + annulation + écarts (Tasks 3, 5, 6, 7) ; valorisation CMP origine figé/absorbé (Tasks 4, 6, 7 — spec amendée `9f1ebf0`) ; stock en transit visible (Tasks 8, 12) ; inventaires complets v1, quantités figées, comptages, clôture sur mouvement net (Tasks 3, 9, 10) ; écrans (Tasks 11, 12) ; matrice §4 avec manager local origine/destination (tests Tasks 5-10) ; différés Phase 4 (Tasks 1-2) ; vérification/PR (Task 13).
- **Cohérence inter-tâches vérifiée** : `estErreurDeclencheur` (Task 1) utilisé Tasks 3, 5, 6, 7, 9, 10 avec les codes `TRANSFERT_EXPEDIE`/`TRANSFERT_TERMINE`/`INVENTAIRE_CLOS` définis en 0007 (Task 3) ; `reponseStockInsuffisant` déplacé en Task 6 et consommé Tasks 6, 10 ; `entrepotDansOrganisation` (Task 1) consommé Task 8 ; schémas Zod (Task 3) consommés Tasks 5, 7, 9 ; `preparerReception` (Task 11) aligné sur le contrat `receive` (Task 7) ; `["stock-transit"]` invalidée par le détail transfert (Task 11) et interrogée par l'écran niveaux (Task 12).
- **Pièges connus adressés** : ordre des instructions dans les batchs send/receive vs triggers (gels/lignes AVANT statut) ; corps optionnel de `receive` hors `validerCorps` ; fragment de COLONNES pour l'index partiel (`inventory_counts.warehouse_id`) ; UPDATE de transition sans filtre de statut partout ; `| null` sur tous les lookups ; alias drizzle pour la double jointure warehouses.






