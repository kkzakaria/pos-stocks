import { parseArgs } from "node:util"
import path from "node:path"
import { connecter, requeteJson } from "./http-client"
import type { ClientApi } from "./http-client"
import { lireStores, lireInventaire } from "./supabase-source"
import type { StoreSource } from "./supabase-source"
import { chargerJson, ecrireJsonAtomique } from "./journal-simple"
import { carteSkuVariante, mapperInventaire, chunk } from "./inventaire"
import type { ProduitApi, ItemReception, LigneIgnoree } from "./inventaire"

// Warehouse+supplier journal produced by creer-magasins.ts. Read-only here —
// this script never writes to it.
interface JournalMagasins {
  warehousesByName: Record<string, string>
  supplierId?: string
}

interface OptionsCli {
  apiUrl: string
  webOrigin: string
  journalMagasins: string
  journal: string
  supabaseWorkdir: string | undefined
  tailleLot: number
  dryRun: boolean
}

function lireOptions(argv: string[]): OptionsCli {
  const { values } = parseArgs({
    args: argv,
    options: {
      "api-url": { type: "string", default: "http://localhost:8787" },
      // Doit correspondre au WEB_ORIGIN configuré côté serveur cible
      // (auth.ts trustedOrigins) — indépendant de --api-url.
      "web-origin": { type: "string", default: "http://localhost:3000" },
      "journal-magasins": {
        type: "string",
        default: path.join(import.meta.dir, "data", "magasins-local.json"),
      },
      journal: {
        type: "string",
        default: path.join(import.meta.dir, "data", "inventaire-local.json"),
      },
      // Directory from which `supabase db query --linked` resolves the linked
      // project. Optional — defaults (in supabase-source) to the worktree root.
      "supabase-workdir": { type: "string" },
      "taille-lot": { type: "string", default: "100" },
      "dry-run": { type: "boolean", default: false },
    },
  })
  return {
    apiUrl: values["api-url"],
    webOrigin: values["web-origin"],
    journalMagasins: values["journal-magasins"],
    journal: values.journal,
    supabaseWorkdir: values["supabase-workdir"],
    tailleLot: Number(values["taille-lot"]),
    dryRun: values["dry-run"],
  }
}

/**
 * In dry-run, an authenticated client is only obtained (and only the
 * read-only GET /products call made) when credentials are available — that
 * is what lets variant resolution happen so the printed plan is accurate.
 * Without credentials, dry-run still runs but falls back to a raw report
 * (see main()). Outside dry-run, credentials are mandatory.
 */
async function obtenirClient(options: OptionsCli): Promise<ClientApi | null> {
  const email = process.env.IMPORT_EMAIL
  const password = process.env.IMPORT_PASSWORD
  if (options.dryRun) {
    if (email && password) {
      return connecter(options.apiUrl, email, password, options.webOrigin)
    }
    return null
  }
  if (!email || !password) {
    throw new Error(
      "Variables d'environnement IMPORT_EMAIL et IMPORT_PASSWORD requises (sauf en --dry-run)"
    )
  }
  return connecter(options.apiUrl, email, password, options.webOrigin)
}

/** Composes storeId → warehouseId from the Supabase stores and the magasins journal. */
function construireCarteEntrepots(
  stores: StoreSource[],
  journal: JournalMagasins
): Map<string, string> {
  const carte = new Map<string, string>()
  for (const store of stores) {
    // Direct Record lookup: noUncheckedIndexedAccess is off, so the cast
    // makes the possible absence explicit for eslint/TS.
    const warehouseId = journal.warehousesByName[store.name] as
      string | undefined
    if (warehouseId !== undefined) {
      carte.set(store.id, warehouseId)
    }
  }
  return carte
}

/** Fetches every product page until `total` products have been collected. */
async function recupererProduits(client: ClientApi): Promise<ProduitApi[]> {
  const produits: ProduitApi[] = []
  const limite = 200
  let page = 1
  for (;;) {
    const { donnees } = await requeteJson<{
      products: ProduitApi[]
      total: number
      page: number
      limite: number
    }>(client, "GET", `/api/v1/products?page=${page}&limite=${limite}`)
    produits.push(...donnees.products)
    if (donnees.products.length === 0 || produits.length >= donnees.total) {
      break
    }
    page += 1
  }
  return produits
}

interface RapportMagasin {
  items: number
  quantite: number
  receptions: number
}

/**
 * Processes every chunk of a single warehouse's items sequentially: create a
 * purchase, add its items, receive it. On receive success the warehouse's
 * validated-chunk count is persisted atomically so a re-run resumes from
 * there. On any failure — in particular a 404 INTROUVABLE on an item, meaning
 * the variant no longer resolves — the current chunk is abandoned (its draft
 * purchase, if created, is left unreceived) and the error propagates: the
 * journal count is never advanced past the last successfully received chunk,
 * so the abandoned chunk is retried from scratch on the next run.
 */
async function traiterMagasin(
  client: ClientApi,
  warehouseId: string,
  items: ItemReception[],
  supplierId: string,
  tailleLot: number,
  journalInventaire: Record<string, number>,
  cheminJournal: string,
  dryRun: boolean
): Promise<RapportMagasin> {
  const lots = chunk(items, tailleLot)
  // Direct Record lookup: noUncheckedIndexedAccess is off, so the cast makes
  // the possible absence explicit for eslint/TS.
  const dejaValides =
    (journalInventaire[warehouseId] as number | undefined) ?? 0
  const rapport: RapportMagasin = { items: 0, quantite: 0, receptions: 0 }

  for (let k = 0; k < lots.length; k += 1) {
    if (k < dejaValides) continue

    const lot = lots[k]
    const quantiteLot = lot.reduce((somme, item) => somme + item.quantity, 0)

    if (dryRun) {
      console.log(
        `[dry-run] entrepôt ${warehouseId} : lot ${k + 1}/${lots.length} — ${lot.length} article(s), quantité ${quantiteLot}`
      )
      rapport.items += lot.length
      rapport.quantite += quantiteLot
      rapport.receptions += 1
      continue
    }

    const reference = `Stock initial Supabase (lot ${k + 1})`
    const achat = await requeteJson<{
      id?: string
      code?: string
      message?: string
    }>(client, "POST", "/api/v1/purchases", {
      warehouseId,
      supplierId,
      reference,
    })
    if (achat.status !== 201 || achat.donnees.id === undefined) {
      throw new Error(
        `Échec de création de la réception (entrepôt ${warehouseId}, lot ${k + 1}) (${achat.status}) : ${JSON.stringify(achat.donnees)}`
      )
    }
    const purchaseId = achat.donnees.id

    for (const item of lot) {
      const reponseItem = await requeteJson<{
        id?: string
        code?: string
        message?: string
      }>(client, "POST", `/api/v1/purchases/${purchaseId}/items`, {
        variantId: item.variantId,
        quantity: item.quantity,
        unitCost: item.unitCost,
      })
      if (
        reponseItem.status === 404 &&
        reponseItem.donnees.code === "INTROUVABLE"
      ) {
        throw new Error(
          `Variante ${item.variantId} introuvable : lot ${k + 1} de l'entrepôt ${warehouseId} abandonné (réception ${purchaseId} laissée non validée)`
        )
      }
      if (reponseItem.status !== 201) {
        throw new Error(
          `Échec d'ajout d'article sur la réception ${purchaseId} (entrepôt ${warehouseId}, lot ${k + 1}) (${reponseItem.status}) : ${JSON.stringify(reponseItem.donnees)}`
        )
      }
    }

    const reception = await requeteJson<{ code?: string; message?: string }>(
      client,
      "POST",
      `/api/v1/purchases/${purchaseId}/receive`
    )
    if (reception.status !== 200) {
      throw new Error(
        `Échec de validation de la réception ${purchaseId} (entrepôt ${warehouseId}, lot ${k + 1}) (${reception.status}) : ${JSON.stringify(reception.donnees)}`
      )
    }

    journalInventaire[warehouseId] = k + 1
    ecrireJsonAtomique(cheminJournal, journalInventaire)

    rapport.items += lot.length
    rapport.quantite += quantiteLot
    rapport.receptions += 1
  }

  return rapport
}

/** Raw (variant-agnostic) plan used in dry-run when no credentials are available. */
function imprimerPlanBrut(
  lignes: ReturnType<typeof lireInventaire>,
  storeIdVersWarehouse: Map<string, string>
): void {
  console.log(
    "[dry-run] IMPORT_EMAIL/IMPORT_PASSWORD absents : résolution des variantes ignorée — rapport basé sur les lignes brutes de l'inventaire Supabase."
  )
  const parCible = new Map<string, { lignes: number; quantite: number }>()
  for (const ligne of lignes) {
    const warehouseId = storeIdVersWarehouse.get(ligne.storeId)
    const cle =
      warehouseId ?? `magasin Supabase sans entrepôt cible (${ligne.storeId})`
    const cumul = parCible.get(cle) ?? { lignes: 0, quantite: 0 }
    cumul.lignes += 1
    cumul.quantite += ligne.quantity
    parCible.set(cle, cumul)
  }
  console.log("\n--- Plan brut (sans résolution de variantes) ---")
  for (const [cle, cumul] of parCible) {
    console.log(
      `${cle} : ${cumul.lignes} ligne(s), quantité totale ${cumul.quantite}`
    )
  }
}

async function main(): Promise<void> {
  const options = lireOptions(process.argv.slice(2))

  const journalMagasins = chargerJson<JournalMagasins>(
    options.journalMagasins,
    {
      warehousesByName: {},
    }
  )
  if (
    journalMagasins.supplierId === undefined ||
    Object.keys(journalMagasins.warehousesByName).length === 0
  ) {
    console.error(
      `Journal des magasins introuvable ou incomplet (${options.journalMagasins}). ` +
        "Exécuter d'abord creer-magasins.ts pour créer les entrepôts et le fournisseur."
    )
    process.exitCode = 1
    return
  }
  const supplierId = journalMagasins.supplierId

  const stores = lireStores(options.supabaseWorkdir)
  console.log(`${stores.length} magasins chargés depuis Supabase`)
  const storeIdVersWarehouse = construireCarteEntrepots(stores, journalMagasins)

  const lignes = lireInventaire(options.supabaseWorkdir)
  console.log(`${lignes.length} lignes d'inventaire chargées depuis Supabase`)

  const client = await obtenirClient(options)
  if (client === null) {
    imprimerPlanBrut(lignes, storeIdVersWarehouse)
    return
  }

  const produits = await recupererProduits(client)
  console.log(`${produits.length} produits chargés depuis l'API`)
  const skuVersVariante = carteSkuVariante(produits)

  const {
    itemsParMagasin,
    ignorees,
  }: {
    itemsParMagasin: Map<string, ItemReception[]>
    ignorees: LigneIgnoree[]
  } = mapperInventaire(lignes, skuVersVariante, storeIdVersWarehouse)

  const journalInventaire = chargerJson<Record<string, number>>(
    options.journal,
    {}
  )

  const parMagasin = new Map<string, RapportMagasin>()
  const erreurs: Array<{ warehouseId: string; erreur: string }> = []

  for (const [warehouseId, items] of itemsParMagasin) {
    try {
      const rapport = await traiterMagasin(
        client,
        warehouseId,
        items,
        supplierId,
        options.tailleLot,
        journalInventaire,
        options.journal,
        options.dryRun
      )
      parMagasin.set(warehouseId, rapport)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`entrepôt ${warehouseId} : ${message}`)
      erreurs.push({ warehouseId, erreur: message })
    }
  }

  console.log("\n--- Rapport ---")
  for (const [warehouseId, rapport] of parMagasin) {
    console.log(
      `${warehouseId} : ${rapport.items} article(s) semé(s), quantité totale ${rapport.quantite}, ${rapport.receptions} réception(s)`
    )
  }
  console.log(`Lignes ignorées (SKU absent) : ${ignorees.length}`)
  for (const ligne of ignorees) {
    console.log(`  - ${ligne.sku}`)
  }
  if (erreurs.length > 0) {
    console.log(`Erreurs : ${erreurs.length}`)
    for (const erreur of erreurs) {
      console.log(`  - ${erreur.warehouseId} : ${erreur.erreur}`)
    }
  }
}

await main()
