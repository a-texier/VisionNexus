---
app: annotation
doc_type: user-guide
audience: user
lang: fr
title: Guide utilisateur
order: 10
tags: [interface, barre d'outils, panneau tracks, timeline, raccourcis, import, export]
sources: [Annotation_App/frontend/src/pages/ProjectsPage.tsx, Annotation_App/frontend/src/pages/AnnotationPage.tsx, Annotation_App/frontend/src/pages/MonitoringPage.tsx, Annotation_App/frontend/src/pages/ConvertPage.tsx, Annotation_App/frontend/src/pages/PresentationPage.tsx, Annotation_App/frontend/src/components/canvas/AnnotationCanvas.tsx, Annotation_App/frontend/src/components/sidebar/TrackPanel.tsx, Annotation_App/frontend/src/components/sidebar/AnnotationList.tsx, Annotation_App/frontend/src/components/sidebar/LabelManager.tsx, Annotation_App/frontend/src/components/timeline/Timeline.tsx, Annotation_App/frontend/src/components/modals/ImportModal.tsx, Annotation_App/frontend/src/components/modals/ExportModal.tsx, Annotation_App/frontend/src/components/modals/SettingsModal.tsx, Annotation_App/frontend/src/components/panels/LutPanel.tsx, Annotation_App/frontend/src/hooks/useKeyboardShortcuts.ts, Annotation_App/frontend/src/components/help/helpContent.ts]
---

# Guide utilisateur

## Page des projets d'Annotation App

La page des projets est l'écran d'accueil d'Annotation App. Elle affiche chaque projet de votre workspace sous forme de carte et donne accès aux outils qui ne dépendent pas d'un projet.

Chaque carte de projet montre :

- le nom du projet et son type, **Séquence Image** (violet) ou **Image Random** (bleu) ; le projet de démonstration créé par le tutoriel a une bordure orange et un badge **Démo tutoriel** ;
- le nombre de frames annotées sur le total, avec un pourcentage et une barre de progression (verte à partir de 80 %, orange à partir de 40 %) ;
- pour les projets multi-séquences, une ligne par séquence avec ses frames annotées, son nombre d'annotations et sa propre barre de progression (les trois premières sont affichées, un lien déplie les autres) ;
- la date de dernière modification.

Cliquez sur une carte pour ouvrir le projet dans l'espace d'annotation. Survolez une carte pour faire apparaître l'icône corbeille ; la suppression demande une confirmation (**Supprimer le projet**) et retire le projet avec toutes ses fiches de frames, annotations, pistes et classes. Les fichiers images référencés par lien symbolique ne sont pas touchés.

L'en-tête contient, de gauche à droite :

- **Tutoriel interactif** : lance la visite guidée (il brille tant que vous ne l'avez jamais lancé).
- **Présentation** : ouvre la documentation intégrée, décrite dans la section *Page Présentation (documentation intégrée)* de ce guide.
- **Convert** : ouvre la page Convert, un utilitaire de conversion `.ver` et YOLO.
- **Paramètres** : ouvre la fenêtre Paramètres (la même que dans l'espace d'annotation).
- **Monitoring** : ouvre la page Monitoring avec les statistiques d'usage.
- **Nouveau projet** : ouvre la fenêtre de création de projet.

Le coin inférieur gauche contient le badge utilisateur et le menu **Workspace**, décrits dans la section *Menu Workspace et hôte du partage* de ce guide.

## Créer un projet dans Annotation App

La fenêtre **Nouveau projet**, ouverte depuis la page des projets, crée un projet vide. Elle comporte trois champs :

- **Nom du projet** (obligatoire).
- **Type** : **Image Random** pour un ensemble d'images sans lien entre elles, ou **Séquence Image** pour une vidéo ou un dossier d'images ordonné.
- **Créer** / **Annuler**.

Le type détermine les outils disponibles. Les projets **Séquence Image** affichent la barre latérale gauche avec les onglets **Tracks** et **Debug** (tous les outils de suivi et de propagation) et les pistes au-dessus de la timeline. Les projets **Image Random** masquent la barre latérale gauche : on annote frame par frame avec les outils manuels, SAM2 et la détection par texte. Les deux types ont la timeline, le curseur de frames, l'import, l'export et la sauvegarde. Dans les projets **Séquence Image**, chaque boîte ou polygone dessiné à la main est aussi rattaché automatiquement à une piste (le plus petit numéro de piste libre sur cette frame). Le type ne peut plus être changé après la création : choisissez **Séquence Image** dès que les frames viennent d'une vidéo ou d'une série temporelle, même si vous ne prévoyez pas encore de suivi.

Après **Créer**, le projet apparaît sur la page des projets. Ouvrez-le et utilisez **Importer** pour ajouter des frames ; le projet reste vide jusqu'au premier import de séquence. Les différences entre les deux types sont expliquées dans [Concepts](concepts.fr.md).

## Menu Workspace et hôte du partage

Le bouton **Workspace** en bas à gauche de la page des projets ouvre un menu consacré au dossier où vivent vos données. Il affiche le chemin du workspace sur la machine du backend et propose :

- **Ouvrir sur le serveur (app locale uniquement)** : ouvre le dossier dans l'explorateur de fichiers. Cela ne fonctionne que si le backend tourne sur votre propre ordinateur ; avec une VM distante, l'application ne peut pas ouvrir de fenêtre sur votre poste.
- **Copier le chemin serveur** : copie le chemin du workspace tel que le voit le backend (par exemple `/srv/data/All_workspaces/annotation_alice`).
- **Copier le chemin Windows (montage)** : copie le même dossier sous forme de chemin réseau Windows (par exemple `\\share-host\data\All_workspaces\annotation_alice`). Cette entrée apparaît dès qu'un hôte de partage est enregistré.
- **Montage Windows - hôte du partage** : un champ pour le nom DNS ou l'IP du serveur SMB qui expose les dossiers du backend à Windows. La ligne d'exemple sous le champ montre comment `/srv/datasets/...` devient `\\<share-host>\datasets\...` : le premier segment du chemin (la racine partagée) est retiré et le second devient le nom du partage. Cliquez sur **Enregistrer l'hôte du partage** pour le mémoriser.

L'hôte du partage est aussi ce qui permet à la coquille VisionNexus de lire les images des frames directement sur le partage au lieu de les télécharger via le backend, ce qui est bien plus rapide en SSH. Quand VisionNexus lance l'application avec un hôte de partage, cette valeur est prioritaire. Les détails sont dans [Configuration](configuration.fr.md) (section *Partage natif (SMB) et réglages de chemins*).

Le badge utilisateur à côté du menu affiche l'utilisateur courant et donne accès à la liste des workspaces récents et des utilisateurs connectés sur la même instance.

## Organisation de l'espace d'annotation

L'espace d'annotation s'ouvre quand vous cliquez sur une carte de projet. Il est organisé en cinq zones :

1. **Barre d'outils du haut** : retour aux projets, nom du projet, outils d'annotation, mode de sortie, détection par texte, annuler/rétablir, zoom, **Importer**, sauvegarde, **Paramètres**, aide et **Exporter**.
2. **Barre latérale gauche** (projets Séquence Image uniquement) : l'onglet **Tracks** avec tous les outils de suivi et l'onglet **Debug** pour inspecter l'homographie. Faites glisser son bord droit pour la redimensionner (la largeur n'est pas sauvegardée).
3. **Canvas** au centre : la frame courante avec ses annotations, le bouton flottant **LUT** en haut à droite, et la barre de navigation des frames en dessous.
4. **Panneau de droite** : les onglets **Classes**, **Annots** et **Aide**. Faites glisser son bord gauche pour le redimensionner (la largeur n'est pas sauvegardée).
5. **Timeline** en bas : une cellule par frame de la séquence courante, avec les pistes au-dessus et le badge utilisateur à gauche.

Des barres de progression apparaissent entre la barre d'outils et le canvas quand une tâche de fond tourne : extraction de frames (orange), import de séquences (bleu), propagation (vert), lot texte (vert, ou jaune en pause) et SAM Auto (émeraude).

L'espace d'annotation restaure votre session quand vous revenez : la frame courante est enregistrée 1,5 seconde après chaque navigation, et la session (frame, zoom, outil et classe actifs) est sauvegardée toutes les deux minutes avec une sauvegarde JSON silencieuse de toutes les annotations sur le serveur. Au chargement des réglages, l'outil actif démarre sur l'**Outil par défaut** de la fenêtre Paramètres (**Rectangle** par défaut). Faites glisser un fichier `.ver`, un dossier de labels YOLO ou un `.json` de sauvegarde sur l'espace d'annotation pour importer ou restaurer des annotations (voir [Procédures](workflows.fr.md)).

## Barre d'outils du haut de l'espace d'annotation

La barre d'outils du haut de l'espace d'annotation regroupe les outils utilisés sur chaque frame. De gauche à droite :

- **Retour aux projets** (icône flèche) et le nom du projet.
- **Outils d'annotation** : **Sélection**, **Panorama**, **Rectangle**, **Polygone**, **SAM Point** et **SAM Auto**. L'outil actif est surligné en bleu. **SAM Auto** démarre immédiatement sur la frame courante quand on clique dessus.
- **BBox / Seg** : le mode de sortie des annotations automatiques. **BBox** crée des boîtes ; **Seg** crée des polygones (masques SAM Auto, boîtes Grounding DINO raffinées par SAM2, masques SAM3). Sa valeur de départ vient du réglage *Sortie segmentation par défaut*.
- **Annoter par texte (GD / SAM3)** (icône T) : affiche ou masque la barre de détection par texte, décrite dans sa propre section de ce guide.
- **Annuler (Ctrl+Z)** et **Rétablir (Ctrl+Y)** : 50 niveaux par frame. Après une suppression multi-frames depuis la timeline, `Ctrl+Z` annule d'abord cette suppression.
- **Dézoomer**, le pourcentage de zoom (cliquez pour réinitialiser zoom et position), **Zoomer**, et **Centrer la vue (reset zoom + pan)**.
- **Importer** : ouvre la fenêtre d'import de séquences.
- **Sauvegarde** (icône d'envoi) : télécharge une sauvegarde JSON de toutes les annotations du projet. Redéposez ce fichier sur l'espace d'annotation pour le restaurer.
- **Paramètres** (icône engrenage) et **Aide** (icône point d'interrogation) : ouvrent la fenêtre Paramètres et la fenêtre d'aide.
- **Exporter** : ouvre la fenêtre d'export du dataset.

Les raccourcis clavier des outils sont listés dans la section *Interactions du canvas et raccourcis clavier*. Les infobulles affichent les mêmes touches : `A` pour **Sélection**, `R`, `P` et `S` pour les outils de dessin, le bouton du milieu de la souris pour **Panorama** ; **SAM Auto** n'a pas de touche.

## Barre de détection par texte (Grounding DINO et SAM3)

La barre de détection par texte de l'espace d'annotation apparaît quand vous cliquez sur **Annoter par texte (GD / SAM3)** dans la barre d'outils du haut. Elle trouve les objets décrits par des mots et crée des annotations de la classe active.

Commandes :

- **GD / SAM3** : choisit le détecteur. **GD** est Grounding DINO ; **SAM3** est le modèle de concepts SAM3.1.
- **Box:** et **Txt:** : les deux seuils du détecteur choisi. Avec **GD**, ce sont les seuils boîte et texte de Grounding DINO. Avec **SAM3**, **Box:** est le score minimal conservé et **Txt:** n'est pas utilisé, il est donc masqué dans l'onglet Detect. Des valeurs basses trouvent plus d'objets et plus de faux positifs. Leurs valeurs de départ viennent de la fenêtre Paramètres.
- **Champ de prompt** : tapez des concepts séparés par des points, en minuscules et au singulier, par exemple `voiture. personne. vélo.`. Appuyez sur `Entrée` ou cliquez sur le bouton baguette pour détecter sur la frame courante.
- Bouton de **plage de frames**, affiché `[F<début>...F<fin>]` (visible quand le projet a plus d'une frame) : ouvre les champs **De F** / **à F**. Ces numéros sont des index de frame à l'échelle du projet, à partir de 0, et non les numéros à partir de 1 de la séquence courante. Par défaut, la plage va de la frame courante à la dernière frame du projet : dans un projet multi-séquences elle peut donc continuer dans les séquences suivantes. Renseignez **à F** pour rester dans une seule séquence.
- **Batch** : lance la détection sur toutes les frames de la plage. Pendant l'exécution, des boutons **Pause**, **Reprendre** et **Stop** apparaissent dans la barre et dans une barre de progression au-dessus du canvas.

Les détections sont enregistrées immédiatement comme annotations automatiques (badge **IA**, provenance Grounding DINO ou SAM3) de la classe active, en boîtes ou en polygones selon **BBox / Seg**. En **Seg**, les boîtes de Grounding DINO sont raffinées en masques par SAM2. La détection par texte exige au moins une classe et une classe active ; sinon un avertissement s'affiche et le bouton de lancement reste désactivé. La détection par texte ne crée jamais de pistes. Pour prolonger des pistes existantes avec un détecteur, utilisez plutôt l'onglet **Detect.** du panneau Tracks.

## Interactions du canvas et raccourcis clavier

Le canvas de l'espace d'annotation affiche la frame courante et ses annotations. Dessiner exige une classe active : si aucune classe n'existe ou si aucune n'est sélectionnée, un message vous demande d'en créer ou d'en sélectionner une dans l'onglet **Classes**.

Actions de la souris sur le canvas :

| Action | Effet |
|---|---|
| Molette | Zoom centré sur le curseur |
| Bouton du milieu maintenu et glissé | Déplacer la vue |
| Clic du milieu sans bouger | Ajuster l'image au canvas et la centrer |
| Glisser avec le bouton gauche (outil Panorama) | Déplacer la vue |
| Cliquer-glisser (Rectangle) | Tracer une boîte englobante (les très petites boîtes sont ignorées) |
| Clics, puis double-clic (Polygone) | Tracer un polygone ; le double-clic le ferme s'il a au moins trois points |
| Clic gauche / clic droit (SAM Point) | Ajouter un point objet / arrière-plan ; SAM2 prédit jusqu'à trois masques |
| Double-clic (SAM Point) | Accepter le meilleur masque prédit |
| Double-clic sur une boîte | La cocher ou la décocher comme cible de suivi (anneau pointillé), pour tous les onglets Tracks à la fois |
| Glisser une boîte sélectionnée (Sélection) | La déplacer ou la redimensionner avec les poignées |

Raccourcis clavier (ignorés pendant la saisie dans un champ) :

| Touche | Effet |
|---|---|
| `A` | Outil Sélection |
| `R` | Outil Rectangle |
| `P` | Outil Polygone |
| `S` | Outil SAM Point |
| `Échap` | Annule le tracé ou les points SAM, désélectionne, revient à Sélection |
| `Suppr` / `Retour arrière` | Supprime les annotations sélectionnées |
| `Ctrl+Z` / `Ctrl+Y` (ou `Ctrl+Maj+Z`) | Annuler / rétablir |
| `Ctrl+C` / `Ctrl+V` | Copier les annotations sélectionnées / les coller sur la frame courante |
| Flèche gauche / droite | Frame précédente / suivante |
| `1` à `9` | Sélectionne la classe dont le raccourci est ce chiffre (sans effet si aucune classe ne l'a) |
| `V` | Bascule l'indicateur de mode revue (sans effet visible dans la version actuelle) |

`Espace` n'a pas de fonction : le panoramique se fait avec le bouton du milieu de la souris. Les touches chiffres sélectionnent la classe qui porte ce raccourci, affiché dans l'onglet **Classes** ; une classe sans touche ne réagit pas.

## Barre de navigation des frames sous le canvas

La barre de navigation des frames se trouve sous le canvas de l'espace d'annotation quand le projet contient plus d'une frame. Elle travaille toujours à l'intérieur de la séquence courante : le curseur et les compteurs ne couvrent que les frames de cette séquence.

Commandes de la première ligne :

- **Sélecteur de séquence** : liste les séquences du projet avec leur type, leur nom, leurs frames annotées et leur nombre d'annotations. En choisir une saute à sa première frame.
- **Importer des annotations** (icône d'envoi, infobulle « Importer des annotations (.ver ou dossier YOLO) sur cette séquence ») : demande un chemin serveur vers un fichier `.ver` ou un dossier de labels YOLO et l'importe sur la séquence courante. Vous choisissez de remplacer les annotations existantes ou de les compléter.
- Flèches **précédente / suivante** et le **curseur**. Pendant que vous faites glisser le curseur, le canvas affiche des aperçus légers de 480 px ; l'image complète se charge au relâchement.
- **Compteur** `n / total` et le champ **aller à** : tapez un numéro de frame (à partir de 1, relatif à la séquence) et appuyez sur `Entrée` pour y sauter.

Commandes de la seconde ligne :

- **Retour au début** : revient à la première frame de la séquence.
- **Lecture** / **Pause** : lit la séquence.
- **FPS** de 1 à 5 : vitesse de lecture.

## Panneau LUT et affichage

Le panneau LUT de l'espace d'annotation contrôle la façon dont les valeurs de l'image sont converties en luminosité à l'écran. Il s'ouvre avec le bouton flottant **LUT** en haut à droite du canvas et sert surtout pour l'imagerie 16 bits et infrarouge.

Commandes du panneau **LUT / Affichage** :

- **Projet** / **Séquence** : la portée du réglage. **Projet** s'applique à toutes les séquences ; **Séquence** le remplace pour la séquence courante seulement (par exemple une séquence infrarouge à côté de séquences RGB). **repli projet** supprime le réglage propre à la séquence. La pseudo-séquence principale des anciens projets ne peut utiliser que la portée projet.
- **Histogramme** des valeurs brutes de la frame, avec les lignes de coupure basse (rose) et haute (orange), les valeurs minimale et maximale et la profondeur en bits.
- **Auto σ** : étire `[moyenne - Nσ, moyenne + Nσ]` sur 0-255. Le curseur **Sigma (N)** va de 0,5 à 6, défaut 3.
- **Min-Max** : étire le minimum et le maximum réels de la frame (contraste maximal).
- **Manuel** : champs et curseurs **Bas (lo)** et **Haut (hi)**.

La LUT est enregistrée dès que vous la modifiez. Elle est aussi appliquée aux images données aux modèles d'IA (SAM2, SAMURAI, Grounding DINO, SAM3, homographie, flux optique) : les modèles voient exactement ce que vous voyez, et un affichage écrasé signifie une entrée de modèle écrasée. Les fichiers sources ne sont jamais modifiés. Voir [Concepts](concepts.fr.md) pour la chaîne d'entrée.

## Onglet Classes du panneau de droite

L'onglet **Classes** du panneau de droite gère les classes d'étiquettes du projet. Chaque annotation appartient à une classe : créez-en au moins une avant de dessiner.

- **+** (**Ajouter une classe**) ouvre le formulaire de création : trois champs texte dont les textes indicatifs annoncent la classe (détection, obligatoire), la sous-classe (reconnaissance) et la sous-sous-classe (identification, active dès qu'une sous-classe est saisie), un sélecteur de couleur, puis **Créer** ou **Annuler**. Seule la classe de base est obligatoire. Une classe créée devient aussitôt la classe active.
- **Cliquez sur une classe** pour en faire la classe active (surlignée en bleu). Cliquez de nouveau pour la désélectionner. Les nouvelles annotations manuelles et IA utilisent la classe active.
- **Survolez une classe** pour faire apparaître les icônes modifier (crayon) et supprimer (corbeille). La modification ouvre les mêmes champs sur place ; validez avec la coche ou `Entrée`.

Les trois niveaux forment une hiérarchie, par exemple drone, quadcoptère, mavic. Les exports YOLO et COCO utilisent le nom complet joint par des soulignés (`drone_quadcoptere_mavic`) ; l'export `.ver` écrit les trois niveaux dans des colonnes séparées. L'icône corbeille supprime la classe immédiatement, sans confirmation, et ses annotations ne sont pas supprimées : elles gardent une référence vers la classe disparue (affichée `classe_<id>`, exportée `unknown` en `.ver`). Réaffectez ou supprimez ces annotations avant de supprimer une classe.

## Onglet Annots du panneau de droite

L'onglet **Annots** du panneau de droite liste les annotations de la frame courante et regroupe les outils de nettoyage par frame.

Chaque ligne affiche la couleur et le nom de la classe, le type (`BBox` ou `Poly`), le score de confiance (vert à partir de 0,8, jaune à partir de 0,5, rouge en dessous), un badge pour les annotations automatiques, un badge **Interp.** pour les annotations interpolées non automatiques, et un sélecteur de piste. Le badge nomme la provenance quand elle est enregistrée (SAM Point, SAM Auto, Grounding DINO, SAM3, SAMURAI, SAM2 video, Guided pour l'onglet Detect., Homog. et Flux opt. pour les boîtes propagées) ; les annotations créées par d'anciennes versions de ces outils peuvent afficher un simple badge **IA**.

Interactions :

- **Clic** sur une ligne : sélectionne l'annotation (elle est mise en évidence sur le canvas) ; **Maj+clic** sélectionne une plage ; **double-clic** zoome le canvas dessus.
- **Sélecteur de piste** : détache l'annotation de sa piste, crée une nouvelle piste (**+ nouvelle**) ou la rattache à une piste existante `#uid`.
- **Icône corbeille** (au survol) : supprime cette annotation.

Boutons de l'en-tête :

- **IA** (infobulle « Afficher annotations IA uniquement ») : masque les annotations manuelles.
- **Filtre de confiance** (icône curseurs) : curseur **Score min de confiance** et **Réinitialiser**.
- **NMS** (icône calques) : un champ IoU (défaut issu des Paramètres, 0,5) et **Appliquer NMS**, qui supprime les doublons qui se chevauchent en gardant le plus confiant.
- **Pastilles de classe** : cliquez sur l'une pour n'afficher que cette classe ; l'icône filtre efface le filtre de classe.

Quand SAM Auto a tourné, une section **SAM Auto** liste les propositions non encore validées, avec **Valider tout**, **Rejeter tout**, et des boutons valider et rejeter par proposition. Les propositions validées depuis cette liste prennent la classe active (ou la première classe) et sont enregistrées en polygones dès que le masque a un contour, quel que soit le choix **BBox / Seg** ; une proposition validée en cliquant sur son masque dans le canvas suit **BBox / Seg**. Le pied de liste affiche le nombre d'éléments sélectionnés avec **Désélectionner**, et **Tout** (supprimer toutes les annotations de la frame) avec une étape **Confirmer ?** **Oui** / **Non**.

## Onglet Aide et fenêtre d'aide

Annotation App propose deux vues d'aide intégrées au contenu identique. L'onglet **Aide** du panneau de droite est toujours à portée de main ; la fenêtre d'aide s'ouvre avec le bouton point d'interrogation de la barre d'outils du haut.

Les deux sont organisées en quatre onglets :

- **Raccourcis** : raccourcis clavier et souris regroupés par outils, édition, navigation et canvas, et timeline et pistes.
- **Modes & Fonctions** : les modes d'annotation, les modes de suivi du panneau Tracks et les fonctions principales (multi-séquence, cibles de suivi partagées, suppression de blocs, timeline compacte, NMS, export, sauvegarde automatique, LUT d'affichage, monitoring).
- **Modèles** : les modèles utilisés par l'application (SAM2 Small et Tiny, SAMURAI, Grounding DINO, SAM3, XFeat) et leur statut.
- **Workflow** : le flux recommandé pour annoter une séquence.

La fenêtre d'aide propose aussi **Lancer le tutoriel interactif**, qui crée le projet de démonstration et démarre la visite guidée. Cette aide intégrée est un aide-mémoire ; cette documentation est la référence complète.

## Panneau Tracks de la barre latérale gauche

Le panneau Tracks est l'onglet **Tracks** de la barre latérale gauche, disponible uniquement dans les projets **Séquence Image**. Il propage les annotations de la frame courante vers les frames suivantes (ou précédentes) et montre ce que font les algorithmes.

Le haut du panneau affiche **Frame courante** avec son index à l'échelle du projet (`#n`, à partir de 0, contrairement aux numéros à partir de 1 des champs de frame plus bas) et le nombre d'annotations disponibles dessus. En dessous, quatre onglets donnent quatre méthodes de propagation :

- **SAMURAI** : suivi par segmentation vidéo avec SAM2 ou SAMURAI, la méthode par défaut et la plus robuste.
- **Detect.** : Grounding DINO ou SAM3 exécuté sur chaque frame, puis apparié à vos cibles par distance de centroïde.
- **Homogr.** : propagation géométrique qui compense le mouvement de la caméra (XFeat sur GPU, SIFT sur CPU).
- **Flux opt.** : flux optique Lucas-Kanade qui suit le mouvement propre de chaque objet.

Tous les onglets partagent le même ensemble de cibles de suivi : les annotations cochées dans un onglet le sont dans tous, et un double-clic sur une boîte du canvas la bascule partout. Dans les onglets **SAMURAI**, **Homogr.** et **Flux opt.**, si aucune cible n'est cochée, toutes les annotations de la frame courante sont utilisées ; l'onglet **Detect.** exige au moins une cible cochée. Les champs de frame (**Jusqu'à la frame**, **De**, **A**) utilisent des numéros à partir de 1 dans la séquence courante, et une propagation ne sort jamais de la séquence courante. Une seule tâche tourne à la fois. Le bas du panneau affiche l'état d'exécution et bascule entre la console **Logs** et la liste **Tracks**. Chaque onglet est décrit dans sa propre section ci-après ; les algorithmes eux-mêmes sont expliqués dans [Concepts](concepts.fr.md).

### Onglet SAMURAI du panneau Tracks

L'onglet **SAMURAI** du panneau Tracks propage les annotations sélectionnées dans la séquence par segmentation vidéo SAM2. Un badge indique le moteur chargé : **SAMURAI actif (Kalman)**, **SAMURAI installé, SAM2 en cours** ou **SAM2 standard (SAMURAI absent)** ; quand SAMURAI n'est pas installé, une ligne indique **Installer SAMURAI : exécuter** `install_samurai.bat`.

Commandes :

- **Cibles à suivre** : une case par annotation de la frame courante, avec **Tout sél.** / **Tout désel.**. La boîte de chaque cible est le prompt donné au modèle.
- **Jusqu'à la frame** : la dernière frame à traiter (numérotée à partir de 1 dans la séquence). Une valeur antérieure à la frame courante propage en remontant le temps ; une étiquette **sens inverse** apparaît.
- **Frames max estimées (GPU rapide)** : une jauge qui compare le nombre de frames à traiter à la capacité VRAM estimée, avec le nom du GPU et la mémoire libre. Elle passe au rouge quand la plage dépasse la capacité : réduisez la plage, décimez à l'import, ou décochez **Mode GPU rapide** dans les Paramètres (le texte d'alerte de la jauge appelle cette option « Offload CPU » : c'est le même réglage, inversé). Quand l'offload CPU est actif (**Offload CPU actif**) ou qu'aucun GPU n'est trouvé, une courte note remplace la jauge.
- **Mode de sortie** : **BBox** ou **Segmentation** (polygones issus des masques).
- **Stratégie multi-cible** : **Auto (rapide)** utilise SAMURAI pour une cible et SAM2 multi-objets natif en une seule passe pour plusieurs cibles. **SAMURAI / objet** lance une passe SAMURAI par cible, meilleure sur les croisements et les occultations mais environ N fois plus lente ; elle exige que SAMURAI soit chargé.
- **Propager par SAMURAI** (ou **Propager par SAM2**) : lance la tâche.

Chaque cible garde sa piste si elle en a déjà une (dans les projets **Séquence Image**, chaque boîte manuelle reçoit une piste automatiquement) ; sinon une nouvelle piste est créée. **SAMURAI / objet** ne s'applique qu'à partir de deux cibles ; avec une seule cible, SAMURAI est utilisé de toute façon quand il est chargé. Pendant l'exécution, les boîtes apparaissent frame par frame sur la timeline et, quand le live temps réel est activé dans les Paramètres, sur le canvas. La barre de progression verte au-dessus du canvas et la zone d'état du panneau ont chacune un bouton d'arrêt. À la fin, frames, pistes et annotations sont rechargées une seule fois depuis la base.

### Onglet Detect. du panneau Tracks

L'onglet **Detect.** du panneau Tracks prolonge vos cibles existantes sur les frames suivantes avec un détecteur piloté par texte. Il exécute Grounding DINO ou SAM3 sur chaque frame, puis ne garde que les détections qui correspondent à une cible par distance de centroïde. Les détections qui ne correspondent à aucune cible sont écartées : les objets qui ne sont pas des cibles ne sont jamais ajoutés.

Commandes :

- **Cibles a suivre** : cases à cocher pour les annotations de la frame courante, avec **Tout sél.** / **Tout désel.**. L'onglet demande d'annoter d'abord la frame si elle est vide.
- **Plage de frames** : **De** et **A** (numérotés à partir de 1 dans la séquence). **De** commence sur la frame qui suit la frame courante.
- **Algorithme** : **GDINO** (Grounding DINO) ou **SAM3.1**. Avec SAM3.1, un choix **Mode de sortie** (**BBox** ou **Segmentation**) apparaît ; avec GDINO, la sortie est toujours en boîtes.
- **Prompt de detection** (obligatoire) : concepts séparés par des points, par exemple `voiture. personne.`.
- **Parametres avances** : **Seuil boite** et **Seuil texte**, **Dist. centroide** (distance maximale entre une cible et une détection, en fraction de l'image ; 0,15 signifie 15 %), **Var. taille max** (variation de surface tolérée entre deux frames ; 0,5 signifie plus ou moins 50 %), et **Auto-stop si objets perdus** avec **% perdu max** et **Frames consec.**.
- **Detecter + associer (N cibles)** : lance la tâche.

Avec Grounding DINO, les deux seuils s'appliquent. Avec **SAM3.1**, le seuil texte n'existe pas (son champ est masqué) et le seuil boîte est le score minimal conservé. **Var. taille max** ne rejette rien : la boîte est enregistrée et la frame est seulement notée comme anomalie dans le résultat de la tâche, que l'interface n'affiche pas. Chaque cible garde sa piste existante ou en reçoit une nouvelle. Cette tâche peut être mise en pause et reprise depuis la zone d'état. Une cible sans correspondance sur une frame laisse un trou dans sa piste. Les valeurs de départ des seuils, de la distance, de la variation de taille et de l'auto-stop viennent de la fenêtre Paramètres.

### Onglet Homogr. du panneau Tracks

L'onglet **Homogr.** du panneau Tracks propage les boîtes de la frame courante vers les frames suivantes en estimant le mouvement global de la caméra entre frames consécutives. Utilisez-le quand la caméra fait un panoramique ou un zoom sur une scène essentiellement statique. Il ne fonctionne que vers l'avant : **Jusqu'a la frame** doit être après la frame courante.

Commandes :

- **Annotations source** et **Frame source** : un résumé de ce qui sera propagé.
- **Annotations à propager** : cases à cocher, avec **Tout sél.** / **Tout désel.**.
- **Jusqu'a la frame** : la dernière frame à traiter.
- **Badge de méthode** : **XFeat GPU** quand le modèle XFeat est disponible, sinon **SIFT CPU**.
- **RANSAC** : **Inliers min.** (nombre absolu de correspondances cohérentes requis), **Ratio inliers** (proportion requise, de 0 à 1) et **Seuil reproj.** (erreur de reprojection tolérée, en pixels).
- **XFeat GPU** (XFeat seulement) : **Top-K pts** (points d'intérêt par image) et **Min cossim** (similarité minimale des descripteurs).
- **Propager par homographie** : lance la tâche.

Les boîtes propagées sont enregistrées comme annotations automatiques et interpolées avec la provenance Homog., avec une confiance égale à la confiance source multipliée par `0,6 + 0,4 x ratio d'inliers`. Elles gardent la piste de leur annotation source, s'il y en a une. Quand l'homographie d'un pas est rejetée par les seuils de qualité, les boîtes sont recopiées telles quelles sur cette frame. Seule la boîte englobante d'un polygone se déplace, l'annotation propagée est donc toujours une boîte : propagez plutôt des boîtes que des polygones. Les valeurs de départ viennent de la fenêtre Paramètres ; les champs RANSAC s'affichent pour les deux méthodes, les champs **XFeat GPU** seulement quand XFeat est disponible.

### Onglet Flux opt. du panneau Tracks

L'onglet **Flux opt.** du panneau Tracks suit chaque boîte sélectionnée individuellement par flux optique Lucas-Kanade. Utilisez-le quand la caméra est fixe et que les objets se déplacent d'eux-mêmes (véhicules, personnes).

Commandes :

- **Cibles à suivre** : cases à cocher, avec **Tout sél.** / **Tout désel.**.
- **Jusqu'à la frame** : la dernière frame à traiter.
- Paramètres **Lucas-Kanade** : **Fenêtre (px)** (fenêtre de recherche, défaut 21 ; plus grande, elle encaisse mieux les mouvements rapides mais perd en précision), **Niveaux pyra.** (défaut 3 ; chaque niveau double le déplacement gérable) et **Pts min.** (défaut 4 ; en dessous de ce nombre de points suivis, la boîte est recopiée telle quelle).
- **Suivre par flux optique** : lance la tâche.

Pour chaque boîte, l'application suit ses quatre coins et une grille 5 x 5 de points intérieurs (29 points), puis estime une transformation échelle, rotation et translation : la boîte grandit ou rétrécit quand l'objet s'approche ou s'éloigne. La note d'information de l'onglet l'indique ; elle ne compense pas la perspective, pour laquelle l'homographie est l'outil. Si l'estimation échoue, la boîte est seulement translatée du déplacement médian. Comme l'homographie, cet onglet ne fonctionne que vers l'avant, et les résultats sont enregistrés comme boîtes automatiques et interpolées avec la provenance Flux opt., en gardant la piste de leur annotation source.

### État d'exécution, Logs et liste Tracks du panneau Tracks

La partie basse du panneau Tracks suit la tâche en cours et liste les pistes de la séquence courante.

**État d'exécution** : pendant une tâche, une barre de progression avec le pourcentage et le dernier message apparaît, avec un bouton **Arrêter** (icône carré). Les tâches Detect. ont aussi **Pause** / **Reprendre**. La même tâche est affichée par la barre de progression verte au-dessus du canvas, qui a elle aussi un bouton d'arrêt.

Vue **Logs** : une console temps réel avec les mêmes lignes que le terminal du serveur. La première ligne, qui commence par `$`, résume la commande (algorithme, cibles, frames, périphérique) ; les lignes suivantes rendent compte de l'avancement. Les erreurs s'affichent en rouge. **Effacer** vide la console. Le point à côté de **Logs** pulse pendant qu'une tâche tourne.

Vue **Tracks (N)** : une ligne par piste de la séquence courante, avec sa couleur, son `#uid`, sa classe, sa plage de frames (index à l'échelle du projet, à partir de 0) et sa longueur. Un point vert signale les pistes présentes sur la frame courante. Cliquez sur une ligne pour aller à la première frame de la piste, double-cliquez pour aller à sa dernière frame, et utilisez l'icône corbeille pour supprimer la piste avec toutes ses annotations. **Tout suppr.** supprime toutes les pistes du projet mais garde les annotations, qui deviennent détachées. Pour ne supprimer qu'une partie d'une piste, utilisez les pistes de la timeline.

## Onglet Debug de la barre latérale gauche

L'onglet **Debug** de la barre latérale gauche (**Debug Homographie**) vérifie si la propagation par homographie peut fonctionner entre deux frames avant de la lancer sur toute une plage.

Choisissez deux frames (**Utiliser frame courante** remplit l'une d'elles), puis cliquez sur **Calculer homographie**. Le panneau affiche la **Methode** (XFeat ou SIFT), **Matches totaux**, **Matches filtres**, **Inliers RANSAC**, **Ratio inliers**, **Homographie valide** (**Oui** / **Non**) et une image des **Correspondances keypoints** avec les inliers en vert et les outliers en rouge (200 traits au plus). **Homographie valide** vérifie que le ratio d'inliers atteint le **Ratio inliers** de la fenêtre Paramètres (0,3 par défaut), le même seuil que la propagation ; le nombre minimal d'inliers utilisé par la propagation n'est pas contrôlé ici.

Peu d'inliers ou un ratio faible signifient que la scène manque de texture, que la caméra a trop bougé ou que la scène n'est pas plane : préférez alors SAMURAI ou le flux optique pour cette séquence.

## Timeline et pistes

La timeline en bas de l'espace d'annotation montre chaque frame de la séquence courante sous forme de cellule compacte. Elle n'a pas de vignettes, ce qui la garde rapide sur des séquences de dizaines de milliers de frames et en SSH.

Cellules de frames :

- Les cellules **vertes** sont les frames annotées et affichent leur nombre d'annotations ; les cellules **rouges** n'ont aucune annotation. Le compteur de la frame courante se met à jour en direct.
- **Clic** sur une cellule : aller à cette frame. **Ctrl+clic** ajoute ou retire une frame de la sélection, **Maj+clic** sélectionne une plage, **Ctrl+A** (pointeur au-dessus de la timeline) ou **Tout sélectionner** sélectionne toutes les frames de la séquence, et `Échap` vide la sélection.
- **Suppr** vide les annotations de toutes les frames sélectionnées en une seule requête serveur. Un message confirme le nombre de frames et `Ctrl+Z` les restaure.

Les pistes (projets Séquence Image) sont au-dessus des cellules, une ligne par piste :

- Une barre blanche marque la frame courante sur chaque piste ; le pourcentage à droite est la part de frames explorées par le tracker.
- **Clic sur un bloc coloré** : le sélectionne (il brille) et saute à sa première frame ; **double-clic** saute à sa dernière frame. `Suppr` ou **Supprimer ce bloc** retire seulement les annotations de cette piste sur ce bloc, sans confirmation.
- **Clic sur la partie grise** d'une piste : sélectionne toute la piste ; **Ctrl/Maj+clic** sélectionne plusieurs pistes. `Suppr` ou le bouton de suppression retire les pistes sélectionnées et toutes leurs annotations, après confirmation. Les numéros des pistes restantes sont renumérotés.
- La touche `Suppr` n'agit sur un bloc ou une piste sélectionnés que si le pointeur est au-dessus de la timeline ; `Échap` vide les sélections de frames, de blocs et de pistes.
- Faites glisser la poignée entre les pistes et les cellules pour agrandir ou réduire la zone des pistes.

## Fenêtre d'import de séquences

La fenêtre **Importer des séquences**, ouverte avec **Importer** dans la barre d'outils du haut, ajoute une ou plusieurs séquences au projet. Chaque emplacement rempli devient une séquence ; un nouvel emplacement vide apparaît dès qu'un emplacement est rempli, ce qui permet de mettre plusieurs sources en file d'un coup.

Le titre de la fenêtre rappelle le type du projet (**Importer des séquences** suivi de **Séquence Image** ou **Image Random**), et un encadré **Formats importables** liste les sources acceptées. Pour chaque emplacement (**SÉQ 1**, **SÉQ 2**...) :

- **Glisser-déposer** un dossier d'images (JPG, PNG, BMP, WebP, TIFF), une vidéo (`.mp4`, `.avi`, `.mov`, `.mkv`, `.webm`) ou un format spécifique pris en charge, ou utiliser **parcourir local**. Dans un navigateur web, les fichiers déposés sont envoyés, même depuis un lecteur réseau Windows. Dans la coquille VisionNexus, c'est le vrai chemin du dossier ou du fichier déposé qui est utilisé, comme si vous l'aviez tapé en chemin serveur (ni envoi, ni copie).
- **Ou taper un chemin serveur** (par exemple `/mnt/datasets/frames` ou `/data/video.mp4`), ou cliquer sur **Serveur** pour parcourir les dossiers du backend. Un chemin serveur est référencé sans copie (liens symboliques) : c'est le choix recommandé pour les gros datasets. Les chemins UNC Windows comme `\\share-host\datasets\run01` sont traduits automatiquement en chemin du backend. Une liste de séquences `.txt` (une ligne `chemin<TAB>nom` par séquence, telle qu'écrite par la sauvegarde automatique) remplit tous les emplacements d'un coup.
- **Nom séquence** : par défaut le nom du dossier ou du fichier. Il devient le nom du sous-dossier ou du fichier à l'export.

**Options d'optimisation (appliquées à chaque séquence)** :

- **Décimation des frames vidéo** : **Tout**, **1/2** à **1/5**, ou **1/N** pour garder une frame sur N.
- **Qualité JPEG frames extraites (MP4)** : de 50 à 95, défaut 85.
- **PNG sans perte pour les MP4 (ignore la qualité JPEG)** : meilleur pour XFeat et le flux optique, plus lourd sur disque.
- **Liens symboliques pour les dossiers serveur (recommandé)** : aucune copie d'image ; l'application copie automatiquement si les liens ne sont pas autorisés.
- **Frames par batch (extraction arrière-plan)** : défaut 50.

Cliquez sur **Importer N séquence(s) en fond** : la fenêtre se ferme, les imports s'enchaînent l'un après l'autre et une barre de progression bleue par séquence apparaît au-dessus du canvas pendant que vous continuez à travailler. Les sources PNG et TIFF 16 bits restent en 16 bits sur disque ; seuls leur affichage et l'entrée des modèles passent par la LUT.

## Fenêtre d'export du dataset

La fenêtre **Exporter le dataset**, ouverte avec **Exporter** dans la barre d'outils du haut, exporte tout le projet en une fois dans un dossier nommé `<projet>_<date>_<heure>` : chaque séquence va dans son propre sous-dossier ou fichier, nommé d'après la séquence. Un projet à une seule séquence est exporté à plat en YOLO et en COCO (sans sous-dossier par séquence).

- **Format de sortie** :
  - **YOLO** : un dossier `<séquence>-yolo/` par séquence annotée, avec `images/`, `labels/` et `data.yaml`, découpé en train, val et test. Quand des polygones existent, une variante YOLO segmentation (`seg_labels/`, `seg_data.yaml`) est écrite en plus.
  - **COCO JSON** : `images/` plus `annotations/instances_{train,val,test}.json`, boîtes en pixels, `category_id` à partir de 1, polygones en `segmentation`.
  - **.ver** : un fichier texte `<séquence>.ver` par séquence annotée, coordonnées en pixels, frames numérotées à partir de 1, avec l'identifiant de piste et les trois niveaux de classe.
- Curseurs **Train** et **Validation** (YOLO et COCO seulement), défaut 80 % et 10 % ; le reste va en test. Une barre colorée résume le découpage et un avertissement apparaît quand une partie est vide.
- **Liens symboliques pour les images** : coché, le dossier du dataset pointe vers les images d'origine et aucun ZIP n'est produit (à utiliser sur le même serveur) ; décoché, les images sont copiées et un ZIP est généré.
- **Dossier de destination** (mode autonome seulement) : laissez vide pour utiliser le dossier `exports/` du workspace. Quand l'application est lancée par l'Orchestrator, ce champ est remplacé par une note : l'export est enregistré automatiquement dans le dossier `exports/` du workspace, dont le chemin est affiché.

Cliquez sur **Exporter**. Une vue de progression suit la tâche ; à la fin, **Export terminé !** affiche le chemin du dataset (mode liens symboliques) ou un bouton **Télécharger ZIP** (mode copie), ainsi que **Nouvel export** et **Fermer**. Pour **.ver** en mode copie, le ZIP des fichiers `.ver` est proposé aussi. Les formats sont détaillés dans [Concepts](concepts.fr.md) et la procédure complète dans [Procédures](workflows.fr.md).

## Fenêtre Paramètres

La fenêtre **Paramètres** s'ouvre depuis le bouton engrenage de l'espace d'annotation ou depuis **Paramètres** sur la page des projets. Les réglages sont stockés par utilisateur dans le workspace et s'appliquent à tous les projets.

Elle comporte des sections repliables :

- **Interface** : couleur de fond du canvas, outil par défaut, opacité des annotations, affichage des étiquettes et de la confiance, épaisseur des bordures, réduction des aperçus, live temps réel pendant la propagation et cadence du canvas.
- **Import** : qualité JPEG, taille des chunks d'envoi, décimation des frames et taille des lots d'images.
- **Algorithmes** : NMS, Grounding DINO, SAM2 Auto, homographie, flux optique, SAM3, appariement Detect., mode mémoire de SAMURAI et SAM2 vidéo, auto-stop global.
- **Stockage workspace** : la taille disque des projets, des sauvegardes JSON et des exports, avec des boutons **Vider ce dossier** pour les sauvegardes et les exports, et **Actualiser**.
- **Export YOLO** : ratios par défaut, inclusion des frames non annotées, liens symboliques.

Les sections **Interface** et **Import** sont ouvertes à l'ouverture de la fenêtre ; cliquez sur le titre d'une section pour la plier ou la déplier. Boutons du bas : **Réinitialiser** écrit aussitôt toutes les valeurs par défaut dans le fichier de réglages (sans passer par **Sauvegarder**), **Fermer** abandonne les modifications non enregistrées, **Sauvegarder** (actif dès qu'une valeur a changé) enregistre les réglages, affiche **Sauvegardé !** et recharge la page pour que toutes les options prennent effet. Chaque option, sa valeur par défaut et son effet sont listés dans [Configuration](configuration.fr.md).

## Page Monitoring

La page Monitoring, ouverte avec **Monitoring** sur la page des projets, mesure quelle part du travail d'annotation a été faite automatiquement et combien les personnes ont dû corriger.

Commandes de l'en-tête :

- **Moi** / **Tous les utilisateurs** : votre workspace seulement, ou tous les workspaces d'annotation sous la même racine de workspaces.
- **Detail** / **Global** : par projet et par séquence, ou un résumé par utilisateur et par racine de workspace.
- Sélecteur **Tous les projets** : limite la vue détaillée à un projet.
- **Exporter HTML** : télécharge un rapport autonome qui s'ouvre hors ligne.
- **Rafraichir**.

La page affiche des chiffres clés (utilisateurs, racines de workspace, annotations, automatiques, manuelles, séquences exportées), la part de chaque utilisateur dans toutes les annotations et dans les annotations manuelles, et par projet : **Auto**, **Manuel**, **Auto retouchees**, **Auto supprimees**, **Frames reprises 2 fois+**, la répartition par provenance (SAMURAI, Grounding DINO, manuel...), le devenir des sorties automatiques (**Conservees**, **Retouchees**, **Supprimees**), la liste des séquences avec une coche verte quand elles sont exportées, la reprise humaine par dataset et la liste des runs automatiques.

Retouches et suppressions sont comptées à partir d'un journal d'événements qui démarre à la première activation du monitoring ; les annotations qui existaient avant comptent comme conservées. Une séquence annotée mais jamais exportée n'est pas considérée comme terminée.

## Page Convert

La page Convert, ouverte avec **Convert** sur la page des projets, convertit des fichiers d'annotation entre le format `.ver` et YOLO sans créer de projet. Tous les chemins sont des chemins serveur.

Deux convertisseurs sont disponibles :

- **.ver vers YOLO** : convertit un fichier `.ver` (coordonnées en pixels) en dossier YOLO normalisé. Remplissez **Chemin du fichier .ver**, **Dossier YOLO de sortie** et la résolution de l'image (largeur et hauteur en pixels, nécessaires pour normaliser), puis cliquez sur **Convertir**. Le message de résultat donne le nombre de classes écrites.
- **YOLO vers .ver** : convertit un dossier de labels YOLO en fichier `.ver`. Remplissez **Dossier YOLO (.txt)**, **Fichier .ver de sortie** et la résolution de l'image (nécessaire pour revenir en pixels), puis cliquez sur **Convertir**. YOLO n'a ni sous-classe ni piste : la classe est répétée dans les trois colonnes de classe et `track_id` vaut `-1`. Le message de résultat donne le nombre de boîtes écrites.

Une erreur s'affiche quand un chemin obligatoire manque ou quand le fichier de sortie existe déjà.

## Page Présentation (documentation intégrée)

La page Présentation, ouverte avec **Présentation** sur la page des projets, affiche cette documentation dans Annotation App, sous le titre **Documentation intégrée**. Elle lit les pages depuis le backend (`/api/docs`) : elle fonctionne hors ligne et correspond toujours à la version installée.

La colonne de gauche range les pages en trois groupes : **Utilisateur** (présentation, guide utilisateur, procédures, concepts), **Installation et reglages** (configuration, dépannage) et **Developpeur** (architecture, référence API, carte du code). Cliquez sur une page pour l'ouvrir ; les titres de la page ouverte sont listés sous son nom et font défiler la page jusqu'à la section cliquée. Les liens entre pages ouvrent directement la page et la section visées, et l'adresse de la page (`/presentation?doc=<page>#h-<n>`) peut être gardée en favori.

La page suit la langue de l'interface. Quand une page n'existe pas dans cette langue, l'autre version s'affiche avec un avertissement. Si le backend ne répond pas, la page l'indique : démarrez le backend puis rechargez. **Retour aux projets** revient à la page des projets.

## Tutoriel interactif

Le tutoriel interactif est une visite guidée d'Annotation App qui se déroule sur des données réelles. Lancez-le avec **Tutoriel interactif** sur la page des projets (le bouton brille tant que vous ne l'avez jamais lancé) ou avec **Lancer le tutoriel interactif** dans la fenêtre d'aide.

La visite crée un projet de démonstration, **Template Cars Annotation**, à partir des dix images d'exemple livrées avec la suite (`data_tuto/` à la racine de la suite), puis déroule le workflow complet en une dizaine de minutes : création du projet, import, création d'une classe, tracé d'une boîte, propagation SAMURAI, nettoyage sur la timeline, suivi de deux cibles en segmentation, l'onglet **Detect.**, la LUT, l'export et les paramètres. Une seconde partie crée **Template Traffic Lights**, un projet **Image Random** annoté uniquement par détection texte en lot, puis visite les pages Monitoring et Présentation.

Chaque étape met en évidence la commande à utiliser et attend votre action. Les projets de démonstration portent la mention **Démo tutoriel** sur la page des projets et se suppriment comme n'importe quel autre projet. Le fait d'avoir déjà lancé ou terminé le tutoriel est mémorisé par VisionNexus pour votre utilisateur.
