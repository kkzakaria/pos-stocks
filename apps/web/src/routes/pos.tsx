import { createFileRoute, redirect } from "@tanstack/react-router"
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

// /pos vit HORS du layout _app : plein écran, pas de sidebar (spec §7).
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
    // Boutiques vendables : /warehouses/destinations est lisible par tout
    // membre (types inclus) — l'intersection avec la matrice « vendre » se
    // fait côté boutiquesVendables ; l'API reste l'autorité.
    const { warehouses } = await apiFetch<{
      warehouses: Array<{ id: string; name: string; type: string }>
    }>("/api/v1/warehouses/destinations")
    const boutiques = boutiquesVendables(me, warehouses)
    if (boutiques.length === 0) throw redirect({ to: "/" })
    return { me, boutiques }
  },
  component: PagePos,
})

function PagePos() {
  const { me, boutiques } = Route.useRouteContext()
  const [boutiqueId, setBoutiqueId] = useState(boutiques[0].id)
  const boutique = boutiques.find((b) => b.id === boutiqueId) ?? boutiques[0]
  const session = useQuery({
    queryKey: ["session-caisse", boutiqueId],
    queryFn: () => fetchSessionCourante(boutiqueId),
  })

  if (session.isPending) {
    return (
      <main className="grid min-h-screen place-items-center">
        <p className="text-gray-500">Chargement de la caisse…</p>
      </main>
    )
  }
  const ouverte = session.data?.session ?? null
  if (!ouverte) {
    return (
      <OuvertureCaisse
        boutiques={boutiques}
        boutiqueId={boutiqueId}
        onChangeBoutique={setBoutiqueId}
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
