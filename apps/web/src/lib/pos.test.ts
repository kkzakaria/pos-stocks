import { describe, it, expect, vi, afterEach } from "vitest"
import {
  ajouterArticle,
  boutiquesVendables,
  changerPrix,
  changerQuantite,
  creerBufferScan,
  definirSource,
  estCaissierPur,
  jourLocal,
  marquerLignesEnAlerte,
  monnaieARendre,
  preparerVente,
  resteAPayer,
  supprimerLigne,
  totalPanier,
} from "./pos"
import type { ArticlePos, LignePanier } from "./pos"

const article = (surcharge: Partial<ArticlePos> = {}): ArticlePos => ({
  variantId: "v1",
  productId: "p1",
  productName: "Coca 50cl",
  variantName: "Standard",
  nom: "Coca 50cl",
  sku: "PRD-0001-STD",
  barcode: "3057640100000",
  categoryId: null,
  trackLots: false,
  imageKey: null,
  price: 500,
  minPrice: null,
  quantity: 10,
  ...surcharge,
})

describe("panier", () => {
  it("ajouterArticle crée une ligne au prix catalogue puis incrémente au re-scan", () => {
    const l1 = ajouterArticle([], article())
    expect(l1.length).toBe(1)
    expect(l1[0]).toMatchObject({
      variantId: "v1",
      quantite: 1,
      prixUnitaire: 500,
      prixCatalogue: 500,
      sourceWarehouseId: null,
    })
    const l2 = ajouterArticle(l1, article())
    expect(l2.length).toBe(1)
    expect(l2[0].quantite).toBe(2)
  })

  it("une ligne en dépannage (source différente) reste distincte", () => {
    const lignes = ajouterArticle([], article())
    const avecSource = lignes.map((l) => ({
      ...l,
      sourceWarehouseId: "reserve",
      sourceNom: "Réserve",
    }))
    const apres = ajouterArticle(avecSource, article())
    expect(apres.length).toBe(2)
  })

  it("totaux, quantité, suppression", () => {
    let lignes = ajouterArticle([], article())
    lignes = ajouterArticle(
      lignes,
      article({ variantId: "v2", nom: "Fanta", price: 400 })
    )
    lignes = changerQuantite(lignes, "v1", null, 3)
    expect(totalPanier(lignes)).toBe(3 * 500 + 400)
    lignes = supprimerLigne(lignes, "v2", null)
    expect(lignes.length).toBe(1)
    expect(totalPanier(lignes)).toBe(1500)
  })

  it("changerPrix : refuse sous le plancher avec le minimum, refuse sans plancher, accepte sinon", () => {
    const avecPlancher = ajouterArticle([], article({ minPrice: 400 }))
    const refus = changerPrix(avecPlancher, "v1", null, 350)
    expect(refus).toEqual({ ok: false, raison: "SOUS_PLANCHER", minimum: 400 })
    const ok = changerPrix(avecPlancher, "v1", null, 450)
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.lignes[0].prixUnitaire).toBe(450)
    const sansPlancher = ajouterArticle([], article())
    const fige = changerPrix(sansPlancher, "v1", null, 450)
    expect(fige).toEqual({ ok: false, raison: "NON_NEGOCIABLE", minimum: 500 })
  })

  it("marquerLignesEnAlerte pose enAlerte sur les variantes fautives", () => {
    let lignes = ajouterArticle([], article())
    lignes = ajouterArticle(lignes, article({ variantId: "v2", nom: "Fanta" }))
    const marquees = marquerLignesEnAlerte(lignes, ["v2"])
    expect(marquees.find((l) => l.variantId === "v1")?.enAlerte).toBe(false)
    expect(marquees.find((l) => l.variantId === "v2")?.enAlerte).toBe(true)
  })

  it("definirSource fusionne dans la ligne cible préexistante (quantités additionnées, prix cible conservé)", () => {
    const lignes: LignePanier[] = [
      {
        variantId: "v1",
        nom: "Coca 50cl",
        sku: "PRD-0001-STD",
        quantite: 2,
        prixUnitaire: 500,
        prixCatalogue: 500,
        prixPlancher: null,
        sourceWarehouseId: null,
        sourceNom: null,
        enAlerte: true,
      },
      {
        variantId: "v1",
        nom: "Coca 50cl",
        sku: "PRD-0001-STD",
        quantite: 1,
        prixUnitaire: 450,
        prixCatalogue: 500,
        prixPlancher: 400,
        sourceWarehouseId: "reserve",
        sourceNom: "Réserve",
        enAlerte: false,
      },
    ]
    const apres = definirSource(lignes, "v1", null, "reserve", "Réserve")
    expect(apres.length).toBe(1)
    expect(apres[0]).toMatchObject({
      sourceWarehouseId: "reserve",
      quantite: 3,
      // la ligne cible conserve SON propre prix négocié
      prixUnitaire: 450,
      enAlerte: false,
    })
  })

  it("definirSource : retour boutique (source null) avec ligne boutique préexistante fusionne aussi", () => {
    const lignes: LignePanier[] = [
      {
        variantId: "v1",
        nom: "Coca 50cl",
        sku: "PRD-0001-STD",
        quantite: 1,
        prixUnitaire: 500,
        prixCatalogue: 500,
        prixPlancher: null,
        sourceWarehouseId: "reserve",
        sourceNom: "Réserve",
        enAlerte: false,
      },
      {
        variantId: "v1",
        nom: "Coca 50cl",
        sku: "PRD-0001-STD",
        quantite: 2,
        prixUnitaire: 450,
        prixCatalogue: 500,
        prixPlancher: 400,
        sourceWarehouseId: null,
        sourceNom: null,
        enAlerte: false,
      },
    ]
    const apres = definirSource(lignes, "v1", "reserve", null, null)
    expect(apres.length).toBe(1)
    expect(apres[0]).toMatchObject({
      sourceWarehouseId: null,
      quantite: 3,
      // la ligne boutique préexistante conserve SON propre prix négocié
      prixUnitaire: 450,
    })
  })
})

describe("paiement", () => {
  it("monnaie à rendre et reste à payer", () => {
    expect(monnaieARendre(1400, 2000)).toBe(600)
    expect(monnaieARendre(1400, 1000)).toBe(0)
    expect(
      resteAPayer(1000, [
        { method: "mobile_money", amount: 400, reference: "OM-1" },
      ])
    ).toBe(600)
    expect(resteAPayer(1000, [])).toBe(1000)
  })

  it("preparerVente construit le payload SaleCreateInput exact", () => {
    let lignes: LignePanier[] = ajouterArticle([], article())
    lignes = changerQuantite(lignes, "v1", null, 2)
    lignes = ajouterArticle(
      lignes,
      article({ variantId: "v2", nom: "Fanta", price: 400 })
    )
    lignes = lignes.map((l) =>
      l.variantId === "v2"
        ? { ...l, sourceWarehouseId: "reserve", sourceNom: "Réserve" }
        : l
    )
    const vente = preparerVente("boutique-1", "req-12345678", lignes, [
      { method: "cash", amount: 1000, receivedAmount: 1000 },
      { method: "mobile_money", amount: 400, reference: "OM-1" },
    ])
    expect(vente).toEqual({
      storeId: "boutique-1",
      clientRequestId: "req-12345678",
      items: [
        { variantId: "v1", quantity: 2, unitPrice: 500 },
        {
          variantId: "v2",
          quantity: 1,
          unitPrice: 400,
          sourceWarehouseId: "reserve",
        },
      ],
      payments: [
        { method: "cash", amount: 1000, receivedAmount: 1000 },
        { method: "mobile_money", amount: 400, reference: "OM-1" },
      ],
    })
  })
})

describe("buffer scan douchette", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const frappe = (
    handler: (e: KeyboardEvent) => void,
    touches: string,
    intervalleMs: number
  ) => {
    for (const touche of touches) {
      handler(new KeyboardEvent("keydown", { key: touche }))
      vi.advanceTimersByTime(intervalleMs)
    }
    handler(new KeyboardEvent("keydown", { key: "Enter" }))
  }

  it("frappes rapides + Entrée = scan", () => {
    vi.useFakeTimers()
    const onScan = vi.fn()
    const handler = creerBufferScan(onScan)
    frappe(handler, "3057640100000", 10)
    expect(onScan).toHaveBeenCalledWith("3057640100000")
  })

  it("frappe humaine (lente) : jamais de scan", () => {
    vi.useFakeTimers()
    const onScan = vi.fn()
    const handler = creerBufferScan(onScan)
    frappe(handler, "3057640100000", 200)
    expect(onScan).not.toHaveBeenCalled()
  })

  it("un code trop court est ignoré", () => {
    vi.useFakeTimers()
    const onScan = vi.fn()
    const handler = creerBufferScan(onScan)
    frappe(handler, "ab", 10)
    expect(onScan).not.toHaveBeenCalled()
  })
})

describe("rôles et boutiques", () => {
  const me = (
    role: string | undefined,
    assignments: Array<{
      warehouseId: string
      warehouseName: string
      role: string
    }>
  ) => ({
    membership: role
      ? { organizationId: "o", organizationName: "O", role }
      : null,
    assignments,
  })

  it("estCaissierPur : staff avec uniquement des affectations cashier", () => {
    expect(
      estCaissierPur(
        me("staff", [
          { warehouseId: "b1", warehouseName: "B1", role: "cashier" },
        ])
      )
    ).toBe(true)
    expect(
      estCaissierPur(
        me("staff", [
          { warehouseId: "b1", warehouseName: "B1", role: "cashier" },
          { warehouseId: "d1", warehouseName: "D1", role: "manager" },
        ])
      )
    ).toBe(false)
    expect(estCaissierPur(me("owner", []))).toBe(false)
    expect(estCaissierPur(me("staff", []))).toBe(false)
  })

  it("boutiquesVendables : owner voit toutes les boutiques, staff ses affectations manager/cashier", () => {
    const destinations = [
      { id: "b1", name: "Boutique 1", type: "store" },
      { id: "d1", name: "Dépôt 1", type: "warehouse" },
      { id: "b2", name: "Boutique 2", type: "store" },
    ]
    expect(boutiquesVendables(me("owner", []), destinations)).toEqual([
      { id: "b1", name: "Boutique 1" },
      { id: "b2", name: "Boutique 2" },
    ])
    expect(
      boutiquesVendables(
        me("staff", [
          { warehouseId: "b2", warehouseName: "Boutique 2", role: "cashier" },
          { warehouseId: "d1", warehouseName: "Dépôt 1", role: "manager" },
        ]),
        destinations
      )
    ).toEqual([{ id: "b2", name: "Boutique 2" }])
    expect(boutiquesVendables(me("stock_manager", []), destinations)).toEqual(
      []
    )
  })

  it("jourLocal formate la date LOCALE en AAAA-MM-JJ", () => {
    expect(jourLocal(new Date(2026, 6, 12, 8, 30))).toBe("2026-07-12")
    expect(jourLocal(new Date(2026, 0, 3))).toBe("2026-01-03")
  })
})
