import { createAuthClient } from "better-auth/react"
import { organizationClient } from "better-auth/client/plugins"

export const authClient = createAuthClient({
  // En dev, le proxy Vite fait suivre /api vers le Worker local ; en prod,
  // VITE_API_URL pointe vers https://api.<domaine>
  baseURL: import.meta.env.VITE_API_URL || undefined,
  plugins: [organizationClient()],
})
