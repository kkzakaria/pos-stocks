import { useEffect, useRef, useState } from "react"
import { Upload } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  ACCEPT_IMAGE,
  AIDE_IMAGE,
  ERREUR_PREPARATION_IMAGE,
  ERREUR_TAILLE_IMAGE,
  ERREUR_TYPE_IMAGE,
  TAILLE_IMAGE_MAX,
  TYPES_IMAGE_ACCEPTES,
  preparerImage,
} from "@/lib/image"
import type { ChangeEvent } from "react"

/**
 * Controlled image field: validates the file locally for immediate feedback,
 * shows a preview built from an object URL, and hands the file to its parent.
 * It performs no request — the file travels with the creation call.
 */
export function ChampImage({
  value,
  onChange,
  id = "p-image",
}: {
  value: File | null
  onChange: (fichier: File | null) => void
  /** DOM id of the file input; override when two instances share a view. */
  id?: string
}) {
  const [erreur, setErreur] = useState<string | null>(null)
  const [apercu, setApercu] = useState<string | null>(null)
  const [enPreparation, setEnPreparation] = useState(false)
  // Generation token: each selection claims a number, and only the selection
  // still holding the latest number is allowed to publish its result. Chosen
  // over an AbortController because `preparerImage` takes no signal — forcing
  // one into its contract before the compression exists would be designing
  // blind — and over a "last file wins" comparison, which cannot tell two
  // selections of the same file apart.
  const generation = useRef(0)

  // The object URL is rebuilt on every file change and revoked on cleanup:
  // leaving it alive would retain the file for the page's lifetime.
  useEffect(() => {
    if (!value) {
      setApercu(null)
      return
    }
    const url = URL.createObjectURL(value)
    setApercu(url)
    return () => URL.revokeObjectURL(url)
  }, [value])

  /**
   * Order matters and is NOT interchangeable — do not "simplify" this by
   * grouping the two validations together:
   *
   * 1. MIME type BEFORE `preparerImage`: an entry guard. An arbitrary file must
   *    never reach a future image decoder, and a PDF must yield "format not
   *    accepted", not a decoding error.
   * 2. `preparerImage`, which will one day shrink the file.
   * 3. Size AFTER `preparerImage`: it is the *prepared* file that has to fit
   *    under the cap, not the original — otherwise a 3 MB phone photo is
   *    rejected before it ever had a chance to be reduced.
   */
  const choisir = async (evenement: ChangeEvent<HTMLInputElement>) => {
    // evenement.target.files is nullable (FileList | null): the optional chain
    // is legitimate for no-unnecessary-condition.
    const input = evenement.target
    const fichier = input.files?.[0]
    // Reset after every attempt: otherwise re-selecting the SAME file
    // does not fire onChange.
    input.value = ""
    if (!fichier) return

    const jeton = ++generation.current
    const obsolete = () => generation.current !== jeton

    if (!TYPES_IMAGE_ACCEPTES.includes(fichier.type)) {
      setErreur(ERREUR_TYPE_IMAGE)
      // Mandatory, and a `finally` could NOT do it: this attempt never enters
      // the `try`. Claiming the token above already invalidated any in-flight
      // preparation, which will now return through its `obsolete()` guard
      // BEFORE its own setEnPreparation(false). Without this line nobody owns
      // the busy state any more: the label stays pointer-events-none for the
      // component's lifetime and the field is dead until a page reload.
      setEnPreparation(false)
      return
    }

    setErreur(null)
    setEnPreparation(true)
    let prepare: File
    try {
      prepare = await preparerImage(fichier)
    } catch {
      if (obsolete()) return
      setEnPreparation(false)
      // Fixed French sentence: the browser's own decoding errors are English.
      setErreur(ERREUR_PREPARATION_IMAGE)
      return
    }
    // A newer selection took over while we were preparing: drop this result
    // silently. Promises are not guaranteed to settle in call order, so
    // without this the first (slower) file would overwrite the second one.
    if (obsolete()) return
    setEnPreparation(false)

    if (prepare.size > TAILLE_IMAGE_MAX) {
      setErreur(ERREUR_TAILLE_IMAGE)
      return
    }
    onChange(prepare)
  }

  return (
    <div className="flex flex-col gap-2">
      {apercu ? (
        <img
          src={apercu}
          alt="Aperçu de l'image du produit"
          width={128}
          height={128}
          className="h-32 w-32 rounded-md border object-cover"
        />
      ) : (
        <div className="flex h-32 w-32 items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">
          Aucune image
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="file"
          accept={ACCEPT_IMAGE}
          aria-label="Choisir une image"
          aria-busy={enPreparation}
          onChange={(e) => void choisir(e)}
          // "peer" must be an immediate previous sibling of the label for
          // peer-focus-visible: to apply — Tailwind's peer combinator only
          // matches general siblings, not ancestors/descendants.
          className="peer sr-only"
        />
        <label
          htmlFor={id}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "w-fit cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-ring/30",
            // Neutralises the label while preparing: the input stays enabled
            // so the busy state is announced rather than made unreachable.
            enPreparation && "pointer-events-none opacity-50"
          )}
        >
          <Upload />
          {enPreparation ? "Préparation…" : "Choisir une image"}
        </label>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              // Invalidates any in-flight preparation too: otherwise it would
              // resurrect the image the user just removed.
              generation.current++
              setEnPreparation(false)
              setErreur(null)
              onChange(null)
            }}
          >
            Retirer l'image
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{AIDE_IMAGE}</p>
      {erreur && (
        <p role="alert" className="text-xs text-destructive">
          {erreur}
        </p>
      )}
    </div>
  )
}
