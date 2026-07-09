import path from "node:path"
import {
  defineWorkersConfig,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config"

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "drizzle"))
  return {
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
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
