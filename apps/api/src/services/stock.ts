import { and, eq, inArray, sql } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import type { BatchItem } from "drizzle-orm/batch"
import * as schema from "../db/schema"
import { estViolationCheck } from "../lib/db-errors"

type Db = DrizzleD1Database<typeof schema>

export type InstructionBatch = BatchItem<"sqlite">

export type TypeMouvement = (typeof schema.MOVEMENT_TYPES)[number]

// Entrées « apport valorisé » : elles portent un unitCost et alimentent le
// CMP du niveau de destination. `purchase` depuis la Phase 4 ; `transfer_in`
// depuis la Phase 5 (spec : le transfert est valorisé au CMP de l'origine,
// figé sur la ligne à l'expédition et absorbé ici, à la réception).
const TYPES_APPORT_VALORISE: ReadonlySet<TypeMouvement> = new Set([
  "purchase",
  "transfer_in",
])

export type MouvementStock = {
  warehouseId: string
  variantId: string
  lotId?: string | null
  // > 0 entrée, < 0 sortie — jamais 0
  delta: number
  type: TypeMouvement
  reason?: string | null
  refType?: string | null
  refId?: string | null
  // Requis pour les apports valorisés ("purchase", "transfer_in") :
  // alimente le CMP
  unitCost?: number
}

export type DetailStockInsuffisant = {
  warehouseId: string
  variantId: string
  disponible: number
  demande: number
}

export class ErreurStockInsuffisant extends Error {
  readonly details: DetailStockInsuffisant[]
  constructor(details: DetailStockInsuffisant[]) {
    super("Stock insuffisant")
    this.name = "ErreurStockInsuffisant"
    this.details = details
  }
}

type Agregat = {
  warehouseId: string
  variantId: string
  totalDelta: number
  // Somme des deltas des mouvements d'apport valorisé du groupe
  qtyRecue: number
  // Somme des quantité × coût unitaire des apports valorisés du groupe
  coutTotalApport: number
}

function agregerParNiveau(mouvements: MouvementStock[]): Agregat[] {
  const parCle = new Map<string, Agregat>()
  for (const m of mouvements) {
    const cle = `${m.warehouseId}|${m.variantId}`
    let agregat = parCle.get(cle)
    if (!agregat) {
      agregat = {
        warehouseId: m.warehouseId,
        variantId: m.variantId,
        totalDelta: 0,
        qtyRecue: 0,
        coutTotalApport: 0,
      }
      parCle.set(cle, agregat)
    }
    agregat.totalDelta += m.delta
    if (TYPES_APPORT_VALORISE.has(m.type)) {
      agregat.qtyRecue += m.delta
      agregat.coutTotalApport += m.delta * (m.unitCost ?? 0)
    }
  }
  return [...parCle.values()]
}

// Après un rollback, reconstruit le détail « qui manquait de combien » pour
// l'erreur 409. Lecture post-échec : sous forte concurrence le détail est
// une photographie approchée, l'invariant (aucune écriture partielle) est,
// lui, garanti par la transaction.
async function calculerDeficits(
  db: Db,
  mouvements: MouvementStock[]
): Promise<DetailStockInsuffisant[]> {
  const sorties = agregerParNiveau(mouvements).filter((a) => a.totalDelta < 0)
  if (sorties.length === 0) {
    return []
  }
  const variantIds = [...new Set(sorties.map((s) => s.variantId))]
  const niveaux = await db
    .select({
      warehouseId: schema.stockLevels.warehouseId,
      variantId: schema.stockLevels.variantId,
      quantity: schema.stockLevels.quantity,
    })
    .from(schema.stockLevels)
    .where(inArray(schema.stockLevels.variantId, variantIds))
  return sorties
    .map((s) => {
      const ligne = niveaux.find(
        (n) => n.warehouseId === s.warehouseId && n.variantId === s.variantId
      )
      return {
        warehouseId: s.warehouseId,
        variantId: s.variantId,
        disponible: ligne?.quantity ?? 0,
        demande: -s.totalDelta,
      }
    })
    .filter((d) => d.disponible < d.demande)
}

// SEUL point d'écriture du stock (spec §8) : aucune route ne touche
// stock_levels ni stock_movements directement.
//
// Atomicité : tout part dans UN db.batch D1 (= une transaction SQLite) —
// instructionsAvant (mise à jour du document appelant, création de lots…)
// + insertion des mouvements + upsert des niveaux. La garde anti-négatif est
// la contrainte CHECK stock_levels_quantity_positive : un solde négatif fait
// ÉCHOUER le statement, donc D1 annule le batch ENTIER, qui est traduit en
// ErreurStockInsuffisant. (Un `UPDATE … WHERE quantity + ? >= 0` seul ne
// suffirait pas : 0 ligne affectée n'est pas une erreur SQL, le batch serait
// déjà committé — mouvements écrits sans décrément — au moment de lire
// meta.changes.)
//
// CMP (coût moyen pondéré, entier XOF), pour les apports valorisés
// (`purchase`, `transfer_in`), recalculé dans le MÊME batch/transaction,
// côté SQL, afin de lire
// quantity/avg_cost au moment de la transaction (pas de course avec une
// vente concurrente) :
//   nouveauCmp = ROUND((qtyAvant × avgAvant + coutTotalApport) / (qtyAvant + qtyRecue))
//   — équivalent à ROUND((qtyAvant × avgAvant + qtyReçue × coûtUnitaire) / (qtyAvant + qtyReçue))
//     quand la réception a un seul coût unitaire.
//   Cas qtyAvant <= 0 : un stock résiduel nul (ou négatif, impossible ici
//   grâce au CHECK, mais l'expression reste défensive) ne porte plus de
//   valeur → le CMP repart du coût de l'apport : ROUND(coutTotalApport / qtyRecue).
// Nota SQLite : dans un UPDATE, toutes les expressions SET lisent les
// valeurs d'AVANT modification — l'ordre des affectations est sans effet.
export async function applyMovements(
  db: Db,
  params: {
    organizationId: string
    userId: string
    mouvements: MouvementStock[]
    instructionsAvant?: InstructionBatch[]
    date?: Date
  }
): Promise<{ movementIds: string[] }> {
  const { organizationId, userId, mouvements } = params
  if (mouvements.length === 0) {
    throw new Error("applyMovements exige au moins un mouvement")
  }
  for (const m of mouvements) {
    if (!Number.isInteger(m.delta) || m.delta === 0) {
      throw new Error("Chaque mouvement doit porter un delta entier non nul")
    }
    if (TYPES_APPORT_VALORISE.has(m.type)) {
      if (m.delta <= 0 || m.unitCost === undefined) {
        throw new Error(
          "Un mouvement d'apport valorisé (purchase, transfer_in) exige un delta positif et un unitCost"
        )
      }
      if (!Number.isInteger(m.unitCost) || m.unitCost < 0) {
        throw new Error("unitCost doit être un entier positif ou nul")
      }
    }
  }
  const date = params.date ?? new Date()

  const lignes = mouvements.map((m) => ({ m, id: crypto.randomUUID() }))
  const insertionsMouvements = lignes.map(({ m, id }) =>
    db.insert(schema.stockMovements).values({
      id,
      organizationId,
      warehouseId: m.warehouseId,
      variantId: m.variantId,
      lotId: m.lotId ?? null,
      delta: m.delta,
      type: m.type,
      reason: m.reason ?? null,
      refType: m.refType ?? null,
      refId: m.refId ?? null,
      userId,
      createdAt: date,
    })
  )

  const cible = [schema.stockLevels.warehouseId, schema.stockLevels.variantId]
  // Deux statements par (entrepôt, variante), et non un simple
  // `INSERT … ON CONFLICT DO UPDATE` : SQLite valide la contrainte CHECK sur
  // la ligne candidate du VALUES de l'INSERT AVANT même de savoir si un
  // conflit se produira. Avec `quantity: totalDelta` en VALUES, un
  // totalDelta négatif fait donc échouer le CHECK immédiatement — y compris
  // quand la ligne existe déjà et que le résultat final (quantité existante
  // + delta) serait parfaitement valide. (Vérifié empiriquement en sqlite3 :
  // `INSERT … VALUES (-3) ON CONFLICT DO UPDATE SET qty = qty + (-3)` sur une
  // ligne existante à qty=10 échoue au CHECK alors que 10-3=7 est valide.)
  // Le correctif : 1) garantir l'existence de la ligne avec des valeurs par
  // défaut sûres (0, 0) via `ON CONFLICT DO NOTHING` — jamais négatif, ne
  // peut jamais violer le CHECK — puis 2) un `UPDATE` qui applique le delta
  // réel. Un `UPDATE … SET quantity = quantity + delta` fait évaluer le
  // CHECK sur la valeur RÉSULTANTE (vérifié également en sqlite3), ce qui
  // restaure exactement la sémantique voulue : échec seulement si le solde
  // final est négatif. Les deux statements sont dans le MÊME batch/
  // transaction, donc toujours vus dans l'ordre et annulés ensemble en cas
  // d'échec plus loin dans le batch.
  const niveauxTouches = agregerParNiveau(mouvements).flatMap((a) => {
    const cmpApport =
      a.qtyRecue > 0 ? Math.round(a.coutTotalApport / a.qtyRecue) : 0
    const assurerLigne = db
      .insert(schema.stockLevels)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        warehouseId: a.warehouseId,
        variantId: a.variantId,
        quantity: 0,
        avgCost: 0,
        minStock: null,
        updatedAt: date,
      })
      .onConflictDoNothing({ target: cible })

    const ou = and(
      eq(schema.stockLevels.warehouseId, a.warehouseId),
      eq(schema.stockLevels.variantId, a.variantId)
    )
    const nouvelleQuantite = sql`${schema.stockLevels.quantity} + ${a.totalDelta}`
    const appliquerDelta =
      a.qtyRecue > 0
        ? db
            .update(schema.stockLevels)
            .set({
              quantity: nouvelleQuantite,
              avgCost: sql`CASE
                WHEN ${schema.stockLevels.quantity} <= 0 THEN ${cmpApport}
                ELSE CAST(ROUND((${schema.stockLevels.quantity} * ${schema.stockLevels.avgCost} + ${a.coutTotalApport}) * 1.0
                  / (${schema.stockLevels.quantity} + ${a.qtyRecue})) AS INTEGER)
              END`,
              updatedAt: date,
            })
            .where(ou)
        : // Pas d'apport valorisé : le CMP ne bouge pas (les sorties et
          // ajustements ne modifient jamais la valorisation unitaire).
          db
            .update(schema.stockLevels)
            .set({ quantity: nouvelleQuantite, updatedAt: date })
            .where(ou)

    return [assurerLigne, appliquerDelta]
  })

  // Batch hétérogène : tableau construit DIRECTEMENT (spreads), pas de
  // push + cast — le typage D1 des batchs l'exige.
  const instructions = [
    ...(params.instructionsAvant ?? []),
    ...insertionsMouvements,
    ...niveauxTouches,
  ]
  // `db.batch` exige le type tuple non-vide `[U, ...U[]]` (pas un simple
  // `U[]`) : la déstructuration reconstruit ce tuple. `instructions` est
  // garanti non vide ici — `mouvements.length === 0` a déjà levé plus haut,
  // et `insertionsMouvements` (dérivé 1:1 de `mouvements`) l'est donc aussi.
  const [premiere, ...reste] = instructions
  try {
    await db.batch([premiere, ...reste])
  } catch (err) {
    // Fragment discriminant : instructionsAvant peut faire échouer un CHECK
    // d'une AUTRE table dans ce même batch (ex. Tasks 7/9/10). Seule une
    // violation de stock_levels_quantity_positive est du stock insuffisant —
    // toute autre erreur (y compris un autre CHECK) doit remonter telle
    // quelle, pas être maquillée en ErreurStockInsuffisant.
    if (estViolationCheck(err, "stock_levels_quantity_positive")) {
      throw new ErreurStockInsuffisant(await calculerDeficits(db, mouvements))
    }
    throw err
  }
  return { movementIds: lignes.map((l) => l.id) }
}

// Seuil d'alerte par entrepôt (surcharge de products.default_min_stock).
// Vit dans le service pour préserver l'invariant « seul stockService écrit
// stock_levels » ; ne touche JAMAIS quantity ni avgCost d'une ligne
// existante.
export async function definirSeuil(
  db: Db,
  params: {
    organizationId: string
    warehouseId: string
    variantId: string
    minStock: number | null
  }
): Promise<void> {
  const maintenant = new Date()
  await db
    .insert(schema.stockLevels)
    .values({
      id: crypto.randomUUID(),
      organizationId: params.organizationId,
      warehouseId: params.warehouseId,
      variantId: params.variantId,
      quantity: 0,
      avgCost: 0,
      minStock: params.minStock,
      updatedAt: maintenant,
    })
    .onConflictDoUpdate({
      target: [schema.stockLevels.warehouseId, schema.stockLevels.variantId],
      set: { minStock: params.minStock, updatedAt: maintenant },
    })
}

export type EcartReconciliation = {
  warehouseId: string
  variantId: string
  quantiteJournal: number
  quantiteNiveaux: number
  ecart: number
  // false si la somme du journal est négative (données corrompues) : on la
  // rapporte mais on refuse de l'appliquer (le CHECK la rejetterait).
  applicable: boolean
}

// Recalcule les QUANTITÉS de stock_levels depuis le journal — jamais le CMP :
// rejouer la valorisation historique exigerait de rejouer chaque réception
// dans l'ordre, hors périmètre. Le CMP courant reste la référence.
// Dry-run par défaut ; l'application est demandée explicitement.
export async function reconcilier(
  db: Db,
  params: { organizationId: string; appliquer: boolean }
): Promise<{ ecarts: EcartReconciliation[]; applique: boolean }> {
  const sommes = await db
    .select({
      warehouseId: schema.stockMovements.warehouseId,
      variantId: schema.stockMovements.variantId,
      quantiteJournal: sql<number>`COALESCE(SUM(${schema.stockMovements.delta}), 0)`,
    })
    .from(schema.stockMovements)
    .where(eq(schema.stockMovements.organizationId, params.organizationId))
    .groupBy(schema.stockMovements.warehouseId, schema.stockMovements.variantId)
  const niveaux = await db
    .select({
      warehouseId: schema.stockLevels.warehouseId,
      variantId: schema.stockLevels.variantId,
      quantity: schema.stockLevels.quantity,
    })
    .from(schema.stockLevels)
    .where(eq(schema.stockLevels.organizationId, params.organizationId))

  const journalParCle = new Map(
    sommes.map((s) => [`${s.warehouseId}|${s.variantId}`, s.quantiteJournal])
  )
  const niveauParCle = new Map(
    niveaux.map((n) => [`${n.warehouseId}|${n.variantId}`, n.quantity])
  )
  const cles = new Set([...journalParCle.keys(), ...niveauParCle.keys()])

  const ecarts: EcartReconciliation[] = []
  for (const cle of cles) {
    const quantiteJournal = journalParCle.get(cle) ?? 0
    const quantiteNiveaux = niveauParCle.get(cle) ?? 0
    if (quantiteJournal === quantiteNiveaux) continue
    const [warehouseId = "", variantId = ""] = cle.split("|")
    ecarts.push({
      warehouseId,
      variantId,
      quantiteJournal,
      quantiteNiveaux,
      ecart: quantiteNiveaux - quantiteJournal,
      applicable: quantiteJournal >= 0,
    })
  }
  ecarts.sort((a, b) =>
    `${a.warehouseId}|${a.variantId}` < `${b.warehouseId}|${b.variantId}`
      ? -1
      : 1
  )

  const corrigeables = ecarts.filter((e) => e.applicable)
  if (!params.appliquer || corrigeables.length === 0) {
    return { ecarts, applique: false }
  }

  const maintenant = new Date()
  const cible = [schema.stockLevels.warehouseId, schema.stockLevels.variantId]

  // `e.quantiteJournal` vient de la lecture `sommes` ci-dessus : un
  // instantané qui peut être périmé au moment de l'écriture (un mouvement
  // commité entre-temps serait sinon écrasé — lost update). L'ÉCRITURE ne
  // doit donc JAMAIS réutiliser cette valeur JS : chaque correction
  // recalcule la somme du journal DANS le statement SQL, au moment du
  // batch. Même stratégie en deux temps qu'applyMovements : 1) garantir
  // l'existence de la ligne avec des valeurs par défaut sûres (jamais
  // négatif, ne peut jamais violer le CHECK) via `onConflictDoNothing`,
  // puis 2) un `UPDATE` dont le SET est une sous-requête corrélée sur
  // stock_movements — jamais la valeur lue plus haut. Le rapport `ecarts`
  // (dry-run) reste basé sur `sommes`/`niveaux` ; lui peut être approché.
  const corrections = corrigeables.flatMap((e) => {
    const assurerLigne = db
      .insert(schema.stockLevels)
      .values({
        id: crypto.randomUUID(),
        organizationId: params.organizationId,
        warehouseId: e.warehouseId,
        variantId: e.variantId,
        quantity: 0,
        avgCost: 0,
        minStock: null,
        updatedAt: maintenant,
      })
      .onConflictDoNothing({ target: cible })

    const corrigerQuantite = db
      .update(schema.stockLevels)
      .set({
        quantity: sql`(SELECT COALESCE(SUM(delta), 0) FROM stock_movements
          WHERE organization_id = ${params.organizationId}
            AND warehouse_id = ${e.warehouseId}
            AND variant_id = ${e.variantId})`,
        updatedAt: maintenant,
      })
      .where(
        and(
          eq(schema.stockLevels.warehouseId, e.warehouseId),
          eq(schema.stockLevels.variantId, e.variantId)
        )
      )

    return [assurerLigne, corrigerQuantite]
  })
  const [premiere, ...reste] = corrections
  await db.batch([premiere, ...reste])
  return { ecarts, applique: true }
}
