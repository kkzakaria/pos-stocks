import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_app/catalogue/fournisseurs")({
  component: () => <p>À venir</p>,
})
