import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { estDateExpiree } from "@/lib/dates"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { Produit } from "./types"

type Props = {
  produit: Produit
  peutEcrire: boolean
  onModifie: () => Promise<unknown>
}

export function SectionLots({ produit, peutEcrire, onModifie }: Props) {
  const [dialogLotPour, setDialogLotPour] = useState<string | null>(null)
  const [numeroLot, setNumeroLot] = useState("")
  const [datePeremption, setDatePeremption] = useState("")
  const [erreurLot, setErreurLot] = useState<string | null>(null)

  const ajouterLot = useMutation({
    mutationFn: (variantId: string) =>
      apiFetch(`/api/v1/variants/${variantId}/lots`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lotNumber: numeroLot,
          expiryDate: datePeremption || undefined,
        }),
      }),
    onSuccess: async () => {
      await onModifie()
      setDialogLotPour(null)
      setNumeroLot("")
      setDatePeremption("")
      setErreurLot(null)
    },
    onError: (err) =>
      setErreurLot(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-base font-semibold">Lots</h2>
      {produit.variants
        .filter((v) => v.isActive)
        .map((v) => (
          <div key={v.id} className="mb-4 rounded-md border p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium">{v.name}</p>
              {peutEcrire && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDialogLotPour(v.id)}
                >
                  Ajouter un lot
                </Button>
              )}
            </div>
            {v.lots.length === 0 ? (
              <p className="text-sm text-gray-500">Aucun lot.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {v.lots.map((lot) => (
                  <li key={lot.id} className="flex items-center gap-3 text-sm">
                    <span className="font-mono">{lot.lotNumber}</span>
                    <span className="text-gray-500">
                      {lot.expiryDate
                        ? new Date(lot.expiryDate).toLocaleDateString("fr-FR")
                        : "sans péremption"}
                    </span>
                    {estDateExpiree(lot.expiryDate) && (
                      <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                        Expiré
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

      {dialogLotPour !== null && (
        <Dialog
          open
          onOpenChange={(ouvert) => {
            if (!ouvert) setDialogLotPour(null)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nouveau lot</DialogTitle>
            </DialogHeader>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                setErreurLot(null)
                ajouterLot.mutate(dialogLotPour)
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="l-numero">Numéro de lot</Label>
                <Input
                  id="l-numero"
                  required
                  value={numeroLot}
                  onChange={(e) => setNumeroLot(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="l-peremption">
                  Date de péremption (optionnel)
                </Label>
                <Input
                  id="l-peremption"
                  type="date"
                  value={datePeremption}
                  onChange={(e) => setDatePeremption(e.target.value)}
                />
              </div>
              {erreurLot && (
                <p role="alert" className="text-sm text-red-700">
                  {erreurLot}
                </p>
              )}
              <Button type="submit" disabled={ajouterLot.isPending}>
                {ajouterLot.isPending ? "Ajout…" : "Ajouter le lot"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}
