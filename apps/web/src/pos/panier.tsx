import { useState } from "react"
import { Minus, Plus, Trash2, Warehouse } from "lucide-react"
import { apiUrl } from "@/lib/api"
import { formaterMontant } from "@/lib/format"
import { totalPanier } from "@/lib/pos"
import type { LignePanier } from "@/lib/pos"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

/** Stable key for a cart line (variant + optional depannage source warehouse). */
export function cleLigne(
  ligne: Pick<LignePanier, "variantId" | "sourceWarehouseId">
): string {
  return `${ligne.variantId}|${ligne.sourceWarehouseId ?? ""}`
}

type Props = {
  lignes: LignePanier[]
  /** Cart locked after an ambiguous submission: editing is frozen. */
  verrouille?: boolean
  /** Price-change error, attached to the line it concerns. */
  erreurPrix?: { cle: string; message: string } | null
  onQuantite: (ligne: LignePanier, quantite: number) => void
  onPrix: (ligne: LignePanier, prix: number) => void
  onSupprimer: (ligne: LignePanier) => void
  onDepanner: (ligne: LignePanier) => void
  /** Clear the whole cart (confirmed via dialog before firing). */
  onVider: () => void
  /**
   * Optional controlled state for the clear-cart confirmation, so the parent
   * can open it from the `Suppr`/`Delete` shortcut. Omit for uncontrolled use.
   */
  viderOuvert?: boolean
  onViderOuvertChange?: (ouvert: boolean) => void
  onEncaisser: () => void
}

/**
 * POS cart with **inline editing on each line** — quantity stepper,
 * tap-to-edit unit price (native numeric field), remove and depannage — so
 * common adjustments no longer open a side panel. The price is editable only
 * when a floor is set; a non-negotiable price (locked to catalog) renders as
 * plain text. Shows the struck-through catalog price when negotiated, the floor
 * while editing, and a stock-shortage flag. The header carries a confirmed
 * clear-cart block (Vider, red, `Suppr` shortcut); the footer the total and
 * the ENCAISSER (F2) button.
 */
export function Panier({
  lignes,
  verrouille = false,
  erreurPrix,
  onQuantite,
  onPrix,
  onSupprimer,
  onDepanner,
  onVider,
  viderOuvert,
  onViderOuvertChange,
  onEncaisser,
}: Props) {
  const total = totalPanier(lignes)
  // Champ en cours d'édition inline : quantité ou prix d'une ligne donnée.
  const [edition, setEdition] = useState<{
    cle: string
    champ: "quantite" | "prix"
  } | null>(null)
  const [saisie, setSaisie] = useState("")

  function ouvrir(ligne: LignePanier, champ: "quantite" | "prix") {
    setEdition({ cle: cleLigne(ligne), champ })
    setSaisie(
      String(champ === "quantite" ? ligne.quantite : ligne.prixUnitaire)
    )
  }
  function valider(ligne: LignePanier) {
    const champ = edition?.champ
    // Virgule décimale FR → point, puis arrondi : quantités ET montants sont
    // des ENTIERS (XOF sans décimale). Sans ça, « 450,5 » (NaN) est abandonné
    // en silence et « 450.5 » stocke une fraction rejetée plus loin sans
    // retour visuel.
    const n = Math.round(Number(saisie.replace(",", ".")))
    // N'applique que si la valeur a changé et reste finie : un blur sans
    // modification ne redéclenche pas une validation serveur inutile.
    if (saisie.trim() !== "" && Number.isFinite(n)) {
      if (champ === "quantite") {
        const q = Math.max(1, n)
        if (q !== ligne.quantite) onQuantite(ligne, q)
      } else {
        // Prix : entier strictement positif. Une saisie ≤ 0 (négatif, zéro)
        // serait ignorée en silence par changerPrix — on garde plutôt
        // l'éditeur ouvert (le champ reste affiché avec la valeur refusée)
        // au lieu de le fermer sans effet ni retour.
        if (n <= 0) return
        if (n !== ligne.prixUnitaire) onPrix(ligne, n)
      }
    }
    setEdition(null)
    setSaisie("")
  }

  return (
    <aside className="flex h-full w-full flex-col border-l bg-card">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Panier</h2>
        <AlertDialog open={viderOuvert} onOpenChange={onViderOuvertChange}>
          <AlertDialogTrigger
            render={
              <Button
                disabled={verrouille || lignes.length === 0}
                aria-label="Vider le panier"
                title="Vider le panier (Suppr)"
                // Rouge fixe (et non le token --destructive, trop clair en
                // thème sombre) pour garder le texte blanc lisible (AA) sur
                // les deux thèmes.
                className="bg-[oklch(0.55_0.22_27)] font-semibold text-white hover:bg-[oklch(0.5_0.22_27)]"
              />
            }
          >
            <Trash2 />
            Vider
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Vider le panier ?</AlertDialogTitle>
              <AlertDialogDescription>
                Tous les articles en cours seront retirés du panier. Cette
                action est irréversible.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction onClick={onVider}>Vider</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {lignes.length === 0 && (
          <li className="p-4 text-sm text-muted-foreground">
            Scannez ou touchez un article.
          </li>
        )}
        {lignes.map((ligne) => {
          const cle = cleLigne(ligne)
          const enEditionQuantite =
            edition?.cle === cle && edition.champ === "quantite"
          const enEditionPrix = edition?.cle === cle && edition.champ === "prix"
          // Prix révisable seulement si un plancher est défini ; sans plancher
          // le prix est verrouillé au catalogue (règle NON_NEGOCIABLE, lib/pos)
          // et toute saisie serait refusée — on n'offre donc pas l'édition.
          const prixRevisable = ligne.prixPlancher !== null
          const prixNegocie = ligne.prixUnitaire !== ligne.prixCatalogue
          return (
            <li
              key={cle}
              className={cn(
                "border-b px-3 py-2.5",
                ligne.enAlerte && "bg-destructive/10"
              )}
            >
              <div className="flex items-start gap-2">
                {ligne.imageKey ? (
                  <img
                    src={apiUrl(`/api/v1/files/${ligne.imageKey}`)}
                    alt=""
                    crossOrigin="use-credentials"
                    loading="lazy"
                    className="size-10 shrink-0 rounded object-cover"
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    className="grid size-10 shrink-0 place-items-center rounded bg-muted text-[10px] font-semibold text-muted-foreground"
                  >
                    {ligne.nom.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{ligne.nom}</p>
                  {ligne.sourceNom && (
                    <span className="mt-0.5 inline-block rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                      réserve {ligne.sourceNom}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={verrouille}
                    onClick={() => onDepanner(ligne)}
                    title="Puiser dans un autre entrepôt"
                    aria-label={`Puiser ${ligne.nom} dans un autre entrepôt`}
                  >
                    <Warehouse />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={verrouille}
                    onClick={() => onSupprimer(ligne)}
                    title="Retirer l'article"
                    aria-label={`Retirer ${ligne.nom}`}
                    className="text-destructive"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>

              <div className="mt-1.5 flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    // Désactivé en édition : le blur valide la saisie AVANT le
                    // click, sinon +/− rejouerait l'ancienne quantité par-dessus.
                    disabled={
                      verrouille || enEditionQuantite || ligne.quantite <= 1
                    }
                    onClick={() => onQuantite(ligne, ligne.quantite - 1)}
                    aria-label={`Diminuer la quantité de ${ligne.nom}`}
                  >
                    <Minus />
                  </Button>
                  {enEditionQuantite ? (
                    <Input
                      autoFocus
                      inputMode="numeric"
                      aria-label={`Nouvelle quantité de ${ligne.nom}`}
                      className="h-8 w-14 text-center tabular-nums"
                      value={saisie}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setSaisie(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur()
                      }}
                      onBlur={() => valider(ligne)}
                    />
                  ) : (
                    <button
                      type="button"
                      disabled={verrouille}
                      onClick={() => ouvrir(ligne, "quantite")}
                      aria-label={`Saisir la quantité de ${ligne.nom}`}
                      className="min-w-6 rounded text-center text-sm font-semibold tabular-nums outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
                    >
                      {ligne.quantite}
                    </button>
                  )}
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={verrouille || enEditionQuantite}
                    onClick={() => onQuantite(ligne, ligne.quantite + 1)}
                    aria-label={`Augmenter la quantité de ${ligne.nom}`}
                  >
                    <Plus />
                  </Button>
                </div>
                <div className="ml-auto flex flex-col items-end">
                  {!prixRevisable ? (
                    <span
                      className="text-sm font-semibold tabular-nums"
                      title="Prix non révisable"
                    >
                      {formaterMontant(ligne.prixUnitaire)}
                    </span>
                  ) : enEditionPrix ? (
                    <Input
                      autoFocus
                      inputMode="numeric"
                      aria-label={`Nouveau prix de ${ligne.nom}`}
                      className="h-8 w-28 text-right tabular-nums"
                      value={saisie}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setSaisie(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur()
                      }}
                      onBlur={() => valider(ligne)}
                    />
                  ) : (
                    <button
                      type="button"
                      disabled={verrouille}
                      onClick={() => ouvrir(ligne, "prix")}
                      aria-label={`Modifier le prix de ${ligne.nom}`}
                      className="rounded text-sm font-semibold tabular-nums underline decoration-muted-foreground decoration-dotted underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 disabled:no-underline"
                    >
                      {formaterMontant(ligne.prixUnitaire)}
                    </button>
                  )}
                  {ligne.quantite > 1 && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formaterMontant(ligne.quantite * ligne.prixUnitaire)}
                    </span>
                  )}
                </div>
              </div>

              {enEditionPrix && ligne.prixPlancher !== null && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Min {formaterMontant(ligne.prixPlancher)}
                </p>
              )}
              {!enEditionPrix && prixNegocie && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Catalogue{" "}
                  <s className="tabular-nums">
                    {formaterMontant(ligne.prixCatalogue)}
                  </s>
                </p>
              )}
              {erreurPrix?.cle === cle && (
                <p role="alert" className="mt-1 text-xs text-destructive">
                  {erreurPrix.message}
                </p>
              )}
              {ligne.enAlerte && (
                <p className="mt-1 text-xs font-semibold text-destructive">
                  Stock insuffisant
                </p>
              )}
            </li>
          )
        })}
      </ul>
      <div className="border-t p-4">
        <p className="mb-3 flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Total</span>
          <span className="text-2xl font-bold tabular-nums">
            {formaterMontant(total)}
          </span>
        </p>
        <Button
          className="min-h-14 w-full text-lg"
          disabled={lignes.length === 0}
          onClick={onEncaisser}
        >
          ENCAISSER
        </Button>
      </div>
    </aside>
  )
}
