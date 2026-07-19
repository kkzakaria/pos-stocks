import { createFileRoute, Link, useRouteContext } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { apiFetch } from "@/lib/api"
import { cn } from "@/lib/utils"
import { formaterMontant } from "@/lib/format"
import {
  blocsTableauDeBord,
  fetchRapportValorisation,
  fetchRapportVentesBoutiques,
  periodePreset,
} from "@/lib/rapports"
import { ErreurChargement } from "@/components/erreur-chargement"
import { BarreProportion } from "@/components/ui/barre-proportion"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"

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

/** Key figure in the header banner: the number is sacred, the layout serves it. */
function StatCle({
  label,
  valeur,
  sousTexte,
  alerte = false,
  enCours = false,
}: {
  label: string
  valeur: string
  sousTexte?: string
  alerte?: boolean
  enCours?: boolean
}) {
  return (
    <div className="min-w-44 flex-1 px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      {enCours ? (
        <Skeleton className="mt-1.5 h-7 w-28" />
      ) : (
        <p
          className={cn(
            "mt-1 text-2xl font-semibold tabular-nums",
            alerte ? "text-destructive" : "text-foreground"
          )}
        >
          {valeur}
        </p>
      )}
      {sousTexte && !enCours && (
        <p className="mt-0.5 text-xs text-muted-foreground">{sousTexte}</p>
      )}
    </div>
  )
}

/** Dashboard section card: title, right-aligned action, and free-form content. */
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
    <section className="rounded-lg bg-card p-4 ring-1 ring-foreground/10">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">{titre}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

const lienBlocClasses =
  "text-sm text-primary underline-offset-4 hover:underline"

/** "Ventes du jour" block: revenue and tickets per store for the day, with a link to the history. */
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
        <Link
          to="/ventes"
          activeOptions={{ exact: true }}
          className={lienBlocClasses}
        >
          Historique →
        </Link>
      }
    >
      {ventes.isPending && <Skeleton className="h-16 w-full" />}
      {ventes.isError && (
        <ErreurChargement
          message="Impossible de charger les ventes du jour."
          onRetry={() => void ventes.refetch()}
        />
      )}
      {ventes.isSuccess &&
        (ventes.data.lignes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune vente aujourd'hui.
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {ventes.data.lignes.map((ligne) => (
              <li key={ligne.storeId} className="space-y-1">
                <div className="flex justify-between gap-2">
                  <span className="truncate">{ligne.storeName}</span>
                  <span className="shrink-0 tabular-nums">
                    {formaterMontant(ligne.ca)} · {ligne.tickets} ticket
                    {ligne.tickets > 1 ? "s" : ""}
                  </span>
                </div>
                <BarreProportion
                  valeur={ligne.ca}
                  total={ventes.data.total.ca}
                />
              </li>
            ))}
            <li className="flex justify-between border-t pt-2 font-medium">
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

/** "Alertes stock bas" block: products below threshold (top 5), sharing its cache with the sidebar badge. */
function BlocAlertes() {
  // Même queryKey que le badge de la sidebar (_app.tsx) : cache partagé.
  const alertes = useQuery({
    queryKey: ["stock-alerts"],
    queryFn: () =>
      apiFetch<{ alerts: Alerte[]; total: number }>("/api/v1/stock/alerts"),
  })
  return (
    <Bloc
      titre="Alertes stock bas"
      action={
        <Link
          to="/stock"
          activeOptions={{ exact: true }}
          className={lienBlocClasses}
        >
          Niveaux →
        </Link>
      }
    >
      {alertes.isPending && <Skeleton className="h-16 w-full" />}
      {alertes.isError && (
        <ErreurChargement
          message="Impossible de charger les alertes."
          onRetry={() => void alertes.refetch()}
        />
      )}
      {alertes.isSuccess &&
        (alertes.data.total === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun produit sous le seuil d'alerte.
          </p>
        ) : (
          <>
            <ul className="space-y-1 text-sm">
              {alertes.data.alerts.slice(0, 5).map((alerte) => (
                <li
                  key={`${alerte.warehouseId}-${alerte.variantId}`}
                  className="flex justify-between gap-2"
                >
                  <span className="truncate">
                    {alerte.productName}
                    {alerte.variantName !== "Standard" &&
                      ` — ${alerte.variantName}`}{" "}
                    <span className="text-muted-foreground">
                      · {alerte.warehouseName}
                    </span>
                  </span>
                  <span className="shrink-0 text-destructive tabular-nums">
                    {alerte.quantity} / seuil {alerte.seuilEffectif ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
            {alertes.data.total > 5 && (
              <p className="mt-2 text-xs text-muted-foreground">
                + {alertes.data.total - 5} autres alertes
              </p>
            )}
          </>
        ))}
    </Bloc>
  )
}

/** "Transferts en attente" block: combines transfers being prepared and in transit (top 5). */
function BlocTransferts() {
  const enPreparation = useQuery({
    queryKey: ["dashboard-transferts", "pending"],
    queryFn: () =>
      apiFetch<{ transfers: TransfertEnAttente[] }>(
        "/api/v1/transfers?statut=pending&limite=50"
      ),
  })
  const enTransit = useQuery({
    queryKey: ["dashboard-transferts", "sent"],
    queryFn: () =>
      apiFetch<{ transfers: TransfertEnAttente[] }>(
        "/api/v1/transfers?statut=sent&limite=50"
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
        <Skeleton className="h-16 w-full" />
      ) : enPreparation.isError || enTransit.isError ? (
        <ErreurChargement
          message="Impossible de charger les transferts."
          onRetry={() => {
            void enPreparation.refetch()
            void enTransit.refetch()
          }}
        />
      ) : lignes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucun transfert en attente.
        </p>
      ) : (
        <ul className="space-y-1 text-sm">
          {lignes.slice(0, 5).map((transfert) => (
            <li key={transfert.id} className="flex justify-between gap-2">
              <span className="truncate">
                {transfert.fromWarehouseName} → {transfert.toWarehouseName}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {LIBELLES_STATUT_TRANSFERT[transfert.status] ??
                  transfert.status}
              </span>
            </li>
          ))}
          {lignes.length > 5 && (
            <li className="text-xs text-muted-foreground">
              + {lignes.length - 5} autres transferts
            </li>
          )}
        </ul>
      )}
    </Bloc>
  )
}

/** "Valeur du stock" block: valuation (quantity × weighted average cost) per warehouse, with a link to the detailed report. */
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
      {valorisation.isPending && <Skeleton className="h-16 w-full" />}
      {valorisation.isError && (
        <ErreurChargement
          message="Impossible de charger la valorisation."
          onRetry={() => void valorisation.refetch()}
        />
      )}
      {valorisation.isSuccess &&
        (valorisation.data.entrepots.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun stock valorisé.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {valorisation.data.entrepots.map((entrepot) => (
              <li key={entrepot.warehouseId} className="space-y-1">
                <div className="flex justify-between gap-2">
                  <span className="truncate">{entrepot.warehouseName}</span>
                  <span className="shrink-0 tabular-nums">
                    {formaterMontant(entrepot.valeur)}
                  </span>
                </div>
                <BarreProportion
                  valeur={entrepot.valeur}
                  total={valorisation.data.total}
                />
              </li>
            ))}
          </ul>
        ))}
    </Bloc>
  )
}

/** Dashboard page: key-figure banner then summary blocks, filtered by the account's permissions (a pure cashier is redirected to the POS). */
function TableauDeBord() {
  const { me } = useRouteContext({ from: "/_app" })
  const blocs = blocsTableauDeBord(me)

  // Chiffres-clés du bandeau — mêmes queryKeys que les blocs (cache partagé,
  // aucune requête en double).
  const { du, au } = periodePreset("jour")
  const ventesJour = useQuery({
    queryKey: ["dashboard-ventes", du],
    queryFn: () => fetchRapportVentesBoutiques(du, au),
    enabled: blocs.ventes,
  })
  const valorisation = useQuery({
    queryKey: ["dashboard-valorisation"],
    queryFn: () => fetchRapportValorisation(),
    enabled: blocs.valorisation,
  })
  const alertes = useQuery({
    queryKey: ["stock-alerts"],
    queryFn: () =>
      apiFetch<{ alerts: Alerte[]; total: number }>("/api/v1/stock/alerts"),
    enabled: blocs.alertes,
  })

  if (blocs.aucun) {
    // An account with no block is either a cashier (assigned to a store → the
    // POS is their workstation) or a staff member with no assignment (no store →
    // /pos would show "no store"). We only send them to the POS in the first
    // case; otherwise we point them to an administrator.
    const estCaissier = me.assignments.some((a) => a.role === "cashier")
    return (
      <div>
        <h1 className="text-xl font-semibold">Tableau de bord</h1>
        {estCaissier ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              Votre poste de travail est le point de vente.
            </p>
            <Button render={<Link to="/pos" />} className="mt-3" size="lg">
              Aller au point de vente
            </Button>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Aucune boutique ne vous est affectée. Demandez à un administrateur
            de vous affecter à un point de vente ou un entrepôt.
          </p>
        )}
      </div>
    )
  }

  const nbAlertes = alertes.data?.total ?? 0
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Tableau de bord</h1>

      {/* Bandeau des chiffres-clés : le chiffre sacré en tête, réglé comme un
          registre — filets fins, tabular-nums, aucun effet décoratif. */}
      <div className="mb-6 flex flex-wrap divide-x divide-border overflow-hidden rounded-lg border">
        {blocs.ventes && (
          <StatCle
            label="Chiffre d'affaires du jour"
            valeur={formaterMontant(ventesJour.data?.total.ca ?? 0)}
            sousTexte={`${ventesJour.data?.total.tickets ?? 0} ticket${
              (ventesJour.data?.total.tickets ?? 0) > 1 ? "s" : ""
            }`}
            enCours={ventesJour.isPending}
          />
        )}
        {blocs.valorisation && (
          <StatCle
            label="Valeur du stock"
            valeur={formaterMontant(valorisation.data?.total ?? 0)}
            sousTexte={`${valorisation.data?.entrepots.length ?? 0} entrepôt${
              (valorisation.data?.entrepots.length ?? 0) > 1 ? "s" : ""
            }`}
            enCours={valorisation.isPending}
          />
        )}
        {blocs.alertes && (
          <StatCle
            label="Alertes stock bas"
            valeur={String(nbAlertes)}
            alerte={nbAlertes > 0}
            sousTexte={
              nbAlertes > 0 ? "à traiter" : "tout est au-dessus du seuil"
            }
            enCours={alertes.isPending}
          />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {blocs.ventes && <BlocVentesDuJour />}
        {blocs.alertes && <BlocAlertes />}
        {blocs.transferts && <BlocTransferts />}
        {blocs.valorisation && <BlocValorisation />}
      </div>
    </div>
  )
}
