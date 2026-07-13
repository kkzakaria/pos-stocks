"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/** DS table; wrapped in a container that scrolls horizontally on wide data. */
function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-xs", className)}
        {...props}
      />
    </div>
  )
}

/** Table header (`<thead>`); `sticky` pins the header row at the top for long, dense tables. */
function TableHeader({
  className,
  sticky = false,
  ...props
}: React.ComponentProps<"thead"> & { sticky?: boolean }) {
  return (
    <thead
      data-slot="table-header"
      className={cn(
        "[&_tr]:border-b",
        // En-tête collant pour les longues tables denses (le conteneur scrolle).
        sticky && "[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-background",
        className
      )}
      {...props}
    />
  )
}

/** Table body (`<tbody>`); removes the last row's hairline. */
function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

/** Table footer (`<tfoot>`) on a muted background; typically totals. */
function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

/** Table row (`<tr>`); hover highlight and selected/expanded state. */
function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

/** Table header cell (`<th>`); `numeric` right-aligns with `tabular-nums` (numbers are sacred). */
function TableHead({
  className,
  numeric = false,
  scope = "col",
  ...props
}: React.ComponentProps<"th"> & { numeric?: boolean }) {
  return (
    <th
      data-slot="table-head"
      scope={scope}
      className={cn(
        "h-8 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        // Le chiffre est sacré : colonnes chiffrées alignées à droite, chasse fixe.
        numeric && "text-right tabular-nums",
        className
      )}
      {...props}
    />
  )
}

/** Table body cell (`<td>`); `numeric` right-aligns with `tabular-nums` for amounts. */
function TableCell({
  className,
  numeric = false,
  ...props
}: React.ComponentProps<"td"> & { numeric?: boolean }) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        numeric && "text-right tabular-nums",
        className
      )}
      {...props}
    />
  )
}

/** Table caption (`<caption>`) at the bottom, muted text. */
function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
