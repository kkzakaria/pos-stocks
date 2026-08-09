"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * DS table; wrapped in a container that scrolls horizontally on wide data.
 * `containerClassName` styles that wrapper — a sticky header only engages
 * when the wrapper itself is the vertical scroll box (e.g. `flex-1 min-h-0
 * overflow-y-auto` in a full-height column), because its `overflow-x-auto`
 * makes it the nearest scroll container.
 */
function Table({
  className,
  containerClassName,
  ...props
}: React.ComponentProps<"table"> & { containerClassName?: string }) {
  return (
    <div
      data-slot="table-container"
      className={cn("relative w-full overflow-x-auto", containerClassName)}
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

/**
 * Classes to put on any `TableCell` holding FREE USER TEXT — a warehouse
 * name, a variant name, a supplier lot number, an attribute value.
 *
 * The defect they fix belongs to `TableCell` itself: it sets
 * `whitespace-nowrap`, and `table-layout: auto` sizes a column on its
 * content's *min-content* width — so one long token widens the table without
 * bound and its container grows a horizontal scrollbar.
 *
 * `break-words` (`overflow-wrap: break-word`) contributes NOTHING to that
 * min-content width: it only breaks a word already overflowing an
 * established line box. Measured in Chrome at min-content on three ~60
 * character strings — `whitespace-nowrap`, then `whitespace-normal`, then
 * `whitespace-normal break-words`, then `whitespace-normal wrap-anywhere`:
 *
 *   unbreakable token  532 → 532 → 532 → 14 px
 *   with spaces        605 → 127 → 127 → 14 px
 *   with hyphens       572 → 125 → 125 → 14 px
 *
 * `break-words` costs exactly 0 px in all three. What partly works is
 * `whitespace-normal` alone, on whatever spaces and hyphens the text happens
 * to contain — and that IS the trap: a column of prose shrinks while an
 * unbreakable reference does not, so the table reads as "fixed" while its
 * worst column is untouched. `overflow-wrap: anywhere` is the only one of the
 * two that enters the min-content calculation, hence the pair.
 *
 * `max-width` + `truncate` would also fit the container, but hides the tail —
 * unacceptable on data meant to be read character by character.
 *
 * Lives here rather than in a consumer: the rule holds for EVERY table of the
 * repo, so the developer writing the next one meets it where they need it.
 */
export const TEXTE_LIBRE = "whitespace-normal wrap-anywhere"

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
