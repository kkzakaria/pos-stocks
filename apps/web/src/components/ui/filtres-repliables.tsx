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
 * `nbActifs` may only ever force the panel OPEN, never closed. Binding
 * `open` straight to `nbActifs > 0` would slam the panel shut the moment the
 * last active filter is cleared — e.g. clearing the search box the user is
 * currently typing in, which sits inside this `<details>` and would vanish
 * under the cursor, focus and all. So the open state is held locally,
 * nudged open on the rising edge of `nbActifs` (adjusted during render, per
 * the React docs' "adjusting state when a prop changes" pattern — an effect
 * would open the panel one paint too late), and otherwise owned by the
 * user's own toggles, fed back through `onToggle`.
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
  const [ouvert, setOuvert] = React.useState(nbActifs > 0)
  const [nbPrecedent, setNbPrecedent] = React.useState(nbActifs)

  // Rising edge only: going from "no active filter" to at least one reveals
  // the panel; the reverse transition leaves it exactly as the user left it.
  if (nbActifs !== nbPrecedent) {
    setNbPrecedent(nbActifs)
    if (nbPrecedent === 0 && nbActifs > 0) setOuvert(true)
  }

  if (estLarge) {
    // id/aria-*/className target the <details>/<summary> wrapper below md;
    // there is no wrapper here, so they have nothing to attach to.
    return <>{children}</>
  }

  return (
    <details
      id={id}
      className={cn(className)}
      open={ouvert}
      // The user's own toggle is the source of truth: mirror it back into
      // state so a later re-render doesn't undo it.
      onToggle={(e) => setOuvert(e.currentTarget.open)}
    >
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
