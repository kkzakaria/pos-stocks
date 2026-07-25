# Création de produit — page dédiée, image et variantes

Statut : validé en brainstorming le 2026-07-25. Remplace le modal de création de
`apps/web/src/routes/_app/catalogue/produits/index.tsx`.

## Problème

La création d'un produit se fait aujourd'hui dans un modal qui ne couvre que
l'identité et les prix. L'image et les variantes n'y figurent pas : il faut créer
le produit, atterrir sur sa fiche, passer en mode édition, puis les ajouter. Rien
ne le signale, et le produit est actif — donc vendable au point de vente — dès
l'instant où il n'a encore ni photo ni déclinaison.

## Décisions de cadrage

Quatre arbitrages pris avec l'utilisateur, dans cet ordre :

1. **Les variantes sont l'exception.** La majorité du catalogue (visserie,
   outillage, consommables) ne se décline pas. Le chemin du produit simple ne
   doit donc pas s'allonger pour servir une minorité.
2. **Un abandon ne laisse rien**, et l'API devient atomique pour l'obtenir :
   `POST /api/v1/products` accepte les variantes dans le même appel, en un seul
   `db.batch` — conforme à l'invariant « une opération métier = un batch ».
3. **L'image voyage dans le même appel**, en multipart. R2 n'étant pas
   transactionnel avec D1, l'écriture R2 précède le batch et un échec du batch
   déclenche une suppression best-effort de l'objet.
4. **Colonne unique**, blocs séquentiels — pas de mise en page à deux colonnes.

## Contrainte externe : le script d'import

La branche `worktree-import-produits-supabase` contient un import Supabase qui
appelle `POST /api/v1/products` en `application/json`, puis téléverse l'image par
un second appel, avec un journal de reprise (`produit_cree` → `image_ok`) bâti sur
ce découpage en deux temps.

**Le contrat `application/json` doit rester intact.** Ce n'est pas une commodité :
le casser casserait un import fonctionnel. L'import est prioritaire et sera mergé
en premier ; la vérification a montré qu'il ne modifie aucun fichier de
`apps/api`, `apps/web` ni `packages/shared`, donc les deux lots ne se recouvrent
pas et le rebase est sans objet.

## API

### `POST /api/v1/products` — deux formats, discriminés par le `Content-Type`

| Format                | Corps                                                         | Usage                                           |
| --------------------- | ------------------------------------------------------------- | ----------------------------------------------- |
| `application/json`    | `productCreateSchema`                                         | Contrat actuel, **inchangé**. Voie de l'import. |
| `multipart/form-data` | partie `donnees` (JSON) + partie `image` (fichier, optionnel) | Nouveau. Voie de la page de création.           |

En multipart, la partie `donnees` est validée par `productCreateSchema` étendu
d'un champ optionnel :

```ts
variants: z.array(variantCreateSchema).optional()
```

Le schéma de variante existant est réutilisé tel quel — il porte déjà `name`,
`attributes`, `barcode?`, `priceOverride?`, `minPriceOverride?` et `sku?`.

### Ordre d'exécution et atomicité

1. Parser et valider `donnees`. Rejet → 400 `VALIDATION`.
2. Valider l'image si présente : taille (2 Mo) puis type (JPEG, PNG, WebP).
   Rejets → 400 `IMAGE_TROP_LOURDE` / 400 `FORMAT_IMAGE`. Le contrôle précoce sur
   `content-length` déjà en place sur `POST /:id/image` est conservé.
3. Vérifier les préconditions **avant toute écriture** : catégorie existante
   (404 `INTROUVABLE`), code-barres du produit libre (409 `BARCODE_EXISTANT`),
   code-barres de chaque variante libre, et **unicité des code-barres entre
   variantes du même envoi** (409 `BARCODE_EXISTANT`).
4. Écrire l'objet dans R2 si une image est fournie — une seule fois, avant la
   boucle de régénération du SKU.
5. Exécuter **un seul `db.batch`** : insertion du produit puis des variantes.
6. Si le batch échoue définitivement, supprimer l'objet R2 en best-effort — le
   nettoyage ne doit jamais masquer l'erreur d'origine, qui est remontée
   inchangée. C'est le motif déjà employé pour l'utilisateur Better Auth orphelin
   dans `users.ts`.

Le SKU auto reste régénéré en cas de course sur l'index unique `(org, sku)`,
produit comme variantes, avec la même limite de trois tentatives puis 409.

### La variante implicite

`POST /products` crée aujourd'hui, dans le même batch, une variante implicite
« Standard » (`attributes: "{}"`, SKU `<SKU>-STD`) et laisse `hasVariants` à
`false`. L'ajout ultérieur d'une première variante explicite, via
`POST /:id/variants`, désactive cette implicite et bascule `hasVariants` à `true`.

**L'implicite est créée dans tous les cas**, y compris quand des variantes
explicites accompagnent la création. Seuls deux drapeaux varient :

| Création                | Variante implicite         | `hasVariants` |
| ----------------------- | -------------------------- | ------------- |
| sans variante explicite | insérée, active            | `false`       |
| avec variantes          | insérée, `isActive: false` | `true`        |

**L'état final ne dépend pas du chemin emprunté** : un produit à variantes
présente exactement les mêmes lignes qu'il ait été créé d'un bloc ou complété
depuis sa fiche. C'est vérifiable à l'octet près, `product_variants` ne portant
pas de colonne `updatedAt` — insérer directement avec `isActive: false` est
indiscernable d'insérer puis désactiver.

Cette convergence est une propriété à tenir, pas une coïncidence : elle évite
qu'une lecture, un export ou une reprise d'inventaire ait à connaître l'histoire
d'un produit pour l'interpréter.

### Codes d'erreur des conflits

`BARCODE_EXISTANT` doit préciser **si le conflit porte sur le produit ou sur une
variante, et laquelle**. Un message générique oblige l'utilisateur à chercher à
l'aveugle dans un formulaire qui peut contenir plusieurs variantes.

Les conflits déjà couverts par l'endpoint restent inchangés et s'appliquent à la
voie multipart : `NOM_EXISTANT` (index unique sur `products.name`) et
`SKU_EXISTANT` (SKU fourni explicitement, ou trois régénérations infructueuses).

### Endpoints inchangés

`POST /api/v1/products/:id/image` et `POST /api/v1/products/:id/variants` restent
en l'état : la fiche produit s'en sert pour l'édition, l'import pour son étape 2.

## Web

### Route

`apps/web/src/routes/_app/catalogue/produits/nouveau.tsx` → `/catalogue/produits/nouveau`.
Le segment statique prime sur `$productId`, aucune ambiguïté de routage.

### Mise en page

Colonne unique, cinq blocs :

| Bloc                     | Champs                                            |
| ------------------------ | ------------------------------------------------- |
| Identité                 | nom (requis), description, catégorie, code-barres |
| Prix                     | prix de vente (requis), prix plancher             |
| Stock                    | seuil d'alerte par défaut, suivre les lots        |
| Image _(facultatif)_     | sélection, aperçu                                 |
| Variantes _(facultatif)_ | replié par défaut                                 |

`defaultMinStock` et `trackLots` quittent le bloc des prix pour ce bloc « Stock » :
ce sont des réglages de stock, et les mêler aux montants brouillait la lecture.

### Comportements

- Le bouton « Nouveau produit » de la liste **navigue** vers la page en
  conservant les filtres courants (`q`, `categorie`, `page`), pour qu'« Annuler »
  y revienne exactement. L'action du composant `EtatVide` navigue de même.
- Le modal et son état local disparaissent de `produits/index.tsx`.
- **Image** : aperçu par `URL.createObjectURL`, révoqué au changement de fichier
  et au démontage. Validation client du type et des 2 Mo pour un retour immédiat ;
  l'API reste l'autorité.
- **Variantes** : bloc replié par défaut. Ouvert, il liste les variantes saisies
  et propose un formulaire d'ajout reprenant l'idiome de `section-variantes`
  (nom, attributs clé/valeur, prix, plancher et code-barres optionnels). Tout
  reste en état local, **aucun appel réseau** avant la soumission.
- **Soumission** : un unique `POST` multipart. Succès → redirection vers la fiche
  du produit créé. Échec → message affiché en `role="alert"`, **rien n'a été
  créé**, la saisie est intégralement conservée.

### Découpage

Trois unités, chacune compréhensible et testable isolément :

| Fichier                                       | Rôle                                                                   | Dépend de                      |
| --------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------ |
| `routes/_app/catalogue/produits/nouveau.tsx`  | état du formulaire, construction du `FormData`, mutation, navigation   | les deux composants ci-dessous |
| `components/produit/formulaire-variantes.tsx` | liste et ajout de variantes, composant contrôlé (`value` / `onChange`) | rien                           |
| `components/produit/champ-image.tsx`          | sélection, aperçu, validation client, révocation de l'URL objet        | rien                           |

Les deux composants ignorent la création : ils manipulent de la donnée, pas des
requêtes. C'est ce qui permet de les tester sans simuler le réseau.

## Tests

### API — D1 réelle

Le test qui porte le design : **une variante au code-barres déjà pris renvoie 409
et ne laisse rien** — ni produit, ni variante, ni objet R2. Il prouve l'atomicité.

Autour :

- multipart avec image et deux variantes → 201 ; produit, variantes et `imageKey`
  vérifiés en base ; image relisible via `GET /api/v1/files/:key` ; `hasVariants`
  à `true` et variante implicite « Standard » présente mais inactive ;
- multipart sans image ni variante → 201, équivalent au JSON : variante implicite
  active et `hasVariants` à `false` ;
- **équivalence des chemins** : un produit créé d'un bloc avec une variante et un
  produit créé nu puis complété par `POST /:id/variants` présentent les mêmes
  lignes de `product_variants` (nom, attributs, SKU, `isActive`) et le même
  `hasVariants`. C'est la propriété de convergence, elle mérite son test ;
- **`application/json` inchangé → 201** — non-régression du contrat de l'import ;
- deux variantes du même envoi partageant un code-barres → 409, rien créé ;
- image de plus de 2 Mo → 400, rien créé ;
- catégorie inconnue → 404, rien créé ;
- matrice de rôles : `staff` et `auditor` → 403.

Valeurs attendues recalculables à la main, conformément aux conventions du dépôt.

### Web

- `formulaire-variantes` : ajout, retrait, saisie d'attributs clé/valeur ;
- `champ-image` : refus au-delà de 2 Mo, refus d'un type non autorisé, aperçu
  présent, URL objet révoquée ;
- page : le `FormData` soumis contient bien les variantes et l'image ; une erreur
  API s'affiche sans vider la saisie.

## Hors périmètre

- L'édition d'un produit existant : la fiche produit reste inchangée.
- La notion de brouillon (produit inactif tant qu'il n'est pas publié), écartée au
  cadrage au profit de l'atomicité.
- La génération croisée d'attributs de variantes (matrice taille × couleur), sans
  objet tant que les variantes restent l'exception.
