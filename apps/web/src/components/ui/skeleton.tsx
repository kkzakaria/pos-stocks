import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Bloc de chargement tonal. `animate-pulse` est neutralisé sous
 * `prefers-reduced-motion` par la garde globale de styles.css.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
