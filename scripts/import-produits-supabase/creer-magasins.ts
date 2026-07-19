import { parseArgs } from "node:util"
import path from "node:path"
import { connecter, requeteJson } from "./http-client"
import type { ClientApi } from "./http-client"
import { lireStores } from "./supabase-source"
import type { StoreSource } from "./supabase-source"
import { chargerJson, ecrireJsonAtomique } from "./journal-simple"
import { construireMagasinCible, NOM_FOURNISSEUR } from "./magasins"

interface JournalMagasins {
  warehousesByName: Record<string, string>
  supplierId?: string
}

interface OptionsCli {
  apiUrl: string
  webOrigin: string
  journal: string
  projet: string | undefined
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
      journal: {
        type: "string",
        default: path.join(import.meta.dir, "data", "magasins-local.json"),
      },
      projet: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  })
  return {
    apiUrl: values["api-url"],
    webOrigin: values["web-origin"],
    journal: values.journal,
    projet: values.projet,
    dryRun: values["dry-run"],
  }
}

async function obtenirClient(options: OptionsCli): Promise<ClientApi> {
  if (options.dryRun) {
    return { baseUrl: options.apiUrl, cookie: "" }
  }
  const email = process.env.IMPORT_EMAIL
  const password = process.env.IMPORT_PASSWORD
  if (!email || !password) {
    throw new Error(
      "Variables d'environnement IMPORT_EMAIL et IMPORT_PASSWORD requises (sauf en --dry-run)"
    )
  }
  return connecter(options.apiUrl, email, password, options.webOrigin)
}

interface ResultatMagasins {
  crees: string[]
  reutilises: string[]
}

/**
 * Ensures every Supabase store has a matching warehouse, creating the
 * missing ones. Idempotent via the journal: names already resolved to an id
 * are never re-created. In dry-run, no API call is made at all — the
 * decision (create vs reuse) is based solely on the journal's current state.
 */
async function assurerMagasins(
  client: ClientApi,
  stores: StoreSource[],
  journal: JournalMagasins,
  cheminJournal: string,
  dryRun: boolean
): Promise<ResultatMagasins> {
  const crees: string[] = []
  const reutilises: string[] = []

  if (!dryRun) {
    const { donnees } = await requeteJson<{
      warehouses: Array<{ id: string; name: string; type: string }>
    }>(client, "GET", "/api/v1/warehouses")
    for (const entrepot of donnees.warehouses) {
      // Direct Record lookup: noUncheckedIndexedAccess is off, so the cast
      // makes the possible absence explicit for eslint/TS.
      const existant = journal.warehousesByName[entrepot.name] as
        string | undefined
      if (existant === undefined) {
        journal.warehousesByName[entrepot.name] = entrepot.id
      }
    }
    ecrireJsonAtomique(cheminJournal, journal)
  }

  for (const store of stores) {
    // Direct Record lookup: noUncheckedIndexedAccess is off, so the cast
    // makes the possible absence explicit for eslint/TS.
    const existant = journal.warehousesByName[store.name] as string | undefined
    if (existant !== undefined) {
      reutilises.push(store.name)
      continue
    }

    if (dryRun) {
      console.log(`[dry-run] créerait le magasin « ${store.name} »`)
      crees.push(store.name)
      continue
    }

    const payload = construireMagasinCible(store)
    const reponse = await requeteJson<{
      id: string
      code?: string
      message?: string
    }>(client, "POST", "/api/v1/warehouses", payload)

    if (reponse.status === 201) {
      journal.warehousesByName[store.name] = reponse.donnees.id
      ecrireJsonAtomique(cheminJournal, journal)
      crees.push(store.name)
      continue
    }

    if (reponse.status === 409 && reponse.donnees.code === "NOM_EXISTANT") {
      const relecture = await requeteJson<{
        warehouses: Array<{ id: string; name: string; type: string }>
      }>(client, "GET", "/api/v1/warehouses")
      const trouve = relecture.donnees.warehouses.find(
        (w) => w.name === store.name
      )
      if (!trouve) {
        throw new Error(
          `Magasin « ${store.name} » en conflit mais introuvable à la relecture`
        )
      }
      journal.warehousesByName[store.name] = trouve.id
      ecrireJsonAtomique(cheminJournal, journal)
      reutilises.push(store.name)
      continue
    }

    throw new Error(
      `Échec de création du magasin « ${store.name} » (${reponse.status}) : ${JSON.stringify(reponse.donnees)}`
    )
  }

  return { crees, reutilises }
}

interface ResultatFournisseur {
  id: string
  cree: boolean
}

/**
 * Ensures the technical supplier used for opening-stock inventory movements
 * exists, creating it once and remembering its id in the journal.
 */
async function assurerFournisseur(
  client: ClientApi,
  journal: JournalMagasins,
  cheminJournal: string,
  dryRun: boolean
): Promise<ResultatFournisseur> {
  if (journal.supplierId !== undefined) {
    return { id: journal.supplierId, cree: false }
  }

  if (dryRun) {
    console.log(`[dry-run] créerait le fournisseur « ${NOM_FOURNISSEUR} »`)
    return { id: "dry-run-fournisseur", cree: true }
  }

  const { donnees } = await requeteJson<{
    suppliers: Array<{ id: string; name: string }>
  }>(client, "GET", "/api/v1/suppliers")
  const trouve = donnees.suppliers.find((s) => s.name === NOM_FOURNISSEUR)
  if (trouve) {
    journal.supplierId = trouve.id
    ecrireJsonAtomique(cheminJournal, journal)
    return { id: trouve.id, cree: false }
  }

  const creation = await requeteJson<{
    id: string
    code?: string
    message?: string
  }>(client, "POST", "/api/v1/suppliers", { name: NOM_FOURNISSEUR })

  if (creation.status === 201) {
    journal.supplierId = creation.donnees.id
    ecrireJsonAtomique(cheminJournal, journal)
    return { id: creation.donnees.id, cree: true }
  }

  if (creation.status === 409 && creation.donnees.code === "NOM_EXISTANT") {
    const relecture = await requeteJson<{
      suppliers: Array<{ id: string; name: string }>
    }>(client, "GET", "/api/v1/suppliers")
    const trouveApres = relecture.donnees.suppliers.find(
      (s) => s.name === NOM_FOURNISSEUR
    )
    if (!trouveApres) {
      throw new Error(
        `Fournisseur « ${NOM_FOURNISSEUR} » en conflit mais introuvable à la relecture`
      )
    }
    journal.supplierId = trouveApres.id
    ecrireJsonAtomique(cheminJournal, journal)
    return { id: trouveApres.id, cree: false }
  }

  throw new Error(
    `Échec de création du fournisseur (${creation.status}) : ${JSON.stringify(creation.donnees)}`
  )
}

async function main(): Promise<void> {
  const options = lireOptions(process.argv.slice(2))

  const journal = chargerJson<JournalMagasins>(options.journal, {
    warehousesByName: {},
  })

  const stores = lireStores(options.projet)
  console.log(`${stores.length} magasins chargés depuis Supabase`)

  const client = await obtenirClient(options)

  const { crees, reutilises } = await assurerMagasins(
    client,
    stores,
    journal,
    options.journal,
    options.dryRun
  )
  const fournisseur = await assurerFournisseur(
    client,
    journal,
    options.journal,
    options.dryRun
  )

  console.log("\n--- Rapport ---")
  console.log(`Magasins créés : ${crees.length}`)
  for (const nom of crees) console.log(`  - ${nom}`)
  console.log(`Magasins réutilisés : ${reutilises.length}`)
  for (const nom of reutilises) console.log(`  - ${nom}`)
  console.log(
    fournisseur.cree
      ? `Fournisseur créé : ${NOM_FOURNISSEUR} (${fournisseur.id})`
      : `Fournisseur réutilisé : ${NOM_FOURNISSEUR} (${fournisseur.id})`
  )
}

await main()
