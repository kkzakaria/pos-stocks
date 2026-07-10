import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_app/catalogue/categories")({
  component: () => <p>À venir</p>,
})
