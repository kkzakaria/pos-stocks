import { useEffect, useState } from "react"
import { Upload } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const TAILLE_MAX = 2 * 1024 * 1024
const TYPES_ACCEPTES = ["image/jpeg", "image/png", "image/webp"]

/**
 * Controlled image field: validates the file locally for immediate feedback,
 * shows a preview built from an object URL, and hands the file to its parent.
 * It performs no request — the file travels with the creation call.
 */
export function ChampImage({
  value,
  onChange,
}: {
  value: File | null
  onChange: (fichier: File | null) => void
}) {
  const [erreur, setErreur] = useState<string | null>(null)
  const [apercu, setApercu] = useState<string | null>(null)

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
        <label
          htmlFor="p-image"
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "w-fit cursor-pointer"
          )}
        >
          <Upload />
          Choisir une image
        </label>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setErreur(null)
              onChange(null)
            }}
          >
            Retirer l'image
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        JPEG, PNG, WebP — 2 Mo max
      </p>
      {erreur && (
        <p role="alert" className="text-xs text-destructive">
          {erreur}
        </p>
      )}
      <input
        id="p-image"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Choisir une image"
        onChange={(e) => {
          // e.target.files is nullable (FileList | null): the optional chain is
          // legitimate for no-unnecessary-condition.
          const input = e.target
          const fichier = input.files?.[0]
          // Reset after every attempt: otherwise re-selecting the SAME file
          // does not fire onChange.
          input.value = ""
          if (!fichier) return
          if (fichier.size > TAILLE_MAX) {
            setErreur("L'image dépasse 2 Mo")
            return
          }
          if (!TYPES_ACCEPTES.includes(fichier.type)) {
            setErreur("Formats acceptés : JPEG, PNG, WebP")
            return
          }
          setErreur(null)
          onChange(fichier)
        }}
        className="sr-only"
      />
    </div>
  )
}
