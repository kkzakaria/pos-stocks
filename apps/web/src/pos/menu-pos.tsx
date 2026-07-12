import { useEffect, useRef, useState } from "react"
import { Link } from "@tanstack/react-router"
import { authClient } from "@/lib/auth-client"

type Props = {
  boutiqueNom: string
  peutRetournerBackOffice: boolean
  onTicketsDuJour: () => void
  onFermerCaisse: () => void
}

// Menu discret en haut à droite du POS (spec §7) : tickets du jour, fermer
// la caisse, retour back-office (si autorisé), déconnexion.
export function MenuPos({
  boutiqueNom,
  peutRetournerBackOffice,
  onTicketsDuJour,
  onFermerCaisse,
}: Props) {
  const [ouvert, setOuvert] = useState(false)
  const conteneur = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ouvert) return
    function fermerSiDehors(e: MouseEvent) {
      if (!conteneur.current?.contains(e.target as Node)) {
        setOuvert(false)
      }
    }
    document.addEventListener("mousedown", fermerSiDehors)
    return () => document.removeEventListener("mousedown", fermerSiDehors)
  }, [ouvert])

  async function handleSignOut() {
    await authClient.signOut()
    window.location.href = "/login"
  }

  const itemClasses =
    "block w-full rounded px-3 py-2 text-left text-sm hover:bg-gray-100"

  return (
    <div ref={conteneur} className="relative">
      <button
        onClick={() => setOuvert((o) => !o)}
        aria-label="Menu"
        aria-expanded={ouvert}
        className="flex min-h-11 items-center gap-2 rounded border px-3 py-2 text-sm"
      >
        <span className="max-w-40 truncate font-medium">{boutiqueNom}</span>
        <span aria-hidden="true">☰</span>
      </button>
      {ouvert && (
        <div className="absolute right-0 z-20 mt-1 w-56 rounded border bg-white p-1 shadow-lg">
          <button
            className={itemClasses}
            onClick={() => {
              setOuvert(false)
              onTicketsDuJour()
            }}
          >
            Tickets du jour
          </button>
          <button
            className={itemClasses}
            onClick={() => {
              setOuvert(false)
              onFermerCaisse()
            }}
          >
            Fermer la caisse
          </button>
          {peutRetournerBackOffice && (
            <Link to="/" className={itemClasses}>
              Retour au back-office
            </Link>
          )}
          <button
            className={`${itemClasses} text-red-600`}
            onClick={handleSignOut}
          >
            Se déconnecter
          </button>
        </div>
      )}
    </div>
  )
}
