import path from "node:path"
import {
  defineWorkersConfig,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config"

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "drizzle"))
  return {
    test: {
      // Tests sur D1 réelle avec plusieurs hachages scrypt par cas : les
      // matrices multi-utilisateurs dépassent les 5 s par défaut sur les
      // runners CI partagés (échecs observés à ~5,3 s, PR #5).
      testTimeout: 20000,
      // Crash workerd « Network connection lost » récurrent sur les runners
      // CI partagés (PR #6, généralisé PR #8 quand la suite a atteint ~245
      // tests) : retry global en CI uniquement. Sûr : l'isolatedStorage est
      // réinitialisé ENTRE les tentatives (vérifié empiriquement, PR #6) ;
      // un vrai échec reste rouge sur les 3 tentatives.
      retry: process.env.CI ? 2 : 0,
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            r2Buckets: ["IMAGES"],
            bindings: {
              TEST_MIGRATIONS: migrations,
              BETTER_AUTH_SECRET: "secret-de-test-secret-de-test-32c",
              BETTER_AUTH_URL: "http://localhost:8787",
              WEB_ORIGIN: "http://localhost:3000",
              SETUP_TOKEN: "jeton-de-setup-test",
            },
          },
        },
      },
    },
  }
})
