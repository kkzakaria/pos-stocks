import type { ReactNode } from "react"
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
}

type Props<T> = {
  colonnes: ColonneAdaptative<T>[]
  lignes: T[]
  cle: (ligne: T) => string
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
export function ListeAdaptative<T>({
  colonnes,
  lignes,
  cle,
  titre,
  valeur,
  sousTitre,
  chargement = false,
  etatVide,
  containerClassName,
  actionCarte,
}: Props<T>) {
  const estLarge = useEstLarge()

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
              <TableRow key={cle(ligne)}>
                {colonnes.map((c) => (
                  <TableCell key={c.cle} numeric={c.numeric}>
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
        <li key={cle(ligne)} className="rounded-md border bg-card p-3">
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
                      c.numeric && "tabular-nums"
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
