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
import { Panier } from "@/pos/panier"
import { PanneauLigne } from "@/pos/panneau-ligne"
import { ModalePaiement } from "@/pos/modale-paiement"
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

export function EcranVente({ me, boutique, session, onSessionFermee }: Props) {
  const queryClient = useQueryClient()
  const catalogue = useQuery({
    queryKey: ["pos-catalogue", boutique.id],
    queryFn: () => fetchCataloguePos(boutique.id),
  })
  const articles = catalogue.data?.articles ?? []
  const categories = catalogue.data?.categories ?? []

  const [lignes, setLignes] = useState<LignePanier[]>([])
  const [recherche, setRecherche] = useState("")
  const [categorieId, setCategorieId] = useState<string | null>(null)
  const [cleChoisie, setCleChoisie] = useState<CleLigne | null>(null)
  const [erreurPrix, setErreurPrix] = useState<string | null>(null)
  const [depannagePour, setDepannagePour] = useState<CleLigne | null>(null)
  const [paiementOuvert, setPaiementOuvert] = useState(false)
  const [erreurVente, setErreurVente] = useState<string | null>(null)
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
  const ligneChoisie = ligneDe(cleChoisie)
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

  const ajouterAuPanier = useCallback((article: ArticlePos) => {
    setLignes((l) => ajouterArticle(l, article))
    setErreurVente(null)
  }, [])
  const scanner = useCallback(
    (code: string) => {
      const article = articles.find((a) => a.barcode === code)
      if (article) ajouterAuPanier(article)
    },
    [articles, ajouterAuPanier]
  )

  // Scan douchette GLOBAL + raccourcis `/` (recherche) et `F2` (encaisser)
  const panierNonVide = lignes.length > 0
  useEffect(() => {
    const surScan = creerBufferScan(scanner)
    const handler = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault()
        if (panierNonVide) setPaiementOuvert(true)
        return
      }
      if (e.key === "/" && document.activeElement !== rechercheRef.current) {
        e.preventDefault()
        rechercheRef.current?.focus()
        return
      }
      surScan(e)
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [scanner, panierNonVide])

  const vente = useMutation({
    mutationFn: (paiements: SalePaymentInput[]) =>
      envoyerVente(
        preparerVente(boutique.id, requestId.current, lignes, paiements)
      ),
    onSuccess: ({ sale }) => {
      setPaiementOuvert(false)
      setLignes([])
      setCleChoisie(null)
      setErreurVente(null)
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
        setErreurVente(
          "Stock insuffisant sur les lignes en alerte — proposez un dépannage ou ajustez les quantités"
        )
        return
      }
      setErreurVente(err instanceof Error ? err.message : "Erreur")
    },
  })

  return (
    <main className="flex h-screen flex-col bg-gray-50 print:hidden">
      <header className="flex items-center gap-3 border-b bg-white px-4 py-2">
        <h1 className="text-lg font-semibold whitespace-nowrap">
          {boutique.name}
        </h1>
        <Input
          ref={rechercheRef}
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Rechercher (nom, SKU, code-barres) — touche /"
          className="max-w-md"
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
      <div className="flex gap-1 overflow-x-auto border-b bg-white px-2 py-1">
        <Button
          variant={categorieId === null ? "default" : "outline"}
          onClick={() => setCategorieId(null)}
        >
          Tout
        </Button>
        {categories.map((cat) => (
          <Button
            key={cat.id}
            variant={categorieId === cat.id ? "default" : "outline"}
            onClick={() => setCategorieId(cat.id)}
          >
            {cat.name}
          </Button>
        ))}
      </div>
      {erreurVente && (
        <p role="alert" className="bg-red-100 px-4 py-2 text-sm text-red-800">
          {erreurVente}
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <section className="min-w-0 flex-1 overflow-y-auto">
          {catalogue.isPending ? (
            <p className="p-6 text-gray-500">Chargement du catalogue…</p>
          ) : (
            <GrilleArticles articles={filtres} onChoisir={ajouterAuPanier} />
          )}
        </section>
        <div className="flex w-96 shrink-0">
          {ligneChoisie && cleChoisie ? (
            <PanneauLigne
              ligne={ligneChoisie}
              erreurPrix={erreurPrix}
              onQuantite={(quantite) =>
                setLignes((l) =>
                  changerQuantite(
                    l,
                    cleChoisie.variantId,
                    cleChoisie.source,
                    quantite
                  )
                )
              }
              onPrix={(prix) => {
                const resultat = changerPrix(
                  lignes,
                  cleChoisie.variantId,
                  cleChoisie.source,
                  prix
                )
                if (!resultat.ok) {
                  setErreurPrix(
                    resultat.raison === "SOUS_PLANCHER"
                      ? `Refusé : minimum ${formaterMontant(resultat.minimum)}`
                      : "Prix non négociable pour cet article"
                  )
                  return
                }
                setErreurPrix(null)
                setLignes(resultat.lignes)
              }}
              onSupprimer={() => {
                setLignes((l) =>
                  supprimerLigne(l, cleChoisie.variantId, cleChoisie.source)
                )
                setCleChoisie(null)
                setErreurPrix(null)
              }}
              onDepanner={() => setDepannagePour(cleChoisie)}
              onFermer={() => {
                setCleChoisie(null)
                setErreurPrix(null)
              }}
            />
          ) : (
            <Panier
              lignes={lignes}
              onChoisirLigne={(ligne) =>
                setCleChoisie({
                  variantId: ligne.variantId,
                  source: ligne.sourceWarehouseId,
                })
              }
              onEncaisser={() => setPaiementOuvert(true)}
            />
          )}
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
            setCleChoisie(
              warehouseId === null
                ? { variantId: depannagePour.variantId, source: null }
                : { variantId: depannagePour.variantId, source: warehouseId }
            )
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
          onFermer={() => setPaiementOuvert(false)}
        />
      )}

      {confirmation && (
        <>
          <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4 print:hidden">
            <div className="w-full max-w-md rounded-lg bg-white p-6 text-center">
              <p className="text-lg font-semibold">
                Vente n° {confirmation.ticketNumber} enregistrée
              </p>
              {confirmation.payments.some((p) => (p.changeGiven ?? 0) > 0) && (
                <p className="my-4 text-5xl font-bold text-green-700 tabular-nums">
                  Monnaie :{" "}
                  {formaterMontant(
                    confirmation.payments.reduce(
                      (somme, p) => somme + (p.changeGiven ?? 0),
                      0
                    )
                  )}
                </p>
              )}
              <div className="mt-4 flex gap-2">
                <Button
                  variant="outline"
                  className="min-h-14 flex-1"
                  onClick={() => window.print()}
                >
                  Réimprimer
                </Button>
                <Button
                  autoFocus
                  className="min-h-14 flex-1 text-lg"
                  onClick={() => setConfirmation(null)}
                >
                  Nouvelle vente
                </Button>
              </div>
            </div>
          </div>
          <ImpressionTicket
            sale={confirmation}
            reglages={reglages.data ?? null}
            onImprime={() => undefined}
          />
        </>
      )}

      {vue === "tickets" && (
        <TicketsDuJour
          storeId={boutique.id}
          onReimprimer={(sale) => setReimpression(sale)}
          onFermer={() => setVue("vente")}
        />
      )}
      {reimpression && (
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
