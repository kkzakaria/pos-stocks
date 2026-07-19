//  @ts-check

import { tanstackConfig } from "@tanstack/eslint-config"

export default [
  ...tanstackConfig,
  {
    rules: {
      "import/no-cycle": "off",
      "import/order": "off",
      "sort-imports": "off",
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/require-await": "off",
      "pnpm/json-enforce-catalog": "off",
    },
  },
  {
    ignores: [
      "eslint.config.js",
      ".prettierrc",
      "**/routeTree.gen.ts",
      "**/.wrangler/",
      // Worktrees d'agent : checkouts complets du dépôt, hors périmètre du
      // lint racine (leurs fichiers ne résolvent pas les tsconfig d'ici).
      ".claude/",
    ],
  },
]
