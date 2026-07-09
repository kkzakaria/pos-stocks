import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_app/mon-compte")({
  component: () => <p>À venir</p>,
})
