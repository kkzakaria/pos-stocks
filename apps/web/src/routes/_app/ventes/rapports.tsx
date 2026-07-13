import { createFileRoute } from "@tanstack/react-router"

// Squelette — remplacé par l'écran Rapports complet (Task 11).
export const Route = createFileRoute("/_app/ventes/rapports")({
  component: () => <p className="text-sm text-gray-500">Rapports à venir.</p>,
})
