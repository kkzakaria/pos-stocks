import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_app/stock/mouvements")({
  component: () => <p className="text-sm text-gray-500">Bientôt disponible.</p>,
})
