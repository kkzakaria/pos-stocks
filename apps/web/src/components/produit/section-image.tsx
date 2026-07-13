import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Upload } from "lucide-react"
import { apiFetch, apiUrl } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import { buttonVariants } from "@/components/ui/button"
import type { Produit } from "./types"

type Props = {
  produit: Produit
  productId: string
  peutEcrire: boolean
  onModifie: () => Promise<unknown>
}

/**
 * Product image section: current preview and upload (JPEG/PNG/WebP, 2 MB max)
 * via multipart; resets the input after each attempt to allow resubmitting the
 * same file and versions the URL to bust the cache.
 */
export function SectionImage({
  produit,
  productId,
  peutEcrire,
  onModifie,
}: Props) {
  const [erreurImage, setErreurImage] = useState<string | null>(null)
  const [versionImage, setVersionImage] = useState(0)

  const envoyerImage = useMutation({
    mutationFn: (fichier: File) => {
      const donnees = new FormData()
      donnees.append("image", fichier)
      // pas d'en-tête content-type : le navigateur pose le boundary multipart
      return apiFetch(`/api/v1/products/${productId}/image`, {
        method: "POST",
        body: donnees,
      })
    },
    onSuccess: async () => {
      await onModifie()
      setVersionImage((v) => v + 1)
      setErreurImage(null)
    },
    onError: (err) =>
      // Les messages IMAGE_TROP_LOURDE / FORMAT_IMAGE arrivent déjà en
      // français via apiFetch (body.message)
      setErreurImage(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <section className="mb-8 flex items-start gap-6">
      {produit.imageKey ? (
        <img
          src={`${apiUrl(`/api/v1/files/${produit.imageKey}`)}?v=${versionImage}`}
          alt={produit.name}
          crossOrigin="use-credentials"
          className="h-32 w-32 rounded-md border object-cover"
        />
      ) : (
        <div className="flex h-32 w-32 items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">
          Aucune image
        </div>
      )}
      {peutEcrire && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="p-image">Image (JPEG, PNG, WebP — 2 Mo max)</Label>
          <label
            htmlFor="p-image"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "w-fit cursor-pointer",
              envoyerImage.isPending && "pointer-events-none opacity-50"
            )}
          >
            <Upload />
            {envoyerImage.isPending ? "Envoi…" : "Choisir une image…"}
          </label>
          <input
            id="p-image"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={envoyerImage.isPending}
            onChange={(e) => {
              // e.target.files est nullable (FileList | null) : l'optional
              // chain est légitime ici pour no-unnecessary-condition
              const input = e.target
              const fichier = input.files?.[0]
              if (!fichier) return
              // Réinitialise après chaque tentative (succès ou échec) :
              // sinon re-sélectionner EXACTEMENT le même fichier ne déclenche
              // pas onChange (la value de l'input n'a pas changé).
              envoyerImage.mutate(fichier, {
                onSettled: () => {
                  input.value = ""
                },
              })
            }}
            className="sr-only"
          />
          {erreurImage && (
            <p role="alert" className="text-sm text-destructive">
              {erreurImage}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
