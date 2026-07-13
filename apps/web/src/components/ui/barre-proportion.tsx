import { cn } from "@/lib/utils"

/**
 * Thin proportion bar (data-viz register): an amount's share of a total.
 * Purely visual — the number stays read in the neighboring cell. Never a
 * pie chart nor a gradient; the data stays in the brand's indigo voice via
 * the `chart-*` ramp.
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
