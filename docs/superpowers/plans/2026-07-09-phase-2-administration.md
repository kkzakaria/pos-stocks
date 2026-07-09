# Phase 2 — Administration : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'admin gère les entrepôts/boutiques, crée les comptes de l'équipe (mot de passe provisoire à changement forcé), attribue rôles d'entreprise et affectations d'entrepôt ; chaque rôle ne voit et ne fait que ce que la matrice de permissions autorise.

**Architecture:** On étend l'API Hono existante (`apps/api`) avec les tables `warehouses`/`warehouse_members`, deux champs additionnels sur `user` (`mustChangePassword`, `isActive` via le mécanisme `additionalFields` de Better Auth), un middleware de permissions à deux niveaux (rôle d'entreprise via `member.role`, rôle d'entrepôt via `warehouse_members`), et des routes REST guardées. Le front (`apps/web`) reçoit TanStack Query, les composants shadcn/ui, une navigation par rôle et les écrans d'administration + « Mon compte ».

**Tech Stack:** existant (Hono, Better Auth 1.6.x, Drizzle/D1, vitest-pool-workers, React/Vite/TanStack Router, Tailwind 4) + TanStack Query (déjà en dépendance) + composants shadcn/ui (CLI déjà configurée via components.json).

## Global Constraints

- Interface et messages d'erreur en **français** ; codes d'erreur stables en MAJUSCULES (`ACCES_REFUSE`, `DERNIER_OWNER`, `MOT_DE_PASSE_A_CHANGER`, …)
- IDs texte via `crypto.randomUUID()` ; horodatages UTC
- **Le schéma Better Auth est GÉNÉRÉ** : toute modif passe par `auth-cli.ts` + `bunx @better-auth/cli generate` + `bun run db:generate` — jamais d'édition manuelle de `src/db/schema/auth.ts`
- Les tables métier portent `organizationId` (préparation SaaS)
- Rôles d'entreprise (`member.role`) : `owner`, `admin`, `auditor`, `stock_manager`, `staff` ; rôles d'entrepôt (`warehouse_members.role`) : `manager`, `auditor`, `cashier`
- Matrice de permissions de la spec §4 (`docs/superpowers/specs/2026-07-08-pos-stocks-design.md`) — les tests de permissions s'y réfèrent
- TDD : test d'abord pour chaque comportement d'API ; commits fréquents ; hooks husky actifs (pas de `--no-verify`)
- Toute écriture DB multi-lignes = `db.batch()` atomique
- Validation Zod dans `packages/shared` pour tout payload, messages français
- Gestionnaire de paquets : bun ; travailler sur la branche `feat/phase-2-administration`

**Prérequis exécutant** : dépôt sur `main` à jour ; `bun install` déjà fait ; les tests existants passent (`bun run test` : 16 api + 5 web).

**État de départ (fin Phase 1)** : API — `createAuth(env)` (`src/lib/auth.ts`, hook sign-up bloqué par `safeTokenEqual`), `requireAuth` (`src/middleware/require-auth.ts`, pose `c.get('user')`), routes `setup`/`me`, helper `safeTokenEqual` (`src/lib/timing-safe.ts`), `onError` global. Web — login « ticket », layout `_app` gardé, `apiFetch` (`src/lib/api.ts`), `authClient`.

---

### Task 1: Dette Phase 1 restante

**Files:**
- Modify: `apps/api/src/routes/setup.ts` (message français `CREATION_UTILISATEUR`)
- Modify: `apps/api/test/setup.test.ts`
- Modify: `apps/web/package.json` (retrait `--passWithNoTests`)
- Modify: `apps/api/.dev.vars.example` (documenter `COOKIE_DOMAIN`)
- Modify: `docs/superpowers/plans/2026-07-08-pos-stocks-roadmap.md` (annoter les décisions)

**Interfaces:**
- Produces: envelope `CREATION_UTILISATEUR` avec `message` français fixe et le détail technique déplacé dans `details`

- [ ] **Step 1: Test — le message CREATION_UTILISATEUR est en français**

Dans `apps/api/test/setup.test.ts`, remplacer l'assertion du test « retourne une erreur stable (non 500) si l'utilisateur existe déjà sans organisation (retry orphelin) » qui vérifie le message, par :

```ts
expect(body.code).toBe("CREATION_UTILISATEUR")
expect(body.message).toBe("Impossible de créer le compte utilisateur")
```

(adapter la variable au code existant du test ; il lit déjà le corps de la réponse)

- [ ] **Step 2: Vérifier l'échec**

Run: `bun run --cwd apps/api test`
Expected: FAIL — le message actuel est celui de l'APIError better-auth (anglais).

- [ ] **Step 3: Corriger setup.ts**

Dans le `catch` de `signUpEmail` (bloc qui renvoie `CREATION_UTILISATEUR`), remplacer le passage du message brut par :

```ts
return c.json(
  {
    code: "CREATION_UTILISATEUR",
    message: "Impossible de créer le compte utilisateur",
    details: err.message,
  },
  err.statusCode ?? 422,
)
```

(conserver la structure existante : `err` est l'`APIError` catché ; garder `console.error(err)` s'il existe)

- [ ] **Step 4: Retirer --passWithNoTests et documenter COOKIE_DOMAIN**

Dans `apps/web/package.json` : `"test": "vitest run"` (des tests existent désormais).
Dans `apps/api/.dev.vars.example`, ajouter à la fin :

```
# Optionnel — en prod avec domaines personnalisés : domaine racine des cookies (ex: .mondomaine.com)
# COOKIE_DOMAIN=
```

- [ ] **Step 5: Annoter la roadmap**

Dans `docs/superpowers/plans/2026-07-08-pos-stocks-roadmap.md`, item « Reprise Phase 1 » : barrer `message français sur CREATION_UTILISATEUR`, `suppression de --passWithNoTests`, `COOKIE_DOMAIN documenté` (✅ 2026-07-09). Annoter :
- « dépendances web inutilisées » → **conservées volontairement** : les composants shadcn/ui ajoutés en Phase 2 requièrent `@base-ui/react`, `class-variance-authority`, `clsx`, `tailwind-merge` (et `lucide-react` est utilisé depuis la refonte login)
- « drop de l'index dupliqué organization_slug_uidx » → **non traité volontairement** : le schéma est régénéré par la CLI Better Auth qui ré-émettrait l'index à chaque régénération (drift schéma/DB) ; quirk upstream accepté, sans impact fonctionnel

- [ ] **Step 6: Vérifier et committer**

Run: `bun run test && bun run typecheck`
Expected: 16 api + 5 web verts.

```bash
git add -A && git commit -m "chore: reprise dette Phase 1 (message FR, passWithNoTests, COOKIE_DOMAIN doc)"
```

---

### Task 2: Schéma — champs user additionnels + tables warehouses/warehouse_members

**Files:**
- Modify: `apps/api/auth-cli.ts` et `apps/api/src/lib/auth.ts` (additionalFields)
- Regenerate: `apps/api/src/db/schema/auth.ts`
- Create: `apps/api/src/db/schema/domain.ts`
- Modify: `apps/api/src/db/schema/index.ts`
- Create: migration `apps/api/drizzle/0001_*.sql` (générée)
- Modify: `apps/api/test/health.test.ts` (vérif nouvelles tables)

**Interfaces:**
- Produces: colonnes `user.must_change_password` (bool, défaut false) et `user.is_active` (bool, défaut true) ; tables Drizzle `warehouses` (id, organizationId, name, type `'warehouse'|'store'`, address nullable, isActive défaut true, createdAt, updatedAt) et `warehouseMembers` (id, organizationId, warehouseId, userId, role `'manager'|'auditor'|'cashier'`, createdAt, unique (warehouseId, userId)) exportées par `src/db/schema`
- Types exportés : `type CompanyRole = 'owner'|'admin'|'auditor'|'stock_manager'|'staff'` et `type WarehouseRole = 'manager'|'auditor'|'cashier'` depuis `packages/shared/src/index.ts` (Create: `packages/shared/src/roles.ts`)

- [ ] **Step 1: additionalFields dans les deux configs Better Auth**

Dans `apps/api/auth-cli.ts` ET dans le `betterAuth({...})` de `apps/api/src/lib/auth.ts`, ajouter au niveau racine de la config :

```ts
user: {
  additionalFields: {
    mustChangePassword: { type: "boolean", defaultValue: false, input: false },
    isActive: { type: "boolean", defaultValue: true, input: false },
  },
},
```

(`input: false` empêche un client de poser ces champs à l'inscription)

- [ ] **Step 2: Régénérer le schéma Better Auth**

```bash
cd apps/api
bunx @better-auth/cli@latest generate --config ./auth-cli.ts --output ./src/db/schema/auth.ts --yes
```

Expected: `auth.ts` régénéré contient `must_change_password` et `is_active` sur la table `user`. Au passage, vérifier si cette version de la CLI met un défaut SQL sur `session.updated_at`/`account.updated_at` : si oui, la dette « défaut updatedAt » se règle seule ; sinon la laisser annotée (ne rien éditer à la main).

- [ ] **Step 3: Tables métier**

`apps/api/src/db/schema/domain.ts` :

```ts
import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core"
import { organization, user } from "./auth"

export const warehouses = sqliteTable("warehouses", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type", { enum: ["warehouse", "store"] }).notNull(),
  address: text("address"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
})

export const warehouseMembers = sqliteTable(
  "warehouse_members",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["manager", "auditor", "cashier"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("warehouse_members_wh_user_uidx").on(t.warehouseId, t.userId)],
)
```

`apps/api/src/db/schema/index.ts` :

```ts
export * from "./auth"
export * from "./domain"
```

`packages/shared/src/roles.ts` :

```ts
export const COMPANY_ROLES = ["owner", "admin", "auditor", "stock_manager", "staff"] as const
export type CompanyRole = (typeof COMPANY_ROLES)[number]

export const WAREHOUSE_ROLES = ["manager", "auditor", "cashier"] as const
export type WarehouseRole = (typeof WAREHOUSE_ROLES)[number]
```

Ajouter à `packages/shared/src/index.ts` :

```ts
export { COMPANY_ROLES, WAREHOUSE_ROLES, type CompanyRole, type WarehouseRole } from "./roles"
```

- [ ] **Step 4: Générer et appliquer la migration, brancher le test**

```bash
bun run db:generate      # crée drizzle/0001_*.sql
bun run db:migrate:local
```

Ajouter au `describe` de `apps/api/test/health.test.ts` :

```ts
it("les tables de la Phase 2 existent", async () => {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('warehouses','warehouse_members')",
  ).all()
  expect(results).toHaveLength(2)
})
```

Run: `bun run test`
Expected: PASS (17 tests api). La migration de test est lue automatiquement (readD1Migrations lit tout le dossier).

- [ ] **Step 5: Typecheck et commit**

```bash
cd ../.. && bun run typecheck
git add -A && git commit -m "feat(api): schéma Phase 2 — champs user additionnels, warehouses, warehouse_members"
```

---

### Task 3: Comptes désactivés — hook de connexion + requireAuth

**Files:**
- Modify: `apps/api/src/lib/auth.ts` (hook before étendu à /sign-in/email)
- Modify: `apps/api/src/middleware/require-auth.ts`
- Create: `apps/api/test/compte-desactive.test.ts`

**Interfaces:**
- Consumes: `safeTokenEqual`, schéma (Task 2)
- Produces: connexion refusée (`403`, message « Compte désactivé ») pour `user.isActive = false` ; `requireAuth` renvoie `403 { code: 'COMPTE_DESACTIVE' }` si la session appartient à un compte désactivé ; `AuthUser` étendu à `{ id, email, name, mustChangePassword: boolean }`

- [ ] **Step 1: Test qui échoue**

`apps/api/test/compte-desactive.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
import app from "../src/index"
import * as schema from "../src/db/schema"

const owner = {
  organizationName: "Ma Société",
  name: "Propriétaire",
  email: "owner@exemple.com",
  password: "MotDePasseTresSolide1",
}

async function bootstrap() {
  const res = await app.request(
    "/api/v1/setup",
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-setup-token": env.SETUP_TOKEN },
      body: JSON.stringify(owner),
    },
    env,
  )
  return res.json<{ userId: string }>()
}

function signIn() {
  return app.request(
    "/api/auth/sign-in/email",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: owner.email, password: owner.password }),
    },
    env,
  )
}

describe("compte désactivé", () => {
  it("refuse la connexion d'un compte désactivé", async () => {
    const { userId } = await bootstrap()
    const db = drizzle(env.DB, { schema })
    await db.update(schema.user).set({ isActive: false }).where(eq(schema.user.id, userId))

    const res = await signIn()
    expect(res.status).toBe(403)
  })

  it("rejette une session existante après désactivation", async () => {
    const { userId } = await bootstrap()
    const cookie = (await signIn()).headers.get("set-cookie") ?? ""
    const db = drizzle(env.DB, { schema })
    await db.update(schema.user).set({ isActive: false }).where(eq(schema.user.id, userId))

    const res = await app.request("/api/v1/me", { headers: { cookie } }, env)
    expect(res.status).toBe(403)
    expect((await res.json<{ code: string }>()).code).toBe("COMPTE_DESACTIVE")
  })
})
```

- [ ] **Step 2: Vérifier l'échec**

Run: `bun run test`
Expected: FAIL — la connexion passe (200) et /me répond 200.

- [ ] **Step 3: Implémenter**

Dans `apps/api/src/lib/auth.ts`, le handler du hook `before` devient (structure actuelle conservée — un seul middleware qui aiguille selon `ctx.path`) :

```ts
handler: createAuthMiddleware(async (ctx) => {
  if (ctx.path === "/sign-up/email") {
    if (!safeTokenEqual(ctx.headers?.get("x-setup-token") ?? undefined, env.SETUP_TOKEN)) {
      throw new APIError("FORBIDDEN", { message: "L'inscription publique est désactivée" })
    }
  }
  if (ctx.path === "/sign-in/email") {
    const email = (ctx.body as { email?: string } | undefined)?.email
    if (email) {
      const rows = await db
        .select({ isActive: schema.user.isActive })
        .from(schema.user)
        .where(eq(schema.user.email, email))
        .limit(1)
      if (rows[0] && rows[0].isActive === false) {
        throw new APIError("FORBIDDEN", { message: "Compte désactivé" })
      }
    }
  }
}),
```

(le `db` drizzle est déjà construit en tête de `createAuth` ; ajouter les imports `eq` de `drizzle-orm` et `* as schema` s'ils manquent — attention : `schema` est déjà importé pour l'adapter)

Dans `apps/api/src/middleware/require-auth.ts` :

```ts
export type AuthUser = {
  id: string
  email: string
  name: string
  mustChangePassword: boolean
}
```

et après récupération de la session :

```ts
const u = session.user as typeof session.user & {
  isActive: boolean
  mustChangePassword: boolean
}
if (u.isActive === false) {
  return c.json({ code: "COMPTE_DESACTIVE", message: "Compte désactivé" }, 403)
}
c.set("user", {
  id: u.id,
  email: u.email,
  name: u.name,
  mustChangePassword: u.mustChangePassword === true,
})
```

Note : avec `additionalFields` déclarés, Better Auth type déjà ces champs sur `session.user` — si le typecheck passe sans le cast, le retirer.

- [ ] **Step 4: Vérifier**

Run: `bun run test && bun run typecheck`
Expected: PASS (19 api).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(api): blocage des comptes désactivés (connexion + sessions)"
```

---

### Task 4: Middleware de permissions à deux niveaux

**Files:**
- Create: `apps/api/src/middleware/permissions.ts`
- Create: `apps/api/test/permissions.test.ts`
- Create: `apps/api/test/helpers.ts` (bootstrap + création d'utilisateurs de test, réutilisé par les tâches suivantes)

**Interfaces:**
- Consumes: `requireAuth`/`AuthVariables`, schéma
- Produces:
  - `requireMembership` : middleware qui pose `c.set('membership', { organizationId: string, role: CompanyRole })` ; `403 { code: 'AUCUNE_ORGANISATION' }` si l'utilisateur n'a pas de membership
  - `requireRole(...roles: CompanyRole[])` : `403 { code: 'ACCES_REFUSE', message: 'Accès refusé' }` si `membership.role` absent de `roles`
  - `requireWarehouseRole(roles: WarehouseRole[], bypass: CompanyRole[] = ['owner','admin','stock_manager'])` : lit `c.req.param('warehouseId')` ; passe si `membership.role ∈ bypass`, sinon exige une ligne `warehouse_members` (userId, warehouseId) avec `role ∈ roles` ; sinon `403 ACCES_REFUSE`
  - `PermissionVariables = AuthVariables & { membership: { organizationId: string; role: CompanyRole } }`
  - Helper de test `apps/api/test/helpers.ts` : `bootstrapOwner()` → `{ ownerCookie, organizationId, ownerId }` ; `createUserWithRole(ownerCookie, role, email?)` → `{ userId, cookie }` (créé via signUpEmail avec le SETUP_TOKEN puis insertion member + sign-in)

- [ ] **Step 1: Écrire le helper de test**

`apps/api/test/helpers.ts` :

```ts
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import app from "../src/index"
import * as schema from "../src/db/schema"
import type { CompanyRole } from "shared"

export const MDP = "MotDePasseTresSolide1"

async function signInCookie(email: string): Promise<string> {
  const res = await app.request(
    "/api/auth/sign-in/email",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: MDP }),
    },
    env,
  )
  return res.headers.get("set-cookie") ?? ""
}

export async function bootstrapOwner() {
  const res = await app.request(
    "/api/v1/setup",
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-setup-token": env.SETUP_TOKEN },
      body: JSON.stringify({
        organizationName: "Ma Société",
        name: "Propriétaire",
        email: "owner@exemple.com",
        password: MDP,
      }),
    },
    env,
  )
  const body = await res.json<{ organizationId: string; userId: string }>()
  return {
    organizationId: body.organizationId,
    ownerId: body.userId,
    ownerCookie: await signInCookie("owner@exemple.com"),
  }
}

export async function createUserWithRole(
  organizationId: string,
  role: CompanyRole,
  email = `${role}-${crypto.randomUUID().slice(0, 8)}@exemple.com`,
) {
  const res = await app.request(
    "/api/auth/sign-up/email",
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-setup-token": env.SETUP_TOKEN },
      body: JSON.stringify({ email, password: MDP, name: `Test ${role}` }),
    },
    env,
  )
  const { user } = await res.json<{ user: { id: string } }>()
  const db = drizzle(env.DB, { schema })
  await db.insert(schema.member).values({
    id: crypto.randomUUID(),
    organizationId,
    userId: user.id,
    role,
    createdAt: new Date(),
  })
  return { userId: user.id, email, cookie: await signInCookie(email) }
}
```

- [ ] **Step 2: Tests de la matrice (échec)**

`apps/api/test/permissions.test.ts` — on monte des routes de test dédiées pour tester les middlewares isolément :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import * as schema from "../src/db/schema"
import { requireAuth } from "../src/middleware/require-auth"
import {
  requireMembership,
  requireRole,
  requireWarehouseRole,
  type PermissionVariables,
} from "../src/middleware/permissions"
import type { Env } from "../src/env"
import { bootstrapOwner, createUserWithRole } from "./helpers"

const testApp = new Hono<{ Bindings: Env; Variables: PermissionVariables }>()
testApp.get("/t/admin-seulement", requireAuth, requireMembership, requireRole("owner", "admin"), (c) =>
  c.json({ ok: true }),
)
testApp.get(
  "/t/entrepot/:warehouseId/vente",
  requireAuth,
  requireMembership,
  requireWarehouseRole(["manager", "cashier"]),
  (c) => c.json({ ok: true }),
)

async function creerEntrepot(organizationId: string) {
  const db = drizzle(env.DB, { schema })
  const id = crypto.randomUUID()
  await db.insert(schema.warehouses).values({
    id,
    organizationId,
    name: "Boutique Centre",
    type: "store",
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return id
}

describe("permissions", () => {
  it("requireRole : autorise owner, refuse staff avec ACCES_REFUSE", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const staff = await createUserWithRole(organizationId, "staff")

    const ok = await testApp.request("/t/admin-seulement", { headers: { cookie: ownerCookie } }, env)
    expect(ok.status).toBe(200)

    const ko = await testApp.request("/t/admin-seulement", { headers: { cookie: staff.cookie } }, env)
    expect(ko.status).toBe(403)
    expect((await ko.json<{ code: string }>()).code).toBe("ACCES_REFUSE")
  })

  it("requireWarehouseRole : caissier affecté OK, staff non affecté refusé, owner bypass", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const warehouseId = await creerEntrepot(organizationId)
    const caissier = await createUserWithRole(organizationId, "staff")
    const intrus = await createUserWithRole(organizationId, "staff")

    const db = drizzle(env.DB, { schema })
    await db.insert(schema.warehouseMembers).values({
      id: crypto.randomUUID(),
      organizationId,
      warehouseId,
      userId: caissier.userId,
      role: "cashier",
      createdAt: new Date(),
    })

    const url = `/t/entrepot/${warehouseId}/vente`
    expect((await testApp.request(url, { headers: { cookie: caissier.cookie } }, env)).status).toBe(200)
    expect((await testApp.request(url, { headers: { cookie: intrus.cookie } }, env)).status).toBe(403)
    expect((await testApp.request(url, { headers: { cookie: ownerCookie } }, env)).status).toBe(200)
  })

  it("requireMembership : 403 AUCUNE_ORGANISATION sans membership", async () => {
    await bootstrapOwner()
    // utilisateur créé SANS ligne member (directement via l'API auth, pas via helpers)
    const app = (await import("../src/index")).default
    await app.request(
      "/api/auth/sign-up/email",
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-setup-token": env.SETUP_TOKEN },
        body: JSON.stringify({ email: "sansorg@exemple.com", password: "MotDePasseTresSolide1", name: "Sans Org" }),
      },
      env,
    )
    const signIn = await app.request(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "sansorg@exemple.com", password: "MotDePasseTresSolide1" }),
      },
      env,
    )
    const cookie = signIn.headers.get("set-cookie") ?? ""
    const res = await testApp.request("/t/admin-seulement", { headers: { cookie } }, env)
    expect(res.status).toBe(403)
    expect((await res.json<{ code: string }>()).code).toBe("AUCUNE_ORGANISATION")
  })
})
```

Run: `bun run test`
Expected: FAIL — module `../src/middleware/permissions` introuvable.

- [ ] **Step 3: Implémenter les middlewares**

`apps/api/src/middleware/permissions.ts` :

```ts
import { createMiddleware } from "hono/factory"
import { drizzle } from "drizzle-orm/d1"
import { and, eq } from "drizzle-orm"
import type { CompanyRole, WarehouseRole } from "shared"
import * as schema from "../db/schema"
import type { Env } from "../env"
import type { AuthVariables } from "./require-auth"

export type Membership = { organizationId: string; role: CompanyRole }
export type PermissionVariables = AuthVariables & { membership: Membership }

type Ctx = { Bindings: Env; Variables: PermissionVariables }

export const requireMembership = createMiddleware<Ctx>(async (c, next) => {
  const user = c.get("user")
  const db = drizzle(c.env.DB, { schema })
  const rows = await db
    .select({ organizationId: schema.member.organizationId, role: schema.member.role })
    .from(schema.member)
    .where(eq(schema.member.userId, user.id))
    .limit(1)
  if (!rows[0]) {
    return c.json({ code: "AUCUNE_ORGANISATION", message: "Aucune organisation associée à ce compte" }, 403)
  }
  c.set("membership", { organizationId: rows[0].organizationId, role: rows[0].role as CompanyRole })
  await next()
})

export function requireRole(...roles: CompanyRole[]) {
  return createMiddleware<Ctx>(async (c, next) => {
    if (!roles.includes(c.get("membership").role)) {
      return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
    }
    await next()
  })
}

export function requireWarehouseRole(
  roles: WarehouseRole[],
  bypass: CompanyRole[] = ["owner", "admin", "stock_manager"],
) {
  return createMiddleware<Ctx>(async (c, next) => {
    if (bypass.includes(c.get("membership").role)) {
      await next()
      return
    }
    const warehouseId = c.req.param("warehouseId")
    if (!warehouseId) {
      return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
    }
    const db = drizzle(c.env.DB, { schema })
    const rows = await db
      .select({ role: schema.warehouseMembers.role })
      .from(schema.warehouseMembers)
      .where(
        and(
          eq(schema.warehouseMembers.warehouseId, warehouseId),
          eq(schema.warehouseMembers.userId, c.get("user").id),
        ),
      )
      .limit(1)
    if (!rows[0] || !roles.includes(rows[0].role as WarehouseRole)) {
      return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
    }
    await next()
  })
}
```

- [ ] **Step 4: Vérifier**

Run: `bun run test && bun run typecheck`
Expected: PASS (22 api).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(api): middlewares de permissions entreprise + entrepôt"
```

---

### Task 5: /me enrichi (mustChangePassword + affectations)

**Files:**
- Modify: `apps/api/src/routes/me.ts`
- Modify: `apps/api/test/me.test.ts`

**Interfaces:**
- Produces: `GET /api/v1/me` → `{ user: { id, email, name, mustChangePassword }, membership: { organizationId, organizationName, role } | null, assignments: Array<{ warehouseId, warehouseName, role }> }`

- [ ] **Step 1: Test (échec)** — ajouter au describe existant de `me.test.ts` :

```ts
it("renvoie mustChangePassword et les affectations", async () => {
  const cookie = await bootstrapAndSignIn()
  const res = await app.request("/api/v1/me", { headers: { cookie } }, env)
  const body = await res.json<{
    user: { mustChangePassword: boolean }
    assignments: Array<unknown>
  }>()
  expect(body.user.mustChangePassword).toBe(false)
  expect(body.assignments).toEqual([])
})
```

Run: `bun run test` — Expected: FAIL (`assignments` undefined).

- [ ] **Step 2: Implémenter** — dans `me.ts`, ajouter la requête d'affectations et le champ :

```ts
const assignments = await db
  .select({
    warehouseId: schema.warehouseMembers.warehouseId,
    warehouseName: schema.warehouses.name,
    role: schema.warehouseMembers.role,
  })
  .from(schema.warehouseMembers)
  .innerJoin(schema.warehouses, eq(schema.warehouseMembers.warehouseId, schema.warehouses.id))
  .where(eq(schema.warehouseMembers.userId, user.id))

return c.json({ user, membership: rows[0] ?? null, assignments })
```

(`user` porte déjà `mustChangePassword` via `AuthUser` de la Task 3)

- [ ] **Step 3: Vérifier et committer**

Run: `bun run test && bun run typecheck` — Expected: PASS (23 api).

```bash
git add -A && git commit -m "feat(api): /me enrichi (mustChangePassword, affectations)"
```

---

### Task 6: API entrepôts (CRUD)

**Files:**
- Create: `packages/shared/src/schemas/warehouse.ts` (+ export dans `packages/shared/src/index.ts`)
- Create: `apps/api/src/routes/warehouses.ts`
- Modify: `apps/api/src/index.ts` (montage)
- Create: `apps/api/test/warehouses.test.ts`

**Interfaces:**
- Consumes: middlewares (Task 4), helpers de test
- Produces: `POST /api/v1/warehouses` (owner/admin) body `{ name, type, address? }` → `201 { id }` ; `GET /api/v1/warehouses` (owner/admin/auditor/stock_manager) → `{ warehouses: [...] }` triés par nom ; `PATCH /api/v1/warehouses/:id` (owner/admin) body partiel `{ name?, type?, address?, isActive? }` → `200` ; `404 INTROUVABLE` si id inconnu dans l'organisation

- [ ] **Step 1: Schéma Zod**

`packages/shared/src/schemas/warehouse.ts` :

```ts
import { z } from "zod"

export const warehouseCreateSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis"),
  type: z.enum(["warehouse", "store"], { message: "Type invalide" }),
  address: z.string().trim().min(1).optional(),
})

export const warehouseUpdateSchema = warehouseCreateSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, { message: "Aucun champ à modifier" })

export type WarehouseCreateInput = z.infer<typeof warehouseCreateSchema>
export type WarehouseUpdateInput = z.infer<typeof warehouseUpdateSchema>
```

Export dans `packages/shared/src/index.ts` :

```ts
export {
  warehouseCreateSchema,
  warehouseUpdateSchema,
  type WarehouseCreateInput,
  type WarehouseUpdateInput,
} from "./schemas/warehouse"
```

- [ ] **Step 2: Tests (échec)**

`apps/api/test/warehouses.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import app from "../src/index"
import { bootstrapOwner, createUserWithRole } from "./helpers"

function post(cookie: string, body: unknown) {
  return app.request(
    "/api/v1/warehouses",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env,
  )
}

describe("API entrepôts", () => {
  it("owner crée puis liste ; staff refusé en écriture ET en lecture", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const staff = await createUserWithRole(organizationId, "staff")

    const created = await post(ownerCookie, { name: "Dépôt Nord", type: "warehouse" })
    expect(created.status).toBe(201)
    const { id } = await created.json<{ id: string }>()
    expect(id).toBeTruthy()

    const liste = await app.request("/api/v1/warehouses", { headers: { cookie: ownerCookie } }, env)
    expect(liste.status).toBe(200)
    const body = await liste.json<{ warehouses: Array<{ name: string; type: string }> }>()
    expect(body.warehouses).toHaveLength(1)
    expect(body.warehouses[0].name).toBe("Dépôt Nord")

    expect((await post(staff.cookie, { name: "X", type: "store" })).status).toBe(403)
    expect(
      (await app.request("/api/v1/warehouses", { headers: { cookie: staff.cookie } }, env)).status,
    ).toBe(403)
  })

  it("stock_manager lit mais n'écrit pas", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    await post(ownerCookie, { name: "Dépôt", type: "warehouse" })
    const gest = await createUserWithRole(organizationId, "stock_manager")

    expect(
      (await app.request("/api/v1/warehouses", { headers: { cookie: gest.cookie } }, env)).status,
    ).toBe(200)
    expect((await post(gest.cookie, { name: "Y", type: "store" })).status).toBe(403)
  })

  it("PATCH modifie et 404 sur id inconnu ; 400 sur payload vide", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const { id } = await (await post(ownerCookie, { name: "Boutique", type: "store" })).json<{ id: string }>()

    const patch = await app.request(
      `/api/v1/warehouses/${id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ isActive: false, name: "Boutique Sud" }),
      },
      env,
    )
    expect(patch.status).toBe(200)

    const inconnu = await app.request(
      `/api/v1/warehouses/${crypto.randomUUID()}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ name: "Z" }),
      },
      env,
    )
    expect(inconnu.status).toBe(404)

    const vide = await app.request(
      `/api/v1/warehouses/${id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({}),
      },
      env,
    )
    expect(vide.status).toBe(400)
  })
})
```

Run: `bun run test` — Expected: FAIL (404 sur les routes).

- [ ] **Step 3: Implémenter la route**

`apps/api/src/routes/warehouses.ts` :

```ts
import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, asc, eq } from "drizzle-orm"
import { warehouseCreateSchema, warehouseUpdateSchema } from "shared"
import * as schema from "../db/schema"
import { requireAuth } from "../middleware/require-auth"
import {
  requireMembership,
  requireRole,
  type PermissionVariables,
} from "../middleware/permissions"
import type { Env } from "../env"

export const warehousesRoute = new Hono<{ Bindings: Env; Variables: PermissionVariables }>()

warehousesRoute.use(requireAuth, requireMembership)

warehousesRoute.get("/", requireRole("owner", "admin", "auditor", "stock_manager"), async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const warehouses = await db
    .select()
    .from(schema.warehouses)
    .where(eq(schema.warehouses.organizationId, c.get("membership").organizationId))
    .orderBy(asc(schema.warehouses.name))
  return c.json({ warehouses })
})

warehousesRoute.post("/", requireRole("owner", "admin"), async (c) => {
  const parsed = warehouseCreateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ code: "VALIDATION", message: "Données invalides", details: parsed.error.flatten() }, 400)
  }
  const db = drizzle(c.env.DB, { schema })
  const id = crypto.randomUUID()
  const now = new Date()
  await db.insert(schema.warehouses).values({
    id,
    organizationId: c.get("membership").organizationId,
    name: parsed.data.name,
    type: parsed.data.type,
    address: parsed.data.address ?? null,
    createdAt: now,
    updatedAt: now,
  })
  return c.json({ id }, 201)
})

warehousesRoute.patch("/:id", requireRole("owner", "admin"), async (c) => {
  const parsed = warehouseUpdateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ code: "VALIDATION", message: "Données invalides", details: parsed.error.flatten() }, 400)
  }
  const db = drizzle(c.env.DB, { schema })
  const result = await db
    .update(schema.warehouses)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(
      and(
        eq(schema.warehouses.id, c.req.param("id")),
        eq(schema.warehouses.organizationId, c.get("membership").organizationId),
      ),
    )
    .returning({ id: schema.warehouses.id })
  if (result.length === 0) {
    return c.json({ code: "INTROUVABLE", message: "Entrepôt introuvable" }, 404)
  }
  return c.json({ ok: true })
})
```

Dans `apps/api/src/index.ts` :

```ts
import { warehousesRoute } from "./routes/warehouses"

app.route("/api/v1/warehouses", warehousesRoute)
```

- [ ] **Step 4: Vérifier et committer**

Run: `bun run test && bun run typecheck` — Expected: PASS (26 api).

```bash
git add -A && git commit -m "feat(api): CRUD entrepôts avec permissions"
```

---

### Task 7: API utilisateurs (création avec mot de passe provisoire, rôles, désactivation)

**Files:**
- Create: `packages/shared/src/schemas/user.ts` (+ export index)
- Create: `apps/api/src/lib/provisional-password.ts`
- Create: `apps/api/src/routes/users.ts`
- Modify: `apps/api/src/index.ts`
- Create: `apps/api/test/users.test.ts`

**Interfaces:**
- Consumes: middlewares, `safeTokenEqual` (indirect : header interne `x-setup-token` pour le hook sign-up), helpers de test
- Produces:
  - `generateProvisionalPassword(): string` — format `XXXX-XXXX-XXXX` (A-Z + 2-9 sans ambigus, via `crypto.getRandomValues`)
  - `POST /api/v1/users` (owner/admin ; créer un `admin` exige owner) body `{ name, email, role }` → `201 { userId, provisionalPassword }` ; l'utilisateur créé a `mustChangePassword = true` ; `409 EMAIL_EXISTANT` si email pris
  - `GET /api/v1/users` (owner/admin/auditor) → `{ users: [{ id, name, email, role, isActive, assignments: [{ warehouseId, warehouseName, role }] }] }`
  - `PATCH /api/v1/users/:id/role` body `{ role }` : owner peut tout ; admin ne touche ni owner/admin ni ne promeut owner/admin ; `409 DERNIER_OWNER` si on rétrograde le dernier owner
  - `PATCH /api/v1/users/:id/statut` body `{ isActive }` : owner/admin ; admin ne peut pas désactiver owner/admin ; personne ne se désactive soi-même (`400 AUTO_DESACTIVATION`) ; la désactivation supprime les sessions du compte

- [ ] **Step 1: Schémas Zod et générateur**

`packages/shared/src/schemas/user.ts` :

```ts
import { z } from "zod"
import { COMPANY_ROLES } from "../roles"

const assignableRoles = COMPANY_ROLES.filter((r) => r !== "owner")

export const userCreateSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis"),
  email: z.string().trim().email("Adresse email invalide"),
  role: z.enum(assignableRoles as [string, ...string[]], { message: "Rôle invalide" }),
})

export const userRoleSchema = z.object({
  role: z.enum(COMPANY_ROLES, { message: "Rôle invalide" }),
})

export const userStatusSchema = z.object({ isActive: z.boolean() })

export type UserCreateInput = z.infer<typeof userCreateSchema>
```

Exports dans `packages/shared/src/index.ts` :

```ts
export { userCreateSchema, userRoleSchema, userStatusSchema, type UserCreateInput } from "./schemas/user"
```

`apps/api/src/lib/provisional-password.ts` :

```ts
// Mot de passe provisoire lisible et dictable : 3 blocs de 4 caractères
// non ambigus (pas de O/0, I/1, L). Entropie ~57 bits.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

export function generateProvisionalPassword(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length])
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8).join("")}`
}
```

- [ ] **Step 2: Tests (échec)**

`apps/api/test/users.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import app from "../src/index"
import { bootstrapOwner, createUserWithRole } from "./helpers"

function createUser(cookie: string, body: unknown) {
  return app.request(
    "/api/v1/users",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env,
  )
}

function patchJson(cookie: string, url: string, body: unknown) {
  return app.request(
    url,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env,
  )
}

describe("API utilisateurs", () => {
  it("owner crée un caissier : mot de passe provisoire retourné, connexion possible, mustChangePassword vrai", async () => {
    const { ownerCookie } = await bootstrapOwner()
    const res = await createUser(ownerCookie, {
      name: "Caissier Un",
      email: "caissier@exemple.com",
      role: "staff",
    })
    expect(res.status).toBe(201)
    const { userId, provisionalPassword } = await res.json<{
      userId: string
      provisionalPassword: string
    }>()
    expect(userId).toBeTruthy()
    expect(provisionalPassword).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)

    const signIn = await app.request(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "caissier@exemple.com", password: provisionalPassword }),
      },
      env,
    )
    expect(signIn.status).toBe(200)
    const cookie = signIn.headers.get("set-cookie") ?? ""
    const me = await app.request("/api/v1/me", { headers: { cookie } }, env)
    const body = await me.json<{ user: { mustChangePassword: boolean }; membership: { role: string } }>()
    expect(body.user.mustChangePassword).toBe(true)
    expect(body.membership.role).toBe("staff")
  })

  it("email déjà pris → 409 EMAIL_EXISTANT ; admin ne peut pas créer un admin", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    await createUser(ownerCookie, { name: "A", email: "double@exemple.com", role: "staff" })
    const dbl = await createUser(ownerCookie, { name: "B", email: "double@exemple.com", role: "staff" })
    expect(dbl.status).toBe(409)
    expect((await dbl.json<{ code: string }>()).code).toBe("EMAIL_EXISTANT")

    const admin = await createUserWithRole(organizationId, "admin")
    const ko = await createUser(admin.cookie, { name: "C", email: "c@exemple.com", role: "admin" })
    expect(ko.status).toBe(403)
  })

  it("liste avec rôles ; auditor lit, staff refusé", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    await createUser(ownerCookie, { name: "X", email: "x@exemple.com", role: "stock_manager" })
    const auditor = await createUserWithRole(organizationId, "auditor")
    const staff = await createUserWithRole(organizationId, "staff")

    const res = await app.request("/api/v1/users", { headers: { cookie: auditor.cookie } }, env)
    expect(res.status).toBe(200)
    const { users } = await res.json<{ users: Array<{ email: string; role: string }> }>()
    expect(users.length).toBeGreaterThanOrEqual(2)

    expect((await app.request("/api/v1/users", { headers: { cookie: staff.cookie } }, env)).status).toBe(403)
  })

  it("changement de rôle : owner OK ; dernier owner protégé ; admin limité", async () => {
    const { organizationId, ownerCookie, ownerId } = await bootstrapOwner()
    const staff = await createUserWithRole(organizationId, "staff")
    const admin = await createUserWithRole(organizationId, "admin")

    expect(
      (await patchJson(ownerCookie, `/api/v1/users/${staff.userId}/role`, { role: "stock_manager" })).status,
    ).toBe(200)

    const dernier = await patchJson(ownerCookie, `/api/v1/users/${ownerId}/role`, { role: "staff" })
    expect(dernier.status).toBe(409)
    expect((await dernier.json<{ code: string }>()).code).toBe("DERNIER_OWNER")

    // admin ne peut pas toucher un admin ni promouvoir owner
    expect(
      (await patchJson(admin.cookie, `/api/v1/users/${admin.userId}/role`, { role: "staff" })).status,
    ).toBe(403)
    expect(
      (await patchJson(admin.cookie, `/api/v1/users/${staff.userId}/role`, { role: "owner" })).status,
    ).toBe(403)
  })

  it("désactivation : sessions révoquées ; auto-désactivation interdite", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const staff = await createUserWithRole(organizationId, "staff")

    const off = await patchJson(ownerCookie, `/api/v1/users/${staff.userId}/statut`, { isActive: false })
    expect(off.status).toBe(200)
    // la session existante du staff est révoquée → 401 (session supprimée)
    const me = await app.request("/api/v1/me", { headers: { cookie: staff.cookie } }, env)
    expect([401, 403]).toContain(me.status)

    const self = await patchJson(ownerCookie, `/api/v1/users/${(await bootstrapOwnerId(ownerCookie))}/statut`, {
      isActive: false,
    })
    expect(self.status).toBe(400)
    expect((await self.json<{ code: string }>()).code).toBe("AUTO_DESACTIVATION")
  })
})

async function bootstrapOwnerId(ownerCookie: string): Promise<string> {
  const me = await app.request("/api/v1/me", { headers: { cookie: ownerCookie } }, env)
  return (await me.json<{ user: { id: string } }>()).user.id
}
```

Run: `bun run test` — Expected: FAIL (404).

- [ ] **Step 3: Implémenter la route**

`apps/api/src/routes/users.ts` :

```ts
import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, asc, eq, ne } from "drizzle-orm"
import { userCreateSchema, userRoleSchema, userStatusSchema, type CompanyRole } from "shared"
import * as schema from "../db/schema"
import { createAuth } from "../lib/auth"
import { generateProvisionalPassword } from "../lib/provisional-password"
import { requireAuth } from "../middleware/require-auth"
import { requireMembership, requireRole, type PermissionVariables } from "../middleware/permissions"
import type { Env } from "../env"

export const usersRoute = new Hono<{ Bindings: Env; Variables: PermissionVariables }>()

usersRoute.use(requireAuth, requireMembership)

// Rôles qu'un admin (non owner) a le droit de voir modifiés/attribués
const ROLES_GERABLES_PAR_ADMIN: CompanyRole[] = ["auditor", "stock_manager", "staff"]

usersRoute.post("/", requireRole("owner", "admin"), async (c) => {
  const parsed = userCreateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ code: "VALIDATION", message: "Données invalides", details: parsed.error.flatten() }, 400)
  }
  const demandeur = c.get("membership")
  const roleCible = parsed.data.role as CompanyRole
  if (demandeur.role !== "owner" && !ROLES_GERABLES_PAR_ADMIN.includes(roleCible)) {
    return c.json({ code: "ACCES_REFUSE", message: "Seul le propriétaire peut créer ce rôle" }, 403)
  }

  const db = drizzle(c.env.DB, { schema })
  const existant = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, parsed.data.email))
    .limit(1)
  if (existant.length > 0) {
    return c.json({ code: "EMAIL_EXISTANT", message: "Un compte existe déjà avec cet email" }, 409)
  }

  const provisionalPassword = generateProvisionalPassword()
  const auth = createAuth(c.env)
  // Le hook sign-up n'autorise la création que munie du jeton interne (SETUP_TOKEN)
  const signUp = await auth.api.signUpEmail({
    body: { email: parsed.data.email, password: provisionalPassword, name: parsed.data.name },
    headers: new Headers({ "x-setup-token": c.env.SETUP_TOKEN }),
  })

  await db.batch([
    db
      .update(schema.user)
      .set({ mustChangePassword: true })
      .where(eq(schema.user.id, signUp.user.id)),
    db.insert(schema.member).values({
      id: crypto.randomUUID(),
      organizationId: demandeur.organizationId,
      userId: signUp.user.id,
      role: roleCible,
      createdAt: new Date(),
    }),
  ])

  return c.json({ userId: signUp.user.id, provisionalPassword }, 201)
})

usersRoute.get("/", requireRole("owner", "admin", "auditor"), async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const organizationId = c.get("membership").organizationId
  const rows = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      isActive: schema.user.isActive,
      role: schema.member.role,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .where(eq(schema.member.organizationId, organizationId))
    .orderBy(asc(schema.user.name))

  const affectations = await db
    .select({
      userId: schema.warehouseMembers.userId,
      warehouseId: schema.warehouseMembers.warehouseId,
      warehouseName: schema.warehouses.name,
      role: schema.warehouseMembers.role,
    })
    .from(schema.warehouseMembers)
    .innerJoin(schema.warehouses, eq(schema.warehouseMembers.warehouseId, schema.warehouses.id))
    .where(eq(schema.warehouseMembers.organizationId, organizationId))

  const users = rows.map((u) => ({
    ...u,
    assignments: affectations
      .filter((a) => a.userId === u.id)
      .map(({ warehouseId, warehouseName, role }) => ({ warehouseId, warehouseName, role })),
  }))
  return c.json({ users })
})

async function membershipCible(c: Parameters<Parameters<typeof usersRoute.patch>[2]>[0], userId: string) {
  const db = drizzle(c.env.DB, { schema })
  const rows = await db
    .select({ id: schema.member.id, role: schema.member.role })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.userId, userId),
        eq(schema.member.organizationId, c.get("membership").organizationId),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

usersRoute.patch("/:id/role", requireRole("owner", "admin"), async (c) => {
  const parsed = userRoleSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ code: "VALIDATION", message: "Données invalides", details: parsed.error.flatten() }, 400)
  }
  const cibleId = c.req.param("id")
  const cible = await membershipCible(c, cibleId)
  if (!cible) return c.json({ code: "INTROUVABLE", message: "Utilisateur introuvable" }, 404)

  const demandeur = c.get("membership")
  const nouveauRole = parsed.data.role as CompanyRole
  if (demandeur.role !== "owner") {
    const cibleGerable = ROLES_GERABLES_PAR_ADMIN.includes(cible.role as CompanyRole)
    const roleGerable = ROLES_GERABLES_PAR_ADMIN.includes(nouveauRole)
    if (!cibleGerable || !roleGerable) {
      return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
    }
  }

  const db = drizzle(c.env.DB, { schema })
  if (cible.role === "owner" && nouveauRole !== "owner") {
    const autresOwners = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, demandeur.organizationId),
          eq(schema.member.role, "owner"),
          ne(schema.member.userId, cibleId),
        ),
      )
    if (autresOwners.length === 0) {
      return c.json({ code: "DERNIER_OWNER", message: "Impossible de rétrograder le dernier propriétaire" }, 409)
    }
  }

  await db.update(schema.member).set({ role: nouveauRole }).where(eq(schema.member.id, cible.id))
  return c.json({ ok: true })
})

usersRoute.patch("/:id/statut", requireRole("owner", "admin"), async (c) => {
  const parsed = userStatusSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ code: "VALIDATION", message: "Données invalides", details: parsed.error.flatten() }, 400)
  }
  const cibleId = c.req.param("id")
  if (cibleId === c.get("user").id) {
    return c.json({ code: "AUTO_DESACTIVATION", message: "Impossible de désactiver son propre compte" }, 400)
  }
  const cible = await membershipCible(c, cibleId)
  if (!cible) return c.json({ code: "INTROUVABLE", message: "Utilisateur introuvable" }, 404)
  if (
    c.get("membership").role !== "owner" &&
    !ROLES_GERABLES_PAR_ADMIN.includes(cible.role as CompanyRole)
  ) {
    return c.json({ code: "ACCES_REFUSE", message: "Accès refusé" }, 403)
  }

  const db = drizzle(c.env.DB, { schema })
  const ops = [
    db.update(schema.user).set({ isActive: parsed.data.isActive }).where(eq(schema.user.id, cibleId)),
  ]
  if (!parsed.data.isActive) {
    ops.push(db.delete(schema.session).where(eq(schema.session.userId, cibleId)))
  }
  await db.batch(ops as [typeof ops[0], ...typeof ops])
  return c.json({ ok: true })
})
```

Dans `apps/api/src/index.ts` :

```ts
import { usersRoute } from "./routes/users"

app.route("/api/v1/users", usersRoute)
```

Note : si le type du helper `membershipCible` pose problème au typecheck, le remplacer par une fonction prenant `(env: Env, organizationId: string, userId: string)` — le comportement testé prime.

- [ ] **Step 4: Vérifier et committer**

Run: `bun run test && bun run typecheck` — Expected: PASS (31 api).

```bash
git add -A && git commit -m "feat(api): gestion des utilisateurs (création mdp provisoire, rôles, désactivation)"
```

---

### Task 8: API affectations d'entrepôt

**Files:**
- Create: `packages/shared/src/schemas/assignment.ts` (+ export index)
- Create: `apps/api/src/routes/warehouse-members.ts`
- Modify: `apps/api/src/index.ts`
- Create: `apps/api/test/warehouse-members.test.ts`

**Interfaces:**
- Produces: `POST /api/v1/warehouse-members` (owner/admin) body `{ userId, warehouseId, role }` → `201 { id }` ; `409 DEJA_AFFECTE` si le couple existe ; `404 INTROUVABLE` si user ou entrepôt hors organisation ; `DELETE /api/v1/warehouse-members/:id` (owner/admin) → `200` / `404`

- [ ] **Step 1: Schéma Zod**

`packages/shared/src/schemas/assignment.ts` :

```ts
import { z } from "zod"
import { WAREHOUSE_ROLES } from "../roles"

export const assignmentCreateSchema = z.object({
  userId: z.string().min(1),
  warehouseId: z.string().min(1),
  role: z.enum(WAREHOUSE_ROLES, { message: "Rôle d'entrepôt invalide" }),
})

export type AssignmentCreateInput = z.infer<typeof assignmentCreateSchema>
```

Export dans l'index shared :

```ts
export { assignmentCreateSchema, type AssignmentCreateInput } from "./schemas/assignment"
```

- [ ] **Step 2: Tests (échec)**

`apps/api/test/warehouse-members.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import app from "../src/index"
import { bootstrapOwner, createUserWithRole } from "./helpers"

async function creerEntrepot(ownerCookie: string) {
  const res = await app.request(
    "/api/v1/warehouses",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ name: "Boutique", type: "store" }),
    },
    env,
  )
  return (await res.json<{ id: string }>()).id
}

function affecter(cookie: string, body: unknown) {
  return app.request(
    "/api/v1/warehouse-members",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env,
  )
}

describe("API affectations", () => {
  it("affecte un caissier, refuse le doublon, supprime", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const warehouseId = await creerEntrepot(ownerCookie)
    const staff = await createUserWithRole(organizationId, "staff")

    const ok = await affecter(ownerCookie, { userId: staff.userId, warehouseId, role: "cashier" })
    expect(ok.status).toBe(201)
    const { id } = await ok.json<{ id: string }>()

    const doublon = await affecter(ownerCookie, { userId: staff.userId, warehouseId, role: "manager" })
    expect(doublon.status).toBe(409)
    expect((await doublon.json<{ code: string }>()).code).toBe("DEJA_AFFECTE")

    const del = await app.request(
      `/api/v1/warehouse-members/${id}`,
      { method: "DELETE", headers: { cookie: ownerCookie } },
      env,
    )
    expect(del.status).toBe(200)
  })

  it("404 si user ou entrepôt inconnu ; staff refusé", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const warehouseId = await creerEntrepot(ownerCookie)
    const staff = await createUserWithRole(organizationId, "staff")

    expect(
      (await affecter(ownerCookie, { userId: crypto.randomUUID(), warehouseId, role: "cashier" })).status,
    ).toBe(404)
    expect(
      (
        await affecter(ownerCookie, {
          userId: staff.userId,
          warehouseId: crypto.randomUUID(),
          role: "cashier",
        })
      ).status,
    ).toBe(404)
    expect(
      (await affecter(staff.cookie, { userId: staff.userId, warehouseId, role: "cashier" })).status,
    ).toBe(403)
  })
})
```

Run: `bun run test` — Expected: FAIL (404).

- [ ] **Step 3: Implémenter**

`apps/api/src/routes/warehouse-members.ts` :

```ts
import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { and, eq } from "drizzle-orm"
import { assignmentCreateSchema } from "shared"
import * as schema from "../db/schema"
import { requireAuth } from "../middleware/require-auth"
import { requireMembership, requireRole, type PermissionVariables } from "../middleware/permissions"
import type { Env } from "../env"

export const warehouseMembersRoute = new Hono<{ Bindings: Env; Variables: PermissionVariables }>()

warehouseMembersRoute.use(requireAuth, requireMembership, requireRole("owner", "admin"))

warehouseMembersRoute.post("/", async (c) => {
  const parsed = assignmentCreateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ code: "VALIDATION", message: "Données invalides", details: parsed.error.flatten() }, 400)
  }
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })

  const [membre, entrepot] = await Promise.all([
    db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(and(eq(schema.member.userId, parsed.data.userId), eq(schema.member.organizationId, organizationId)))
      .limit(1),
    db
      .select({ id: schema.warehouses.id })
      .from(schema.warehouses)
      .where(and(eq(schema.warehouses.id, parsed.data.warehouseId), eq(schema.warehouses.organizationId, organizationId)))
      .limit(1),
  ])
  if (membre.length === 0 || entrepot.length === 0) {
    return c.json({ code: "INTROUVABLE", message: "Utilisateur ou entrepôt introuvable" }, 404)
  }

  const id = crypto.randomUUID()
  try {
    await db.insert(schema.warehouseMembers).values({
      id,
      organizationId,
      warehouseId: parsed.data.warehouseId,
      userId: parsed.data.userId,
      role: parsed.data.role,
      createdAt: new Date(),
    })
  } catch (err) {
    if (String(err).includes("UNIQUE constraint failed")) {
      return c.json({ code: "DEJA_AFFECTE", message: "Cet utilisateur est déjà affecté à cet entrepôt" }, 409)
    }
    throw err
  }
  return c.json({ id }, 201)
})

warehouseMembersRoute.delete("/:id", async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const result = await db
    .delete(schema.warehouseMembers)
    .where(
      and(
        eq(schema.warehouseMembers.id, c.req.param("id")),
        eq(schema.warehouseMembers.organizationId, c.get("membership").organizationId),
      ),
    )
    .returning({ id: schema.warehouseMembers.id })
  if (result.length === 0) {
    return c.json({ code: "INTROUVABLE", message: "Affectation introuvable" }, 404)
  }
  return c.json({ ok: true })
})
```

Montage dans `src/index.ts` :

```ts
import { warehouseMembersRoute } from "./routes/warehouse-members"

app.route("/api/v1/warehouse-members", warehouseMembersRoute)
```

- [ ] **Step 4: Vérifier et committer**

Run: `bun run test && bun run typecheck` — Expected: PASS (33 api).

```bash
git add -A && git commit -m "feat(api): affectations d'entrepôt (warehouse-members)"
```

---

### Task 9: API paramètres d'organisation

**Files:**
- Create: `packages/shared/src/schemas/organization.ts` (+ export index)
- Create: `apps/api/src/routes/organization.ts`
- Modify: `apps/api/src/index.ts`
- Create: `apps/api/test/organization.test.ts`

**Interfaces:**
- Produces: `GET /api/v1/organization` (tout membre) → `{ name, currency, receiptHeader, receiptFooter }` (métadonnées JSON de `organization.metadata`, défauts `currency: 'XOF'`, textes `''`) ; `PATCH /api/v1/organization` (owner/admin) body partiel `{ name?, currency?, receiptHeader?, receiptFooter? }` → `200` (merge des metadata existantes)

- [ ] **Step 1: Schéma Zod**

`packages/shared/src/schemas/organization.ts` :

```ts
import { z } from "zod"

export const organizationSettingsSchema = z
  .object({
    name: z.string().trim().min(1, "Le nom est requis").optional(),
    currency: z
      .string()
      .trim()
      .length(3, "Code devise ISO 4217 (3 lettres)")
      .transform((v) => v.toUpperCase())
      .optional(),
    receiptHeader: z.string().max(500).optional(),
    receiptFooter: z.string().max(500).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Aucun champ à modifier" })

export type OrganizationSettingsInput = z.infer<typeof organizationSettingsSchema>
```

Export index shared :

```ts
export { organizationSettingsSchema, type OrganizationSettingsInput } from "./schemas/organization"
```

- [ ] **Step 2: Tests (échec)**

`apps/api/test/organization.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import app from "../src/index"
import { bootstrapOwner, createUserWithRole } from "./helpers"

describe("API organisation", () => {
  it("GET renvoie les défauts ; PATCH modifie et merge ; staff lit mais n'écrit pas", async () => {
    const { organizationId, ownerCookie } = await bootstrapOwner()
    const staff = await createUserWithRole(organizationId, "staff")

    const get1 = await app.request("/api/v1/organization", { headers: { cookie: ownerCookie } }, env)
    expect(get1.status).toBe(200)
    const initial = await get1.json<{ name: string; currency: string }>()
    expect(initial.name).toBe("Ma Société")
    expect(initial.currency).toBe("XOF")

    const patch = await app.request(
      "/api/v1/organization",
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ receiptHeader: "Merci de votre visite", currency: "xof" }),
      },
      env,
    )
    expect(patch.status).toBe(200)

    const get2 = await app.request("/api/v1/organization", { headers: { cookie: staff.cookie } }, env)
    expect(get2.status).toBe(200)
    const apres = await get2.json<{ currency: string; receiptHeader: string }>()
    expect(apres.currency).toBe("XOF")
    expect(apres.receiptHeader).toBe("Merci de votre visite")

    const ko = await app.request(
      "/api/v1/organization",
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: staff.cookie },
        body: JSON.stringify({ name: "Piratage" }),
      },
      env,
    )
    expect(ko.status).toBe(403)
  })
})
```

Run: `bun run test` — Expected: FAIL (404).

- [ ] **Step 3: Implémenter**

`apps/api/src/routes/organization.ts` :

```ts
import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
import { organizationSettingsSchema } from "shared"
import * as schema from "../db/schema"
import { requireAuth } from "../middleware/require-auth"
import { requireMembership, requireRole, type PermissionVariables } from "../middleware/permissions"
import type { Env } from "../env"

export const organizationRoute = new Hono<{ Bindings: Env; Variables: PermissionVariables }>()

organizationRoute.use(requireAuth, requireMembership)

type Meta = { currency?: string; receiptHeader?: string; receiptFooter?: string }

function lireMeta(raw: string | null): Meta {
  try {
    return raw ? (JSON.parse(raw) as Meta) : {}
  } catch {
    return {}
  }
}

organizationRoute.get("/", async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const rows = await db
    .select({ name: schema.organization.name, metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, c.get("membership").organizationId))
    .limit(1)
  const meta = lireMeta(rows[0]?.metadata ?? null)
  return c.json({
    name: rows[0]?.name ?? "",
    currency: meta.currency ?? "XOF",
    receiptHeader: meta.receiptHeader ?? "",
    receiptFooter: meta.receiptFooter ?? "",
  })
})

organizationRoute.patch("/", requireRole("owner", "admin"), async (c) => {
  const parsed = organizationSettingsSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ code: "VALIDATION", message: "Données invalides", details: parsed.error.flatten() }, 400)
  }
  const organizationId = c.get("membership").organizationId
  const db = drizzle(c.env.DB, { schema })
  const rows = await db
    .select({ name: schema.organization.name, metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1)
  const meta = lireMeta(rows[0]?.metadata ?? null)
  const { name, ...metaPatch } = parsed.data
  await db
    .update(schema.organization)
    .set({
      ...(name ? { name } : {}),
      metadata: JSON.stringify({ currency: "XOF", ...meta, ...metaPatch }),
    })
    .where(eq(schema.organization.id, organizationId))
  return c.json({ ok: true })
})
```

Montage :

```ts
import { organizationRoute } from "./routes/organization"

app.route("/api/v1/organization", organizationRoute)
```

- [ ] **Step 4: Vérifier et committer**

Run: `bun run test && bun run typecheck` — Expected: PASS (34 api).

```bash
git add -A && git commit -m "feat(api): paramètres d'organisation (devise, en-tête/pied de ticket)"
```

---

### Task 10: API « Mon compte » — changement de mot de passe + parcours forcé

**Files:**
- Create: `packages/shared/src/schemas/account.ts` (+ export index)
- Create: `apps/api/src/routes/mon-compte.ts`
- Modify: `apps/api/src/middleware/require-auth.ts` (enforcement `MOT_DE_PASSE_A_CHANGER`)
- Modify: `apps/api/src/index.ts`
- Create: `apps/api/test/mon-compte.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/v1/mon-compte/mot-de-passe` body `{ currentPassword, newPassword }` (min 12) → `200` ; révoque les autres sessions ; remet `mustChangePassword = false` ; `400 MOT_DE_PASSE_INCORRECT` si mot de passe actuel faux
  - `requireAuth` : si `mustChangePassword` et que le chemin n'est ni `/api/v1/me` ni `/api/v1/mon-compte/mot-de-passe` → `403 { code: 'MOT_DE_PASSE_A_CHANGER' }`

- [ ] **Step 1: Schéma Zod**

`packages/shared/src/schemas/account.ts` :

```ts
import { z } from "zod"

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Le mot de passe actuel est requis"),
  newPassword: z.string().min(12, "Le nouveau mot de passe doit contenir au moins 12 caractères"),
})

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
```

Export index shared :

```ts
export { changePasswordSchema, type ChangePasswordInput } from "./schemas/account"
```

- [ ] **Step 2: Tests (échec)**

`apps/api/test/mon-compte.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import app from "../src/index"
import { bootstrapOwner, MDP } from "./helpers"

function changer(cookie: string, body: unknown) {
  return app.request(
    "/api/v1/mon-compte/mot-de-passe",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env,
  )
}

describe("mon compte", () => {
  it("change le mot de passe et lève l'obligation ; l'ancien ne marche plus", async () => {
    const { ownerCookie } = await bootstrapOwner()
    // créer un employé avec mdp provisoire (mustChangePassword = true)
    const creation = await app.request(
      "/api/v1/users",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ name: "Employé", email: "emp@exemple.com", role: "staff" }),
      },
      env,
    )
    const { provisionalPassword } = await creation.json<{ provisionalPassword: string }>()

    const signIn = await app.request(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "emp@exemple.com", password: provisionalPassword }),
      },
      env,
    )
    const cookie = signIn.headers.get("set-cookie") ?? ""

    // tant que le mdp n'est pas changé, les autres routes API sont bloquées
    const bloque = await app.request("/api/v1/warehouses", { headers: { cookie } }, env)
    expect(bloque.status).toBe(403)
    expect((await bloque.json<{ code: string }>()).code).toBe("MOT_DE_PASSE_A_CHANGER")

    // mauvais mot de passe actuel → 400
    const ko = await changer(cookie, { currentPassword: "faux-mot-de-passe", newPassword: MDP })
    expect(ko.status).toBe(400)
    expect((await ko.json<{ code: string }>()).code).toBe("MOT_DE_PASSE_INCORRECT")

    // changement OK
    const ok = await changer(cookie, { currentPassword: provisionalPassword, newPassword: MDP })
    expect(ok.status).toBe(200)

    // reconnexion avec le nouveau mot de passe : mustChangePassword est retombé
    const signIn2 = await app.request(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "emp@exemple.com", password: MDP }),
      },
      env,
    )
    expect(signIn2.status).toBe(200)
    const cookie2 = signIn2.headers.get("set-cookie") ?? ""
    const me = await app.request("/api/v1/me", { headers: { cookie: cookie2 } }, env)
    expect((await me.json<{ user: { mustChangePassword: boolean } }>()).user.mustChangePassword).toBe(false)

    // l'ancien mot de passe provisoire ne fonctionne plus
    const ancien = await app.request(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "emp@exemple.com", password: provisionalPassword }),
      },
      env,
    )
    expect(ancien.status).not.toBe(200)
  })
})
```

Run: `bun run test` — Expected: FAIL (404 sur mon-compte, et /warehouses répond 403 ACCES_REFUSE et non MOT_DE_PASSE_A_CHANGER).

- [ ] **Step 3: Implémenter**

Dans `apps/api/src/middleware/require-auth.ts`, après le `c.set('user', ...)` :

```ts
const CHEMINS_AUTORISES_MDP = ["/api/v1/me", "/api/v1/mon-compte/mot-de-passe"]
if (
  c.get("user").mustChangePassword &&
  !CHEMINS_AUTORISES_MDP.includes(new URL(c.req.url).pathname)
) {
  return c.json(
    { code: "MOT_DE_PASSE_A_CHANGER", message: "Vous devez changer votre mot de passe avant de continuer" },
    403,
  )
}
```

(placer la constante hors de la fonction middleware)

`apps/api/src/routes/mon-compte.ts` :

```ts
import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
import { APIError } from "better-auth/api"
import { changePasswordSchema } from "shared"
import * as schema from "../db/schema"
import { createAuth } from "../lib/auth"
import { requireAuth, type AuthVariables } from "../middleware/require-auth"
import type { Env } from "../env"

export const monCompteRoute = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

monCompteRoute.post("/mot-de-passe", requireAuth, async (c) => {
  const parsed = changePasswordSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ code: "VALIDATION", message: "Données invalides", details: parsed.error.flatten() }, 400)
  }
  const auth = createAuth(c.env)
  try {
    await auth.api.changePassword({
      body: {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        revokeOtherSessions: true,
      },
      headers: c.req.raw.headers,
    })
  } catch (err) {
    if (err instanceof APIError) {
      return c.json({ code: "MOT_DE_PASSE_INCORRECT", message: "Mot de passe actuel incorrect" }, 400)
    }
    throw err
  }
  const db = drizzle(c.env.DB, { schema })
  await db
    .update(schema.user)
    .set({ mustChangePassword: false })
    .where(eq(schema.user.id, c.get("user").id))
  return c.json({ ok: true })
})
```

Montage :

```ts
import { monCompteRoute } from "./routes/mon-compte"

app.route("/api/v1/mon-compte", monCompteRoute)
```

- [ ] **Step 4: Vérifier et committer**

Run: `bun run test && bun run typecheck` — Expected: PASS (35 api). Vérifier aussi qu'aucun test antérieur ne casse (le owner du bootstrap a `mustChangePassword = false`, rien ne change pour lui).

```bash
git add -A && git commit -m "feat(api): changement de mot de passe + parcours mot de passe provisoire forcé"
```

---

### Task 11: Front — fondations (TanStack Query, composants shadcn, contexte /me, navigation par rôle)

**Files:**
- Modify: `apps/web/src/main.tsx` (QueryClientProvider)
- Create: composants shadcn via CLI (`apps/web/src/components/ui/*`)
- Create: `apps/web/src/lib/me.ts`
- Modify: `apps/web/src/routes/_app.tsx` (contexte /me, sidebar par rôle, garde première connexion)

**Interfaces:**
- Consumes: `GET /api/v1/me` (Task 5), `apiFetch` existant
- Produces: type `Me = { user: { id: string; email: string; name: string; mustChangePassword: boolean }, membership: { organizationId: string; organizationName: string; role: CompanyRole } | null, assignments: Array<{ warehouseId: string; warehouseName: string; role: WarehouseRole }> }` + `fetchMe(): Promise<Me>` (`src/lib/me.ts`) ; contexte de route `_app` = `{ me: Me }` ; redirection vers `/mon-compte` si `mustChangePassword` ; sidebar : « Tableau de bord » (tous), section « Administration » (owner/admin/auditor) avec Entrepôts / Utilisateurs / Paramètres, lien « Mon compte » (tous)

- [ ] **Step 1: Installer les composants shadcn et le provider Query**

```bash
cd apps/web
bunx shadcn@latest add button input label card dialog table select badge
```

Expected: fichiers créés sous `src/components/ui/`. En cas d'échec réseau de la CLI, s'arrêter et le signaler (ne pas recopier des composants à la main).

`apps/web/src/main.tsx` — envelopper le routeur :

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
})

// dans le render :
<QueryClientProvider client={queryClient}>
  <RouterProvider router={router} />
</QueryClientProvider>
```

- [ ] **Step 2: fetchMe et contexte de layout**

`apps/web/src/lib/me.ts` :

```ts
import { apiFetch } from "./api"
import type { CompanyRole, WarehouseRole } from "shared"

export type Me = {
  user: { id: string; email: string; name: string; mustChangePassword: boolean }
  membership: {
    organizationId: string
    organizationName: string
    role: CompanyRole
  } | null
  assignments: Array<{ warehouseId: string; warehouseName: string; role: WarehouseRole }>
}

export function fetchMe(): Promise<Me> {
  return apiFetch<Me>("/api/v1/me")
}
```

Ajouter `"shared": "workspace:*"` aux dependencies d'`apps/web/package.json` puis `bun install` (types des rôles).

`apps/web/src/routes/_app.tsx` — remplacer le `beforeLoad` et la sidebar :

```tsx
import { Outlet, Link, createFileRoute, redirect } from "@tanstack/react-router"
import { authClient } from "@/lib/auth-client"
import { fetchMe } from "@/lib/me"

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ location }) => {
    const { data } = await authClient.getSession()
    if (!data) throw redirect({ to: "/login" })
    const me = await fetchMe()
    if (me.user.mustChangePassword && location.pathname !== "/mon-compte") {
      throw redirect({ to: "/mon-compte" })
    }
    return { me }
  },
  component: AppLayout,
})

const lienClasses = "rounded px-2 py-1.5 text-sm hover:bg-gray-100 aria-[current=page]:font-semibold"

function AppLayout() {
  const { me } = Route.useRouteContext()
  const role = me.membership?.role
  const estAdmin = role === "owner" || role === "admin" || role === "auditor"

  async function handleSignOut() {
    await authClient.signOut()
    window.location.href = "/login"
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col justify-between border-r p-4">
        <div>
          <h2 className="mb-1 text-lg font-semibold">pos-stocks</h2>
          <p className="mb-6 truncate text-xs text-gray-500">
            {me.membership?.organizationName}
          </p>
          <nav className="flex flex-col gap-1">
            <Link to="/" className={lienClasses}>
              Tableau de bord
            </Link>
            {estAdmin && (
              <>
                <p className="mt-4 mb-1 px-2 text-[11px] font-medium tracking-widest text-gray-400 uppercase">
                  Administration
                </p>
                <Link to="/administration/entrepots" className={lienClasses}>
                  Entrepôts
                </Link>
                <Link to="/administration/utilisateurs" className={lienClasses}>
                  Utilisateurs
                </Link>
                <Link to="/administration/parametres" className={lienClasses}>
                  Paramètres
                </Link>
              </>
            )}
          </nav>
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <Link to="/mon-compte" className={lienClasses}>
            Mon compte
          </Link>
          <span className="truncate px-2 text-xs text-gray-500">{me.user.email}</span>
          <button onClick={handleSignOut} className="px-2 py-1.5 text-left text-red-600">
            Se déconnecter
          </button>
        </div>
      </aside>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  )
}
```

Note : les routes `/administration/*` et `/mon-compte` sont créées aux tâches 12-15 ; TypeScript refusera les `<Link>` tant qu'elles n'existent pas — créer dans CETTE tâche des fichiers de route squelettes (`export const Route = createFileRoute('...')({ component: () => <p>À venir</p> })`) pour :
`src/routes/_app/mon-compte.tsx`, `src/routes/_app/administration/entrepots.tsx`, `src/routes/_app/administration/utilisateurs.tsx`, `src/routes/_app/administration/parametres.tsx` — remplacés dans les tâches suivantes.

- [ ] **Step 3: Vérifier (typecheck + build + tests) et committer**

```bash
bun run typecheck && bun run test && bun run build
cd ../.. && git add -A && git commit -m "feat(web): fondations Phase 2 — Query, shadcn/ui, contexte me, navigation par rôle"
```

Expected: 5 tests web verts (aucun test existant ne touche `_app`), build OK.

---

### Task 12: Front — page « Mon compte » (changement de mot de passe + parcours forcé)

**Files:**
- Create: `apps/web/src/components/change-password-form.tsx`
- Create: `apps/web/src/components/change-password-form.test.tsx`
- Modify: `apps/web/src/routes/_app/mon-compte.tsx`

**Interfaces:**
- Consumes: `POST /api/v1/mon-compte/mot-de-passe` via `apiFetch`, contexte `me`
- Produces: `ChangePasswordForm` avec prop `{ onSubmit: (values: { currentPassword: string; newPassword: string }) => Promise<string | null> }` (même contrat que LoginForm : message d'erreur ou null) ; la page affiche un bandeau d'obligation si `mustChangePassword`

- [ ] **Step 1: Test du composant (échec)**

`apps/web/src/components/change-password-form.test.tsx` :

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ChangePasswordForm } from "./change-password-form"

describe("ChangePasswordForm", () => {
  it("refuse si la confirmation ne correspond pas, sans appeler onSubmit", async () => {
    const onSubmit = vi.fn()
    render(<ChangePasswordForm onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText("Mot de passe actuel"), { target: { value: "ancien-mdp" } })
    fireEvent.change(screen.getByLabelText("Nouveau mot de passe"), {
      target: { value: "NouveauMotDePasse1" },
    })
    fireEvent.change(screen.getByLabelText("Confirmer le nouveau mot de passe"), {
      target: { value: "Different1" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Changer le mot de passe" }))

    expect(await screen.findByText("Les mots de passe ne correspondent pas")).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("soumet les valeurs quand tout est cohérent", async () => {
    const onSubmit = vi.fn().mockResolvedValue(null)
    render(<ChangePasswordForm onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText("Mot de passe actuel"), { target: { value: "ancien-mdp" } })
    fireEvent.change(screen.getByLabelText("Nouveau mot de passe"), {
      target: { value: "NouveauMotDePasse1" },
    })
    fireEvent.change(screen.getByLabelText("Confirmer le nouveau mot de passe"), {
      target: { value: "NouveauMotDePasse1" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Changer le mot de passe" }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        currentPassword: "ancien-mdp",
        newPassword: "NouveauMotDePasse1",
      }),
    )
  })
})
```

Run: `bun run --cwd apps/web test` — Expected: FAIL (module introuvable).

- [ ] **Step 2: Implémenter le composant**

`apps/web/src/components/change-password-form.tsx` :

```tsx
import { useState } from "react"

type Props = {
  onSubmit: (values: { currentPassword: string; newPassword: string }) => Promise<string | null>
}

const champClasses =
  "h-11 w-full rounded-md border border-gray-300 px-3 text-base focus:border-gray-500 focus:ring-2 focus:ring-gray-300 focus:outline-none"

export function ChangePasswordForm({ onSubmit }: Props) {
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    if (newPassword !== confirmation) {
      setError("Les mots de passe ne correspondent pas")
      return
    }
    if (newPassword.length < 12) {
      setError("Le nouveau mot de passe doit contenir au moins 12 caractères")
      return
    }
    setLoading(true)
    try {
      const message = await onSubmit({ currentPassword, newPassword })
      setError(message)
      if (!message) {
        setSuccess(true)
        setCurrentPassword("")
        setNewPassword("")
        setConfirmation("")
      }
    } catch {
      setError("Une erreur est survenue, veuillez réessayer.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="mdp-actuel" className="text-sm font-medium">
          Mot de passe actuel
        </label>
        <input
          id="mdp-actuel"
          type="password"
          required
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className={champClasses}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="mdp-nouveau" className="text-sm font-medium">
          Nouveau mot de passe
        </label>
        <input
          id="mdp-nouveau"
          type="password"
          required
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className={champClasses}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="mdp-confirmation" className="text-sm font-medium">
          Confirmer le nouveau mot de passe
        </label>
        <input
          id="mdp-confirmation"
          type="password"
          required
          autoComplete="new-password"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          className={champClasses}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="text-sm font-medium text-green-700">
          Mot de passe changé
        </p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="h-11 rounded-md bg-black text-base font-semibold text-white disabled:opacity-60"
      >
        {loading ? "Changement…" : "Changer le mot de passe"}
      </button>
    </form>
  )
}
```

Run: `bun run --cwd apps/web test` — Expected: PASS (7 web).

- [ ] **Step 3: Page mon-compte**

`apps/web/src/routes/_app/mon-compte.tsx` :

```tsx
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { apiFetch } from "@/lib/api"
import { ChangePasswordForm } from "@/components/change-password-form"

export const Route = createFileRoute("/_app/mon-compte")({
  component: MonComptePage,
})

function MonComptePage() {
  const { me } = Route.useRouteContext()
  const router = useRouter()

  async function handleSubmit(values: { currentPassword: string; newPassword: string }) {
    try {
      await apiFetch("/api/v1/mon-compte/mot-de-passe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      })
      await router.invalidate()
      return null
    } catch (err) {
      return err instanceof Error ? err.message : "Une erreur est survenue"
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold">Mon compte</h1>
      <p className="mt-1 text-sm text-gray-500">
        {me.user.name} · {me.user.email} · rôle : {me.membership?.role ?? "—"}
      </p>
      {me.user.mustChangePassword && (
        <p role="alert" className="mt-4 rounded-md bg-orange-50 px-3 py-2 text-sm text-orange-800">
          Votre mot de passe est provisoire : choisissez-en un nouveau pour accéder à l'application.
        </p>
      )}
      <h2 className="mt-8 mb-4 text-base font-semibold">Changer mon mot de passe</h2>
      <ChangePasswordForm onSubmit={handleSubmit} />
    </div>
  )
}
```

- [ ] **Step 4: Vérifier et committer**

```bash
bun run typecheck && bun run --cwd apps/web test && bun run --cwd apps/web build
git add -A && git commit -m "feat(web): page Mon compte, changement de mot de passe et parcours forcé"
```

---

### Task 13: Front — Administration : Entrepôts

**Files:**
- Modify: `apps/web/src/routes/_app/administration/entrepots.tsx`

**Interfaces:**
- Consumes: `GET/POST/PATCH /api/v1/warehouses`, composants ui (button, input, label, dialog, table, select, badge), react-query
- Produces: page liste (nom, type traduit « Entrepôt »/« Boutique », adresse, badge Actif/Inactif) + dialog de création + activation/désactivation ; boutons d'écriture masqués pour `auditor`

- [ ] **Step 1: Implémenter la page**

`apps/web/src/routes/_app/administration/entrepots.tsx` :

```tsx
import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
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

export const Route = createFileRoute("/_app/administration/entrepots")({
  component: EntrepotsPage,
})

type Warehouse = {
  id: string
  name: string
  type: "warehouse" | "store"
  address: string | null
  isActive: boolean
}

const TYPES = { warehouse: "Entrepôt", store: "Boutique" } as const

function EntrepotsPage() {
  const { me } = Route.useRouteContext()
  const peutEcrire = me.membership?.role === "owner" || me.membership?.role === "admin"
  const queryClient = useQueryClient()
  const [dialogOuvert, setDialogOuvert] = useState(false)
  const [nom, setNom] = useState("")
  const [type, setType] = useState<"warehouse" | "store">("store")
  const [adresse, setAdresse] = useState("")
  const [erreur, setErreur] = useState<string | null>(null)

  const { data, isPending } = useQuery({
    queryKey: ["warehouses"],
    queryFn: () => apiFetch<{ warehouses: Warehouse[] }>("/api/v1/warehouses"),
  })

  const creer = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/warehouses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: nom, type, address: adresse || undefined }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["warehouses"] })
      setDialogOuvert(false)
      setNom("")
      setAdresse("")
      setErreur(null)
    },
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })

  const basculer = useMutation({
    mutationFn: (w: Warehouse) =>
      apiFetch(`/api/v1/warehouses/${w.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !w.isActive }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["warehouses"] }),
  })

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Entrepôts &amp; boutiques</h1>
        {peutEcrire && (
          <Dialog open={dialogOuvert} onOpenChange={setDialogOuvert}>
            <DialogTrigger asChild>
              <Button>Nouvel entrepôt</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nouvel entrepôt ou boutique</DialogTitle>
              </DialogHeader>
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  creer.mutate()
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="wh-nom">Nom</Label>
                  <Input id="wh-nom" required value={nom} onChange={(e) => setNom(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="wh-type">Type</Label>
                  <select
                    id="wh-type"
                    value={type}
                    onChange={(e) => setType(e.target.value as "warehouse" | "store")}
                    className="h-10 rounded-md border px-2 text-sm"
                  >
                    <option value="store">Boutique (avec point de vente)</option>
                    <option value="warehouse">Entrepôt (réserve)</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="wh-adresse">Adresse (optionnel)</Label>
                  <Input id="wh-adresse" value={adresse} onChange={(e) => setAdresse(e.target.value)} />
                </div>
                {erreur && (
                  <p role="alert" className="text-sm text-red-700">
                    {erreur}
                  </p>
                )}
                <Button type="submit" disabled={creer.isPending}>
                  {creer.isPending ? "Création…" : "Créer"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {isPending ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nom</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Adresse</TableHead>
              <TableHead>Statut</TableHead>
              {peutEcrire && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.warehouses ?? []).map((w) => (
              <TableRow key={w.id}>
                <TableCell className="font-medium">{w.name}</TableCell>
                <TableCell>{TYPES[w.type]}</TableCell>
                <TableCell>{w.address ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={w.isActive ? "default" : "secondary"}>
                    {w.isActive ? "Actif" : "Inactif"}
                  </Badge>
                </TableCell>
                {peutEcrire && (
                  <TableCell>
                    <Button variant="outline" size="sm" onClick={() => basculer.mutate(w)}>
                      {w.isActive ? "Désactiver" : "Réactiver"}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {data?.warehouses.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-gray-500">
                  Aucun entrepôt — créez le premier pour démarrer.
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

- [ ] **Step 2: Vérifier et committer**

```bash
bun run typecheck && bun run --cwd apps/web build
git add -A && git commit -m "feat(web): écran administration des entrepôts"
```

---

### Task 14: Front — Administration : Utilisateurs & affectations

**Files:**
- Modify: `apps/web/src/routes/_app/administration/utilisateurs.tsx`
- Create: `apps/web/src/components/provisional-password-dialog.tsx`
- Create: `apps/web/src/components/provisional-password-dialog.test.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/v1/users`, `PATCH /users/:id/role`, `PATCH /users/:id/statut`, `POST/DELETE /api/v1/warehouse-members`, `GET /api/v1/warehouses`
- Produces: liste utilisateurs (nom, email, rôle traduit, affectations, statut) ; création avec **affichage unique** du mot de passe provisoire (composant `ProvisionalPasswordDialog` : props `{ password: string, email: string, onClose: () => void }`, avec bouton « Copier ») ; changement de rôle (select) ; affectation entrepôt+rôle ; désactivation/réactivation

- [ ] **Step 1: Test du dialog mot de passe provisoire (échec)**

`apps/web/src/components/provisional-password-dialog.test.tsx` :

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ProvisionalPasswordDialog } from "./provisional-password-dialog"

describe("ProvisionalPasswordDialog", () => {
  it("affiche le mot de passe et l'email, et se ferme", () => {
    const onClose = vi.fn()
    render(
      <ProvisionalPasswordDialog password="ABCD-EFGH-JKMN" email="emp@exemple.com" onClose={onClose} />,
    )
    expect(screen.getByText("ABCD-EFGH-JKMN")).toBeTruthy()
    expect(screen.getByText(/emp@exemple\.com/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "J'ai transmis le mot de passe" }))
    expect(onClose).toHaveBeenCalled()
  })
})
```

Run: `bun run --cwd apps/web test` — Expected: FAIL.

- [ ] **Step 2: Implémenter le dialog**

`apps/web/src/components/provisional-password-dialog.tsx` :

```tsx
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type Props = { password: string; email: string; onClose: () => void }

export function ProvisionalPasswordDialog({ password, email, onClose }: Props) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Compte créé</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-600">
          Transmettez ce mot de passe provisoire à <strong>{email}</strong>. Il ne sera plus jamais
          affiché ; l'employé devra le changer à sa première connexion.
        </p>
        <p className="my-2 rounded-md bg-gray-100 px-4 py-3 text-center font-mono text-lg tracking-widest select-all">
          {password}
        </p>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard?.writeText(password)
            }}
          >
            Copier
          </Button>
          <Button onClick={onClose}>J'ai transmis le mot de passe</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

Run: `bun run --cwd apps/web test` — Expected: PASS (8 web).

- [ ] **Step 3: Page utilisateurs**

`apps/web/src/routes/_app/administration/utilisateurs.tsx` :

```tsx
import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { CompanyRole, WarehouseRole } from "shared"
import { apiFetch } from "@/lib/api"
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
import { ProvisionalPasswordDialog } from "@/components/provisional-password-dialog"

export const Route = createFileRoute("/_app/administration/utilisateurs")({
  component: UtilisateursPage,
})

type Utilisateur = {
  id: string
  name: string
  email: string
  role: CompanyRole
  isActive: boolean
  assignments: Array<{ warehouseId: string; warehouseName: string; role: WarehouseRole }>
}

const ROLES_FR: Record<CompanyRole, string> = {
  owner: "Propriétaire",
  admin: "Administrateur",
  auditor: "Auditeur",
  stock_manager: "Gestionnaire de stock",
  staff: "Employé",
}

const ROLES_ENTREPOT_FR: Record<WarehouseRole, string> = {
  manager: "Responsable",
  auditor: "Auditeur",
  cashier: "Caissier",
}

function UtilisateursPage() {
  const { me } = Route.useRouteContext()
  const peutEcrire = me.membership?.role === "owner" || me.membership?.role === "admin"
  const queryClient = useQueryClient()

  const [dialogCreation, setDialogCreation] = useState(false)
  const [nom, setNom] = useState("")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<CompanyRole>("staff")
  const [erreur, setErreur] = useState<string | null>(null)
  const [provisoire, setProvisoire] = useState<{ password: string; email: string } | null>(null)
  const [affectation, setAffectation] = useState<{ userId: string; warehouseId: string; role: WarehouseRole }>({
    userId: "",
    warehouseId: "",
    role: "cashier",
  })

  const utilisateurs = useQuery({
    queryKey: ["users"],
    queryFn: () => apiFetch<{ users: Utilisateur[] }>("/api/v1/users"),
  })
  const entrepots = useQuery({
    queryKey: ["warehouses"],
    queryFn: () => apiFetch<{ warehouses: Array<{ id: string; name: string }> }>("/api/v1/warehouses"),
  })

  const invalider = () => queryClient.invalidateQueries({ queryKey: ["users"] })

  const creer = useMutation({
    mutationFn: () =>
      apiFetch<{ provisionalPassword: string }>("/api/v1/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: nom, email, role }),
      }),
    onSuccess: async (res) => {
      await invalider()
      setDialogCreation(false)
      setProvisoire({ password: res.provisionalPassword, email })
      setNom("")
      setEmail("")
      setRole("staff")
      setErreur(null)
    },
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })

  const changerRole = useMutation({
    mutationFn: (v: { userId: string; role: CompanyRole }) =>
      apiFetch(`/api/v1/users/${v.userId}/role`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: v.role }),
      }),
    onSuccess: invalider,
    onError: (err) => alert(err instanceof Error ? err.message : "Erreur"),
  })

  const changerStatut = useMutation({
    mutationFn: (u: Utilisateur) =>
      apiFetch(`/api/v1/users/${u.id}/statut`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !u.isActive }),
      }),
    onSuccess: invalider,
    onError: (err) => alert(err instanceof Error ? err.message : "Erreur"),
  })

  const affecter = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/warehouse-members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(affectation),
      }),
    onSuccess: async () => {
      await invalider()
      setAffectation({ userId: "", warehouseId: "", role: "cashier" })
    },
    onError: (err) => alert(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Utilisateurs</h1>
        {peutEcrire && (
          <Dialog open={dialogCreation} onOpenChange={setDialogCreation}>
            <DialogTrigger asChild>
              <Button>Nouvel utilisateur</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Créer un compte employé</DialogTitle>
              </DialogHeader>
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  creer.mutate()
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="u-nom">Nom</Label>
                  <Input id="u-nom" required value={nom} onChange={(e) => setNom(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="u-email">Email</Label>
                  <Input
                    id="u-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="u-role">Rôle</Label>
                  <select
                    id="u-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value as CompanyRole)}
                    className="h-10 rounded-md border px-2 text-sm"
                  >
                    <option value="staff">Employé (caissier)</option>
                    <option value="stock_manager">Gestionnaire de stock</option>
                    <option value="auditor">Auditeur</option>
                    {me.membership?.role === "owner" && <option value="admin">Administrateur</option>}
                  </select>
                </div>
                {erreur && (
                  <p role="alert" className="text-sm text-red-700">
                    {erreur}
                  </p>
                )}
                <Button type="submit" disabled={creer.isPending}>
                  {creer.isPending ? "Création…" : "Créer le compte"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {provisoire && (
        <ProvisionalPasswordDialog
          password={provisoire.password}
          email={provisoire.email}
          onClose={() => setProvisoire(null)}
        />
      )}

      {utilisateurs.isPending ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nom</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Rôle</TableHead>
              <TableHead>Affectations</TableHead>
              <TableHead>Statut</TableHead>
              {peutEcrire && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(utilisateurs.data?.users ?? []).map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.name}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>
                  {peutEcrire && u.id !== me.user.id ? (
                    <select
                      value={u.role}
                      onChange={(e) => changerRole.mutate({ userId: u.id, role: e.target.value as CompanyRole })}
                      className="rounded border px-1 py-0.5 text-sm"
                    >
                      {Object.entries(ROLES_FR).map(([valeur, libelle]) => (
                        <option key={valeur} value={valeur}>
                          {libelle}
                        </option>
                      ))}
                    </select>
                  ) : (
                    ROLES_FR[u.role]
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {u.assignments.length === 0
                    ? "—"
                    : u.assignments
                        .map((a) => `${a.warehouseName} (${ROLES_ENTREPOT_FR[a.role]})`)
                        .join(", ")}
                </TableCell>
                <TableCell>
                  <Badge variant={u.isActive ? "default" : "secondary"}>
                    {u.isActive ? "Actif" : "Désactivé"}
                  </Badge>
                </TableCell>
                {peutEcrire && (
                  <TableCell>
                    {u.id !== me.user.id && (
                      <Button variant="outline" size="sm" onClick={() => changerStatut.mutate(u)}>
                        {u.isActive ? "Désactiver" : "Réactiver"}
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {peutEcrire && (
        <div className="mt-8 max-w-2xl rounded-md border p-4">
          <h2 className="mb-3 text-base font-semibold">Affecter à un entrepôt</h2>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              affecter.mutate()
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="a-user">Utilisateur</Label>
              <select
                id="a-user"
                required
                value={affectation.userId}
                onChange={(e) => setAffectation({ ...affectation, userId: e.target.value })}
                className="h-10 rounded-md border px-2 text-sm"
              >
                <option value="">— choisir —</option>
                {(utilisateurs.data?.users ?? [])
                  .filter((u) => u.isActive)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="a-wh">Entrepôt</Label>
              <select
                id="a-wh"
                required
                value={affectation.warehouseId}
                onChange={(e) => setAffectation({ ...affectation, warehouseId: e.target.value })}
                className="h-10 rounded-md border px-2 text-sm"
              >
                <option value="">— choisir —</option>
                {(entrepots.data?.warehouses ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="a-role">Rôle</Label>
              <select
                id="a-role"
                value={affectation.role}
                onChange={(e) => setAffectation({ ...affectation, role: e.target.value as WarehouseRole })}
                className="h-10 rounded-md border px-2 text-sm"
              >
                <option value="cashier">Caissier</option>
                <option value="manager">Responsable</option>
                <option value="auditor">Auditeur</option>
              </select>
            </div>
            <Button type="submit" disabled={affecter.isPending}>
              Affecter
            </Button>
          </form>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Vérifier et committer**

```bash
bun run typecheck && bun run --cwd apps/web test && bun run --cwd apps/web build
git add -A && git commit -m "feat(web): écran administration des utilisateurs et affectations"
```

---

### Task 15: Front — Administration : Paramètres

**Files:**
- Modify: `apps/web/src/routes/_app/administration/parametres.tsx`

**Interfaces:**
- Consumes: `GET/PATCH /api/v1/organization`
- Produces: formulaire nom entreprise, devise (input 3 lettres, défaut XOF), en-tête et pied de ticket (textarea) ; lecture seule pour `auditor`

- [ ] **Step 1: Implémenter la page**

`apps/web/src/routes/_app/administration/parametres.tsx` :

```tsx
import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export const Route = createFileRoute("/_app/administration/parametres")({
  component: ParametresPage,
})

type Reglages = { name: string; currency: string; receiptHeader: string; receiptFooter: string }

function ParametresPage() {
  const { me } = Route.useRouteContext()
  const peutEcrire = me.membership?.role === "owner" || me.membership?.role === "admin"
  const queryClient = useQueryClient()
  const [form, setForm] = useState<Reglages | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const { data } = useQuery({
    queryKey: ["organization"],
    queryFn: () => apiFetch<Reglages>("/api/v1/organization"),
  })

  useEffect(() => {
    if (data && !form) setForm(data)
  }, [data, form])

  const enregistrer = useMutation({
    mutationFn: (values: Reglages) =>
      apiFetch("/api/v1/organization", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["organization"] })
      setMessage("Paramètres enregistrés")
    },
    onError: (err) => setMessage(err instanceof Error ? err.message : "Erreur"),
  })

  if (!form) return <p className="text-sm text-gray-500">Chargement…</p>

  return (
    <div className="max-w-xl">
      <h1 className="mb-6 text-xl font-semibold">Paramètres</h1>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          setMessage(null)
          enregistrer.mutate(form)
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-nom">Nom de l'entreprise</Label>
          <Input
            id="p-nom"
            required
            disabled={!peutEcrire}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-devise">Devise (code ISO, ex : XOF)</Label>
          <Input
            id="p-devise"
            required
            maxLength={3}
            disabled={!peutEcrire}
            value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
            className="w-28 font-mono uppercase"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-entete">En-tête de ticket</Label>
          <textarea
            id="p-entete"
            rows={2}
            disabled={!peutEcrire}
            value={form.receiptHeader}
            onChange={(e) => setForm({ ...form, receiptHeader: e.target.value })}
            className="rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-pied">Pied de ticket</Label>
          <textarea
            id="p-pied"
            rows={2}
            disabled={!peutEcrire}
            value={form.receiptFooter}
            onChange={(e) => setForm({ ...form, receiptFooter: e.target.value })}
            className="rounded-md border px-3 py-2 text-sm"
          />
        </div>
        {message && (
          <p role="status" className="text-sm font-medium text-gray-700">
            {message}
          </p>
        )}
        {peutEcrire && (
          <Button type="submit" disabled={enregistrer.isPending}>
            {enregistrer.isPending ? "Enregistrement…" : "Enregistrer"}
          </Button>
        )}
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Vérifier et committer**

```bash
bun run typecheck && bun run --cwd apps/web build
git add -A && git commit -m "feat(web): écran des paramètres d'organisation"
```

---

### Task 16: Finalisation — vérification bout-en-bout, roadmap, PR

**Files:**
- Modify: `docs/superpowers/plans/2026-07-08-pos-stocks-roadmap.md`

- [ ] **Step 1: Suite complète**

```bash
bun run typecheck && bun run lint && bun run test
```

Expected: tout vert (35 api + 8 web).

- [ ] **Step 2: Vérification manuelle bout-en-bout en local**

```bash
# Terminal 1 : cd apps/api && bun run db:migrate:local && bun run dev
# Terminal 2 : cd apps/web && bun run dev
```

Parcours à valider dans le navigateur (http://localhost:3000) :
1. Connexion owner → sections Administration visibles
2. Créer une boutique et un entrepôt → visibles dans la liste
3. Créer un employé « staff » → le mot de passe provisoire s'affiche une fois ; le copier
4. L'affecter comme caissier à la boutique → visible dans la colonne Affectations
5. Se déconnecter, se connecter avec l'employé → redirection forcée sur « Mon compte », bandeau orange ; impossible d'aller ailleurs
6. Changer le mot de passe → accès au tableau de bord ; PAS de section Administration
7. Se reconnecter owner → Paramètres : changer l'en-tête de ticket → « Paramètres enregistrés »
8. Désactiver l'employé → sa session est coupée (il est renvoyé au login au prochain chargement)

- [ ] **Step 3: Roadmap et PR**

Cocher dans la roadmap les items Phase 2 livrés (CRUD entrepôts, comptes + rôles, affectations, middleware, écrans) et passer le statut du tableau à « en cours → terminée » une fois mergée. Puis :

```bash
git push -u origin feat/phase-2-administration
gh pr create --title "Phase 2 — Administration : entrepôts, comptes, rôles et permissions" --body "## Résumé

- Schéma : \`warehouses\`, \`warehouse_members\`, champs \`user.mustChangePassword\`/\`user.isActive\` (additionalFields Better Auth, schéma régénéré)
- Middlewares de permissions à deux niveaux (rôle d'entreprise + rôle d'entrepôt) testés contre la matrice de la spec §4
- API : CRUD entrepôts, gestion des utilisateurs (création avec mot de passe provisoire, rôles avec protection du dernier owner, désactivation avec révocation de sessions), affectations d'entrepôt, paramètres d'organisation, changement de mot de passe avec parcours forcé
- Front : navigation par rôle, écrans Administration (entrepôts, utilisateurs + affectations, paramètres), page Mon compte, dialog d'affichage unique du mot de passe provisoire

## Tests

- API : 35 tests sur D1 réelle (permissions par rôle, parcours mot de passe provisoire complet)
- Web : 8 tests composants — typecheck + lint + build verts
- Parcours manuel bout-en-bout validé en local (8 étapes, voir plan Task 16)

Le merge déclenchera migrations D1 + déploiement automatiques.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```
