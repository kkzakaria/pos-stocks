import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Tonal loading block. `animate-pulse` is neutralized under
 * `prefers-reduced-motion` by the global guard in styles.css.
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
