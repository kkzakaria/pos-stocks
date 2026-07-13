import { useEffect, useRef } from "react"
import type { KeyboardEvent, RefObject } from "react"

// `readonly current` rend la cible covariante : une RefObject<HTMLButtonElement>
// (ex. bouton « Nouvelle vente ») est acceptée là où l'on attend un HTMLElement.
type CibleFocus = { readonly current: HTMLElement | null }

// Piège de focus mutualisé pour les modales POS (WAI-ARIA APG « Dialog
// Modal »). Extrait de la modale de paiement, dont l'implémentation avait
// déjà colmaté deux fuites vérifiées empiriquement (différé P6) :
//   1. Shift+Tab sur le CONTENEUR lui-même (état initial, tabIndex -1)
//      sortait de la modale.
//   2. Une échappée POINTEUR (clic sur l'overlay, fond non inert) puis Tab
//      reprenait la tabulation dans la page.
// Toute modale hand-rollée de l'app passe par ce hook pour hériter des deux
// correctifs d'un seul coup, plutôt que de dupliquer (et re-régresser) la
// logique.

// Éléments focusables : boutons/inputs non désactivés, liens, tabindex explicite.
const SELECTEUR_FOCUSABLES =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

type Options = {
  // Élément à focaliser à l'ouverture. Par défaut le conteneur (cas sans
  // action évidente, ex. paiement) ; passer un bouton pour offrir un défaut
  // clavier (ex. « Nouvelle vente » sur la confirmation).
  focusInitial?: CibleFocus
}

export function usePiegeFocus<TConteneur extends HTMLElement>(
  onFermer: () => void,
  options?: Options
): {
  conteneurRef: RefObject<TConteneur | null>
  gererClavier: (e: KeyboardEvent<HTMLElement>) => void
} {
  const conteneurRef = useRef<TConteneur>(null)

  // Focus initial sur la modale (WAI-ARIA APG). Volontairement une seule fois
  // à l'ouverture : les refs (conteneur, cible) sont stables.
  useEffect(() => {
    const cible = options?.focusInitial?.current ?? conteneurRef.current
    cible?.focus()
  }, [])

  // Rattrapage : tout focus qui atterrit HORS de la modale (échappée
  // pointeur) est ramené sur le conteneur.
  useEffect(() => {
    const rattraper = (e: FocusEvent) => {
      const conteneur = conteneurRef.current
      if (!conteneur) return
      if (e.target instanceof Node && !conteneur.contains(e.target)) {
        conteneur.focus()
      }
    }
    document.addEventListener("focusin", rattraper)
    return () => document.removeEventListener("focusin", rattraper)
  }, [])

  function gererClavier(e: KeyboardEvent<HTMLElement>) {
    if (e.key === "Escape") {
      onFermer()
      return
    }
    if (e.key !== "Tab") return
    const focusables =
      conteneurRef.current?.querySelectorAll<HTMLElement>(SELECTEUR_FOCUSABLES)
    if (!focusables || focusables.length === 0) return
    const premier = focusables[0]
    const dernier = focusables[focusables.length - 1]
    if (
      e.shiftKey &&
      (document.activeElement === premier ||
        document.activeElement === conteneurRef.current)
    ) {
      e.preventDefault()
      dernier.focus()
    } else if (!e.shiftKey && document.activeElement === dernier) {
      e.preventDefault()
      premier.focus()
    }
  }

  return { conteneurRef, gererClavier }
}
