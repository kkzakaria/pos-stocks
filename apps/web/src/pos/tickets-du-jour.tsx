import { useQuery, useMutation } from "@tanstack/react-query"
import { formaterMontant } from "@/lib/format"
import { jourLocal } from "@/lib/pos"
import { fetchVente, fetchVentesDuJour } from "@/lib/pos-api"
import type { VenteDetail } from "@/lib/pos-api"
import { Button } from "@/components/ui/button"

type Props = {
  storeId: string
  onReimprimer: (sale: VenteDetail) => void
  onFermer: () => void
}

export function TicketsDuJour({ storeId, onReimprimer, onFermer }: Props) {
  const jour = jourLocal()
  const ventes = useQuery({
    queryKey: ["pos-ventes-jour", storeId, jour],
    queryFn: () => fetchVentesDuJour(storeId, jour),
  })
  const liste = ventes.data?.sales ?? []
  // Un rejet de fetchVente ne doit pas rester une promesse non gérée : le
  // caissier voit l'erreur et le bouton se désactive pendant le chargement.
  const reimpression = useMutation({
    mutationFn: (saleId: string) => fetchVente(saleId),
    onSuccess: ({ sale }) => onReimprimer(sale),
  })
  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/50 p-4">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg bg-white">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-lg font-semibold">Tickets du jour</h2>
          <button
            onClick={onFermer}
            aria-label="Fermer"
            className="p-2 text-xl"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {ventes.isPending && (
            <p className="p-3 text-sm text-gray-500">Chargement…</p>
          )}
          {ventes.isError && (
            <div className="p-3">
              <p role="alert" className="mb-2 text-sm text-red-600">
                Impossible de charger les tickets du jour.
              </p>
              <Button variant="outline" onClick={() => void ventes.refetch()}>
                Réessayer
              </Button>
            </div>
          )}
          {!ventes.isPending && !ventes.isError && liste.length === 0 && (
            <p className="p-3 text-sm text-gray-500">
              Aucune vente aujourd'hui.
            </p>
          )}
          {reimpression.isError && (
            <p role="alert" className="mb-2 px-1 text-sm text-red-600">
              {reimpression.error instanceof Error
                ? reimpression.error.message
                : "Impossible de charger ce ticket"}
            </p>
          )}
          {liste.map((vente) => {
            const enCours =
              reimpression.isPending && reimpression.variables === vente.id
            return (
              <div
                key={vente.id}
                className="flex items-center justify-between gap-2 border-b px-2 py-2"
              >
                <div>
                  <p className="text-sm font-medium">
                    N° {vente.ticketNumber} — {formaterMontant(vente.total)}
                  </p>
                  <p className="text-xs text-gray-500">
                    {new Date(vente.createdAt).toLocaleTimeString("fr-FR")} ·{" "}
                    {vente.cashierName} · {vente.itemCount} article
                    {vente.itemCount > 1 ? "s" : ""}
                  </p>
                </div>
                <Button
                  variant="outline"
                  disabled={enCours}
                  onClick={() => reimpression.mutate(vente.id)}
                >
                  {enCours ? "Chargement…" : "Réimprimer"}
                </Button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
