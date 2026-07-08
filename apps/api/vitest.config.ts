import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config"

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            BETTER_AUTH_SECRET: "secret-de-test-secret-de-test-32c",
            BETTER_AUTH_URL: "http://localhost:8787",
            WEB_ORIGIN: "http://localhost:3000",
            SETUP_TOKEN: "jeton-de-setup-test",
          },
        },
      },
    },
  },
})
