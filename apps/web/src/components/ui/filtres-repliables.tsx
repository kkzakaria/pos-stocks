import * as React from "react"

import { Badge } from "@/components/ui/badge"
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
 *
 * `open` is intentionally uncontrolled: it is only ever set from React on
 * mount and whenever `nbActifs > 0` changes value, which is what makes a
 * manual user toggle survive unrelated re-renders while an activated filter
 * still forces the panel back open (React skips re-applying the `open`
 * attribute when the computed value hasn't changed since the last render).
 */
function FiltresRepliables({
  nbActifs,
  children,
  className,
  label = "Filtres",
  id,
  ...ariaProps
}: {
  nbActifs: number
  children: React.ReactNode
  className?: string
  label?: string
} & React.AriaAttributes &
  Pick<React.ComponentPropsWithoutRef<"details">, "id">) {
  const estLarge = useEstLarge()

  if (estLarge) {
    // id/aria-*/className target the <details>/<summary> wrapper below md;
    // there is no wrapper here, so they have nothing to attach to.
    return <>{children}</>
  }

  return (
    <details id={id} className={cn(className)} open={nbActifs > 0}>
      <summary
        className={cn(
          "flex min-h-11 cursor-pointer items-center gap-1.5 border-b text-sm font-medium",
          // Suppress the native <summary> focus outline so it doesn't stack
          // visibly with the token-based ring below.
          "outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        )}
        {...ariaProps}
      >
        {label}
        {nbActifs > 0 && <Badge variant="secondary">{nbActifs}</Badge>}
      </summary>
      {children}
    </details>
  )
}

export { FiltresRepliables }
