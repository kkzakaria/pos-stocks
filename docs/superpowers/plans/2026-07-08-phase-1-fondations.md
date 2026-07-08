# Phase 1 — Fondations : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monorepo opérationnel avec API (Hono + D1 + Drizzle + Better Auth + organisation) et SPA (login + shell back-office), testé et déployable sur deux Cloudflare Workers.

**Architecture:** Deux Workers séparés — `apps/api` (Hono, Better Auth avec adapter Drizzle sur D1, plugin organization) et `apps/web` (SPA React servie en assets statiques). `packages/shared` porte les schémas Zod partagés. L'inscription publique est bloquée par un hook Better Auth ; l'initialisation (owner + organisation) passe par une route protégée par jeton.

**Tech Stack:** bun (workspaces), Hono, Better Auth, Drizzle ORM, Cloudflare D1, wrangler, Vite, React 19, TanStack Router, TanStack Query, shadcn/ui, Tailwind 4, vitest + @cloudflare/vitest-pool-workers, Zod.

## Global Constraints

- Interface et messages d'erreur en **français** ; codes d'erreur stables en majuscules (ex. `NON_AUTHENTIFIE`)
- Montants en entiers (unités mineures), devise par défaut `XOF` — pas encore utilisé en Phase 1 mais aucune colonne monétaire en flottant
- Toutes les tables métier futures porteront `organizationId` (préparation SaaS)
- Identifiants texte (UUID via `crypto.randomUUID()`)
- Gestionnaire de paquets : **bun** (`bun install`, `bun run`, `bunx`)
- TDD : test d'abord quand un comportement est testable ; commits fréquents
- Ne jamais committer de secrets — `.dev.vars` est dans `.gitignore`

**Prérequis exécutant** : bun ≥ 1.1 installé ; pour la Tâche 9 uniquement, un compte Cloudflare authentifié (`wrangler login`).

---

### Task 1: Restructuration en monorepo + SPA web

Le scaffold actuel (TanStack Start à la racine) devient `apps/web` en SPA pure (sans SSR), et la racine devient un workspace bun.

**Files:**
- Create: `package.json` (racine, remplace l'existant), `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/tsconfig.json`, `apps/web/src/main.tsx`, `apps/web/src/routes/__root.tsx`, `apps/web/src/routes/index.tsx`
- Move: `src/styles.css` → `apps/web/src/styles.css`, `src/logo.svg` → `apps/web/src/logo.svg`, `public/*` → `apps/web/public/*`, `components.json` → `apps/web/components.json`
- Delete: `src/` (restes du scaffold Start : `router.tsx`, `routeTree.gen.ts`), `vite.config.ts` racine, `tsconfig.json` racine, `.cta.json`
- Modify: `.gitignore` ; `eslint.config.js` reste à la racine, inchangé

**Interfaces:**
- Produces: workspace bun `apps/*` + `packages/*` ; app web démarrable sur le port 3000 avec proxy `/api` → `http://localhost:8787` ; alias TS `@/` → `apps/web/src`

- [ ] **Step 1: Créer la structure et le package.json racine**

```bash
mkdir -p apps/web/src/routes packages
git mv src/styles.css apps/web/src/ 2>/dev/null || mv src/styles.css apps/web/src/
git mv src/logo.svg apps/web/src/ 2>/dev/null || mv src/logo.svg apps/web/src/
git mv public apps/web/public
git mv components.json apps/web/components.json
git rm -r src vite.config.ts tsconfig.json .cta.json
rm -rf node_modules bun.lock
```

`package.json` (racine) :

```json
{
  "name": "pos-stocks",
  "private": true,
  "type": "module",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev:web": "bun run --cwd apps/web dev",
    "dev:api": "bun run --cwd apps/api dev",
    "typecheck": "bun run --cwd apps/web typecheck && bun run --cwd apps/api typecheck && bun run --cwd packages/shared typecheck",
    "test": "bun run --cwd apps/web test && bun run --cwd apps/api test",
    "lint": "eslint .",
    "format": "prettier --write \"**/*.{ts,tsx,js,jsx}\""
  },
  "devDependencies": {
    "@tanstack/eslint-config": "latest",
    "eslint": "^9",
    "prettier": "^3.8.3",
    "prettier-plugin-tailwindcss": "^0.8.0",
    "typescript": "^5.9.0"
  }
}
```

Note : TypeScript `^5.9` (et non `^6` du scaffold) pour rester compatible avec l'écosystème (drizzle-kit, better-auth CLI). Ajouter à `.gitignore` les lignes `apps/api/.dev.vars` et `apps/api/.wrangler/`.

- [ ] **Step 2: Créer apps/web (SPA Vite + TanStack Router)**

`apps/web/package.json` :

```json
{
  "name": "web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev --port 3000",
    "build": "vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@base-ui/react": "^1.6.0",
    "@fontsource-variable/inter": "^5.2.8",
    "@tanstack/react-query": "^5.90.0",
    "@tanstack/react-router": "^1.130.0",
    "better-auth": "^1.4.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^1.23.0",
    "react": "^19.2.6",
    "react-dom": "^19.2.6",
    "tailwind-merge": "^3.6.0",
    "tailwindcss": "^4",
    "tw-animate-css": "^1.4.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4",
    "@tanstack/router-plugin": "^1.130.0",
    "@testing-library/dom": "^10.4.1",
    "@testing-library/react": "^16.3.2",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@vitejs/plugin-react": "^5.0.0",
    "jsdom": "^26",
    "typescript": "^5.9.0",
    "vite": "^7",
    "vitest": "^3.2.0"
  }
}
```

`apps/web/vite.config.ts` :

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 3000,
    proxy: { '/api': 'http://localhost:8787' },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
```

`apps/web/index.html` :

```html
<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>pos-stocks</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/tsconfig.json` :

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client", "vitest/globals"],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src", "vite.config.ts"]
}
```

`apps/web/src/main.tsx` :

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import '@fontsource-variable/inter'
import './styles.css'

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
```

`apps/web/src/routes/__root.tsx` :

```tsx
import { Outlet, createRootRoute } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: () => <Outlet />,
})
```

`apps/web/src/routes/index.tsx` :

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: () => (
    <main className="grid min-h-screen place-items-center">
      <h1 className="text-2xl font-semibold">pos-stocks</h1>
    </main>
  ),
})
```

- [ ] **Step 3: Installer et vérifier**

```bash
bun install
bun run --cwd apps/web dev &
sleep 3 && curl -s http://localhost:3000 | grep -q '<div id="root">' && echo OK
kill %1
```

Expected: `OK` (le plugin router génère `src/routeTree.gen.ts` au premier démarrage).

- [ ] **Step 4: Typecheck**

```bash
bun run --cwd apps/web typecheck
```

Expected: exit 0, aucune erreur.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: restructuration en monorepo bun, apps/web en SPA pure"
```

---

### Task 2: Package partagé + scaffold du Worker API

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`, `packages/shared/src/schemas/setup.ts`
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/wrangler.jsonc`, `apps/api/src/index.ts`, `apps/api/src/env.ts`
- Create: `apps/api/vitest.config.ts`, `apps/api/test/health.test.ts`

**Interfaces:**
- Produces: `shared` exporte `setupSchema` (Zod) et le type `SetupInput` ; `apps/api/src/index.ts` exporte `default app` (Hono) et `apps/api/src/env.ts` exporte `type Env = { DB: D1Database; BETTER_AUTH_SECRET: string; BETTER_AUTH_URL: string; WEB_ORIGIN: string; COOKIE_DOMAIN?: string; SETUP_TOKEN: string }` ; `GET /api/v1/health` → `200 { "status": "ok" }`

- [ ] **Step 1: Créer packages/shared**

`packages/shared/package.json` :

```json
{
  "name": "shared",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./schemas/*": "./src/schemas/*.ts"
  },
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": { "zod": "^4.0.0" },
  "devDependencies": { "typescript": "^5.9.0" }
}
```

`packages/shared/tsconfig.json` :

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

`packages/shared/src/schemas/setup.ts` :

```ts
import { z } from 'zod'

export const setupSchema = z.object({
  organizationName: z.string().min(1, "Le nom de l'entreprise est requis"),
  name: z.string().min(1, 'Le nom est requis'),
  email: z.string().email('Adresse email invalide'),
  password: z.string().min(12, 'Le mot de passe doit contenir au moins 12 caractères'),
})

export type SetupInput = z.infer<typeof setupSchema>
```

`packages/shared/src/index.ts` :

```ts
export { setupSchema, type SetupInput } from './schemas/setup'
```

- [ ] **Step 2: Créer le scaffold apps/api**

`apps/api/package.json` :

```json
{
  "name": "api",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate:local": "wrangler d1 migrations apply pos-stocks-db --local",
    "db:migrate:remote": "wrangler d1 migrations apply pos-stocks-db --remote",
    "cf-typegen": "wrangler types"
  },
  "dependencies": {
    "better-auth": "^1.4.0",
    "drizzle-orm": "^0.44.0",
    "hono": "^4.9.0",
    "shared": "workspace:*",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@better-auth/cli": "^1.4.0",
    "@cloudflare/vitest-pool-workers": "^0.9.0",
    "@cloudflare/workers-types": "^4.20260601.0",
    "drizzle-kit": "^0.31.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0",
    "wrangler": "^4.40.0"
  }
}
```

Note versions : `@cloudflare/vitest-pool-workers` impose une plage de `vitest` en peerDependency — si `bun install` affiche un avertissement de peer, aligner la version de `vitest` d'`apps/api` sur la plage demandée.

`apps/api/wrangler.jsonc` :

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "pos-stocks-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-06-01",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "pos-stocks-db",
      // ID local factice — remplacé en Tâche 9 par l'ID renvoyé par `wrangler d1 create`
      "database_id": "00000000-0000-0000-0000-000000000000",
      "migrations_dir": "drizzle"
    }
  ]
}
```

`apps/api/src/env.ts` :

```ts
export type Env = {
  DB: D1Database
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  WEB_ORIGIN: string
  COOKIE_DOMAIN?: string
  SETUP_TOKEN: string
}
```

`apps/api/tsconfig.json` :

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"]
  },
  "include": ["src", "test", "drizzle.config.ts", "vitest.config.ts", "auth-cli.ts"]
}
```

- [ ] **Step 3: Écrire le test qui échoue (health)**

`apps/api/vitest.config.ts` :

```ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            BETTER_AUTH_SECRET: 'secret-de-test-secret-de-test-32c',
            BETTER_AUTH_URL: 'http://localhost:8787',
            WEB_ORIGIN: 'http://localhost:3000',
            SETUP_TOKEN: 'jeton-de-setup-test',
          },
        },
      },
    },
  },
})
```

`apps/api/test/health.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import app from '../src/index'

describe('GET /api/v1/health', () => {
  it('répond 200 avec le statut ok', async () => {
    const res = await app.request('/api/v1/health', {}, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })
})
```

Déclarer le type de `env` pour les tests — `apps/api/test/env.d.ts` :

```ts
import type { Env } from '../src/env'

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[]
  }
}
```

- [ ] **Step 4: Vérifier que le test échoue**

```bash
cd apps/api && bun install && bun run test
```

Expected: FAIL — `../src/index` introuvable.

- [ ] **Step 5: Implémenter l'app Hono minimale**

`apps/api/src/index.ts` :

```ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './env'

const app = new Hono<{ Bindings: Env }>()

app.use('/api/*', (c, next) =>
  cors({ origin: c.env.WEB_ORIGIN, credentials: true })(c, next),
)

app.get('/api/v1/health', (c) => c.json({ status: 'ok' }))

export default app
```

- [ ] **Step 6: Vérifier que le test passe**

```bash
bun run test
```

Expected: PASS (1 test).

- [ ] **Step 7: Typecheck global et commit**

```bash
cd ../.. && bun install && bun run typecheck
git add -A
git commit -m "feat(api): scaffold Hono + wrangler + vitest-pool-workers, package shared"
```

---

### Task 3: Drizzle + schéma Better Auth + migrations

**Files:**
- Create: `apps/api/auth-cli.ts` (config uniquement pour la CLI Better Auth), `apps/api/drizzle.config.ts`, `apps/api/src/db/schema/auth.ts` (généré), `apps/api/src/db/schema/index.ts`, `apps/api/test/apply-migrations.ts`
- Modify: `apps/api/vitest.config.ts`

**Interfaces:**
- Produces: `src/db/schema/index.ts` réexporte les tables Better Auth (`user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`) ; dossier `apps/api/drizzle/` contenant les migrations SQL ; les tests appliquent automatiquement les migrations sur la D1 de test

- [ ] **Step 1: Créer la config CLI et générer le schéma Drizzle**

`apps/api/auth-cli.ts` — utilisé UNIQUEMENT par `@better-auth/cli generate` (les plugins déclarés ici doivent rester synchronisés avec `src/lib/auth.ts` ; re-générer après tout ajout de plugin) :

```ts
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins/organization'
import { drizzle } from 'drizzle-orm/d1'

export const auth = betterAuth({
  database: drizzleAdapter(drizzle({} as D1Database), { provider: 'sqlite' }),
  emailAndPassword: { enabled: true },
  plugins: [organization()],
})
```

```bash
cd apps/api
bunx @better-auth/cli@latest generate --config ./auth-cli.ts --output ./src/db/schema/auth.ts --yes
```

Expected: `src/db/schema/auth.ts` créé, contenant les tables `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation` en syntaxe Drizzle sqlite.

`apps/api/src/db/schema/index.ts` :

```ts
export * from './auth'
```

- [ ] **Step 2: Générer la migration SQL**

`apps/api/drizzle.config.ts` :

```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema',
  out: './drizzle',
})
```

```bash
bun run db:generate
```

Expected: un fichier `drizzle/0000_*.sql` créé avec les `CREATE TABLE` des 7 tables.

- [ ] **Step 3: Appliquer les migrations en local et brancher les tests**

```bash
bun run db:migrate:local
```

Expected: `1 migration applied` (crée `.wrangler/state` local).

Modifier `apps/api/vitest.config.ts` pour lire et appliquer les migrations :

```ts
import path from 'node:path'
import {
  defineWorkersConfig,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, 'drizzle'))
  return {
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.jsonc' },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              BETTER_AUTH_SECRET: 'secret-de-test-secret-de-test-32c',
              BETTER_AUTH_URL: 'http://localhost:8787',
              WEB_ORIGIN: 'http://localhost:3000',
              SETUP_TOKEN: 'jeton-de-setup-test',
            },
          },
        },
      },
    },
  }
})
```

`apps/api/test/apply-migrations.ts` :

```ts
import { applyD1Migrations, env } from 'cloudflare:test'

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
```

- [ ] **Step 4: Vérifier que les tests passent toujours et que la table user existe**

Ajouter temporairement à `apps/api/test/health.test.ts` (dans le même `describe`) puis exécuter :

```ts
it('les migrations sont appliquées', async () => {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='user'",
  ).all()
  expect(results).toHaveLength(1)
})
```

```bash
bun run test
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): schéma Better Auth via Drizzle, migrations D1 branchées aux tests"
```

---

### Task 4: Better Auth serveur (adapter Drizzle/D1, signup bloqué, cookies cross-sous-domaines)

**Files:**
- Create: `apps/api/src/lib/auth.ts`, `apps/api/.dev.vars`, `apps/api/.dev.vars.example`, `apps/api/test/auth.test.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `Env` (Task 2), schéma `src/db/schema` (Task 3)
- Produces: `createAuth(env: Env)` → instance Better Auth ; routes `/api/auth/*` opérationnelles ; l'inscription (`POST /api/auth/sign-up/email`) exige l'en-tête `x-setup-token: <SETUP_TOKEN>`, sinon 403

- [ ] **Step 1: Écrire les tests qui échouent**

`apps/api/test/auth.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import app from '../src/index'

const signUpBody = {
  email: 'admin@exemple.com',
  password: 'MotDePasseTresSolide1',
  name: 'Admin Test',
}

function signUp(headers: Record<string, string> = {}) {
  return app.request(
    '/api/auth/sign-up/email',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(signUpBody),
    },
    env,
  )
}

describe('Better Auth', () => {
  it("refuse l'inscription publique sans jeton de setup", async () => {
    const res = await signUp()
    expect(res.status).toBe(403)
  })

  it("accepte l'inscription avec le jeton, puis la connexion", async () => {
    const created = await signUp({ 'x-setup-token': env.SETUP_TOKEN })
    expect(created.status).toBe(200)

    const signIn = await app.request(
      '/api/auth/sign-in/email',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: signUpBody.email,
          password: signUpBody.password,
        }),
      },
      env,
    )
    expect(signIn.status).toBe(200)
    expect(signIn.headers.get('set-cookie')).toContain('better-auth')
  })
})
```

- [ ] **Step 2: Vérifier l'échec**

```bash
bun run test
```

Expected: FAIL — 404 sur `/api/auth/sign-up/email` (routes non montées).

- [ ] **Step 3: Implémenter createAuth et monter les routes**

`apps/api/src/lib/auth.ts` :

```ts
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins/organization'
import { createAuthMiddleware, APIError } from 'better-auth/api'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import type { Env } from '../env'

export function createAuth(env: Env) {
  const db = drizzle(env.DB, { schema })
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'sqlite' }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.WEB_ORIGIN],
    emailAndPassword: { enabled: true },
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === '/sign-up/email',
          handler: createAuthMiddleware(async (ctx) => {
            if (ctx.headers?.get('x-setup-token') !== env.SETUP_TOKEN) {
              throw new APIError('FORBIDDEN', {
                message: "L'inscription publique est désactivée",
              })
            }
          }),
        },
      ],
    },
    advanced: env.COOKIE_DOMAIN
      ? {
          crossSubDomainCookies: { enabled: true, domain: env.COOKIE_DOMAIN },
          useSecureCookies: true,
        }
      : {},
    plugins: [organization()],
  })
}

export type Auth = ReturnType<typeof createAuth>
```

Note : la forme exacte de `hooks.before` (tableau `{ matcher, handler }`) est celle documentée sur better-auth.com/docs — vérifier contre la version installée ; si l'API diffère, adapter en conservant le comportement testé (403 sans jeton).

Dans `apps/api/src/index.ts`, ajouter après la route health :

```ts
import { createAuth } from './lib/auth'

app.on(['GET', 'POST'], '/api/auth/*', (c) => createAuth(c.env).handler(c.req.raw))
```

`apps/api/.dev.vars.example` (committé) et `.dev.vars` (non committé, mêmes clés avec vraies valeurs) :

```
BETTER_AUTH_SECRET=generer-avec-openssl-rand-base64-32
BETTER_AUTH_URL=http://localhost:8787
WEB_ORIGIN=http://localhost:3000
SETUP_TOKEN=choisir-un-jeton-long-et-secret
```

- [ ] **Step 4: Vérifier que les tests passent**

```bash
bun run test
```

Expected: PASS (4 tests). Si le test signup renvoie 500, lire l'erreur : un mismatch de schéma (Task 3) se manifeste ici.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): Better Auth sur D1 (drizzle), inscription publique bloquée par jeton"
```

---

### Task 5: Bootstrap de l'organisation (route /api/v1/setup)

**Files:**
- Create: `apps/api/src/routes/setup.ts`, `apps/api/test/setup.test.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `createAuth` (Task 4), `setupSchema` de `shared` (Task 2), tables `organization`/`member` (Task 3)
- Produces: `POST /api/v1/setup` (en-tête `x-setup-token` requis) → crée user owner + organisation (slug `principale`, metadata `{"currency":"XOF"}`) + membre `owner` ; `201 { organizationId, userId }` ; `403 INTERDIT` si jeton invalide ; `409 DEJA_INITIALISE` si une organisation existe ; `400` si payload invalide

- [ ] **Step 1: Écrire les tests qui échouent**

`apps/api/test/setup.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import app from '../src/index'

const payload = {
  organizationName: 'Ma Société',
  name: 'Propriétaire',
  email: 'owner@exemple.com',
  password: 'MotDePasseTresSolide1',
}

function setup(body: unknown, token?: string) {
  return app.request(
    '/api/v1/setup',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { 'x-setup-token': token } : {}),
      },
      body: JSON.stringify(body),
    },
    env,
  )
}

describe('POST /api/v1/setup', () => {
  it('refuse sans jeton valide', async () => {
    const res = await setup(payload, 'mauvais-jeton')
    expect(res.status).toBe(403)
  })

  it('refuse un payload invalide', async () => {
    const res = await setup({ ...payload, password: 'court' }, env.SETUP_TOKEN)
    expect(res.status).toBe(400)
  })

  it("crée l'owner et l'organisation, puis refuse une seconde initialisation", async () => {
    const res = await setup(payload, env.SETUP_TOKEN)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { organizationId: string; userId: string }
    expect(body.organizationId).toBeTruthy()
    expect(body.userId).toBeTruthy()

    const again = await setup(payload, env.SETUP_TOKEN)
    expect(again.status).toBe(409)
    expect(((await again.json()) as { code: string }).code).toBe('DEJA_INITIALISE')
  })
})
```

- [ ] **Step 2: Vérifier l'échec**

```bash
bun run test
```

Expected: FAIL — 404 sur `/api/v1/setup`.

- [ ] **Step 3: Implémenter la route**

`apps/api/src/routes/setup.ts` :

```ts
import { Hono } from 'hono'
import { drizzle } from 'drizzle-orm/d1'
import { setupSchema } from 'shared'
import { createAuth } from '../lib/auth'
import * as schema from '../db/schema'
import type { Env } from '../env'

export const setupRoute = new Hono<{ Bindings: Env }>()

setupRoute.post('/', async (c) => {
  if (c.req.header('x-setup-token') !== c.env.SETUP_TOKEN) {
    return c.json({ code: 'INTERDIT', message: 'Jeton de setup invalide' }, 403)
  }

  const parsed = setupSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json(
      { code: 'VALIDATION', message: 'Données invalides', details: parsed.error.flatten() },
      400,
    )
  }

  const db = drizzle(c.env.DB, { schema })
  const existing = await db.select({ id: schema.organization.id }).from(schema.organization).limit(1)
  if (existing.length > 0) {
    return c.json({ code: 'DEJA_INITIALISE', message: "L'application est déjà initialisée" }, 409)
  }

  const auth = createAuth(c.env)
  const signUp = await auth.api.signUpEmail({
    body: {
      email: parsed.data.email,
      password: parsed.data.password,
      name: parsed.data.name,
    },
    headers: new Headers({ 'x-setup-token': c.env.SETUP_TOKEN }),
  })

  const now = new Date()
  const organizationId = crypto.randomUUID()
  await db.batch([
    db.insert(schema.organization).values({
      id: organizationId,
      name: parsed.data.organizationName,
      slug: 'principale',
      createdAt: now,
      metadata: JSON.stringify({ currency: 'XOF' }),
    }),
    db.insert(schema.member).values({
      id: crypto.randomUUID(),
      organizationId,
      userId: signUp.user.id,
      role: 'owner',
      createdAt: now,
    }),
  ])

  return c.json({ organizationId, userId: signUp.user.id }, 201)
})
```

Dans `apps/api/src/index.ts` :

```ts
import { setupRoute } from './routes/setup'

app.route('/api/v1/setup', setupRoute)
```

Note : si le typecheck signale des colonnes différentes sur `organization`/`member`, ouvrir `src/db/schema/auth.ts` (généré en Task 3) et aligner les noms de champs sur ceux générés — c'est le schéma généré qui fait foi.

- [ ] **Step 4: Vérifier que les tests passent**

```bash
bun run test && bun run typecheck
```

Expected: PASS (7 tests), typecheck sans erreur.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): route de bootstrap organisation + owner protégée par jeton"
```

---

### Task 6: Middleware de session + route /api/v1/me

**Files:**
- Create: `apps/api/src/middleware/require-auth.ts`, `apps/api/src/routes/me.ts`, `apps/api/test/me.test.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `createAuth` (Task 4), tables `member`/`organization` (Task 3)
- Produces: middleware `requireAuth` qui pose `c.get('user')` (type `AuthUser = { id: string; email: string; name: string }`) et renvoie `401 { code: 'NON_AUTHENTIFIE' }` sans session ; `GET /api/v1/me` → `200 { user: { id, email, name }, membership: { organizationId, organizationName, role } | null }`

- [ ] **Step 1: Écrire les tests qui échouent**

`apps/api/test/me.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import app from '../src/index'

async function bootstrapAndSignIn() {
  await app.request(
    '/api/v1/setup',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-setup-token': env.SETUP_TOKEN },
      body: JSON.stringify({
        organizationName: 'Ma Société',
        name: 'Propriétaire',
        email: 'owner@exemple.com',
        password: 'MotDePasseTresSolide1',
      }),
    },
    env,
  )
  const signIn = await app.request(
    '/api/auth/sign-in/email',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@exemple.com', password: 'MotDePasseTresSolide1' }),
    },
    env,
  )
  return signIn.headers.get('set-cookie') ?? ''
}

describe('GET /api/v1/me', () => {
  it('renvoie 401 sans session', async () => {
    const res = await app.request('/api/v1/me', {}, env)
    expect(res.status).toBe(401)
    expect(((await res.json()) as { code: string }).code).toBe('NON_AUTHENTIFIE')
  })

  it("renvoie l'utilisateur et son rôle owner avec session", async () => {
    const cookie = await bootstrapAndSignIn()
    const res = await app.request('/api/v1/me', { headers: { cookie } }, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      user: { email: string }
      membership: { role: string; organizationName: string }
    }
    expect(body.user.email).toBe('owner@exemple.com')
    expect(body.membership.role).toBe('owner')
    expect(body.membership.organizationName).toBe('Ma Société')
  })
})
```

- [ ] **Step 2: Vérifier l'échec**

```bash
bun run test
```

Expected: FAIL — 404 sur `/api/v1/me`.

- [ ] **Step 3: Implémenter middleware et route**

`apps/api/src/middleware/require-auth.ts` :

```ts
import { createMiddleware } from 'hono/factory'
import { createAuth } from '../lib/auth'
import type { Env } from '../env'

export type AuthUser = { id: string; email: string; name: string }

export type AuthVariables = { user: AuthUser }

export const requireAuth = createMiddleware<{
  Bindings: Env
  Variables: AuthVariables
}>(async (c, next) => {
  const auth = createAuth(c.env)
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) {
    return c.json({ code: 'NON_AUTHENTIFIE', message: 'Authentification requise' }, 401)
  }
  c.set('user', {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  })
  await next()
})
```

`apps/api/src/routes/me.ts` :

```ts
import { Hono } from 'hono'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema'
import { requireAuth, type AuthVariables } from '../middleware/require-auth'
import type { Env } from '../env'

export const meRoute = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

meRoute.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const db = drizzle(c.env.DB, { schema })
  const rows = await db
    .select({
      organizationId: schema.member.organizationId,
      organizationName: schema.organization.name,
      role: schema.member.role,
    })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.member.organizationId, schema.organization.id))
    .where(eq(schema.member.userId, user.id))
    .limit(1)

  return c.json({ user, membership: rows[0] ?? null })
})
```

Dans `apps/api/src/index.ts` :

```ts
import { meRoute } from './routes/me'

app.route('/api/v1/me', meRoute)
```

- [ ] **Step 4: Vérifier que les tests passent**

```bash
bun run test && bun run typecheck
```

Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): middleware de session et route /api/v1/me"
```

---

### Task 7: Front — client auth, page de connexion, garde de routes, shell

**Files:**
- Create: `apps/web/src/lib/auth-client.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/routes/login.tsx`, `apps/web/src/routes/_app.tsx`, `apps/web/src/routes/_app/index.tsx`, `apps/web/src/components/login-form.tsx`, `apps/web/src/components/login-form.test.tsx`, `apps/web/src/test-setup.ts`
- Modify: `apps/web/src/routes/index.tsx` (supprimé, remplacé par `_app/index.tsx`), `apps/web/vite.config.ts` (setupFiles)

**Interfaces:**
- Consumes: `/api/auth/*` (Task 4), `/api/v1/me` (Task 6)
- Produces: `authClient` (better-auth/react, plugin organizationClient) ; layout `_app` qui redirige vers `/login` si pas de session ; `LoginForm` avec props `{ onSubmit: (values: { email: string; password: string }) => Promise<string | null> }` (retourne un message d'erreur ou null)

- [ ] **Step 1: Écrire le test du composant LoginForm (échec)**

Dans `apps/web/vite.config.ts`, compléter la section test :

```ts
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
```

`apps/web/src/test-setup.ts` :

```ts
import '@testing-library/dom'
```

`apps/web/src/components/login-form.test.tsx` :

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LoginForm } from './login-form'

describe('LoginForm', () => {
  it('soumet email et mot de passe', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null)
    render(<LoginForm onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'a@b.com' },
    })
    fireEvent.change(screen.getByLabelText('Mot de passe'), {
      target: { value: 'secret123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        email: 'a@b.com',
        password: 'secret123456',
      }),
    )
  })

  it("affiche le message d'erreur retourné", async () => {
    const onSubmit = vi.fn().mockResolvedValue('Identifiants invalides')
    render(<LoginForm onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Mot de passe'), {
      target: { value: 'mauvais' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))

    expect(await screen.findByText('Identifiants invalides')).toBeTruthy()
  })
})
```

```bash
cd apps/web && bun run test
```

Expected: FAIL — `./login-form` introuvable.

- [ ] **Step 2: Implémenter LoginForm**

`apps/web/src/components/login-form.tsx` :

```tsx
import { useState } from 'react'

type Props = {
  onSubmit: (values: { email: string; password: string }) => Promise<string | null>
}

export function LoginForm({ onSubmit }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const message = await onSubmit({ email, password })
    setError(message)
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Mot de passe
        </label>
        <input
          id="password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Se connecter
      </button>
    </form>
  )
}
```

```bash
bun run test
```

Expected: PASS (2 tests).

- [ ] **Step 3: Client auth et routes**

`apps/web/src/lib/auth-client.ts` :

```ts
import { createAuthClient } from 'better-auth/react'
import { organizationClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  // En dev, le proxy Vite fait suivre /api vers le Worker local ; en prod,
  // VITE_API_URL pointe vers https://api.<domaine>
  baseURL: import.meta.env.VITE_API_URL || undefined,
  plugins: [organizationClient()],
})
```

`apps/web/src/lib/api.ts` :

```ts
const base = import.meta.env.VITE_API_URL || ''

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, { credentials: 'include', ...init })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message ?? `Erreur ${res.status}`)
  }
  return res.json() as Promise<T>
}
```

`apps/web/src/routes/login.tsx` :

```tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { authClient } from '@/lib/auth-client'
import { LoginForm } from '@/components/login-form'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()

  async function handleSubmit(values: { email: string; password: string }) {
    const { error } = await authClient.signIn.email(values)
    if (error) return 'Identifiants invalides'
    await navigate({ to: '/' })
    return null
  }

  return (
    <main className="grid min-h-screen place-items-center">
      <div className="flex flex-col items-center gap-6">
        <h1 className="text-2xl font-semibold">pos-stocks</h1>
        <LoginForm onSubmit={handleSubmit} />
      </div>
    </main>
  )
}
```

Supprimer `apps/web/src/routes/index.tsx` puis créer `apps/web/src/routes/_app.tsx` (layout gardé) :

```tsx
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { authClient } from '@/lib/auth-client'

export const Route = createFileRoute('/_app')({
  beforeLoad: async () => {
    const { data } = await authClient.getSession()
    if (!data) throw redirect({ to: '/login' })
    return { user: data.user }
  },
  component: AppLayout,
})

function AppLayout() {
  const { user } = Route.useRouteContext()

  async function handleSignOut() {
    await authClient.signOut()
    window.location.href = '/login'
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col justify-between border-r p-4">
        <div>
          <h2 className="mb-6 text-lg font-semibold">pos-stocks</h2>
          <nav className="flex flex-col gap-2 text-sm">
            <span className="font-medium">Tableau de bord</span>
          </nav>
        </div>
        <div className="flex flex-col gap-2 text-sm">
          <span className="truncate text-gray-500">{user.email}</span>
          <button onClick={handleSignOut} className="text-left text-red-600">
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

`apps/web/src/routes/_app/index.tsx` :

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/')({
  component: () => (
    <div>
      <h1 className="text-xl font-semibold">Tableau de bord</h1>
      <p className="mt-2 text-sm text-gray-500">
        Bienvenue. Les modules arrivent dans les prochaines phases.
      </p>
    </div>
  ),
})
```

- [ ] **Step 4: Vérification manuelle bout-en-bout en local**

```bash
# Terminal 1
cd apps/api && bun run db:migrate:local && bun run dev
# Terminal 2
cd apps/web && bun run dev
# Terminal 3 — initialiser (SETUP_TOKEN = valeur de apps/api/.dev.vars)
curl -s -X POST http://localhost:8787/api/v1/setup \
  -H 'content-type: application/json' -H "x-setup-token: $SETUP_TOKEN" \
  -d '{"organizationName":"Ma Société","name":"Owner","email":"owner@exemple.com","password":"MotDePasseTresSolide1"}'
```

Expected: réponse 201. Puis dans le navigateur sur `http://localhost:3000` : redirection vers `/login`, connexion avec `owner@exemple.com`, arrivée sur le tableau de bord, déconnexion fonctionnelle.

- [ ] **Step 5: Typecheck, tests, commit**

```bash
cd ../.. && bun run typecheck && bun run test
git add -A
git commit -m "feat(web): connexion Better Auth, garde de routes et shell back-office"
```

---

### Task 8: CI GitHub Actions

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: scripts racine `typecheck`, `lint`, `test` (Task 1)
- Produces: CI verte sur chaque push

- [ ] **Step 1: Créer le workflow**

`.github/workflows/ci.yml` :

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun run lint
      - run: bun run test
```

- [ ] **Step 2: Vérifier localement les trois commandes**

```bash
bun run typecheck && bun run lint && bun run test
```

Expected: exit 0 pour les trois. (Si `lint` échoue sur les fichiers déplacés, corriger les erreurs signalées avant de committer.)

- [ ] **Step 3: Commit et push**

```bash
git add .github
git commit -m "ci: typecheck, lint et tests sur chaque push"
git push
```

Expected: le workflow passe au vert sur GitHub (vérifier avec `gh run watch` ou l'onglet Actions).

---

### Task 9: Premier déploiement des deux Workers

⚠️ Nécessite un compte Cloudflare authentifié (`wrangler login`) et, pour les domaines personnalisés, une zone DNS sur le compte. Si l'exécutant n'a pas les accès, documenter les commandes exécutées/restantes et s'arrêter proprement.

**Files:**
- Create: `apps/web/wrangler.jsonc`
- Modify: `apps/api/wrangler.jsonc` (database_id réel)

**Interfaces:**
- Consumes: tout ce qui précède
- Produces: API accessible sur `https://pos-stocks-api.<compte>.workers.dev`, SPA sur `https://pos-stocks-web.<compte>.workers.dev` (domaines personnalisés + `COOKIE_DOMAIN` : hors périmètre Phase 1, notés pour Phase 2)

- [ ] **Step 1: Créer la base D1 et mettre à jour la config**

```bash
cd apps/api
bunx wrangler d1 create pos-stocks-db
```

Expected: sortie contenant `database_id = "<uuid>"`. Reporter cet UUID dans `apps/api/wrangler.jsonc` (`database_id`).

```bash
bun run db:migrate:remote
```

Expected: `1 migration applied`.

- [ ] **Step 2: Poser les secrets et déployer l'API**

```bash
openssl rand -base64 32   # → BETTER_AUTH_SECRET
openssl rand -base64 32   # → SETUP_TOKEN
bunx wrangler secret put BETTER_AUTH_SECRET
bunx wrangler secret put SETUP_TOKEN
```

Ajouter les variables non secrètes dans `apps/api/wrangler.jsonc` :

```jsonc
  "vars": {
    "BETTER_AUTH_URL": "https://pos-stocks-api.<compte>.workers.dev",
    "WEB_ORIGIN": "https://pos-stocks-web.<compte>.workers.dev"
  }
```

```bash
bunx wrangler deploy
curl -s https://pos-stocks-api.<compte>.workers.dev/api/v1/health
```

Expected: `{"status":"ok"}`.

- [ ] **Step 3: Déployer la SPA**

`apps/web/wrangler.jsonc` :

```jsonc
{
  "$schema": "../api/node_modules/wrangler/config-schema.json",
  "name": "pos-stocks-web",
  "compatibility_date": "2026-06-01",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application"
  }
}
```

```bash
cd ../web
VITE_API_URL=https://pos-stocks-api.<compte>.workers.dev bun run build
bunx wrangler deploy
```

Note : sur deux domaines `workers.dev` distincts, les cookies de session sont **cross-site** — la connexion depuis la SPA déployée ne fonctionnera pleinement qu'avec les domaines personnalisés partageant un domaine racine (`app.x.com` / `api.x.com` + `COOKIE_DOMAIN=.x.com`), prévus en Phase 2. Pour la Phase 1, valider en production : health API + chargement de la SPA + bootstrap via curl (Step 4). La connexion bout-en-bout en production sera validée en Phase 2 avec les domaines.

- [ ] **Step 4: Bootstrap de production et vérification**

```bash
curl -s -X POST https://pos-stocks-api.<compte>.workers.dev/api/v1/setup \
  -H 'content-type: application/json' -H 'x-setup-token: <SETUP_TOKEN de prod>' \
  -d '{"organizationName":"<Nom réel>","name":"<Owner>","email":"<email>","password":"<mot de passe fort>"}'
```

Expected: 201. Rejouer la commande → 409 `DEJA_INITIALISE`.

- [ ] **Step 5: Commit et mise à jour de la roadmap**

```bash
git add -A
git commit -m "chore: configuration de déploiement des deux Workers"
```

Cocher les cases Phase 1 dans `docs/superpowers/plans/2026-07-08-pos-stocks-roadmap.md`, passer le statut Phase 1 à ✅, et committer.
