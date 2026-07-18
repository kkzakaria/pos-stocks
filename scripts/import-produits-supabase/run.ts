import { parseArgs } from "node:util"
import path from "node:path"
import type { CategoryCreateInput } from "shared"
import { chargerSnapshot  } from "./snapshot"
import type {ProduitSource} from "./snapshot";
import { construireProduitCible, extraireNomsCategories } from "./mapping"
import {
  chargerProgression,
  enregistrerEntree,
  dejaImporte
  
  
} from "./progress"
import type {EntreeProgression, JournalProgression} from "./progress";
import { executerAvecConcurrence } from "./concurrency"
import { telechargerEtConvertir } from "./image"
import {
  connecter,
  requeteJson,
  televerserImage
  
} from "./http-client"
import type {ClientApi} from "./http-client";

interface OptionsCli {
  apiUrl: string
  webOrigin: string
  snapshot: string
  progression: string
  concurrence: number
  dryRun: boolean
}

function lireOptions(argv: string[]): OptionsCli {
  const { values } = parseArgs({
    args: argv,
    options: {
      "api-url": { type: "string", default: "http://localhost:8787" },
      // Doit correspondre au WEB_ORIGIN configuré côté serveur cible
      // (auth.ts trustedOrigins) — indépendant de --api-url, cf. Task 6.
      "web-origin": { type: "string", default: "http://localhost:3000" },
      snapshot: {
        type: "string",
        default: path.join(import.meta.dir, "data", "produits-supabase.json"),
      },
      progression: {
        type: "string",
        default: path.join(import.meta.dir, "data", "progress.json"),
      },
      concurrence: { type: "string", default: "5" },
      "dry-run": { type: "boolean", default: false },
    },
  })
  return {
    apiUrl: values["api-url"],
    webOrigin: values["web-origin"],
    snapshot: values.snapshot,
    progression: values.progression,
    concurrence: Number(values.concurrence),
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

function creerJournal(
  cheminProgression: string,
  etatInitial: JournalProgression
) {
  let etat = etatInitial
  return {
    dejaImporte: (sourceId: string): boolean => dejaImporte(etat, sourceId),
    marquer: (sourceId: string, entree: EntreeProgression): void => {
      etat = enregistrerEntree(cheminProgression, etat, sourceId, entree)
    },
  }
}

async function assurerCategories(
  client: ClientApi,
  noms: string[],
  dryRun: boolean
): Promise<Map<string, string>> {
  if (dryRun) {
    const carte = new Map<string, string>()
    for (const nom of noms) {
      console.log(
        `[dry-run] créerait (ou réutiliserait) la catégorie « ${nom} »`
      )
      carte.set(nom, `dry-run-${nom}`)
    }
    return carte
  }

  const { donnees } = await requeteJson<{
    categories: Array<{ id: string; name: string }>
  }>(client, "GET", "/api/v1/categories")
  const parNom = new Map(donnees.categories.map((c) => [c.name, c.id]))

  for (const nom of noms) {
    if (parNom.has(nom)) continue
    const payload: CategoryCreateInput = { name: nom }
    const reponse = await requeteJson<{ id: string; code?: string }>(
      client,
      "POST",
      "/api/v1/categories",
      payload
    )
    if (reponse.status === 201) {
      parNom.set(nom, reponse.donnees.id)
      console.log(`catégorie créée : ${nom}`)
      continue
    }
    if (reponse.status === 409 && reponse.donnees.code === "NOM_EXISTANT") {
      const relecture = await requeteJson<{
        categories: Array<{ id: string; name: string }>
      }>(client, "GET", "/api/v1/categories")
      const trouvee = relecture.donnees.categories.find((c) => c.name === nom)
      if (!trouvee) {
        throw new Error(
          `Catégorie « ${nom} » en conflit mais introuvable à la relecture`
        )
      }
      parNom.set(nom, trouvee.id)
      continue
    }
    throw new Error(
      `Échec de création de la catégorie « ${nom} » (${reponse.status}) : ${JSON.stringify(reponse.donnees)}`
    )
  }
  return parNom
}

interface Rapport {
  crees: number
  imagesOk: number
  imagesEchouees: number
  echecs: Array<{ sku: string; erreur: string }>
}

async function importerUnProduit(
  client: ClientApi,
  source: ProduitSource,
  categorieId: string,
  journal: ReturnType<typeof creerJournal>,
  rapport: Rapport,
  dryRun: boolean
): Promise<void> {
  if (journal.dejaImporte(source.id)) return

  const payload = construireProduitCible(source, categorieId)

  if (dryRun) {
    console.log(
      `[dry-run] créerait le produit ${payload.sku} — ${payload.name}`
    )
    rapport.crees += 1
    return
  }

  const creation = await requeteJson<{
    id: string
    sku: string
    code?: string
    message?: string
  }>(client, "POST", "/api/v1/products", payload)

  if (creation.status !== 201) {
    const erreur =
      `${creation.status} ${creation.donnees.code ?? ""} ${creation.donnees.message ?? ""}`.trim()
    journal.marquer(source.id, { statut: "echec", sku: source.sku, erreur })
    rapport.echecs.push({ sku: source.sku, erreur })
    return
  }

  const productId = creation.donnees.id
  journal.marquer(source.id, {
    statut: "produit_cree",
    productId,
    sku: source.sku,
  })
  rapport.crees += 1

  if (source.image_url === null) return

  const image = await telechargerEtConvertir(source.image_url, source.id)
  if (image === null) {
    rapport.imagesEchouees += 1
    return
  }

  const televersement = await televerserImage(
    client,
    productId,
    image.buffer,
    image.nomFichier,
    image.contentType
  )
  if (televersement.status === 200) {
    journal.marquer(source.id, {
      statut: "image_ok",
      productId,
      sku: source.sku,
    })
    rapport.imagesOk += 1
  } else {
    rapport.imagesEchouees += 1
    console.warn(
      `image ${source.sku} : échec du téléversement (${televersement.status}) ${JSON.stringify(televersement.donnees)}`
    )
  }
}

async function main(): Promise<void> {
  const options = lireOptions(process.argv.slice(2))

  const produits = chargerSnapshot(options.snapshot)
  console.log(`${produits.length} produits chargés depuis ${options.snapshot}`)

  const client = await obtenirClient(options)

  const noms = extraireNomsCategories(produits)
  const categoriesParNom = await assurerCategories(client, noms, options.dryRun)

  const journal = creerJournal(
    options.progression,
    chargerProgression(options.progression)
  )
  const rapport: Rapport = {
    crees: 0,
    imagesOk: 0,
    imagesEchouees: 0,
    echecs: [],
  }

  await executerAvecConcurrence(
    produits,
    options.concurrence,
    async (source) => {
      const categorieId = categoriesParNom.get(source.category)
      if (categorieId === undefined) {
        rapport.echecs.push({
          sku: source.sku,
          erreur: `Catégorie « ${source.category} » non résolue`,
        })
        return
      }
      try {
        await importerUnProduit(
          client,
          source,
          categorieId,
          journal,
          rapport,
          options.dryRun
        )
      } catch (err) {
        rapport.echecs.push({ sku: source.sku, erreur: String(err) })
      }
    }
  )

  console.log("\n--- Rapport ---")
  console.log(`Produits créés : ${rapport.crees}`)
  console.log(`Images téléversées : ${rapport.imagesOk}`)
  console.log(`Images en échec : ${rapport.imagesEchouees}`)
  console.log(`Échecs produit : ${rapport.echecs.length}`)
  for (const echec of rapport.echecs) {
    console.log(`  - ${echec.sku} : ${echec.erreur}`)
  }
}

await main()
