# Refonte de la fiche produit — « consulter d'abord »

Date : 2026-07-22 · Statut : validé (brainstorming du 2026-07-22)
Complète la spec de référence `2026-07-08-pos-stocks-design.md` (§ catalogue).

## Contexte et problème

La page `/catalogue/produits/$productId` actuelle est un formulaire avant
d'être une fiche : une colonne unique `max-w-3xl` empile l'upload d'image,
un long formulaire « Informations » (champs pleine largeur, bouton
Enregistrer pleine largeur façon dialog), la table des variantes puis les
lots. Aucun chiffre ne se lit d'un coup d'œil et **aucune information de
stock** n'apparaît — alors que « combien il m'en reste et où » est la
première question devant un produit. Pas de lien de retour vers la liste.

## Décisions de cadrage (brainstorming)

1. **Vocation : consulter d'abord.** La fiche est une page de lecture ;
   l'édition est accessible mais seconde.
2. **Le stock entre sur la fiche**, par entrepôt et par variante, avec CMP —
   ce qui demande un petit endpoint API dédié (lecture seule).
3. **Édition en place par section** (pas de dialog global ni de mode
   édition de page) : chaque section bascule ses champs en édition inline.
4. **Layout A : deux colonnes** — identité à gauche (1/3), données vivantes
   à droite (2/3) — repli en une colonne sous `lg:`.

## Design

### Structure de la page

Colonne pleine hauteur comme les listes (`h-[calc(100dvh-3rem)]`, zone
droite scrollable si besoin).

- **En-tête** : lien « ← Produits » (les filtres de la liste survivent via
  l'URL-état), nom, SKU en mono pâle, badge Actif/Inactif.
- **Bande de synthèse** : une ligne de faits chiffrés, style registre —
  `Prix de vente … · Prix plancher … · Seuil d'alerte … · Stock total …` —
  chiffres `tabular-nums`, libellés `muted-foreground`. Pas de cartes KPI
  ni de hero-metrics (anti-références du DESIGN.md). Le stock total est la
  somme des entrepôts visibles par le rôle ; il est omis si l'utilisateur
  n'a aucune portée de lecture stock.
- **Colonne gauche — Identité** : image (128 px, clic pour remplacer,
  JPEG/PNG/WebP 2 Mo max, comportements actuels conservés), puis
  catégorie, code-barres, description en liste de définition dense.
- **Colonne droite — données vivantes** :
  - **Stock par entrepôt** : table entrepôt · variante (colonne présente
    seulement si le produit a plusieurs variantes actives) · quantité ·
    CMP. Ligne de total en pied (`TableFooter`). État vide : « Aucun stock
    visible pour ce produit. »
  - **Variantes** : table actuelle (nom, SKU, attributs, prix effectif,
    statut, bascule) avec, sous chaque ligne de variante, ses **lots**
    (numéro mono, péremption, badge Expiré, « Ajouter un lot ») lorsque
    `trackLots` est actif. La section Lots séparée disparaît : un lot
    appartient à une variante et se lit au même endroit.

### Édition en place par section

- **Synthèse** : bouton « Modifier » discret (ghost, aligné à droite de la
  bande) → prix, plancher et seuil deviennent des inputs compacts en
  place ; Enregistrer / Annuler. PATCH produit existant.
- **Identité** : même motif → nom, catégorie (combobox DS), code-barres,
  description, interrupteur « Produit actif ». PATCH produit existant.
- Une seule section en édition à la fois n'est PAS imposé (états
  indépendants, plus simple) ; chaque section gère son message d'erreur
  en place (`role="alert"`).
- **Variantes / lots** : dialogs actuels inchangés (création de variante,
  bascule actif/inactif, ajout de lot).
- Sans permission d'écriture (`usePeutEcrire`), aucun affordance
  d'édition ne s'affiche ; l'API reste l'autorité.

### Nouvel endpoint API — `GET /api/v1/products/:productId/stock`

- Lecture seule. Réponse :
  `{ stock: [{ warehouseId, warehouseName, variantId, variantName,
  quantity, avgCost }] }`, trié par entrepôt puis variante.
- **Portée** : filtré par `porteeLectureStock`/`filtrePortee`
  (`lib/stock-acces.ts`) — un manager local ne voit que ses entrepôts, un
  staff sans affectation reçoit une liste vide (200, pas 403 : la fiche
  reste consultable, la table de stock affiche son état vide).
- Produit hors organisation → `404 INTROUVABLE` (garde cross-tenant avant
  tout bypass de rôle).
- Aucune écriture : les invariants (`applyMovements` seul point d'écriture)
  ne sont pas concernés.

## Non-objectifs

- Pas d'historique des mouvements sur la fiche (le journal existe).
- Pas d'édition des attributs d'une variante existante (différé v1, issue
  #10) ni de suppression de lot.
- Pas de graphique d'évolution du stock.

## Tests et critères d'acceptation

- **API (D1 réelle)** : matrice de portée sur le nouvel endpoint (owner
  voit tout ; manager local limité à ses entrepôts ; staff sans
  affectation → liste vide), cross-org → 404, quantités et CMP
  recalculables à la main via `applyMovements`.
- **Web (Testing Library)** : la fiche affiche synthèse, stock, variantes
  et lots imbriqués ; la bascule Modifier → Enregistrer/Annuler d'une
  section fonctionne et n'affecte pas l'autre ; aucun affordance
  d'édition sans `peutEcrire` ; montants via les helpers `texteMontant`.
- **E2E navigateur** : fiche complète en ≥ 1024 px (deux colonnes) et en
  colonne unique étroite ; édition en place vérifiée de bout en bout.
- La page conserve : invalidation de requête après mutation, messages
  d'erreur API en français affichés en place, upload d'image inchangé.
