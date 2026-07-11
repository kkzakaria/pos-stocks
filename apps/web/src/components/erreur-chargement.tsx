import { Button } from "@/components/ui/button"

// État d'erreur transverse des écrans (différé Phase 4) : message en
// français + bouton de relance de la requête TanStack Query.
export function ErreurChargement({
  message = "Impossible de charger les données.",
  onRetry,
}: {
  message?: string
  onRetry: () => void
}) {
  return (
    <div
      role="alert"
      className="flex items-center gap-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
    >
      <span>{message}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Réessayer
      </Button>
    </div>
  )
}
