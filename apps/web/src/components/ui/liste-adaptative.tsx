import type { KeyboardEvent, MouseEvent, ReactNode } from "react"
import { useEstLarge } from "@/lib/use-media-query"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TableSkeleton } from "@/components/ui/table-skeleton"

export type ColonneAdaptative<T> = {
  /** Stable identifier, also the React key. */
  cle: string
  entete: ReactNode
  cellule: (ligne: T) => ReactNode
  /** Right-aligned, tabular figures — for amounts and quantities. */
  numeric?: boolean
  /** Label used in card mode; falls back to `entete`. */
  libelle?: ReactNode
  /**
   * Marks this column's data as already carried by `titre`/`valeur`/`sousTitre`,
   * so the card omits its label/value pair. Setting it on a column that is NOT
   * actually rendered by one of those three render props hides that data by
   * screen width — forbidden by this project's no-data-loss constraint.
   * `ListeAdaptative` cannot enforce this itself (`titre`/`valeur`/`sousTitre`
   * are opaque render functions); enforcement lives in each consuming screen's
   * own "ne perd aucune donnée en mode carte" test.
   */
  masquerEnCarte?: boolean
  /**
   * Extra classes applied to the generated `TableCell` (table mode) and to
   * the card's `<dd>` (card mode), merged through `cn()`. Use it instead of
   * wrapping `cellule`'s return value in its own `<span>`/`<div>` for a
   * uniform style (e.g. `font-mono`, `text-right`) — a wrapper only styles
   * the table cell, silently losing the style in card mode.
   */
  classeCellule?: string
}

type Props<T> = {
  colonnes: ColonneAdaptative<T>[]
  lignes: T[]
  /** Row key extractor (React key + identity) — distinct from `ColonneAdaptative.cle`, which names a column. */
  cleLigne: (ligne: T) => string
  /** Card mode: the dominant identity line. */
  titre: (ligne: T) => ReactNode
  /** Card mode: trailing value on the title line (amount, delta). */
  valeur?: (ligne: T) => ReactNode
  /** Card mode: secondary line under the title (usually a date). */
  sousTitre?: (ligne: T) => ReactNode
  chargement?: boolean
  etatVide?: ReactNode
  /** Forwarded to Table: the sticky header needs this to be the scroll box. */
  containerClassName?: string
  /** Card mode: trailing action (e.g. a details link). */
  actionCarte?: (ligne: T) => ReactNode
  /**
   * Makes the whole row clickable (e.g. navigate to a detail page), applied
   * to `<TableRow>` in table mode and to `<li>` in card mode. Both get
   * `role="button"`, `tabIndex={0}` and an Enter/Space `onKeyDown` handler
   * so a clickable row is reachable and activatable by keyboard in either
   * mode, matching the click behavior exactly.
   */
  surClicLigne?: (ligne: T) => void
  /** Extra classes for the row itself (table `<TableRow>` / card `<li>`), merged through `cn()`. */
  classeLigne?: (ligne: T) => string
}

/**
 * Renders a dense table from the `md` tier up, and a list of hierarchical
 * cards below it. Only one of the two trees is ever mounted: duplicating the
 * DOM would make screen readers announce every row twice and would double the
 * render cost of long tables on the modest hardware this product targets.
 *
 * Card layout is deliberately not a flat list of label/value pairs — at eight
 * columns that is a wall of text. The identity of the row goes on a dominant
 * title line, its headline figure sits opposite it, and only the remaining
 * columns become pairs underneath.
 */
// A row click/keydown must not also fire an interactive descendant's own
// action — a `<Link>` in a cell, or `actionCarte`'s button, both bubble up
// to the row. `closest()` from the event target finds the nearest
// interactive ancestor; if it sits strictly inside the row boundary (not the
// row itself, which also carries `role="button"`), the event originates from
// that descendant and the row handler stands down.
const SELECTEUR_INTERACTIF =
  'a[href], button, input, select, textarea, [role="button"], [role="link"], [tabindex]'

function depuisDescendantInteractif(e: MouseEvent | KeyboardEvent): boolean {
  const cible = e.target
  const limite = e.currentTarget
  if (!(cible instanceof Element) || !(limite instanceof Element)) return false
  const interactif = cible.closest(SELECTEUR_INTERACTIF)
  return (
    interactif !== null && interactif !== limite && limite.contains(interactif)
  )
}

export function ListeAdaptative<T>({
  colonnes,
  lignes,
  cleLigne,
  titre,
  valeur,
  sousTitre,
  chargement = false,
  etatVide,
  containerClassName,
  actionCarte,
  surClicLigne,
  classeLigne,
}: Props<T>) {
  const estLarge = useEstLarge()

  function gererClicLigne(ligne: T) {
    return (e: MouseEvent) => {
      if (depuisDescendantInteractif(e)) return
      surClicLigne?.(ligne)
    }
  }

  // Enter/Space activates the row the same way a click would — the same
  // handler powers both table and card mode so the two never drift apart.
  function gererClavierLigne(ligne: T) {
    return (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return
      if (depuisDescendantInteractif(e)) return
      e.preventDefault()
      surClicLigne?.(ligne)
    }
  }

  if (estLarge) {
    return (
      <Table containerClassName={containerClassName}>
        <TableHeader sticky>
          <TableRow>
            {colonnes.map((c) => (
              <TableHead key={c.cle} numeric={c.numeric}>
                {c.entete}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {chargement ? (
            <TableSkeleton colonnes={colonnes.length} />
          ) : lignes.length === 0 ? (
            <TableRow>
              <TableCell colSpan={colonnes.length}>{etatVide}</TableCell>
            </TableRow>
          ) : (
            lignes.map((ligne) => (
              <TableRow
                key={cleLigne(ligne)}
                className={cn(
                  surClicLigne && "cursor-pointer",
                  classeLigne?.(ligne)
                )}
                onClick={surClicLigne ? gererClicLigne(ligne) : undefined}
                onKeyDown={surClicLigne ? gererClavierLigne(ligne) : undefined}
                tabIndex={surClicLigne ? 0 : undefined}
                role={surClicLigne ? "button" : undefined}
              >
                {colonnes.map((c) => (
                  <TableCell
                    key={c.cle}
                    numeric={c.numeric}
                    className={c.classeCellule}
                  >
                    {c.cellule(ligne)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    )
  }

  if (chargement) {
    return (
      <div className={cn("flex flex-col gap-2", containerClassName)}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-md border p-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="mt-2 h-3 w-1/3" />
          </div>
        ))}
      </div>
    )
  }

  if (lignes.length === 0) {
    return <div className={containerClassName}>{etatVide}</div>
  }

  const paires = colonnes.filter((c) => !c.masquerEnCarte)

  return (
    <ul className={cn("flex flex-col gap-2", containerClassName)}>
      {lignes.map((ligne) => (
        <li
          key={cleLigne(ligne)}
          className={cn(
            "rounded-md border bg-card p-3",
            surClicLigne && "cursor-pointer",
            classeLigne?.(ligne)
          )}
          onClick={surClicLigne ? gererClicLigne(ligne) : undefined}
          onKeyDown={surClicLigne ? gererClavierLigne(ligne) : undefined}
          tabIndex={surClicLigne ? 0 : undefined}
          role={surClicLigne ? "button" : undefined}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 flex-1 font-medium break-words">
              {titre(ligne)}
            </p>
            {valeur && (
              <span className="shrink-0 font-medium tabular-nums">
                {valeur(ligne)}
              </span>
            )}
          </div>
          {sousTitre && (
            <p className="mt-0.5 text-muted-foreground">{sousTitre(ligne)}</p>
          )}
          {paires.length > 0 && (
            <dl className="mt-2 flex flex-col gap-1">
              {paires.map((c) => (
                <div key={c.cle} className="flex justify-between gap-3">
                  <dt className="min-w-0 shrink-0 break-words text-muted-foreground">
                    {c.libelle ?? c.entete}
                  </dt>
                  <dd
                    className={cn(
                      "min-w-0 text-right break-words",
                      c.numeric && "tabular-nums",
                      c.classeCellule
                    )}
                  >
                    {c.cellule(ligne)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {actionCarte && <div className="mt-2">{actionCarte(ligne)}</div>}
        </li>
      ))}
    </ul>
  )
}
