# Persistance du panier POS — Design

**Date :** 2026-07-19
**Issue :** #14 — POS : persistance du panier en cours (survivre au rafraîchissement / à la fermeture d'onglet)

## Problème

Le panier de l'écran de vente (`apps/web/src/pos/ecran-vente.tsx`) vit uniquement en mémoire React (`useState<LignePanier[]>`). Un rafraîchissement, une fermeture accidentelle d'onglet ou un plantage du navigateur perd l'intégralité de la saisie — au comptoir, en pleine vente, c'est une ressaisie complète.

## Objectif

Persister **localement** le panier en cours pour qu'il survive à un rechargement, et le restaurer au remontage de `EcranVente`, sans jamais compromettre les garanties d'idempotence existantes.

## Périmètre

- **Un seul panier actif** par boutique et session de caisse. Les paniers multiples « en attente » (mise de côté) sont **hors périmètre** — ce serait une fonctionnalité métier distincte, pas de la persistance.
- **Hors périmètre** : synchronisation serveur / multi-appareil du panier (évolution SaaS ultérieure).

## Contexte technique existant

Deux mécanismes d'idempotence pilotent le design (`ecran-vente.tsx`) :

- **`requestId`** (`useRef`) — clé d'idempotence, UNE par panier encaissé, conservée telle quelle sur retry, régénérée après chaque vente réussie.
- **`panierVerrouille`** — verrou posé après une soumission **ambiguë** (erreur réseau sans réponse : la vente a peut-être été commitée côté serveur). Il bloque scan et modifications jusqu'à résolution (succès) ou abandon explicite. Sans lui, un retry rejouant la même clé renverrait l'ancienne vente et écraserait silencieusement les modifications.

`LignePanier` (`lib/pos.ts`) est entièrement sérialisable (primitives et nullables uniquement) :
`variantId`, `nom`, `sku`, `imageKey?`, `quantite`, `prixUnitaire`, `prixCatalogue`, `prixPlancher`, `sourceWarehouseId`, `sourceNom`, `enAlerte`.

`prixUnitaire` peut être un **prix saisi manuellement** (négocié / dépannage, dans les bornes) — il ne doit jamais être écrasé automatiquement.

## Architecture

### Stockage et portée

`localStorage`, clé **`pos:panier:<boutiqueId>:<sessionId>`**.

- **Synchrone** : le panier est restauré au premier rendu, sans état « en cours de chargement ». IndexedDB serait sur-dimensionné pour ~2 Ko.
- **Scopé à la session de caisse** : fermer la caisse rend le panier caduc automatiquement (on ne vend pas contre une session fermée). Purge naturelle — pas de TTL arbitraire à inventer, et jamais de restauration d'un panier de la veille.

### Forme persistée

```ts
interface PanierPersiste {
  v: 1
  lignes: LignePanier[]
  requestId: string
  verrouille: boolean
  majA: string // ISO
}
```

`v` permet d'ignorer proprement un format devenu incompatible : à la lecture, un `v` inconnu (ou un JSON illisible) entraîne un **départ à zéro**, jamais une exception.

### Module dédié

`apps/web/src/lib/panier-persistance.ts` — fonctions **pures**, testables sans React ni DOM :

- `clePanier(boutiqueId: string, sessionId: string): string`
- `charger(cle: string): PanierPersiste | null` — parse, valide `v` et chaque ligne, renvoie `null` si invalide. Ne **supprime pas** : ce serait une écriture hors verrou, susceptible d'effacer un panier valide (voire verrouillé) écrit entre-temps par un autre onglet.
- `enregistrer(cle: string, etat: PanierPersiste): Promise<void>`
- `purger(cle: string, requestIdAttendu?: string): Promise<void>`
- `revaliderPanier(lignes, articles): { lignes: LignePanier[]; retirees: number; prixModifies: number }`

`ecran-vente.tsx` ne gagne que l'initialisation paresseuse de l'état et deux `useEffect`.

## Cycle de vie

- **Lecture** : au montage, initialisation paresseuse de `lignes`, `requestId` et `panierVerrouille` depuis le stockage. Le panier réapparaît **immédiatement**, sans attendre le réseau (restauration silencieuse — aucune modale de confirmation).
- **Écriture** : un `useEffect` sérialise à chaque changement de `lignes`, `requestId` ou `panierVerrouille`.
- **Purge** : panier vide → `removeItem`. Ça couvre les deux sorties existantes sans code supplémentaire — `onSuccess` fait déjà `setLignes([])`, et « Vider le panier » aussi.

## Revalidation à la restauration (non destructive)

Le catalogue est asynchrone (`refetchOnMount: "always"`). La revalidation s'exécute donc **une seule fois**, à la première arrivée du catalogue après une restauration.

Déclenchement explicite : l'initialisation paresseuse pose un drapeau « à revalider » (`useRef<boolean>`) uniquement si un panier non vide et **non verrouillé** a été restauré. Un panier verrouillé (soumission ambiguë en cours, cf. section suivante) n'est jamais revalidé automatiquement : la vente est peut-être déjà commitée côté serveur, donc retirer/repriser une ligne ici puis rejouer le même `requestId` au retry ferait imprimer un ticket qui ne correspond plus à l'écran. Le `useEffect` de revalidation ne fait rien tant que le catalogue n'est pas chargé ni si le drapeau est faux ; dès qu'il s'exécute, il abaisse le drapeau. Un panier saisi normalement (non restauré) n'est donc jamais revalidé, et un rechargement ultérieur du catalogue ne rejoue pas la revalidation.

Règles appliquées :

- ligne dont le `variantId` n'est plus au catalogue (retiré ou désactivé) → **retirée** ;
- ligne dont le prix catalogue a changé → `prixCatalogue` actualisé et ligne **marquée** `prixModifie: true`, **sans jamais toucher `prixUnitaire`** (les prix négociés et dépannages sont préservés) ;
- les autres lignes sont inchangées.

Un bandeau dismissible récapitule : « Panier restauré — N article(s) retiré(s), M prix modifié(s) ». Il n'apparaît que si au moins un changement a eu lieu.

Cela ajoute un champ optionnel `prixModifie?: boolean` sur `LignePanier`, en miroir de l'`enAlerte` existant.

Le serveur reste l'autorité finale sur le stock : un `STOCK_INSUFFISANT` à l'encaissement est déjà géré (lignes en alerte + dépannage).

## Sûreté et idempotence

`requestId` et `verrouille` sont restaurés **tels quels**. Un rechargement pendant une soumission ambiguë retrouve le panier verrouillé avec son message « la vente est peut-être déjà enregistrée : réessayez, ou vérifiez les tickets du jour ».

C'est le choix **le plus sûr** : restaurer le panier avec une clé neuve permettrait, si la vente avait bien été commitée avant le rechargement, un **doublon** — client débité deux fois et stock sorti deux fois. En conservant la clé, un nouvel envoi rejoue l'idempotence et le serveur renvoie la vente déjà enregistrée.

**Multi-onglet** : dernier écrivain gagne, pas de synchronisation via l'événement `storage` (YAGNI). Un onglet ne génère une clé neuve **que pour un panier neuf** : au montage, `requestId` vaut la clé persistée si un panier a été restauré, et un `crypto.randomUUID()` seulement à défaut. Deux onglets qui restaurent la **même** entrée reprennent donc la **même** clé — c'est voulu, et c'est ce qui rend le doublon impossible entre eux. Le risque ne vient que de deux onglets porteurs de clés **différentes** (l'un a restauré, l'autre a démarré sur un panier vide). Sans garde, si l'onglet A verrouille son panier après une soumission ambiguë (vente peut-être déjà commitée) et que l'onglet B écrit ensuite dans le même stockage, le verrou et le `requestId` de A disparaissent ; un rechargement de A restaurerait alors l'état déverrouillé de B et pourrait committer une **seconde** vente pour le même panier. Garde appliquée **symétriquement dans `enregistrer` et `purger`** (`panier-persistance.ts`) : ni une écriture ni une suppression n'écrase une entrée stockée qui est verrouillée et porte un `requestId` différent du sien — seul l'onglet qui détient ce verrou (même `requestId`) peut le lever. Sans la garde sur `purger`, un onglet dont le panier redevient vide effacerait le verrou d'un autre onglet : même vecteur de doublon, par un autre chemin.

La garde est un **lire-puis-écrire**, donc elle doit être atomique entre onglets : elle s'exécute sous l'**API Web Locks** (`navigator.locks.request`, clé `pos:panier-lock:<cle>`), faute de quoi une écriture concurrente pourrait s'intercaler entre la lecture de contrôle et l'écriture.

**Sans cette API, la persistance est désactivée** (aucune écriture) plutôt qu'exécutée de façon non atomique : la garde ne tiendrait pas, et son mode de défaillance est un doublon de vente — client débité deux fois. Perdre le confort d'un panier restauré est le moindre mal. En test, `test-setup.ts` fournit une implémentation minimale de l'API pour que les suites exercent le chemin de production et non le chemin désactivé.

Conséquence assumée de ce choix : l'écriture n'est plus synchrone (l'acquisition du verrou est asynchrone). Fermer l'onglet dans la fraction de milliseconde qui suit une modification pourrait perdre cette dernière modification — fenêtre très inférieure au geste humain de fermeture, jugée négligeable face au gain de sûreté.

Au pire, hors de ces cas, un ticket est réimprimé.

## Gestion d'erreurs

- `localStorage` indisponible ou en échec (mode privé, quota dépassé) : tout accès est encadré par un `try/catch`. On dégrade **silencieusement** vers le comportement actuel (pas de persistance) — jamais de crash de l'écran de vente, qui est l'écran critique du comptoir.
- Entrée illisible ou `v` inconnu : départ à zéro. L'entrée périmée est laissée en place — inoffensive, puisque chaque lecture la rejette — et récupérée par la purge suivante, qui s'exécute sous le verrou.
- Le panier restauré n'est jamais présumé valide : la revalidation et le serveur tranchent.

## Tests

**Unitaires (purs, sans React)** — `lib/panier-persistance.test.ts` :
- round-trip sérialisation (une ligne avec prix négocié et dépannage survit à l'identique) ;
- `v` inconnu / JSON illisible → `null` + purge ;
- `localStorage` absent ou levant une exception → pas de crash, dégradation silencieuse ;
- `revaliderPanier` : article disparu retiré ; prix catalogue changé → `prixCatalogue` actualisé, `prixModifie: true`, `prixUnitaire` **inchangé** ; ligne intacte non modifiée ; compteurs `retirees`/`prixModifies` exacts.

**Composant (Testing Library)** — `pos/ecran-vente.test.tsx` :
- panier restauré au remontage (lignes et totaux) ;
- bandeau de restauration affiché avec les bons compteurs, et absent si aucun changement ;
- purge du stockage après encaissement réussi ;
- purge après « Vider le panier » ;
- état verrouillé restauré (panier non modifiable, message d'ambiguïté présent).

Valeurs attendues recalculables à la main (totaux, compteurs), jamais dérivées de la sortie de l'implémentation.
