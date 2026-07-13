import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { authClient } from "@/lib/auth-client"
import { apiFetch } from "@/lib/api"
import { fetchMe } from "@/lib/me"
import type { Me } from "@/lib/me"
import { boutiquesVendables } from "@/lib/pos"
import { fetchSessionCourante } from "@/lib/pos-api"
import { OuvertureCaisse } from "@/pos/ouverture-caisse"
import { EcranVente } from "@/pos/ecran-vente"
import { Button } from "@/components/ui/button"

// /pos vit HORS du layout _app : plein écran, pas de sidebar (spec §7).
// Différés P6 : le fetch des destinations vivait dans beforeLoad sans
// try/catch (erreur réseau = écran d'erreur brut du routeur) — déplacé dans
// le composant (isError → écran avec Réessayer) ; session.isError dégradait
// silencieusement en « Ouvrir la caisse » alors qu'une session est
// peut-être DÉJÀ ouverte — écran d'erreur explicite.
export const Route = createFileRoute("/pos")({
  beforeLoad: async () => {
    const { data } = await authClient.getSession()
    if (!data) throw redirect({ to: "/login" })
    let me: Me
    try {
      me = await fetchMe()
    } catch {
      throw redirect({ to: "/login" })
    }
    if (me.user.mustChangePassword) throw redirect({ to: "/mon-compte" })
    return { me }
  },
  component: PagePos,
})

/** Full-screen POS error screen: alert message, "Réessayer" button, and fallback to the dashboard. */
function EcranErreur({
  message,
  onReessayer,
}: {
  message: string
  onReessayer: () => void
}) {
  return (
    <main className="grid min-h-screen place-items-center">
      <div className="text-center">
        <p role="alert" className="mb-4 text-destructive">
          {message}
        </p>
        <div className="flex items-center justify-center gap-2">
          <Button onClick={onReessayer}>Réessayer</Button>
          <Button variant="outline" render={<Link to="/" />}>
            Retour au tableau de bord
          </Button>
        </div>
      </div>
    </main>
  )
}

/** Point-of-sale router: picks the sellable store, then shows the cash-drawer opening or the sales screen depending on whether a session is open. */
function PagePos() {
  const { me } = Route.useRouteContext()
  const destinations = useQuery({
    queryKey: ["pos-destinations"],
    queryFn: () =>
      apiFetch<{
        warehouses: Array<{ id: string; name: string; type: string }>
      }>("/api/v1/warehouses/destinations"),
  })
  const boutiques = boutiquesVendables(me, destinations.data?.warehouses ?? [])
  const [boutiqueChoisie, setBoutiqueChoisie] = useState<string | null>(null)
  const premiere = boutiques.length > 0 ? boutiques[0].id : null
  const boutiqueId = boutiqueChoisie ?? premiere
  const boutique = boutiques.find((b) => b.id === boutiqueId) ?? null
  const session = useQuery({
    queryKey: ["session-caisse", boutiqueId],
    queryFn: () => fetchSessionCourante(boutiqueId ?? ""),
    enabled: boutiqueId !== null,
  })

  if (destinations.isPending || (boutiqueId !== null && session.isPending)) {
    return (
      <main className="grid min-h-screen place-items-center">
        <p className="text-muted-foreground">Chargement de la caisse…</p>
      </main>
    )
  }
  if (destinations.isError) {
    return (
      <EcranErreur
        message="Impossible de charger les boutiques."
        onReessayer={() => void destinations.refetch()}
      />
    )
  }
  if (!boutique || boutiqueId === null) {
    return (
      <EcranErreur
        message="Aucune boutique vendable pour ce compte."
        onReessayer={() => void destinations.refetch()}
      />
    )
  }
  if (session.isError) {
    return (
      <EcranErreur
        message="Impossible de vérifier la session de caisse."
        onReessayer={() => void session.refetch()}
      />
    )
  }
  const ouverte = session.data?.session ?? null
  if (!ouverte) {
    return (
      <OuvertureCaisse
        boutiques={boutiques}
        boutiqueId={boutiqueId}
        onChangeBoutique={setBoutiqueChoisie}
        onOuverte={() => void session.refetch()}
      />
    )
  }
  return (
    <EcranVente
      me={me}
      boutique={boutique}
      session={ouverte}
      onSessionFermee={() => void session.refetch()}
    />
  )
}
