---
name: POS-Stocks
description: Gestion de stock multi-entrepôts et point de vente — un registre numérique où chaque chiffre se tient à l'audit.
colors:
  primary: "oklch(0.488 0.243 264.376)"
  primary-foreground: "oklch(0.97 0.014 254.604)"
  background: "oklch(1 0 0)"
  foreground: "oklch(0.145 0 0)"
  card: "oklch(1 0 0)"
  muted: "oklch(0.97 0 0)"
  muted-foreground: "oklch(0.52 0 0)"
  secondary: "oklch(0.967 0.001 286.375)"
  secondary-foreground: "oklch(0.21 0.006 285.885)"
  border: "oklch(0.922 0 0)"
  ring: "oklch(0.708 0 0)"
  destructive: "oklch(0.577 0.245 27.325)"
  sidebar: "oklch(0.985 0 0)"
  chart-1: "oklch(0.809 0.105 251.813)"
  chart-3: "oklch(0.546 0.245 262.881)"
  chart-5: "oklch(0.424 0.199 265.638)"
  ticket-comptoir: "oklch(0.26 0.03 158)"
  ticket-papier: "oklch(0.985 0.004 106)"
  ticket-rack: "oklch(0.55 0.19 38)"
typography:
  display:
    fontFamily: "Space Grotesk Variable, Inter Variable, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  title:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  mono:
    fontFamily: "JetBrains Mono Variable, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.625rem"
  full: "9999px"
spacing:
  xs: "0.5rem"
  sm: "0.75rem"
  md: "1rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 0.5rem"
    height: "1.75rem"
  button-primary-hover:
    backgroundColor: "oklch(0.488 0.243 264.376 / 0.8)"
    textColor: "{colors.primary-foreground}"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "0 0.5rem"
    height: "1.75rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "1.75rem"
  button-destructive:
    backgroundColor: "oklch(0.577 0.245 27.325 / 0.1)"
    textColor: "{colors.destructive}"
    rounded: "{rounded.md}"
    height: "1.75rem"
  input:
    backgroundColor: "oklch(0.922 0 0 / 0.2)"
    textColor: "{colors.foreground}"
    typography: "{typography.title}"
    rounded: "{rounded.md}"
    padding: "0.125rem 0.5rem"
    height: "1.75rem"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "1rem"
  badge-default:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0.125rem 0.5rem"
    height: "1.25rem"
---

# Design System: POS-Stocks

## 1. Overview

**Creative North Star: "Le registre du comptable"**

Le système visuel est un registre numérique : une page blanche, réglée de traits fins, où le chiffre est l'encre. On n'orne pas un livre de comptes — on l'aligne, on le rend lisible, on fait en sorte que chaque montant se tienne à l'audit. La densité est assumée : les boutons font 28 px de haut, le corps de texte 12 px, les tables respirent peu — parce que le gestionnaire de stock veut *voir* ses lignes, pas les faire défiler. La couleur est rare et fonctionnelle : un indigo profond porte l'action et la sélection, tout le reste est encre, papier et gris tramés. Deux thèmes (clair et sombre) partagent la même grammaire.

Ce que le système rejette explicitement : l'**ERP obèse** (écrans gris saturés, menus sans fin, codes cryptiques), le **POS grand public ludique** (arrondi, coloré, gamifié), le **template admin générique** (cartes grises anonymes sans point de vue) et le **clinquant marketing** (dégradés, hero-metrics, motion décoratif). La confiance ne vient pas d'un effet, elle vient de la lisibilité.

Une exception assumée à la retenue : le monde du **ticket de caisse** — l'écran de connexion et le reçu 80 mm. Là, le registre laisse place au papier thermique : comptoir vert profond, encre sombre, accent orange « rack », Space Grotesk en display et JetBrains Mono pour les chiffres. C'est le seul endroit où le système a de la matière et de la chaleur ; ailleurs, il reste l'encre sur la page.

**Key Characteristics:**
- Dense par défaut : contrôles compacts (28 px), échelle de type serrée, information au premier plan.
- Plat et tonal : pas d'ombres portées dans l'app ; la profondeur vient de traits fins (`ring-1`) et de couches de gris.
- Une seule voix chromatique : l'indigo pour l'action, la sélection, l'état — jamais pour décorer.
- Inter partout dans l'app ; Space Grotesk et JetBrains Mono réservés au monde du ticket.
- Le chiffre est l'élément le plus lisible de chaque écran.

## 2. Colors

Une page d'encre et de papier, ponctuée d'un seul indigo — plus un monde chaud, isolé, pour le ticket de caisse.

### Primary
- **Indigo du registre** (`oklch(0.488 0.243 264.376)`) : la seule couleur saturée de l'app. Elle porte le bouton primaire, la sélection courante, l'entrée active de la barre latérale et les indicateurs d'état. En sombre elle s'assombrit (`oklch(0.424 0.199 265.638)`). Sa rareté est le sujet.
- **Encre sur indigo** (`oklch(0.97 0.014 254.604)`) : le texte posé sur l'indigo (`primary-foreground`).

### Neutral
- **Encre** (`oklch(0.145 0 0)`) : le texte principal, le chiffre. Le noir presque pur du registre.
- **Papier** (`oklch(1 0 0)`) : le fond et la carte en thème clair. Blanc franc, chroma 0 — jamais teinté « pour la chaleur ».
- **Encre pâle** (`oklch(0.52 0 0)`) : texte secondaire et libellés discrets (`muted-foreground`). Tient le seuil AA (≥ 4,5:1) sur toutes les surfaces, y compris `bg-muted`.
- **Trait** (`oklch(0.922 0 0)`) : bordures, séparateurs, réglure du registre (`border` / `input`).
- **Barre latérale** (`oklch(0.985 0 0)`) : un gris à peine plus froid que le contenu, pour distinguer la navigation de la page.

### Tertiary — Données
- **Rampe indigo des graphiques** (`chart-1` `oklch(0.809 0.105 251.813)` → `chart-5` `oklch(0.424 0.199 265.638)`) : cinq pas dans la même famille bleue pour la data-viz. Même hue que le primaire : la donnée reste dans la voix de la marque.

### Signature — Le ticket
- **Comptoir** (`#14261d`) : vert profond, fond de l'écran de connexion et cadre du reçu.
- **Papier thermique** (`#fcfcf8`) : le corps du ticket, blanc cassé chaud.
- **Rack** (`#c2410c` / vif `#e8590c`) : l'unique accent orange, réservé au monde du ticket. **Il ne migre jamais dans l'app.**

### Named Rules
**La règle d'une seule voix.** L'indigo n'apparaît que pour l'action, la sélection et l'état — jamais en décor, jamais en aplat de remplissage. Sur un écran donné, il touche moins de 10 % de la surface. Sa rareté fait sa lisibilité.

**La règle du monde clos.** L'orange « rack », le vert comptoir, Space Grotesk et JetBrains Mono appartiennent au ticket (connexion + reçu 80 mm). Ils ne franchissent jamais la frontière vers l'app. Inversement, l'app ne pose jamais d'indigo sur le ticket.

## 3. Typography

**Display Font:** Space Grotesk Variable (fallback Inter Variable) — *réservé au monde du ticket*
**Body Font:** Inter Variable (fallback sans-serif) — *toute l'app*
**Label/Mono Font:** JetBrains Mono Variable — *chiffres du reçu, numéros de ticket*

**Character:** Inter porte seule l'app — titres, boutons, libellés, données, corps — parce qu'un outil produit n'a pas besoin d'un couple display/texte ; il a besoin d'une graisse bien réglée. La respiration typographique vient du poids (400 vs 500) et de la taille, pas d'une seconde fonte. Space Grotesk et JetBrains Mono n'existent que là où le papier thermique existe.

### Hierarchy
- **Display** (Space Grotesk, 500, ~1,5 rem, LH 1.1) : titres du ticket de connexion uniquement.
- **Headline** (Inter, 500, 1 rem, LH 1.4) : titres de page, en-têtes de section.
- **Title** (Inter, 500, 0,875 rem `text-sm`) : titres de carte (`font-heading` = Inter), en-têtes de bloc.
- **Body** (Inter, 400, 0,75 rem `text-xs/relaxed`, LH ~1.55) : le corps de l'app, la plupart des libellés et des cellules. Prose plafonnée à 65–75 ch ; les tables denses peuvent courir plus large.
- **Label** (Inter, 500, 0,625 rem) : badges, micro-libellés. **Jamais en capitales tramées décoratives.**
- **Mono** (JetBrains Mono, 400, 0,75 rem) : montants et numéros sur le reçu, où l'alignement des chiffres compte.

### Named Rules
**La règle d'Inter partout.** Dans l'app, une seule famille. Aucun display, aucun serif décoratif, aucune fonte « pour donner du caractère » à un libellé ou une donnée. Le caractère vient de la graisse et de la hiérarchie.

**La règle des chiffres monospacés.** Sur le reçu — et partout où des montants s'empilent et doivent s'aligner — les chiffres passent en JetBrains Mono. Ailleurs, `formaterMontant` (entiers XOF) suffit ; le chiffre reste l'élément le plus lisible de la ligne.

## 4. Elevation

Le système est **plat par défaut**. Aucune ombre portée dans l'app : la profondeur se lit sur des traits fins et des couches tonales. Une carte n'est pas « soulevée » par une ombre — elle est cernée d'un filet (`ring-1 ring-foreground/10`) et posée sur un fond légèrement plus clair ou plus froid. C'est la profondeur d'un registre relié, pas d'un bureau encombré.

### Shadow Vocabulary
- **Aucune ombre d'app.** Les surfaces sont plates au repos et à l'état actif. La séparation vient du filet et du gris.
- **Ombre du ticket** (`box-shadow: 0 1px 2px rgb(0 0 0 / 0.25), 0 24px 48px -16px rgb(0 0 0 / 0.5)`) : la seule ombre du système, portée par le reçu posé sur le comptoir. Elle appartient au monde du ticket.

### Named Rules
**La règle du filet.** Une surface se distingue par un trait, pas par une ombre. Si l'on est tenté d'ajouter un `box-shadow` pour « détacher » une carte dans l'app, c'est le mauvais outil : renforcer le filet ou décaler le fond d'un pas de gris.

## 5. Components

Vocabulaire compact et homogène : même forme de bouton, même contrôle de formulaire, même style d'icône (Lucide) d'un écran à l'autre. Rien ne se réinvente pour la saveur.

### Buttons
- **Shape:** coins doux, `rounded-md` (0,5 rem) ; `rounded-sm` (0,375 rem) sur les tailles `xs`.
- **Taille par défaut compacte:** `h-7` (28 px), `px-2` (8 px), texte `text-xs`. Tailles `xs` / `sm` / `lg` / `icon` disponibles ; l'app privilégie le compact.
- **Primary:** fond indigo (`primary`), texte `primary-foreground` ; `hover` éclaircit à 80 % d'opacité.
- **Outline:** filet `border`, fond transparent (léger `input/30` en sombre) ; `hover` pose un fond `input/50`.
- **Secondary / Ghost:** gris tramé pour les actions moins fortes ; `ghost` ne montre son fond qu'au survol (`muted`).
- **Destructive:** fond `destructive/10`, texte `destructive` — jamais un aplat rouge plein ; l'avertissement est teinté, pas hurlé.
- **Focus:** `focus-visible` pose une bordure `ring` + un halo `ring/30` (2 px). **Toujours visible** — l'app se pilote au clavier.
- **Press:** léger `translate-y-px` à l'appui (sauf menus) — le seul micro-mouvement, fonctionnel.

### Inputs / Fields
- **Style:** `h-7` (28 px), `rounded-md`, filet `border-input`, fond `input/20` (`input/30` en sombre). Compact, aligné sur les boutons.
- **Focus:** bordure `ring` + halo `ring/30` (2 px). Placeholder en `muted-foreground` — au seuil AA, jamais un gris trop pâle.
- **Error:** `aria-invalid` bascule bordure et halo en `destructive`.
- **Disabled:** opacité 50 %, curseur interdit.

### Cards / Containers
- **Corner Style:** `rounded-lg` (0,625 rem).
- **Background:** `card` (papier), texte `card-foreground`.
- **Shadow Strategy:** aucune — filet `ring-1 ring-foreground/10` (voir Elevation).
- **Internal Padding:** `--card-spacing` = 16 px (12 px en `size=sm`), homogène header/content/footer.
- **Titre:** `font-heading` (Inter) `text-sm font-medium` ; description en `text-xs muted-foreground`.

### Badges
- **Style:** pilule `rounded-full`, `h-5` (20 px), texte 0,625 rem, `font-medium`.
- **Variants:** `default` indigo plein, `secondary` gris, `destructive` teinté (`destructive/10`), `outline` filet, `ghost`. Même logique de couleur que les boutons.

### Navigation
- **Barre latérale** sur fond `sidebar` (gris à peine plus froid). Entrée active portée par l'indigo (`sidebar-primary`) ; survol en `sidebar-accent`. Le front masque ce qui est hors portée du rôle ; l'API fait autorité.

### Signature — Le ticket de caisse
Le reçu 80 mm et l'écran de connexion forment un composant à part, imprimé : papier thermique, bords perforés en zigzag, code-barres décoratif en pied, animation « impression » (`ticket-imprimer`, cubic-bezier(0.22,1,0.36,1)) désactivée sous `prefers-reduced-motion`. Le ticket s'imprime via `createPortal(document.body)` — aucun ancêtre `print:hidden` ne doit l'envelopper.

## 6. Do's and Don'ts

### Do:
- **Do** garder l'indigo pour l'action, la sélection et l'état — moins de 10 % de la surface (la règle d'une seule voix).
- **Do** distinguer les surfaces par un filet (`ring-1 ring-foreground/10`) et des couches de gris, jamais par une ombre.
- **Do** rester dense : contrôles `h-7`, corps `text-xs`, tables serrées là où le gestionnaire en a besoin.
- **Do** utiliser Inter pour tout dans l'app ; réserver Space Grotesk / JetBrains Mono au monde du ticket.
- **Do** rendre le focus toujours visible (`ring/30`) — l'app se pilote au clavier, surtout au POS.
- **Do** teinter les états destructifs (`destructive/10`), pas les remplir de rouge plein.
- **Do** formater les montants en entiers XOF via `formaterMontant` ; le chiffre est l'élément le plus lisible de la ligne.

### Don't:
- **Don't** faire un **ERP obèse** : pas d'écrans gris saturés, de menus sans fin, de codes cryptiques.
- **Don't** faire un **POS grand public ludique** : pas d'arrondis exagérés, de couleurs vives multiples, de gamification.
- **Don't** faire un **template admin générique** : pas de cartes grises anonymes empilées sans hiérarchie.
- **Don't** faire du **clinquant marketing** : pas de dégradés, de texte en dégradé, de hero-metrics, de motion décoratif.
- **Don't** ajouter d'ombre portée dans l'app pour « détacher » un élément — renforcer le filet ou décaler le gris.
- **Don't** laisser fuir l'orange « rack », le vert comptoir ou les fontes du ticket dans l'app (la règle du monde clos).
- **Don't** poser de bordure latérale colorée (`border-left`/`border-right` > 1 px) en guise d'accent sur une carte ou une alerte — filet complet ou fond teinté.
- **Don't** mettre un gris trop pâle sous le seuil AA sur les placeholders et le texte « muted ».
