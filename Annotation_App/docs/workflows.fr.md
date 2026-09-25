---
app: annotation
doc_type: workflows
audience: user
lang: fr
title: Procédures
order: 20
tags: [import, samurai, grounding dino, propagation, export, sauvegarde, orchestrator]
sources: [Annotation_App/frontend/src/pages/AnnotationPage.tsx, Annotation_App/frontend/src/components/modals/ImportModal.tsx, Annotation_App/frontend/src/components/modals/ExportModal.tsx, Annotation_App/frontend/src/components/sidebar/TrackPanel.tsx, Annotation_App/frontend/src/components/timeline/Timeline.tsx, Annotation_App/backend/models/routers/orchestrator.py, Annotation_App/backend/models/routers/projects.py, Annotation_App/backend/utils/native_share.py]
---

# Procédures

## Créer un projet et importer des images ou une vidéo locales

Cette procédure crée un projet Annotation App et le remplit avec des images ou une vidéo stockées sur votre propre ordinateur, envoyées par le navigateur.

*Prérequis* : Annotation App est ouverte sur la page des projets.

1. Cliquez sur **Nouveau projet**, saisissez un **Nom du projet** et choisissez le **Type** : **Séquence Image** pour une vidéo ou un dossier d'images ordonné (outils de suivi disponibles), **Image Random** pour des images sans lien entre elles. Cliquez sur **Créer**.
2. Cliquez sur la carte du nouveau projet pour ouvrir l'espace d'annotation. Le canvas affiche « Aucune frame disponible ».
3. Cliquez sur **Importer** dans la barre d'outils du haut (ou sur le lien sous le canvas vide).
4. Faites glisser un dossier d'images ou un fichier vidéo (`.mp4`, `.avi`, `.mov`, `.mkv`, `.webm`) sur l'emplacement **SÉQ 1**, ou cliquez sur **parcourir local** et choisissez les fichiers. Un second emplacement vide apparaît : remplissez-le pour ajouter une autre séquence dans le même lot.
5. Modifiez éventuellement **Nom séquence** ; il devient le nom du dossier ou du fichier à l'export.
6. Pour une vidéo, ouvrez **Options d'optimisation (appliquées à chaque séquence)** et réglez **Décimation des frames vidéo** (par exemple **1/3** pour une vidéo à 30 fps aux frames redondantes) et **Qualité JPEG frames extraites (MP4)**. Cochez **PNG sans perte pour les MP4 (ignore la qualité JPEG)** si vous prévoyez d'utiliser l'homographie ou le flux optique.
7. Cliquez sur **Importer N séquence(s) en fond**. La fenêtre se ferme et une barre de progression bleue par séquence apparaît au-dessus du canvas ; pour les vidéos, une barre d'extraction orange suit.
8. Commencez à annoter dès que les premières frames apparaissent ; la timeline se remplit au fur et à mesure de l'import.

*Résultat* : le projet contient une séquence par source importée, listée dans le sélecteur de séquence sous le canvas et sur la carte du projet. Les images envoyées gardent leur format d'origine ; les frames vidéo sont extraites en JPEG (ou PNG) dans le dossier du projet du workspace. Dans la coquille VisionNexus, un dossier déposé est référencé par son vrai chemin au lieu d'être envoyé, comme dans la procédure suivante.

## Importer une séquence depuis un dossier serveur ou un partage SMB/UNC

Cette procédure référence des images qui se trouvent déjà sur la machine du backend ou sur un partage réseau, sans les copier. C'est la façon recommandée d'importer de gros datasets, surtout quand le backend tourne sur une VM distante.

*Prérequis* : un projet est ouvert dans l'espace d'annotation ; les images sont accessibles depuis le backend (disque local, partage monté sous `/srv`, `/mnt`, `/data`, `/home` ou `/media`) ; pour les chemins UNC, l'hôte du partage est enregistré dans le menu **Workspace** ou fourni par VisionNexus.

1. Cliquez sur **Importer** dans la barre d'outils du haut.
2. Dans le champ de chemin de **SÉQ 1**, tapez le chemin serveur d'un dossier d'images ou d'une vidéo, par exemple `/srv/datasets/run01` ou `/data/video.mp4`. Vous pouvez aussi coller un chemin Windows comme `\\share-host\datasets\run01` : il est traduit automatiquement vers le chemin correspondant du backend (`/srv/datasets/run01`, `/mnt/datasets/run01`...).
3. Sinon, cliquez sur **Serveur** pour parcourir les dossiers du backend, sélectionnez un dossier ou une vidéo, puis cliquez sur **Choisir ce dossier** ou **Sélectionner**. Les dossiers récemment visités sont mémorisés.
4. Pour importer de nombreuses séquences d'un coup, tapez plutôt le chemin d'une liste `.txt` (une ligne `chemin<TAB>nom` par séquence) : tous les emplacements sont remplis d'un coup.
5. Vérifiez que **Liens symboliques pour les dossiers serveur (recommandé)** est coché dans **Options d'optimisation (appliquées à chaque séquence)**.
6. Ajustez **Nom séquence** si besoin, puis cliquez sur **Importer N séquence(s) en fond**.

*Résultat* : les dossiers d'images sont référencés par liens symboliques (zéro copie, disponibles presque immédiatement, insérés par lots) ; les vidéos serveur sont extraites en tâche de fond. Si le chemin n'existe pas sur le backend, l'import échoue avec une erreur « Dossier introuvable » ; voir [Dépannage](troubleshooting.fr.md).

## Annoter manuellement avec des boîtes et des polygones

Cette procédure trace des annotations à la main dans l'espace d'annotation, la base de tout type de projet.

*Prérequis* : un projet contenant au moins une frame importée est ouvert.

1. Ouvrez l'onglet **Classes** du panneau de droite, cliquez sur **+**, tapez le nom de la classe (sous-classe et sous-sous-classe sont facultatives), choisissez une couleur et cliquez sur **Créer**. Répétez pour chaque classe.
2. Cliquez sur la classe à dessiner pour en faire la classe active (surlignée en bleu).
3. Appuyez sur `R` (ou cliquez sur **Rectangle**) et faites glisser sur le canvas pour tracer une boîte. Relâchez pour l'enregistrer.
4. Pour un contour précis, appuyez sur `P` (ou cliquez sur **Polygone**), cliquez chaque sommet, puis double-cliquez pour fermer le polygone (au moins trois points).
5. Appuyez sur `A` pour passer en **Sélection** : cliquez sur une annotation pour la sélectionner, faites-la glisser ou tirez ses poignées pour l'ajuster, appuyez sur `Suppr` pour la retirer. Utilisez `Ctrl+Z` / `Ctrl+Y` pour annuler ou rétablir.
6. Utilisez `Ctrl+C` sur des annotations sélectionnées et `Ctrl+V` sur une autre frame pour les copier d'une frame à l'autre.
7. Passez à la frame suivante avec la flèche droite ou le curseur, et recommencez.

*Résultat* : les annotations sont enregistrées immédiatement dans la base en coordonnées normalisées, comme annotations manuelles avec une confiance de 1,0. Dans un projet **Séquence Image**, chacune est aussi rattachée automatiquement à une piste (le plus petit numéro de piste libre sur la frame). La cellule de timeline de chaque frame annotée devient verte avec son nombre d'annotations.

## Annoter avec des points SAM

Cette procédure utilise SAM2 pour transformer quelques clics en un masque précis, enregistré en boîte ou en polygone.

*Prérequis* : un projet est ouvert, une classe est active, et le checkpoint SAM2 est installé (voir [Configuration](configuration.fr.md)).

1. Choisissez la sortie dans la barre d'outils : **BBox** pour une boîte, **Seg** pour un polygone.
2. Appuyez sur `S` (ou cliquez sur **SAM Point**).
3. Clic gauche sur l'objet : SAM2 prédit jusqu'à trois masques candidats et les affiche sur le canvas.
4. Si le masque déborde sur le fond, faites un clic droit sur la zone fautive pour ajouter un point d'arrière-plan ; ajoutez des points objet par clic gauche là où l'objet manque. Les masques sont recalculés après chaque point.
5. Double-cliquez pour accepter le meilleur masque. Il est enregistré comme annotation automatique de la classe active, avec le score du masque comme confiance.
6. Appuyez sur `Échap` à tout moment pour abandonner les points et recommencer.

*Résultat* : une annotation par masque accepté, marquée du badge **SAM Point** dans l'onglet **Annots** (aucune piste n'est rattachée). Si rien ne se passe après un clic, SAM2 n'est pas chargé : voir [Dépannage](troubleshooting.fr.md).

## Segmenter automatiquement une frame avec SAM Auto

Cette procédure segmente tout ce qui se trouve sur la frame courante sans aucun prompt, puis vous laisse ne garder que les masques utiles.

*Prérequis* : un projet est ouvert, le checkpoint SAM2 est installé, et une classe est active pour la validation.

1. Choisissez **BBox** ou **Seg** dans la barre d'outils.
2. Cliquez sur **SAM Auto**. Une barre émeraude affiche la connexion, puis le nombre de masques reçus au fil de l'eau.
3. Ouvrez l'onglet **Annots**. La section **SAM Auto** liste les propositions non encore validées.
4. Validez les propositions utiles une par une, ou cliquez sur **Valider tout** ; rejetez les autres une par une ou avec **Rejeter tout**. Cliquer sur le masque d'une proposition dans le canvas la valide aussi. Les propositions validées depuis la liste sont enregistrées en polygones quand le masque a un contour, même en mode **BBox** ; les clics dans le canvas suivent **BBox / Seg**.
5. Ouvrez le panneau **NMS** de l'onglet **Annots**, gardez un IoU autour de 0,5 et cliquez sur **Appliquer NMS** pour supprimer les doublons qui se chevauchent.

*Résultat* : les propositions validées deviennent des annotations de la classe active avec la provenance SAM Auto. SAM Auto donne le meilleur de lui-même sur des images denses pour démarrer vite ; pour des types d'objets précis, la détection par texte est généralement plus directe.

## Annoter automatiquement avec un prompt texte (Grounding DINO ou SAM3)

Cette procédure détecte chaque objet correspondant à une description textuelle, sur une frame ou sur une plage de frames, dans tout type de projet.

*Prérequis* : un projet est ouvert, au moins une classe existe et est active, et Grounding DINO ou SAM3 est installé.

1. Cliquez sur **Annoter par texte (GD / SAM3)** (icône T) dans la barre d'outils du haut.
2. Choisissez **GD** (Grounding DINO) ou **SAM3**, et **BBox** ou **Seg** pour la sortie.
3. Tapez le prompt sous forme de concepts en minuscules et au singulier, séparés par des points, par exemple `voiture. camion.`. Évitez les phrases complètes.
4. Appuyez sur `Entrée` pour détecter sur la frame courante et vérifiez le résultat sur le canvas. En cas de trop nombreux faux positifs, montez **Box:** ; si des objets manquent, baissez-le.
5. Pour traiter de nombreuses frames, cliquez sur le bouton de plage, réglez **De F** et **à F**, puis cliquez sur **Batch**. Ces champs prennent des index de frame à l'échelle du projet, à partir de 0, et la fin par défaut est la dernière frame du projet : dans un projet multi-séquences, réglez **à F** pour rester dans la séquence courante. Utilisez **Pause**, **Reprendre** ou **Stop** si besoin ; gardez la page ouverte, car le lot est piloté par l'interface.
6. Relisez le résultat dans l'onglet **Annots** et sur la timeline ; utilisez **Appliquer NMS** ou le filtre de confiance pour nettoyer.

*Résultat* : les détections sont enregistrées comme annotations automatiques de la classe active (une classe par passage : relancez le prompt avec une autre classe active pour d'autres types d'objets). La détection par texte ne crée pas de pistes ; pour relier des détections en pistes sur une vidéo, utilisez la procédure Detect. de cette page.

## Suivre un objet dans une séquence avec SAMURAI

Cette procédure annote un objet sur une frame et laisse SAMURAI le suivre dans la vidéo. C'est la façon recommandée d'annoter une cible en mouvement, même avec des occultations partielles.

*Prérequis* : un projet **Séquence Image** avec une séquence importée, une classe active, et le checkpoint SAM2 installé (SAMURAI est inclus).

1. Placez-vous sur une frame où l'objet est entièrement visible et tracez une boîte bien ajustée autour (`R`). Une boîte trop large rend la cible ambiguë pour tout le passage.
2. Ouvrez l'onglet **Tracks** de la barre latérale gauche, puis l'onglet **SAMURAI**. Vérifiez que le badge indique **SAMURAI actif (Kalman)**.
3. Dans **Cibles à suivre**, cochez la boîte (ou double-cliquez dessus dans le canvas).
4. Réglez **Jusqu'à la frame** sur la dernière frame à traiter. Une valeur antérieure à la frame courante suit en remontant le temps.
5. Regardez la jauge **Frames max estimées (GPU rapide)**. Si elle est rouge, réduisez la plage ou décochez **Mode GPU rapide** dans les Paramètres.
6. Choisissez **BBox** ou **Segmentation** dans **Mode de sortie**, gardez **Auto (rapide)**, et cliquez sur **Propager par SAMURAI**.
7. Regardez les boîtes apparaître sur la timeline et, avec le live temps réel activé, sur le canvas. Arrêtez à tout moment avec le bouton d'arrêt de la barre de progression verte.
8. Quand l'objet est perdu, allez à la première frame fautive, corrigez ou retracez la boîte, et relancez la propagation depuis cette frame.

*Résultat* : l'objet a une piste avec un `#uid`, visible comme une ligne au-dessus de la timeline, et une annotation par frame traitée avec la provenance SAMURAI.

## Suivre plusieurs objets avec SAM2 multi-objets ou SAMURAI par objet

Cette procédure propage plusieurs cibles à la fois dans un projet **Séquence Image**.

*Prérequis* : la frame de référence contient une boîte par objet à suivre ; SAM2 est installé.

1. Sur la frame de référence, tracez une boîte par objet, chacune avec sa classe.
2. Double-cliquez sur chaque boîte dans le canvas pour la marquer comme cible (un anneau pointillé apparaît), ou cochez-les dans **Cibles à suivre** de l'onglet **SAMURAI**.
3. Réglez **Jusqu'à la frame** et **Mode de sortie**.
4. Dans **Stratégie multi-cible**, choisissez :
   - **Auto (rapide)** pour une seule passe de suivi SAM2 multi-objets natif, rapide mais sans modèle de mouvement ;
   - **SAMURAI / objet** pour une passe SAMURAI par cible, meilleure quand des objets semblables se croisent ou se masquent, mais environ N fois plus lente.
5. Cliquez sur **Propager par SAMURAI** (ou **Propager par SAM2**).
6. Relisez chaque piste sur la timeline. Si deux objets ont échangé leur identité après un croisement, supprimez les blocs erronés et relancez depuis la frame où ils se séparent.

*Résultat* : une piste par cible. Les annotations portent la provenance SAM2 vidéo (Auto avec plusieurs cibles) ou SAMURAI (une cible, ou mode par objet).

## Propager des boîtes par homographie (XFeat ou SIFT)

Cette procédure transporte les boîtes d'une frame clé vers les frames suivantes en compensant le mouvement de la caméra. Elle convient à une caméra qui fait un panoramique ou un zoom sur des objets qui ne bougent pas d'eux-mêmes.

*Prérequis* : un projet **Séquence Image** ; la frame courante porte les boîtes à propager.

1. Vérifiez éventuellement la scène dans l'onglet **Debug** : choisissez la frame courante et une frame ultérieure, cliquez sur **Calculer homographie**, et vérifiez que **Homographie valide** vaut **Oui** avec un bon **Ratio inliers**.
2. Ouvrez **Tracks**, puis **Homogr.**. Le badge affiche **XFeat GPU** ou **SIFT CPU**.
3. Cochez les boîtes dans **Annotations à propager** (aucune cochée signifie toutes les boîtes de la frame) et réglez **Jusqu'a la frame**, qui doit être après la frame courante : l'homographie ne propage que vers l'avant.
4. Gardez d'abord les valeurs **RANSAC** par défaut. Montez **Inliers min.** si les boîtes dérivent ; baissez légèrement **Ratio inliers** si trop de frames sont rejetées.
5. Cliquez sur **Propager par homographie** et suivez l'avancement dans la vue **Logs** (points d'intérêt, correspondances, inliers et ratio par frame).

*Résultat* : chaque frame de la plage reçoit les boîtes transformées, marquées automatiques et interpolées, avec une confiance abaissée quand le ratio d'inliers est faible. Là où l'homographie est rejetée, les boîtes sont recopiées telles quelles : vérifiez sur la timeline les boîtes figées.

## Suivre des objets mobiles par flux optique

Cette procédure suit chaque boîte individuellement par flux optique Lucas-Kanade, pour des objets qui se déplacent devant une caméra fixe ou lente.

*Prérequis* : un projet **Séquence Image** ; la frame courante porte les boîtes à suivre, sur des objets texturés.

1. Ouvrez **Tracks**, puis **Flux opt.**.
2. Cochez les cibles dans **Cibles à suivre** (aucune cochée signifie toutes les boîtes de la frame) et réglez **Jusqu'à la frame**, après la frame courante.
3. Gardez **Fenêtre (px)** à 21, **Niveaux pyra.** à 3 et **Pts min.** à 4 pour un premier passage. Pour des mouvements rapides, montez **Niveaux pyra.** ; pour une vidéo compressée, montez **Fenêtre (px)** entre 25 et 31.
4. Cliquez sur **Suivre par flux optique**.
5. Relisez les boîtes : quand une boîte cesse de bouger, l'objet a perdu ses points suivables (surface uniforme, reflet, changement d'éclairage). Retracez-la et relancez depuis cette frame, ou passez à SAMURAI.

*Résultat* : chaque cible a une boîte sur chaque frame traitée, redimensionnée quand l'objet s'approche ou s'éloigne, enregistrée comme annotation automatique interpolée.

## Prolonger des pistes existantes avec Detect.

Cette procédure prolonge des cibles sur les frames suivantes avec Grounding DINO ou SAM3, en ne gardant que les détections proches de chaque cible.

*Prérequis* : un projet **Séquence Image** ; la frame de référence porte les cibles ; Grounding DINO ou SAM3 est installé ; les objets peuvent être nommés par des mots.

1. Ouvrez **Tracks**, puis **Detect.**.
2. Cochez les cibles dans **Cibles a suivre** et réglez **Plage de frames** (**De**, **A**).
3. Choisissez **GDINO** ou **SAM3.1** dans **Algorithme**, et pour SAM3.1 le **Mode de sortie**.
4. Tapez le **Prompt de detection**, par exemple `voiture. camion.`.
5. Ouvrez **Parametres avances** si besoin : montez **Dist. centroide** pour des objets rapides, baissez-la quand les cibles sont proches les unes des autres ; activez **Auto-stop si objets perdus** pour les longues plages.
6. Cliquez sur **Detecter + associer (N cibles)**. Mettez en pause ou arrêtez depuis la zone d'état si besoin.

*Résultat* : chaque cible est prolongée sur les frames où une détection se trouve à moins de la distance de centroïde de sa position précédente, dans sa piste existante ou dans une nouvelle piste. Les frames sans correspondance laissent un trou dans la piste ; les détections non appariées sont écartées. Avec **SAM3.1**, le seuil de boîte des **Parametres avances** est le score minimal conservé et il n'y a pas de seuil texte.

## Relire et corriger les pistes sur la timeline

Cette procédure nettoie le résultat d'une propagation avec la timeline et ses pistes, en bas de l'espace d'annotation.

*Prérequis* : un projet **Séquence Image** avec au moins une piste.

1. Parcourez les cellules de frames : les cellules vertes sont annotées, les rouges sont vides. Des trous au milieu d'une séquence signalent souvent une cible perdue.
2. Parcourez les pistes : chaque bloc coloré est un tronçon où l'objet a été suivi. Cliquez sur un bloc pour sauter à sa première frame ; double-cliquez pour sauter à sa dernière frame.
3. Pour retirer un tronçon erroné, cliquez sur son bloc (il brille) et appuyez sur `Suppr`, ou cliquez sur **Supprimer ce bloc**. Seules les annotations de cette piste sur ce tronçon sont retirées.
4. Pour retirer une piste entière, cliquez sur la partie grise de sa ligne (ou sur plusieurs avec `Ctrl+clic`), appuyez sur `Suppr` et confirmez. La piste et toutes ses annotations sont supprimées et les pistes restantes sont renumérotées.
5. Pour vider complètement certaines frames, sélectionnez leurs cellules (`Ctrl+clic`, `Maj+clic`, ou `Ctrl+A` au-dessus de la timeline) et appuyez sur `Suppr`. `Ctrl+Z` les restaure.
6. Pour corriger une frame isolée, allez-y, corrigez la boîte dans le canvas, et rattachez-la à la bonne piste avec le sélecteur de piste de l'onglet **Annots** si besoin.
7. Relancez une propagation depuis la frame corrigée pour régénérer les frames suivantes.

*Résultat* : les pistes sont continues et correctement identifiées, prêtes pour l'export.

## Régler la LUT d'affichage pour des images 16 bits ou infrarouges

Cette procédure règle le contraste des séquences 16 bits ou infrarouges pour que vous et les modèles voyiez des images exploitables.

*Prérequis* : un projet avec des frames PNG ou TIFF 16 bits (ou toute frame au contraste médiocre).

1. Cliquez sur le bouton flottant **LUT** en haut à droite du canvas.
2. Choisissez la portée : **Projet** pour toutes les séquences, ou **Séquence** pour la séquence courante seulement (utile quand des séquences infrarouges et RGB partagent un projet).
3. Essayez d'abord **Auto σ** et déplacez **Sigma (N)** : des valeurs basses augmentent le contraste, des valeurs hautes conservent davantage les valeurs extrêmes.
4. Si besoin, passez en **Min-Max** pour un contraste maximal, ou en **Manuel** et réglez **Bas (lo)** et **Haut (hi)** en regardant l'histogramme.
5. Fermez le panneau. Le réglage est enregistré immédiatement. Utilisez **repli projet** pour supprimer un réglage propre à la séquence.

*Résultat* : l'affichage, les aperçus et l'entrée de chaque modèle utilisent la nouvelle correspondance. Lancez détections et propagations après avoir réglé la LUT, car les modèles voient exactement l'image affichée.

## Exporter le dataset en YOLO, COCO ou .ver

Cette procédure exporte toutes les séquences d'un projet en une seule opération.

*Prérequis* : le projet contient des annotations ; les classes sont définies.

1. Cliquez sur **Exporter** dans la barre d'outils du haut.
2. Choisissez le **Format de sortie** : **YOLO** pour l'entraînement Ultralytics (détection, plus segmentation quand des polygones existent), **COCO JSON** pour les outils compatibles COCO, **.ver** pour le format texte natif avec identifiants de piste.
3. Pour YOLO et COCO, réglez les curseurs **Train** et **Validation** ; le reste va en test.
4. Gardez **Liens symboliques pour les images** coché pour créer un dossier de dataset sur le serveur sans copier les images (l'option la plus rapide, utilisée par Training App sur la même machine). Décochez-le pour copier les images et obtenir un ZIP à télécharger.
5. En mode autonome, saisissez éventuellement un **Dossier de destination** ; laissez-le vide pour utiliser `exports/` dans le workspace.
6. Cliquez sur **Exporter** et attendez **Export terminé !**.
7. Copiez le chemin du dataset affiché, ou cliquez sur **Télécharger ZIP** en mode copie.

*Résultat* : un dossier d'export `<projet>_<date>_<heure>` qui contient un dossier `<séquence>-yolo/` ou `<séquence>-coco/`, ou un fichier `<séquence>.ver`, par séquence annotée (un projet à une seule séquence est exporté à plat en YOLO et en COCO). Chaque séquence exportée est marquée comme exportée sur la page Monitoring.

## Importer des annotations existantes (.ver ou YOLO) sur une séquence

Cette procédure charge des annotations produites ailleurs sur une séquence importée.

*Prérequis* : la séquence est importée et ses frames correspondent au fichier d'annotations. Un fichier `.ver` est apparié par ses numéros de frame (à partir de 1) ; les fichiers de labels YOLO sont appariés par nom de fichier (sans extension), sinon par ordre. Les classes et pistes manquantes sont créées automatiquement.

1. Sélectionnez la séquence dans le sélecteur de séquence sous le canvas.
2. Cliquez sur l'icône **Importer des annotations** à côté du sélecteur.
3. Tapez le chemin serveur d'un fichier `.ver` ou d'un dossier de labels YOLO (fichiers `.txt`).
4. Répondez à la confirmation : **OK** remplace les annotations existantes de la séquence, **Annuler** les complète.
5. Sinon, faites glisser le fichier `.ver` ou le dossier YOLO directement sur l'espace d'annotation : il est importé sur la séquence courante.

*Résultat* : un message indique le nombre d'annotations importées et le nombre de frames couvertes. Les annotations importées ont la provenance « imported ».

## Sauvegarder et restaurer les annotations

Cette procédure protège les annotations contre les erreurs et reconstruit un projet perdu.

*Prérequis* : un projet est ouvert.

1. Rien à faire pour la sauvegarde automatique : toutes les deux minutes, l'application écrit `backup/p<id>_<nom>/p<id>_<nom>.json` dans le workspace, plus `p<id>_<nom>_sequences.txt` qui liste le chemin source et le nom de chaque séquence. Le fichier est écrasé à chaque fois.
2. Pour une copie manuelle, cliquez sur le bouton de sauvegarde (icône d'envoi) dans la barre d'outils du haut : un fichier JSON est téléchargé.
3. Pour restaurer dans le même projet, faites glisser le fichier JSON sur l'espace d'annotation.
4. Pour reconstruire un projet supprimé : créez un nouveau projet du même type, ouvrez **Importer**, tapez le chemin du fichier `_sequences.txt` dans le premier emplacement (toutes les séquences sont remplies avec leurs noms), importez, puis faites glisser le JSON de sauvegarde sur l'espace d'annotation.

*Résultat* : les annotations sont restaurées séquence par séquence, appariées par nom de séquence et position de frame, même si les identifiants en base ont changé. Les références à des pistes qui n'existent plus sont abandonnées.

## Convertir entre .ver et YOLO sans projet

Cette procédure convertit des fichiers d'annotation sur le serveur avec la page Convert, sans importer d'image.

*Prérequis* : le fichier ou dossier source est sur la machine du backend ; vous connaissez la résolution des images.

1. Sur la page des projets, cliquez sur **Convert**.
2. Pour `.ver` vers YOLO : remplissez **Chemin du fichier .ver**, **Dossier YOLO de sortie**, et la largeur et la hauteur des images, puis cliquez sur **Convertir**.
3. Pour YOLO vers `.ver` : remplissez **Dossier YOLO (.txt)**, **Fichier .ver de sortie**, et la largeur et la hauteur des images, puis cliquez sur **Convertir**.
4. Lisez le message de résultat (nombre de classes ou de boîtes écrites).

*Résultat* : le fichier ou dossier converti est écrit au chemin indiqué. La sortie ne doit pas déjà exister.

## Utiliser Annotation App depuis un pipeline Orchestrator

Cette procédure fait tourner Annotation App comme étape d'annotation d'un pipeline Orchestrator, entre Dataset Explorer et l'entraînement.

*Prérequis* : l'Orchestrator App tourne ; son graphe contient un node Annotation relié à un sous-ensemble Dataset Explorer ou à un node source de dataset.

1. Dans l'Orchestrator, configurez le node Annotation : nom du projet, classes, mode (séquence ou random), et soit l'annotation manuelle, soit le mode entièrement automatique (modèle SAM3 ou Grounding DINO, prompt texte, seuil, relecture facultative avant export).
2. Lancez le pipeline. L'Orchestrator démarre Annotation App si besoin et crée le projet à partir du dossier du sous-ensemble (`imports/<sous-ensemble>` dans le workspace Annotation) ou du chemin de la source de dataset. Une barre de progression sous le node suit l'import.
3. En mode manuel, le pipeline s'arrête sur l'étape « Annotate images manually ». Ouvrez Annotation App depuis le lien du node, retrouvez le projet sur la page des projets, annotez-le avec n'importe quel outil de ce guide, puis cliquez sur **Continue** dans l'Orchestrator.
4. En mode entièrement automatique, l'Orchestrator lance la détection par texte sur chaque frame ; avec la relecture activée, il s'arrête pour que vous vérifiiez et corrigiez les boîtes, puis vous cliquez sur **Continue**.
5. L'Orchestrator déclenche ensuite l'export YOLO (et un export `.ver`) dans `exports/` du workspace Annotation. Un export existant au contenu identique est réutilisé au lieu d'être recalculé.

*Résultat* : le dataset exporté est disponible pour les nodes suivants (entraînement, DVC). Quand Annotation App est lancée par l'Orchestrator, la fenêtre **Exporter le dataset** n'a pas de champ de destination : les exports manuels vont aussi dans le dossier `exports/` du workspace, dont le chemin est affiché dans la fenêtre.
