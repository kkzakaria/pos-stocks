import type { Me } from "@/lib/me"
import type { SessionCaisse } from "@/lib/pos-api"
import { MenuPos } from "@/pos/menu-pos"
import { estCaissierPur } from "@/lib/pos"

type Props = {
  me: Me
  boutique: { id: string; name: string }
  session: SessionCaisse
  onSessionFermee: () => void
}

export function EcranVente({ me, boutique, session, onSessionFermee }: Props) {
  void session
  void onSessionFermee
  return (
    <main className="flex min-h-screen flex-col bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-4 py-2">
        <h1 className="text-lg font-semibold">Point de vente</h1>
        <MenuPos
          boutiqueNom={boutique.name}
          peutRetournerBackOffice={!estCaissierPur(me)}
          onTicketsDuJour={() => undefined}
          onFermerCaisse={() => undefined}
        />
      </header>
      <p className="p-6 text-gray-500">Caisse ouverte — écran de vente.</p>
    </main>
  )
}
