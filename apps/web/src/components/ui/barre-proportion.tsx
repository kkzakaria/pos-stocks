import { cn } from "@/lib/utils"

/**
 * Barre fine de proportion (data-viz registre) : part d'un montant dans un
 * total. Purement visuelle — le chiffre reste lu dans la cellule voisine.
 * Jamais de camembert ni de dégradé ; la donnée reste dans la voix indigo
 * de la marque via la rampe `chart-*`.
 */
export function BarreProportion({
  valeur,
  total,
  className,
}: {
  valeur: number
  total: number
  className?: string
}) {
  if (total <= 0) return null
  const pourcentage = Math.max(0, Math.min(100, (valeur / total) * 100))
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block h-1.5 w-full overflow-hidden rounded-full bg-muted",
        className
      )}
    >
      <span
        className="block h-full rounded-full bg-chart-3"
        style={{ width: `${pourcentage}%` }}
      />
    </span>
  )
}
