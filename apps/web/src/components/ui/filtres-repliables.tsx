import * as React from "react"

import { useEstLarge } from "@/lib/use-media-query"
import { cn } from "@/lib/utils"

/**
 * Collapses a filter bar behind a native `<details>` below the `md` tier,
 * so the record list doesn't sit under a wall of stacked controls on small
 * screens. From `md` up, children render exactly as passed — no wrapper.
 *
 * The tier switch goes through `useEstLarge`, not CSS: rendering both trees
 * at once would duplicate form controls in the DOM (duplicate `id`s, labels
 * bound twice).
 */
function FiltresRepliables({
  nbActifs,
  children,
  className,
}: {
  nbActifs: number
  children: React.ReactNode
  className?: string
}) {
  const estLarge = useEstLarge()

  if (estLarge) {
    return <>{children}</>
  }

  return (
    <details className={cn(className)} open={nbActifs > 0}>
      <summary
        className={cn(
          "flex min-h-11 cursor-pointer items-center gap-1 border-b text-sm font-medium",
          "focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
        )}
      >
        Filtres{nbActifs > 0 && ` (${nbActifs})`}
      </summary>
      {children}
    </details>
  )
}

export { FiltresRepliables }
