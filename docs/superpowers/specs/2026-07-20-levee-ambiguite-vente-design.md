# Lever l'ambiguïté d'une vente par consultation serveur — Design

**Date :** 2026-07-20
**Issue :** #21 — POS : l'abandon explicite après soumission ambiguë ne régénère pas le `requestId`

## Problème

Quand l'encaissement part mais que la réponse se perd (coupure réseau, timeout), le client ne sait pas si la vente a été commitée côté serveur. Il pose alors un verrou (`panierVerrouille`) qui bloque toute modification du panier.

À la fermeture de la modale de paiement — « abandon explicite » — le code lève ce verrou **sans régénérer `requestId`** (`ecran-vente.tsx`, `onFermer`). Le caissier peut donc modifier le panier puis encaisser. Cet encaissement rejoue la **même** clé d'idempotence : si la vente initiale avait bien été commitée, le serveur renvoie l'**ancienne** vente, le ticket imprimé ne correspond pas au panier affiché, et les modifications sont silencieusement perdues.

Le comportement est antérieur à l'issue et documenté comme une décision assumée dans le code.

## L'arbitrage apparent, et pourquoi il est faux

L'issue posait un dilemme :

- **régénérer la clé à l'abandon** → si la vente initiale avait été commitée, un nouvel encaissement crée un **doublon** (client débité deux fois, stock sorti deux fois) ;
- **ne pas la régénérer** (actuel) → les modifications du caissier sont silencieusement écrasées.

Ce dilemme n'existe que parce que **le client est aveugle** : il doit deviner si la vente a atterri. Le serveur, lui, le sait déjà — `sales.client_request_id` porte un index unique et `reponseIdempotente` (`routes/sales.ts`) sait retrouver une vente par cette clé. Il manque seulement un moyen de le **demander**.

En donnant cette vue au client, l'ambiguïté se lève de façon déterministe et l'arbitrage disparaît au lieu d'être tranché.

## Périmètre

- API : un point de consultation d'une vente par sa clé d'idempotence.
- Front : résolution automatique de l'ambiguïté, avec repli manuel.
- **Hors périmètre** : modifier la sémantique d'idempotence de `POST /sales`, le verrou lui-même, ou le comportement en cas d'erreur API structurée (le serveur a répondu, donc rien n'est ambigu).

## Architecture

### API — consultation par clé d'idempotence

`GET /api/v1/sales/par-cle-requete/:clientRequestId` → `{ sale }` (200) ou `404 INTROUVABLE`.

- Même mécanique d'accès que `GET /sales/:id` : recherche **scopée à l'organisation**, puis `verifierLectureVentes` sur la boutique de la vente.
- **Garde de portée organisation AVANT tout** (invariant #7) : la recherche filtrant déjà sur `organizationId`, une vente d'une autre organisation est simplement introuvable → `404 INTROUVABLE`, jamais `403`. Un refus de portée boutique/rôle donne `403 ACCES_REFUSE`.
- Enveloppe réduite : **`{ sale }` seul**. `GET /sales/:id` renvoie aussi `marge`, mais la résolution POS n'en a aucun usage — l'inclure coûterait une requête et un contrôle de permission supplémentaires pour rien.
- **Pas de conflit avec `/:id`** : ce motif ne matche qu'un **seul** segment, alors que `par-cle-requete/:clé` en compte deux. La route est déclarée avant `/:id` par convention (du plus spécifique au plus général), mais l'ordre n'a aucune incidence — vérifié empiriquement.
- `GET` pur : aucune écriture, rejouable sans effet.

Une seule requête suffit : le client obtient directement le détail nécessaire à l'impression du ticket, sans second aller-retour sur un réseau déjà fragile.

### Front — résolution automatique, repli manuel

Sur erreur réseau **ambiguë** (branche `onError` sans `ApiError`), avant de se contenter de verrouiller, le client interroge le point de consultation avec `requestId.current`. Quatre issues :

1. **La vente existe** → l'ambiguïté est levée en faveur du succès. On rejoue le chemin `onSuccess` : impression, confirmation, panier vidé, clé régénérée, verrou levé. Le caissier ne perçoit qu'un délai.
2. **`404` portant le code `INTROUVABLE`** → rien n'a été commité. On déverrouille **et** on régénère la clé : le panier redevient pleinement modifiable, sans risque de doublon puisqu'il n'y a rien à dupliquer. Le **code** est exigé en plus du statut : `apiFetch` produit aussi une `ApiError` à `code: null` pour un 404 sans enveloppe — typiquement un déploiement désynchronisé où la route n'existe pas encore côté API. Conclure « rien commité » dans ce cas déverrouillerait et régénérerait la clé alors que la vente a peut-être atterri, ouvrant précisément le doublon que ce chemin existe pour empêcher. Un tel 404 est donc traité comme non concluant (cas 3).
3. **La consultation échoue** (réseau toujours coupé — le cas le plus probable) → comportement actuel conservé : verrou et message inchangés, plus un bouton **« Vérifier si la vente est passée »** qui rejoue la consultation.
4. **La consultation renvoie une erreur API structurée** (403, 500…) → traitée comme le cas 3 : on ne conclut rien, le verrou reste.

Le résultat est strictement meilleur que l'existant dans chaque branche, et jamais pire.

### Pas de re-soumission pendant la résolution

La modale de paiement est **fermée** dès l'erreur ambiguë, et **toutes les portes vers l'encaissement sont fermées** tant que le verrou tient : le bouton `ENCAISSER` est désactivé **et** le raccourci `F2` est inerte. Fermer la modale ne suffit pas seul — l'un comme l'autre la rouvriraient. La laisser ouverte permettait à un second envoi de courir contre la consultation en vol : si celle-ci répondait `404` et régénérait la clé avant que ce second envoi ne soit commité — et que lui aussi perde sa réponse — la résolution suivante chercherait la **nouvelle** clé, conclurait à tort « rien commité », déverrouillerait, et ouvrirait le doublon. La sortie n'est plus le retry mais « Vérifier ».

Corollaire : le bandeau et son bouton s'affichent aussi lorsque `panierVerrouille` est vrai **sans** message — cas d'un panier restauré depuis le stockage, où `erreurVente` n'est pas persisté. Sans ce repli, un rechargement pendant l'ambiguïté laisserait un panier verrouillé sans aucun moyen de le résoudre.

### Ce que devient l'abandon explicite

La fermeture de la modale ne devine plus rien :

- ambiguïté **déjà levée** (cas 1 ou 2) → il n'y a plus de verrou ; la fermeture est ordinaire ;
- ambiguïté **non levée** (cas 3 ou 4) → la fermeture laisse le verrou **en place** au lieu de le lever à l'aveugle. La seule sortie est « Vérifier », qui tranche pour de bon.

C'est le cœur du correctif : on ne déverrouille plus sans savoir. Le commentaire actuel de `onFermer`, qui documente la décision inverse, est remplacé.

## Gestion d'erreurs

- Consultation en échec → aucun changement d'état, message inchangé, bouton « Vérifier » disponible. Jamais de blocage définitif : le caissier peut toujours réessayer, et « Tickets du jour » reste accessible.
- `404` sur une clé jamais soumise (cas théorique, la soumission ayant échoué avant d'atteindre le serveur) → traité comme « rien commité », ce qui est exact.
- La consultation étant un `GET` idempotent, la rejouer n'a aucun effet de bord.

## Interaction avec la persistance du panier (#14)

Le panier persisté porte `verrouille` et `requestId`. La résolution de l'ambiguïté les fait évoluer de façon cohérente :

- cas 1 → panier vidé, donc l'entrée est purgée (le jeton `proprietaire` ne tourne pas, la purge passe) ;
- cas 2 → l'entrée est réécrite déverrouillée avec la clé neuve ;
- cas 3/4 → l'entrée reste verrouillée avec sa clé, ce qui est exactement l'état à préserver pour un rechargement.

Aucune adaptation du module de persistance n'est nécessaire.

## Tests

**API** (`apps/api/test/`, D1 réelle) :
- vente retrouvée par sa clé d'idempotence, enveloppe `{ sale }` dont le détail correspond à celui de `GET /sales/:id` ;
- `404 INTROUVABLE` sur une clé inconnue ;
- **`404 INTROUVABLE` sur une vente d'une AUTRE organisation** (garde de portée avant tout) ;
- caissier hors de sa boutique → `403 ACCES_REFUSE` (portée de rôle, organisation identique) ;
- la route n'est pas captée par `/:id` (une clé ressemblant à un id ne tombe pas dans la mauvaise route).

**Composant** (`apps/web/src/pos/ecran-vente.test.tsx`) :
- ambiguïté → consultation trouve la vente → ticket imprimé, confirmation affichée, panier vidé ;
- ambiguïté → consultation `404` → panier déverrouillé **et clé régénérée**. Assertion discriminante : le `clientRequestId` envoyé à l'encaissement suivant **diffère** de celui de la tentative ambiguë ;
- consultation en échec → verrou maintenu, message présent, bouton « Vérifier » affiché ;
- clic sur « Vérifier » → relance la consultation et résout selon son résultat.

Valeurs attendues recalculables à la main, jamais dérivées de la sortie de l'implémentation.
