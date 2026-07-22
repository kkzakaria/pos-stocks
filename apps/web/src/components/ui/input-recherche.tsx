import * as React from "react"
import { Search } from "lucide-react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * DS search field: a compact Input with a leading magnifier, tuned for
 * list filtering — no autocomplete, no spellcheck, native cancel button
 * hidden to keep the hairline vocabulary.
 */
function InputRecherche({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <div className={cn("relative", className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        autoComplete="off"
        spellCheck={false}
        className="pl-7 [&::-webkit-search-cancel-button]:hidden"
        {...props}
      />
    </div>
  )
}

export { InputRecherche }
