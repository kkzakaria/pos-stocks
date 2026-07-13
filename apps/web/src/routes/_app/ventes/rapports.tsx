import { createFileRoute, useRouteContext } from "@tanstack/react-router"
import { useState } from "react"
import { FileBarChart } from "lucide-react"
import { RapportVentes } from "@/rapports/rapport-ventes"
import { RapportMarges } from "@/rapports/rapport-marges"
import { RapportValorisation } from "@/rapports/rapport-valorisation"
import { EtatVide } from "@/components/etat-vide"
import { Button } from "@/components/ui/button"

type Onglet = "ventes" | "marges" | "valorisation"

export const Route = createFileRoute("/_app/ventes/rapports")({
  validateSearch: (search: Record<string, unknown>): { onglet?: Onglet } => {
    const onglet = search.onglet
    return onglet === "ventes" ||
      onglet === "marges" ||
      onglet === "valorisation"
      ? { onglet }
      : {}
  },
  component: PageRapports,
})

function PageRapports() {
  const { me } = useRouteContext({ from: "/_app" })
  const role = me.membership?.role
  // Matrice §4 : ventes/marges fermés à stock_manager ; valorisation ouverte
  // aux rôles org, à stock_manager et aux manager/auditor locaux. Le front
  // masque, l'API fait autorité.
  const org = role === "owner" || role === "admin" || role === "auditor"
  const locaux = me.assignments.some(
    (a) => a.role === "manager" || a.role === "auditor"
  )
  const accesVentesMarges = org || locaux
  const accesValorisation = org || role === "stock_manager" || locaux
  const onglets: Array<{ id: Onglet; libelle: string; visible: boolean }> = [
    { id: "ventes", libelle: "Ventes", visible: accesVentesMarges },
    { id: "marges", libelle: "Marges", visible: accesVentesMarges },
    {
      id: "valorisation",
      libelle: "Valorisation du stock",
      visible: accesValorisation,
    },
  ]
  const visibles = onglets.filter((o) => o.visible)
  const { onglet: ongletDemande } = Route.useSearch()
  const [onglet, setOnglet] = useState<Onglet>(() => {
    if (ongletDemande && visibles.some((o) => o.id === ongletDemande)) {
      return ongletDemande
    }
    return visibles.length > 0 ? visibles[0].id : "ventes"
  })

  if (visibles.length === 0) {
    return (
      <div>
        <h1 className="text-xl font-semibold">Rapports</h1>
        <div className="mt-4">
          <EtatVide
            icon={FileBarChart}
            titre="Aucun rapport accessible"
            message="Ce compte n'a accès à aucun rapport. Demandez les droits nécessaires à un administrateur."
          />
        </div>
      </div>
    )
  }
  return (
    <div>
      <h1 className="text-xl font-semibold">Rapports</h1>
      <div className="mt-4 mb-4 flex gap-2">
        {visibles.map((o) => (
          <Button
            key={o.id}
            variant={onglet === o.id ? "default" : "outline"}
            onClick={() => setOnglet(o.id)}
          >
            {o.libelle}
          </Button>
        ))}
      </div>
      {onglet === "ventes" && <RapportVentes />}
      {onglet === "marges" && <RapportMarges />}
      {onglet === "valorisation" && <RapportValorisation />}
    </div>
  )
}
