import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import {
  clePanier,
  charger,
  enregistrer,
  purger,
  revaliderPanier,
} from "@/lib/panier-persistance"
import type { PanierPersiste } from "@/lib/panier-persistance"
import type { ArticlePos, LignePanier } from "@/lib/pos"

const ligne: LignePanier = {
  variantId: "v1",
  nom: "Coca 50cl",
  sku: "SKU1",
  imageKey: null,
  quantite: 2,
  prixUnitaire: 450, // negotiated price, below the catalogue price
  prixCatalogue: 500,
  prixPlancher: 400,
  sourceWarehouseId: "wh2", // sourced from another warehouse
  sourceNom: "Dépôt central",
  enAlerte: false,
}

const etat: PanierPersiste = {
  v: 1,
  lignes: [ligne],
  requestId: "req-1",
  verrouille: true,
  majA: "2026-07-19T10:00:00.000Z",
}

describe("panier-persistance", () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it("compose une clé scopée boutique + session", () => {
    expect(clePanier("store1", "sess1")).toBe("pos:panier:store1:sess1")
  })

  it("round-trip : prix négocié et dépannage survivent à l'identique", async () => {
    await enregistrer("k", etat)
    expect(charger("k")).toEqual(etat)
  })

  it("renvoie null si rien n'est stocké", async () => {
    expect(charger("k")).toBeNull()
  })

  it("purge et renvoie null sur une version inconnue", async () => {
    localStorage.setItem("k", JSON.stringify({ ...etat, v: 2 }))
    expect(charger("k")).toBeNull()
    expect(localStorage.getItem("k")).toBeNull()
  })

  it("purge et renvoie null sur un JSON illisible", async () => {
    localStorage.setItem("k", "{pas du json")
    expect(charger("k")).toBeNull()
    expect(localStorage.getItem("k")).toBeNull()
  })

  it("purger supprime l'entrée", async () => {
    await enregistrer("k", etat)
    await purger("k")
    expect(localStorage.getItem("k")).toBeNull()
  })

  it("n'écrase pas un panier verrouillé d'un AUTRE onglet/requestId", async () => {
    const verrouilleAutreOnglet: PanierPersiste = {
      ...etat,
      verrouille: true,
      requestId: "req-onglet-a",
    }
    await enregistrer("k", verrouilleAutreOnglet)
    // Tab B has a DIFFERENT requestId: the write is refused so tab A's lock
    // (and its idempotency key) survives intact.
    await enregistrer("k", {
      ...etat,
      verrouille: false,
      requestId: "req-onglet-b",
    })
    expect(charger("k")).toEqual(verrouilleAutreOnglet)
  })

  it("purger ne supprime pas un panier verrouillé d'un AUTRE requestId", async () => {
    const verrouilleAutreOnglet: PanierPersiste = {
      ...etat,
      verrouille: true,
      requestId: "req-onglet-a",
    }
    await enregistrer("k", verrouilleAutreOnglet)
    // Tab B empties its cart: it must NOT wipe tab A's locked entry, which is
    // the only thing preventing a duplicate sale on retry.
    await purger("k", "req-onglet-b")
    expect(charger("k")).toEqual(verrouilleAutreOnglet)
  })

  it("purger supprime un panier verrouillé du MÊME requestId", async () => {
    await enregistrer("k", {
      ...etat,
      verrouille: true,
      requestId: "req-onglet-a",
    })
    await purger("k", "req-onglet-a")
    expect(localStorage.getItem("k")).toBeNull()
  })

  it("sérialise l'écriture sous un verrou inter-onglets quand navigator.locks existe", async () => {
    // jsdom does not implement the Web Locks API: it is stubbed here to prove
    // that the atomic path is actually taken.
    const nomsDemandes: string[] = []
    const verrous = {
      request: async (nom: string, rappel: () => void): Promise<void> => {
        nomsDemandes.push(nom)
        rappel()
      },
    }
    vi.stubGlobal("navigator", { ...globalThis.navigator, locks: verrous })

    await enregistrer("k", etat)
    await purger("k", etat.requestId)

    expect(nomsDemandes).toEqual(["pos:panier-lock:k", "pos:panier-lock:k"])
    expect(localStorage.getItem("k")).toBeNull()
    vi.unstubAllGlobals()
  })

  it("ne persiste RIEN si l'API Web Locks est absente (fail-safe)", async () => {
    // No atomic cross-tab primitive means the anti-duplicate-sale guard cannot
    // hold, so persistence is disabled rather than run non-atomically.
    const sansVerrous = { ...globalThis.navigator }
    delete (sansVerrous as { locks?: unknown }).locks
    vi.stubGlobal("navigator", sansVerrous)

    await enregistrer("k", etat)
    expect(localStorage.getItem("k")).toBeNull()

    vi.unstubAllGlobals()
  })

  it("garde le verrou d'un autre onglet même sous Web Locks", async () => {
    const verrous = {
      request: async (_nom: string, rappel: () => void): Promise<void> => {
        rappel()
      },
    }
    vi.stubGlobal("navigator", { ...globalThis.navigator, locks: verrous })

    const verrouilleAutreOnglet: PanierPersiste = {
      ...etat,
      verrouille: true,
      requestId: "req-onglet-a",
    }
    await enregistrer("k", verrouilleAutreOnglet)
    await enregistrer("k", { ...etat, requestId: "req-onglet-b" })
    await purger("k", "req-onglet-b")

    expect(charger("k")).toEqual(verrouilleAutreOnglet)
    vi.unstubAllGlobals()
  })

  it("purge et renvoie null si une ligne n'a pas tous ses champs requis", async () => {
    const { nom: _nom, ...ligneSansNom } = ligne
    localStorage.setItem(
      "k",
      JSON.stringify({ ...etat, lignes: [ligneSansNom] })
    )
    expect(charger("k")).toBeNull()
    expect(localStorage.getItem("k")).toBeNull()
  })

  it("autorise l'écrasement d'un panier verrouillé par le MÊME requestId (le même onglet résout son propre verrou)", async () => {
    const verrouille: PanierPersiste = {
      ...etat,
      verrouille: true,
      requestId: "req-onglet-a",
    }
    await enregistrer("k", verrouille)
    const resolu: PanierPersiste = {
      ...etat,
      verrouille: false,
      requestId: "req-onglet-a",
      lignes: [],
    }
    await enregistrer("k", resolu)
    expect(charger("k")).toEqual(resolu)
  })

  it("purge et renvoie null si une ligne est corrompue (variantId non-string)", async () => {
    localStorage.setItem(
      "k",
      JSON.stringify({
        ...etat,
        lignes: [{ ...ligne, variantId: 42 }],
      })
    )
    expect(charger("k")).toBeNull()
    expect(localStorage.getItem("k")).toBeNull()
  })

  it("purge et renvoie null si une ligne a une quantité non finie", async () => {
    localStorage.setItem(
      "k",
      JSON.stringify({
        ...etat,
        lignes: [{ ...ligne, quantite: Number.NaN }],
      })
    )
    expect(charger("k")).toBeNull()
    expect(localStorage.getItem("k")).toBeNull()
  })

  it("purge et renvoie null si une ligne a un prixUnitaire non finie", async () => {
    localStorage.setItem(
      "k",
      JSON.stringify({
        ...etat,
        lignes: [{ ...ligne, prixUnitaire: "500" }],
      })
    )
    expect(charger("k")).toBeNull()
    expect(localStorage.getItem("k")).toBeNull()
  })

  it("ne lève jamais si localStorage est indisponible", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("indisponible")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota")
    })
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("indisponible")
    })
    expect(charger("k")).toBeNull()
    // Since `enregistrer`/`purger` are async, `expect(() => …).not.toThrow()`
    // would be tautological: the promise must be awaited to prove the internal
    // try/catch actually absorbs the storage failure.
    await expect(enregistrer("k", etat)).resolves.toBeUndefined()
    await expect(purger("k")).resolves.toBeUndefined()
  })
})

const article: ArticlePos = {
  variantId: "v1",
  productId: "p1",
  productName: "Coca 50cl",
  variantName: "Standard",
  nom: "Coca 50cl",
  sku: "SKU1",
  barcode: null,
  categoryId: null,
  trackLots: false,
  imageKey: null,
  price: 500,
  minPrice: 400,
  quantity: 10,
}

describe("revaliderPanier", () => {
  it("retire une ligne dont l'article n'est plus au catalogue", () => {
    const r = revaliderPanier([ligne], [])
    expect(r.lignes).toEqual([])
    expect(r.retirees).toBe(1)
    expect(r.prixModifies).toBe(0)
  })

  it("laisse intacte une ligne dont le prix catalogue n'a pas bougé", () => {
    const r = revaliderPanier([ligne], [article])
    expect(r.lignes).toEqual([ligne])
    expect(r.retirees).toBe(0)
    expect(r.prixModifies).toBe(0)
  })

  it("actualise prixCatalogue et marque la ligne, sans toucher prixUnitaire", () => {
    const r = revaliderPanier([ligne], [{ ...article, price: 600 }])
    expect(r.prixModifies).toBe(1)
    expect(r.retirees).toBe(0)
    expect(r.lignes[0].prixCatalogue).toBe(600)
    expect(r.lignes[0].prixModifie).toBe(true)
    // The negotiated price must survive revalidation.
    expect(r.lignes[0].prixUnitaire).toBe(450)
  })

  it("compte séparément retraits et prix modifiés", () => {
    const autre: LignePanier = { ...ligne, variantId: "v2", sku: "SKU2" }
    const r = revaliderPanier([ligne, autre], [{ ...article, price: 600 }])
    expect(r.retirees).toBe(1)
    expect(r.prixModifies).toBe(1)
    expect(r.lignes).toHaveLength(1)
  })

  it("gère un panier vide", () => {
    const r = revaliderPanier([], [article])
    expect(r).toEqual({ lignes: [], retirees: 0, prixModifies: 0 })
  })
})
