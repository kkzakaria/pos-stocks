import { Button } from "@/components/ui/button"

// État d'erreur transverse des écrans (différé Phase 4) : message en
// français + bouton de relance de la requête TanStack Query.
/**
 * Loading-error banner: French message and a "Retry" button that replays the
 * request via the `onRetry` callback.
 */
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
      className="flex items-center gap-3 rounded-md border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive"
    >
      <span>{message}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Réessayer
      </Button>
    </div>
  )
}
