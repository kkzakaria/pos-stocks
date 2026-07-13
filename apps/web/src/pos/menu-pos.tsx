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

  const itemBase = "block w-full rounded px-3 py-2 text-left text-sm"
  const itemNeutre = `${itemBase} hover:bg-accent hover:text-accent-foreground`
  // Le survol neutre partagé écraserait text-destructive ; la déconnexion
  // garde donc son propre survol destructif.
  const itemDestructif = `${itemBase} text-destructive hover:bg-destructive/10 hover:text-destructive`

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
        <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
          <button
            className={itemNeutre}
            onClick={() => {
              setOuvert(false)
              onTicketsDuJour()
            }}
          >
            Tickets du jour
          </button>
          <button
            className={itemNeutre}
            onClick={() => {
              setOuvert(false)
              onFermerCaisse()
            }}
          >
            Fermer la caisse
          </button>
          {peutRetournerBackOffice && (
            <Link to="/" className={itemNeutre}>
              Retour au back-office
            </Link>
          )}
          <button className={itemDestructif} onClick={handleSignOut}>
            Se déconnecter
          </button>
        </div>
      )}
    </div>
  )
}
