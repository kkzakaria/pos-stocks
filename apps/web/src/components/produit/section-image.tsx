import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { apiFetch, apiUrl } from "@/lib/api"
import { Label } from "@/components/ui/label"
import type { Produit } from "./types"

type Props = {
  produit: Produit
  productId: string
  peutEcrire: boolean
  onModifie: () => Promise<unknown>
}

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
        <div className="flex h-32 w-32 items-center justify-center rounded-md border bg-gray-50 text-xs text-gray-400">
          Aucune image
        </div>
      )}
      {peutEcrire && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="p-image">Image (JPEG, PNG, WebP — 2 Mo max)</Label>
          <input
            id="p-image"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              // e.target.files est nullable (FileList | null) : l'optional
              // chain est légitime ici pour no-unnecessary-condition
              const fichier = e.target.files?.[0]
              if (fichier) envoyerImage.mutate(fichier)
            }}
            className="text-sm"
          />
          {erreurImage && (
            <p role="alert" className="text-sm text-red-700">
              {erreurImage}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
