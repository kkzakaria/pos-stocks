# Pagination cohérente des tableaux — Sous-projet A : composant partagé (web)

- **Issue** : #13 (pagination cohérente des tableaux)
- **Statut** : design validé, prêt pour plan d'implémentation
- **Périmètre** : web uniquement, aucune modification d'API

## Contexte

La pagination des tableaux est incohérente dans la SPA. Trois écrans paginent déjà
côté serveur mais réimplémentent chacun leur UI de pagination inline, avec des
formulations et des comportements légèrement divergents :

- `apps/web/src/routes/_app/ventes/index.tsx` — « Page X/Y — N ventes », masque si 1 page.
- `apps/web/src/routes/_app/stock/mouvements.tsx` — « Page X/Y — N mouvement(s) », affiche toujours (boutons inertes sur 1 page).
- `apps/web/src/pos/tickets-du-jour.tsx` — « Page X/Y — N tickets », masque si 1 page.

Ce sous-projet **extrait un composant `Pagination` partagé** et **refactore ces trois
appels** pour l'utiliser, sans changer l'API ni la pagination serveur existante. La
pagination serveur des listes aujourd'hui non bornées (produits, niveaux, réceptions,
transferts, inventaires, catégories, fournisseurs, utilisateurs) fait l'objet d'un
**sous-projet B distinct** (API + web + tests), traité ensuite.

## Objectif

Un composant de pagination unique, sobre (DS « registre du comptable »), accessible et
réutilisable, éliminant la triple duplication et harmonisant la formulation.

## Composant `Pagination`

Emplacement : `apps/web/src/components/ui/pagination.tsx`.

### Interface

```ts
type NomElement = { un: string; plusieurs: string }

type PaginationProps = {
  page: number // page courante, 1-based
  total: number // nombre total d'éléments (renvoyé par l'API)
  pageSize: number // taille de page
  onPageChange: (page: number) => void
  element: NomElement // { un: "vente", plusieurs: "ventes" }
  className?: string
}
```

Le composant est la **source unique** du nombre de pages : il calcule
`pageCount = max(1, ceil(total / pageSize))`. Aucun `pageCount` n'est passé de
l'extérieur (impossible de dériver du paging serveur).

### Accord grammatical

Le libellé du compteur suit l'accord français : `total > 1 ? plusieurs : un`
(« 0 vente », « 1 vente », « 2 ventes »). L'accord est géré par le composant, pas par
l'appelant.

### Comportement

- `pageCount ≤ 1` : rend **seulement** le compteur `« N ventes »` — pas de boutons,
  pas de « Page 1/1 ».
- `pageCount > 1` : rend `[Précédent]  Page X/Y — N ventes  [Suivant]`.
  - `Précédent` désactivé quand `page ≤ 1`.
  - `Suivant` désactivé quand `page ≥ pageCount`.
  - Les boutons désactivés le sont réellement (`disabled`), pas seulement visuellement.

### Accessibilité & design system

- Racine `<nav aria-label="Pagination">`.
- Compteur en `text-muted-foreground`, densité sobre, **pas d'ellipse de numéros de page**.
- Boutons via le composant `Button` existant (`variant="outline"`), libellés texte
  « Précédent » / « Suivant » (pas d'icône seule).

## Refacto des trois appels inline

Aucune régression fonctionnelle. Chaque écran remplace son bloc inline par le composant :

| Écran | `pageSize` (source) | `element` |
| --- | --- | --- |
| `ventes/index.tsx` | `parPage` (réponse API) | `{ un: "vente", plusieurs: "ventes" }` |
| `stock/mouvements.tsx` | `LIMITE` (constante locale) | `{ un: "mouvement", plusieurs: "mouvements" }` |
| `pos/tickets-du-jour.tsx` | `50` | `{ un: "ticket", plusieurs: "tickets" }` |

Seule évolution de comportement assumée : `stock/mouvements.tsx` affichait « Page 1/1 »
avec des boutons inertes sur une page unique ; il passera au **compteur seul** sur une
page unique, conformément au comportement retenu pour le composant.

## Tests

Test unitaire du composant (Testing Library + jsdom, motif du dépôt, helpers regex
`texteMontant` non requis ici) :

- **Page unique** (`total ≤ pageSize`) : le compteur `« N ventes »` est rendu ; aucun
  bouton Précédent/Suivant n'est présent.
- **Multi-pages** : le texte `« Page X/Y — N ventes »` est rendu ; `Précédent` désactivé
  en page 1 ; `Suivant` désactivé en dernière page ; `onPageChange` est appelé avec
  `page − 1` / `page + 1` au clic.
- **Accord** : `total` de 0 et 1 → `un` ; `total ≥ 2` → `plusieurs`.
- **Accessibilité** : présence d'un `nav` avec `aria-label="Pagination"`.

Aucune modification d'API dans ce sous-projet → aucun test d'intégration API. Les trois
écrans refactorés conservent leur comportement ; leurs éventuels tests existants
restent verts.

## Hors périmètre (sous-projet B)

- Ajout de la pagination serveur (`page`/`limite`, réponse avec `total`) aux endpoints
  aujourd'hui non bornés, et branchement du composant sur ces écrans.
- Harmonisation des conventions de paramètres serveur (`parPage` sur `/sales` vs
  `limite` sur `/stock/movements`) : décision reportée au sous-projet B, car elle
  touche des contrats d'API déjà en production.
