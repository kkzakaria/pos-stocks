import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_app/")({
  component: () => (
    <div>
      <h1 className="text-xl font-semibold">Tableau de bord</h1>
      <p className="mt-2 text-sm text-gray-500">
        Bienvenue. Les modules arrivent dans les prochaines phases.
      </p>
    </div>
  ),
})
