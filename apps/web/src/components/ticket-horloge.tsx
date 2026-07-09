import { useEffect, useState } from "react"

function formatMaintenant() {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date())
}

// Horloge du ticket : vérifie chaque seconde, mais ne re-rend que lorsque
// la minute affichée change (setState avec une chaîne identique est ignoré).
export function TicketHorloge({ className }: { className?: string }) {
  const [maintenant, setMaintenant] = useState(formatMaintenant)

  useEffect(() => {
    const id = setInterval(() => setMaintenant(formatMaintenant()), 1000)
    return () => clearInterval(id)
  }, [])

  return <p className={className}>{maintenant}</p>
}
