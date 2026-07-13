# Product

## Register

product

## Platform

web

## Users

Une seule entreprise aujourd'hui (retail multi-entrepôts en zone XOF), mais l'app est architecturée pour évoluer en SaaS multi-tenant. Trois profils l'utilisent à parts sensiblement égales, et l'interface doit servir chacun sans en privilégier un :

- **Caissiers**, au comptoir : ils encaissent des ventes vite, souvent sur un écran fixe ou une tablette tactile, parfois au clavier. Leur écran est le POS ; leur enjeu est la vitesse et le nombre de gestes.
- **Gestionnaires de stock**, en réserve : réceptions, transferts inter-entrepôts, inventaires. Ils vivent dans des tables denses et exigent l'exactitude.
- **Propriétaire / administrateurs** : pilotage global — rapports, marges, valorisation, utilisateurs, paramètres. Ils veulent une vue d'ensemble et le contrôle.

Le système applique deux niveaux de permissions (rôle d'entreprise puis rôle d'entrepôt) ; l'interface masque ce qui est hors portée, mais c'est l'API qui fait autorité. Tout est en français.

## Product Purpose

Gérer le stock multi-entrepôts et le point de vente dans un seul système, où une vente déplace immédiatement l'inventaire réel. L'app remplace le trio « tableur + POS générique + logiciel de stock séparé » par une source de vérité unique : niveaux par entrepôt, transferts, réceptions, inventaires, ventes, coûts (CMP figé, FEFO par lot) et rapports (ventes, marges, valorisation). Le succès, c'est que le chiffre à l'écran soit toujours juste et défendable — jamais un doute sur « combien il en reste » ou « combien ça a coûté ».

## Positioning

L'exactitude vérifiable. Chaque mouvement de stock et chaque montant sont traçables et réconciliables : rien ne bouge sans être journalisé, et les nombres se tiennent à l'audit. C'est la promesse que chaque écran doit renforcer — pas seulement afficher un total, mais donner confiance qu'il est le bon.

## Brand Personality

Précis, efficace, fiable. Un outil professionnel sérieux, à la confiance tranquille, sans esbroufe. Le ressenti visé à l'usage est **rapide et sans friction** : l'action fréquente est à un raccourci ou un tap, l'outil s'efface derrière la tâche. La tension à tenir en permanence : aller vite *tout en* restant irréprochable sur l'exactitude — la rapidité ne doit jamais donner l'impression d'un raccourci sur la rigueur.

## Anti-references

- **L'ERP d'entreprise obèse** (SAP / Sage) : écrans gris saturés, menus sans fin, codes cryptiques, intranet de 1998.
- **Le POS grand public ludique** : arrondi, coloré, gamifié, trop décontracté pour de l'argent et du stock.
- **Le template d'admin générique** : dashboard Bootstrap/Material anonyme, cartes grises partout, aucun point de vue.
- **Le clinquant marketing** : dégradés, hero-metrics, motion décoratif — tout ce qui distrait de la tâche.

## Design Principles

- **Le chiffre est sacré.** La donnée (montant, quantité, coût, écart) est l'élément le plus lisible de chaque écran ; la mise en page la sert, jamais l'inverse. Montants en entiers XOF via `formaterMontant`.
- **Vite sans bâcler.** Optimiser le nombre de gestes et le temps jusqu'à l'action, mais sans jamais masquer un état ou une conséquence. La vitesse vient de la clarté, pas de la dissimulation.
- **Tout se lit, tout se prouve.** Chaque état est nommé et chaque mouvement est traçable ; on ne cache rien qu'un auditeur voudrait voir. La confiance naît de la lisibilité.
- **Familiarité gagnante.** Réutiliser les affordances standard (mêmes boutons, mêmes contrôles de formulaire, même vocabulaire d'icônes d'un écran à l'autre) ; l'outil doit disparaître dans la tâche, la surprise est réservée aux moments, pas aux pages.
- **La densité au service du métier.** Assumer les tables denses et l'information compacte là où les gestionnaires en ont besoin, sans les imposer au comptoir où le caissier veut peu d'éléments et de gros gestes.

## Accessibility & Inclusion

- **Contraste WCAG AA** sur les deux thèmes (clair et sombre) : ≥ 4,5:1 pour le corps de texte, ≥ 3:1 pour le grand texte. Les placeholders et le texte « muted » doivent tenir le même seuil que le corps.
- **Clavier d'abord au POS** : le caissier encaisse sans souris — navigation et raccourcis clavier complets sur l'écran de vente.
- **Matériel modeste** : tablettes et portables plus anciens, petits écrans, connexions variables — rester lisible et rapide, pas d'effets lourds.
- **Cibles tactiles confortables** : tailles de tap adaptées aux comptoirs tactiles, pas seulement des zones précises à la souris.
