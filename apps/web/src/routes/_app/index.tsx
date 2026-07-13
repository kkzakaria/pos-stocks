import { createFileRoute, Link, useRouteContext } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { apiFetch } from "@/lib/api"
import { formaterMontant } from "@/lib/format"
import {
  blocsTableauDeBord,
  fetchRapportValorisation,
  fetchRapportVentesBoutiques,
  periodePreset,
} from "@/lib/rapports"

export const Route = createFileRoute("/_app/")({
  component: TableauDeBord,
})

type Alerte = {
  warehouseId: string
  warehouseName: string
  variantId: string
  productName: string
  variantName: string
  sku: string
  quantity: number
  seuilEffectif: number | null
}

type TransfertEnAttente = {
  id: string
  status: string
  fromWarehouseName: string
  toWarehouseName: string
}

const LIBELLES_STATUT_TRANSFERT: Record<string, string> = {
  pending: "En préparation",
  sent: "Expédié",
}

function Bloc({
  titre,
  action,
  children,
}: {
  titre: string
  action: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">{titre}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

const lienBlocClasses = "text-sm text-blue-600 hover:underline"

function BlocVentesDuJour() {
  const { du, au } = periodePreset("jour")
  const ventes = useQuery({
    queryKey: ["dashboard-ventes", du],
    queryFn: () => fetchRapportVentesBoutiques(du, au),
  })
  return (
    <Bloc
      titre="Ventes du jour"
      action={
        <Link to="/ventes" className={lienBlocClasses}>
          Historique →
        </Link>
      }
    >
      {ventes.isPending && <p className="text-sm text-gray-500">Chargement…</p>}
      {ventes.isError && (
        <p role="alert" className="text-sm text-red-600">
          Impossible de charger les ventes du jour.
        </p>
      )}
      {ventes.isSuccess &&
        (ventes.data.lignes.length === 0 ? (
          <p className="text-sm text-gray-500">Aucune vente aujourd'hui.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {ventes.data.lignes.map((ligne) => (
              <li key={ligne.storeId} className="flex justify-between">
                <span>{ligne.storeName}</span>
                <span className="tabular-nums">
                  {formaterMontant(ligne.ca)} · {ligne.tickets} ticket
                  {ligne.tickets > 1 ? "s" : ""}
                </span>
              </li>
            ))}
            <li className="flex justify-between border-t pt-1 font-medium">
              <span>Total</span>
              <span className="tabular-nums">
                {formaterMontant(ventes.data.total.ca)} ·{" "}
                {ventes.data.total.tickets} tickets
              </span>
            </li>
          </ul>
        ))}
    </Bloc>
  )
}

function BlocAlertes() {
  // Même queryKey que le badge de la sidebar (_app.tsx) : même endpoint,
  // cache partagé.
  const alertes = useQuery({
    queryKey: ["stock-alerts"],
    queryFn: () =>
      apiFetch<{ alerts: Alerte[]; total: number }>("/api/v1/stock/alerts"),
  })
  return (
    <Bloc
      titre="Alertes stock bas"
      action={
        <Link to="/stock" className={lienBlocClasses}>
          Niveaux →
        </Link>
      }
    >
      {alertes.isPending && (
        <p className="text-sm text-gray-500">Chargement…</p>
      )}
      {alertes.isError && (
        <p role="alert" className="text-sm text-red-600">
          Impossible de charger les alertes.
        </p>
      )}
      {alertes.isSuccess &&
        (alertes.data.total === 0 ? (
          <p className="text-sm text-gray-500">
            Aucun produit sous le seuil d'alerte.
          </p>
        ) : (
          <>
            <ul className="space-y-1 text-sm">
              {alertes.data.alerts.slice(0, 5).map((alerte) => (
                <li
                  key={`${alerte.warehouseId}-${alerte.variantId}`}
                  className="flex justify-between"
                >
                  <span>
                    {alerte.productName}
                    {alerte.variantName !== "Standard" &&
                      ` — ${alerte.variantName}`}{" "}
                    <span className="text-gray-500">
                      · {alerte.warehouseName}
                    </span>
                  </span>
                  <span className="text-red-600 tabular-nums">
                    {alerte.quantity} / seuil {alerte.seuilEffectif ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
            {alertes.data.total > 5 && (
              <p className="mt-2 text-xs text-gray-500">
                + {alertes.data.total - 5} autres alertes
              </p>
            )}
          </>
        ))}
    </Bloc>
  )
}

function BlocTransferts() {
  const enPreparation = useQuery({
    queryKey: ["dashboard-transferts", "pending"],
    queryFn: () =>
      apiFetch<{ transfers: TransfertEnAttente[] }>(
        "/api/v1/transfers?statut=pending&limit=50"
      ),
  })
  const enTransit = useQuery({
    queryKey: ["dashboard-transferts", "sent"],
    queryFn: () =>
      apiFetch<{ transfers: TransfertEnAttente[] }>(
        "/api/v1/transfers?statut=sent&limit=50"
      ),
  })
  const lignes = [
    ...(enPreparation.data?.transfers ?? []),
    ...(enTransit.data?.transfers ?? []),
  ]
  return (
    <Bloc
      titre="Transferts en attente"
      action={
        <Link to="/stock/transferts" className={lienBlocClasses}>
          Transferts →
        </Link>
      }
    >
      {enPreparation.isPending || enTransit.isPending ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : enPreparation.isError || enTransit.isError ? (
        <p role="alert" className="text-sm text-red-600">
          Impossible de charger les transferts.
        </p>
      ) : lignes.length === 0 ? (
        <p className="text-sm text-gray-500">Aucun transfert en attente.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {lignes.slice(0, 5).map((transfert) => (
            <li key={transfert.id} className="flex justify-between">
              <span>
                {transfert.fromWarehouseName} → {transfert.toWarehouseName}
              </span>
              <span className="text-gray-500">
                {LIBELLES_STATUT_TRANSFERT[transfert.status] ??
                  transfert.status}
              </span>
            </li>
          ))}
          {lignes.length > 5 && (
            <li className="text-xs text-gray-500">
              + {lignes.length - 5} autres transferts
            </li>
          )}
        </ul>
      )}
    </Bloc>
  )
}

function BlocValorisation() {
  const valorisation = useQuery({
    queryKey: ["dashboard-valorisation"],
    queryFn: () => fetchRapportValorisation(),
  })
  return (
    <Bloc
      titre="Valeur du stock"
      action={
        <Link
          to="/ventes/rapports"
          search={{ onglet: "valorisation" }}
          className={lienBlocClasses}
        >
          Rapport →
        </Link>
      }
    >
      {valorisation.isPending && (
        <p className="text-sm text-gray-500">Chargement…</p>
      )}
      {valorisation.isError && (
        <p role="alert" className="text-sm text-red-600">
          Impossible de charger la valorisation.
        </p>
      )}
      {valorisation.isSuccess &&
        (valorisation.data.entrepots.length === 0 ? (
          <p className="text-sm text-gray-500">Aucun stock valorisé.</p>
        ) : (
          <>
            <p className="text-2xl font-semibold tabular-nums">
              {formaterMontant(valorisation.data.total)}
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {valorisation.data.entrepots.map((entrepot) => (
                <li key={entrepot.warehouseId} className="flex justify-between">
                  <span>{entrepot.warehouseName}</span>
                  <span className="tabular-nums">
                    {formaterMontant(entrepot.valeur)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ))}
    </Bloc>
  )
}

function TableauDeBord() {
  const { me } = useRouteContext({ from: "/_app" })
  const blocs = blocsTableauDeBord(me)
  if (blocs.aucun) {
    return (
      <div>
        <h1 className="text-xl font-semibold">Tableau de bord</h1>
        <p className="mt-2 text-sm text-gray-500">
          Votre poste de travail est le point de vente.
        </p>
        <Link
          to="/pos"
          className="mt-3 inline-block rounded bg-black px-4 py-2 text-sm text-white"
        >
          Aller au point de vente
        </Link>
      </div>
    )
  }
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Tableau de bord</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        {blocs.ventes && <BlocVentesDuJour />}
        {blocs.alertes && <BlocAlertes />}
        {blocs.transferts && <BlocTransferts />}
        {blocs.valorisation && <BlocValorisation />}
      </div>
    </div>
  )
}
