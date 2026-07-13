import { useCallback, useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { SalePaymentInput } from "shared"
import type { Me } from "@/lib/me"
import { ApiError } from "@/lib/api"
import { formaterMontant } from "@/lib/format"
import {
  ajouterArticle,
  changerPrix,
  changerQuantite,
  creerBufferScan,
  definirSource,
  estCaissierPur,
  marquerLignesEnAlerte,
  preparerVente,
  supprimerLigne,
  totalPanier,
} from "@/lib/pos"
import type { ArticlePos, LignePanier } from "@/lib/pos"
import {
  envoyerVente,
  fetchCataloguePos,
  fetchReglagesTicket,
} from "@/lib/pos-api"
import type { SessionCaisse, VenteDetail } from "@/lib/pos-api"
import { GrilleArticles } from "@/pos/grille-articles"
import { Panier, cleLigne } from "@/pos/panier"
import { ModalePaiement } from "@/pos/modale-paiement"
import { ModaleConfirmation } from "@/pos/modale-confirmation"
import { DialogueDepannage } from "@/pos/dialogue-depannage"
import { MenuPos } from "@/pos/menu-pos"
import { ImpressionTicket } from "@/pos/ticket-recu"
import { TicketsDuJour } from "@/pos/tickets-du-jour"
import { FermetureCaisse } from "@/pos/fermeture-caisse"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Props = {
  me: Me
  boutique: { id: string; name: string }
  session: SessionCaisse
  onSessionFermee: () => void
}

type CleLigne = { variantId: string; source: string | null }

/**
 * POS sales screen: tile catalog, cart, barcode scanning and shortcuts
 * (`/`, F2), idempotent checkout handling ambiguous network responses
 * (cart locking) and concurrent stockouts, plus the day's-tickets and
 * cash-drawer-closing views.
 */
export function EcranVente({ me, boutique, session, onSessionFermee }: Props) {
  const queryClient = useQueryClient()
  const catalogue = useQuery({
    queryKey: ["pos-catalogue", boutique.id],
    queryFn: () => fetchCataloguePos(boutique.id),
    // Anomalie E2E P6 : tuiles parfois incomplètes après navigation répétée
    // (l'invalidation ne vivait que dans onSuccess de la vente). Chaque
    // retour sur l'écran repart du serveur — décision 11 du plan.
    refetchOnMount: "always",
  })
  const articles = catalogue.data?.articles ?? []
  const categories = catalogue.data?.categories ?? []

  const [lignes, setLignes] = useState<LignePanier[]>([])
  const [recherche, setRecherche] = useState("")
  const [categorieId, setCategorieId] = useState<string | null>(null)
  const [erreurPrix, setErreurPrix] = useState<{
    cle: string
    message: string
  } | null>(null)
  const [depannagePour, setDepannagePour] = useState<CleLigne | null>(null)
  const [paiementOuvert, setPaiementOuvert] = useState(false)
  const [viderOuvert, setViderOuvert] = useState(false)
  const [erreurVente, setErreurVente] = useState<string | null>(null)
  // Verrouillage panier après une soumission AMBIGUË (réponse réseau
  // perdue, cf. onError ci-dessous) : la vente a peut-être été commitée
  // côté serveur sans que la réponse nous parvienne. Un retry rejoue le
  // MÊME clientRequestId (idempotence, décision 5) — si le panier a changé
  // entre-temps, le retry renverrait l'ancienne vente et onSuccess
  // effacerait silencieusement les modifications. On bloque donc le scan
  // et les modifications manuelles jusqu'à résolution (succès) ou abandon
  // explicite (fermeture de la modale de paiement) ; requestId.current
  // n'est PAS régénéré tant que ce n'est pas résolu.
  const [panierVerrouille, setPanierVerrouille] = useState(false)
  const [confirmation, setConfirmation] = useState<VenteDetail | null>(null)
  const [vue, setVue] = useState<"vente" | "tickets" | "fermeture">("vente")
  const [reimpression, setReimpression] = useState<VenteDetail | null>(null)
  const reglages = useQuery({
    queryKey: ["reglages-ticket"],
    queryFn: fetchReglagesTicket,
  })
  // Identifiant d'idempotence (décision 5) : UN par panier encaissé,
  // conservé tel quel sur retry, régénéré après chaque vente réussie.
  const requestId = useRef(crypto.randomUUID())
  const rechercheRef = useRef<HTMLInputElement>(null)

  const ligneDe = (cle: CleLigne | null): LignePanier | null =>
    cle
      ? (lignes.find(
          (l) =>
            l.variantId === cle.variantId && l.sourceWarehouseId === cle.source
        ) ?? null)
      : null
  const ligneDepannage = ligneDe(depannagePour)

  const minuscule = recherche.trim().toLowerCase()
  const filtres = articles.filter(
    (a) =>
      (categorieId === null || a.categoryId === categorieId) &&
      (minuscule === "" ||
        a.nom.toLowerCase().includes(minuscule) ||
        a.sku.toLowerCase().includes(minuscule) ||
        (a.barcode ?? "").includes(minuscule))
  )

  const ajouterAuPanier = useCallback(
    (article: ArticlePos) => {
      if (panierVerrouille) return
      setLignes((l) => ajouterArticle(l, article))
      setErreurVente(null)
    },
    [panierVerrouille]
  )
  const scanner = useCallback(
    (code: string) => {
      const article = articles.find((a) => a.barcode === code)
      if (article) ajouterAuPanier(article)
    },
    [articles, ajouterAuPanier]
  )

  // Scan douchette GLOBAL + raccourcis `/` (recherche) et `F2` (encaisser) —
  // inertes quand une modale est ouverte (sinon `/` focaliserait la recherche
  // derrière l'overlay, et un scan ajouterait un article invisible).
  const panierNonVide = lignes.length > 0
  const modaleOuverte =
    paiementOuvert ||
    viderOuvert ||
    confirmation !== null ||
    depannagePour !== null ||
    vue !== "vente"
  useEffect(() => {
    if (modaleOuverte) return
    const surScan = creerBufferScan(scanner)
    const handler = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault()
        if (panierNonVide) setPaiementOuvert(true)
        return
      }
      // Suppr : ouvre la confirmation de vidage — inerte pendant une saisie
      // (édition quantité/prix, recherche) où « Suppr » efface un caractère,
      // et quand le panier est vide ou verrouillé.
      if (e.key === "Delete") {
        const actif = document.activeElement
        const dansSaisie =
          actif instanceof HTMLElement &&
          (actif.tagName === "INPUT" ||
            actif.tagName === "TEXTAREA" ||
            actif.isContentEditable)
        if (!dansSaisie && panierNonVide && !panierVerrouille) {
          e.preventDefault()
          setViderOuvert(true)
        }
        return
      }
      if (e.key === "/" && document.activeElement !== rechercheRef.current) {
        e.preventDefault()
        rechercheRef.current?.focus()
        return
      }
      // Le champ de recherche gère ses propres frappes (saisie manuelle ET
      // douchette dans le champ) via son onKeyDown : ne pas doubler avec le
      // buffer de scan global, sinon un scan focus-recherche ajoute 2 articles
      // (le 1er résultat filtré + le code scanné). Revue finale de branche.
      if (document.activeElement === rechercheRef.current) return
      surScan(e)
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [scanner, panierNonVide, modaleOuverte, panierVerrouille])

  const vente = useMutation({
    mutationFn: (paiements: SalePaymentInput[]) =>
      envoyerVente(
        preparerVente(boutique.id, requestId.current, lignes, paiements)
      ),
    onSuccess: ({ sale }) => {
      // Revue — impression et `dejaEnregistree` : on n'inspecte pas ce flag
      // ici volontairement. La clé d'idempotence est régénérée après CHAQUE
      // vente réussie (ligne ci-dessous), donc le seul cas où le serveur
      // répond `dejaEnregistree: true` est un retry après une réponse
      // réseau perdue côté client — qui n'a donc jamais imprimé. Imprimer
      // systématiquement ici est le comportement voulu, pas un oubli.
      setPaiementOuvert(false)
      setLignes([])
      setErreurVente(null)
      setPanierVerrouille(false)
      setConfirmation(sale)
      requestId.current = crypto.randomUUID()
      void queryClient.invalidateQueries({
        queryKey: ["pos-catalogue", boutique.id],
      })
    },
    onError: (err) => {
      // Spec §5, étape 5 : sur STOCK_INSUFFISANT (caisse concurrente),
      // retour au panier avec les lignes fautives en alerte + dépannage.
      if (err instanceof ApiError && err.code === "STOCK_INSUFFISANT") {
        const details = Array.isArray(err.details)
          ? (err.details as Array<{ variantId: string }>)
          : []
        setLignes((l) =>
          marquerLignesEnAlerte(
            l,
            details.map((d) => d.variantId)
          )
        )
        setPaiementOuvert(false)
        setPanierVerrouille(false)
        setErreurVente(
          "Stock insuffisant sur les lignes en alerte — proposez un dépannage ou ajustez les quantités"
        )
        return
      }
      if (err instanceof ApiError) {
        // Erreur structurée : le serveur A RÉPONDU, la vente n'a pas été
        // commitée (toute erreur métier est levée avant le commit du
        // batch) — sans risque à modifier le panier.
        setPanierVerrouille(false)
        setErreurVente(err.message)
        return
      }
      // Erreur réseau/timeout AMBIGUË : pas de réponse reçue, le batch a
      // pu être commité côté serveur. On verrouille le panier (voir
      // commentaire sur panierVerrouille) jusqu'à retry ou abandon.
      setPanierVerrouille(true)
      setErreurVente(
        (err instanceof Error ? err.message : "Erreur réseau") +
          " — la vente est peut-être déjà enregistrée : réessayez, ou fermez pour vérifier les tickets du jour avant de modifier le panier."
      )
    },
  })

  return (
    <main className="flex h-screen flex-col bg-muted print:hidden">
      <header className="flex items-center gap-3 border-b bg-card px-4 py-2">
        <h1 className="text-lg font-semibold whitespace-nowrap">
          {boutique.name}
        </h1>
        <Input
          ref={rechercheRef}
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          onKeyDown={(e) => {
            // Entrée ajoute le premier résultat filtré et vide la recherche :
            // encaissement clavier sans douchette ni clic sur la tuile.
            if (
              e.key === "Enter" &&
              recherche.trim() !== "" &&
              filtres.length > 0
            ) {
              e.preventDefault()
              ajouterAuPanier(filtres[0])
              setRecherche("")
            }
          }}
          placeholder="Rechercher (nom, SKU, code-barres) — touche /"
          // Compact à la souris (back-office), 44px au doigt (comptoir tactile).
          className="max-w-md pointer-coarse:min-h-11"
        />
        <div className="ml-auto">
          <MenuPos
            boutiqueNom={boutique.name}
            peutRetournerBackOffice={!estCaissierPur(me)}
            onTicketsDuJour={() => setVue("tickets")}
            onFermerCaisse={() => setVue("fermeture")}
          />
        </div>
      </header>
      <div
        role="group"
        aria-label="Filtrer par catégorie"
        className="flex gap-1 overflow-x-auto border-b bg-card px-2 py-1"
      >
        <Button
          variant={categorieId === null ? "default" : "outline"}
          aria-pressed={categorieId === null}
          onClick={() => setCategorieId(null)}
          // Chips denses à la souris, cibles ≥ 44px au doigt (WCAG 2.5.5).
          className="pointer-coarse:min-h-11 pointer-coarse:px-3"
        >
          Tout
        </Button>
        {categories.map((cat) => (
          <Button
            key={cat.id}
            variant={categorieId === cat.id ? "default" : "outline"}
            aria-pressed={categorieId === cat.id}
            onClick={() => setCategorieId(cat.id)}
            className="pointer-coarse:min-h-11 pointer-coarse:px-3"
          >
            {cat.name}
          </Button>
        ))}
      </div>
      {erreurVente && (
        <p
          role="alert"
          className="bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          {erreurVente}
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <section className="min-w-0 flex-1 overflow-y-auto">
          {catalogue.isPending ? (
            <p className="p-6 text-muted-foreground">
              Chargement du catalogue…
            </p>
          ) : catalogue.isError ? (
            <div className="p-6">
              <p role="alert" className="mb-3 text-sm text-destructive">
                Impossible de charger le catalogue.
              </p>
              <Button
                variant="outline"
                onClick={() => void catalogue.refetch()}
              >
                Réessayer
              </Button>
            </div>
          ) : (
            <GrilleArticles articles={filtres} onChoisir={ajouterAuPanier} />
          )}
        </section>
        <div className="flex w-96 shrink-0">
          <Panier
            lignes={lignes}
            verrouille={panierVerrouille}
            erreurPrix={erreurPrix}
            onQuantite={(ligne, quantite) => {
              if (panierVerrouille) return
              setLignes((l) =>
                changerQuantite(
                  l,
                  ligne.variantId,
                  ligne.sourceWarehouseId,
                  quantite
                )
              )
            }}
            onPrix={(ligne, prix) => {
              if (panierVerrouille) return
              const resultat = changerPrix(
                lignes,
                ligne.variantId,
                ligne.sourceWarehouseId,
                prix
              )
              if (!resultat.ok) {
                setErreurPrix({
                  cle: cleLigne(ligne),
                  message:
                    resultat.raison === "SOUS_PLANCHER"
                      ? `Refusé : minimum ${formaterMontant(resultat.minimum)}`
                      : "Prix non négociable pour cet article",
                })
                return
              }
              setErreurPrix(null)
              setLignes(resultat.lignes)
            }}
            onSupprimer={(ligne) => {
              if (panierVerrouille) return
              setLignes((l) =>
                supprimerLigne(l, ligne.variantId, ligne.sourceWarehouseId)
              )
              setErreurPrix(null)
            }}
            onDepanner={(ligne) => {
              if (panierVerrouille) return
              setDepannagePour({
                variantId: ligne.variantId,
                source: ligne.sourceWarehouseId,
              })
            }}
            onVider={() => {
              if (panierVerrouille) return
              setLignes([])
              setErreurPrix(null)
              setErreurVente(null)
            }}
            viderOuvert={viderOuvert}
            onViderOuvertChange={setViderOuvert}
            onEncaisser={() => setPaiementOuvert(true)}
          />
        </div>
      </div>

      {ligneDepannage && depannagePour && (
        <DialogueDepannage
          storeId={boutique.id}
          ligne={ligneDepannage}
          onChoisir={(warehouseId, nom) => {
            setLignes((l) =>
              definirSource(
                l,
                depannagePour.variantId,
                depannagePour.source,
                warehouseId,
                nom
              )
            )
            setDepannagePour(null)
          }}
          onFermer={() => setDepannagePour(null)}
        />
      )}

      {paiementOuvert && (
        <ModalePaiement
          total={totalPanier(lignes)}
          enCours={vente.isPending}
          erreur={erreurVente}
          onValider={(paiements) => vente.mutate(paiements)}
          onFermer={() => {
            // Fermer la modale après une tentative ambiguë vaut abandon
            // explicite (décision : déverrouille le panier, cf.
            // panierVerrouille) — requestId.current n'est pas régénéré,
            // un futur encaissement rejouera donc la même tentative.
            setPanierVerrouille(false)
            setPaiementOuvert(false)
          }}
        />
      )}

      {confirmation && (
        <>
          <ModaleConfirmation
            vente={confirmation}
            onNouvelleVente={() => setConfirmation(null)}
            onReimprimer={() => window.print()}
          />
          {!reglages.isPending && (
            <ImpressionTicket
              sale={confirmation}
              reglages={reglages.data ?? null}
              onImprime={() => undefined}
            />
          )}
        </>
      )}

      {vue === "tickets" && (
        <TicketsDuJour
          storeId={boutique.id}
          onReimprimer={(sale) => setReimpression(sale)}
          onFermer={() => setVue("vente")}
        />
      )}
      {reimpression && !reglages.isPending && (
        <ImpressionTicket
          sale={reimpression}
          reglages={reglages.data ?? null}
          onImprime={() => setReimpression(null)}
        />
      )}
      {vue === "fermeture" && (
        <FermetureCaisse
          session={session}
          onFermee={() => {
            setVue("vente")
            onSessionFermee()
          }}
          onAnnuler={() => setVue("vente")}
        />
      )}
    </main>
  )
}
