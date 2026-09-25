---
app: annotation
doc_type: troubleshooting
audience: both
lang: fr
title: Dépannage
order: 50
tags: [erreurs, vram, samurai, smb, ssh, démarrage, performances]
sources: [Annotation_App/backend/main.py, Annotation_App/backend/database.py, Annotation_App/backend/models/routers/sam.py, Annotation_App/backend/models/routers/tracking.py, Annotation_App/backend/models/routers/dataset.py, Annotation_App/backend/utils/native_share.py, Annotation_App/frontend/src/services/api.ts, Annotation_App/frontend/src/components/sidebar/TrackPanel.tsx, Annotation_App/frontend/src/pages/AnnotationPage.tsx]
---

# Dépannage

## Message « Le backend ne répond pas » et interface figée

**Symptôme** : un message rouge « Le backend ne répond pas (calcul en cours ?) » suivi de « requête abandonnée » apparaît, les boutons ne réagissent plus, ou le panneau Tracks affiche « Connexion backend perdue : polling arrete. ».

**Cause** : chaque requête de l'interface a un délai de 30 secondes (plus long pour les envois). Le message apparaît quand le backend ne répond pas à temps : le processus backend s'est arrêté ou a redémarré (plantage, `--reload` après modification d'un fichier), le tunnel SSH vers la VM est tombé, ou le backend est saturé par des requêtes très lourdes, par exemple des images 16 bits lues sur un montage réseau lent pendant qu'un import et une propagation tournent en même temps. Le serveur est dimensionné pour qu'aucune requête n'attende une connexion à la base (un pool de 60 connexions pour 96 threads de travail) ; si le pool est tout de même épuisé, les requêtes échouent désormais au bout de 10 secondes au lieu de rester bloquées.

**Solution** :

1. Regardez le terminal du backend ou le journal de l'onglet Annotation dans VisionNexus : une trace Python signale un plantage, un message de redémarrage signale un rechargement automatique.
2. Vérifiez que le backend répond : ouvrez `http://localhost:<port backend>/health`. S'il ne répond pas, relancez l'application depuis VisionNexus ou avec le lanceur.
3. Avec une VM distante, vérifiez la connexion SSH ; VisionNexus reconnecte le tunnel quand l'onglet est rouvert.
4. Si le blocage n'arrive que pendant une propagation, attendez la fin ou arrêtez-la avec le bouton d'arrêt rouge ; réduisez le travail simultané (pas d'import et de propagation en même temps sur un montage lent).
5. Rechargez la page (`F5`) une fois que le backend répond de nouveau ; la session est restaurée.

## La page des projets est vide juste après le lancement

**Symptôme** : Annotation App s'ouvre, mais la page des projets affiche « Aucun projet. » alors que des projets existent, ou reste en chargement. La console du frontend peut afficher `[vite] http proxy error: /api/projects`.

**Cause** : l'interface a été ouverte avant que le backend soit prêt. Le frontend Vite est prêt en une seconde environ, alors que le backend a besoin de 10 à 40 secondes pour charger PyTorch, CUDA et SAM2. Les requêtes envoyées pendant ce temps échouent et ne sont pas rejouées. VisionNexus attend l'endpoint `/health` du backend et affiche « Backend en cours de demarrage (chargement des modeles)... » avant d'ouvrir l'onglet, mais un lancement manuel ou un favori du navigateur peut encore tomber dans l'intervalle. Une seconde cause est un workspace différent : l'application a été lancée avec un autre `--user` ou `--workspace`, ou manuellement sans `ANNOTATION_WORKSPACE` (ce qui utilise `Annotation_App/data/`).

**Solution** :

1. Attendez que le terminal du backend affiche « Application prete », puis rechargez la page.
2. Ouvrez le menu **Workspace** en bas à gauche de la page des projets et vérifiez le chemin. Si ce n'est pas le workspace attendu, relancez avec les bons `--workspace` et `--user`.
3. Vérifiez que `annotation.db` existe dans ce workspace. S'il a été supprimé, une nouvelle base vide a été créée : restaurez-la depuis votre sauvegarde, ou reconstruisez les projets à partir des sauvegardes automatiques de `backup/` (voir [Procédures](workflows.fr.md)).

## SAM Point ne fait rien ou affiche « Erreur SAM point »

**Symptôme** : cliquer sur le canvas avec **SAM Point** ne produit aucun masque, ou un message « Erreur SAM point » demandant de vérifier que SAM2 est chargé apparaît. **SAM Auto** échoue avec « Erreur SAM Auto ».

**Cause** : SAM2 n'est pas chargé. Au démarrage, le backend charge `backend/checkpoints/sam2.1_hiera_small.pt` (ou le checkpoint tiny). Si aucun des deux fichiers n'existe, ou si le paquet Python `sam2` manque, le serveur démarre quand même mais chaque requête SAM échoue avec « Modèle SAM2 non chargé ».

**Solution** :

1. Ouvrez `http://localhost:<port backend>/api/sam/ping` : `"status": "not_loaded"` confirme la cause.
2. Vérifiez que `Annotation_App/backend/checkpoints/sam2.1_hiera_small.pt` existe. Sinon, téléchargez-le avec `python backend/tests/download_all_models.py --skip-sam3` ou copiez-le depuis un bundle (voir [Configuration](configuration.fr.md)).
3. Vérifiez que le paquet `sam2` est installé dans `IA_env` (`python -c "import sam2"`).
4. Redémarrez le backend : le modèle n'est chargé qu'au démarrage.
5. Vérifiez qu'une classe est active : les masques SAM sont enregistrés avec la classe active.

## La détection par texte échoue avec un message d'erreur

**Symptôme** : appuyer sur `Entrée` dans la barre de détection par texte, lancer **Batch**, ou démarrer l'onglet **Detect.** affiche « Detection par texte : » suivi d'une erreur comme « Grounding DINO non disponible », « SAM3 non installé », « Checkpoint SAM3 absent » ou « Erreur Grounding ».

**Cause** : le détecteur choisi ne peut pas fonctionner. Grounding DINO a besoin du paquet `transformers` et soit du dossier local `backend/checkpoints/grounding_dino/`, soit d'un accès internet pour télécharger `IDEA-Research/grounding-dino-tiny` ; avec `HF_HUB_OFFLINE=1` et sans dossier local, le chargement échoue. SAM3 a besoin du paquet SAM3 et du checkpoint `backend/checkpoints/sam3.1/sam3.1_multiplex.pt`, à accès restreint sur Hugging Face et non téléchargé automatiquement.

**Solution** :

1. Vérifiez l'état du détecteur : `GET /api/sam/grounding/status` pour Grounding DINO, `GET /api/sam3/status` pour SAM3.
2. Pour Grounding DINO : `pip install transformers` (ou depuis les wheels hors ligne), puis vérifiez que `backend/checkpoints/grounding_dino/config.json` et un fichier de poids existent.
3. Pour SAM3 : demandez l'accès à `facebook/sam3.1` sur Hugging Face, puis lancez `python backend/tests/download_sam3.py` (ou `download_all_models.py --hf-token ...`).
4. Redémarrez le backend et réessayez, ou passez à l'autre détecteur (**GD** / **SAM3**, ou **GDINO** / **SAM3.1** dans l'onglet Detect.).

Si Grounding DINO ne détecte rien et qu'aucune erreur n'apparaît, la bulle indique « Aucun objet détecté avec ce prompt. » : le détecteur fonctionne mais aucune boîte ne passe les seuils. Baissez **Box:** et **Txt:**, et écrivez le prompt comme un nom court en anglais (par exemple `car` ou `person`), que ce modèle gère le mieux.

## La détection par texte réclame une classe ou reste désactivée

**Symptôme** : le bouton de lancement de la barre de détection par texte est désactivé avec un avertissement, ou un message indique « Créez d abord une classe dans le panneau Classes avant de lancer GD ou SAM3. » ou « Sélectionnez une classe active avant de lancer GD ou SAM3. ». Dessiner sur le canvas affiche « Créez d'abord une classe (onglet Classes, bouton +) pour pouvoir annoter. ».

**Cause** : chaque annotation appartient à une classe, et les outils automatiques créent des annotations de la classe active. Quand le projet n'a pas de classe, ou qu'aucune classe n'est sélectionnée, les outils ne peuvent rien enregistrer.

**Solution** :

1. Ouvrez l'onglet **Classes** du panneau de droite.
2. Si la liste est vide, cliquez sur **+**, tapez un nom et cliquez sur **Créer**.
3. Cliquez sur la classe pour la rendre active (elle est surlignée en bleu).
4. Relancez la détection par texte. Pour détecter plusieurs types d'objets, lancez le prompt une fois par classe, en changeant la classe active entre deux passages.

## Mémoire CUDA épuisée pendant une propagation SAMURAI ou SAM2

**Symptôme** : une propagation SAMURAI ou SAM2 s'arrête sur une erreur mentionnant `CUDA out of memory` ou `OutOfMemoryError` dans la vue **Logs** ou le terminal du backend. La jauge **Frames max estimées (GPU rapide)** de l'onglet SAMURAI était rouge avant le lancement.

**Cause** : en mode GPU rapide (le défaut), toutes les frames de la plage sont gardées en VRAM en 1024 x 1024. Un GPU de 10 Go contient environ 350 à 450 frames ; des plages plus longues, plusieurs cibles, ou d'autres tâches sur le même GPU (un autre utilisateur, Training App) dépassent la mémoire.

**Solution** :

1. Réduisez la plage avec **Jusqu'à la frame** jusqu'à ce que la jauge ne soit plus rouge, et propagez en plusieurs morceaux, chacun partant de la dernière bonne frame.
2. Ou ouvrez **Paramètres**, section **Algorithmes**, et décochez **Mode GPU rapide** : les frames restent alors en RAM, sans limite de VRAM, pour un temps 1,5 à 3 fois plus long.
3. Décimez les longues vidéos à l'import (**Décimation des frames vidéo**) quand les frames consécutives sont redondantes.
4. Vérifiez avec `nvidia-smi` qu'aucun autre processus n'utilise la mémoire du GPU.
5. Sur un petit GPU, ne gardez que le checkpoint SAM2 tiny, ou tournez sur CPU (très lent mais sans limite de VRAM).

## L'onglet SAMURAI affiche « SAM2 standard (SAMURAI absent) »

**Symptôme** : le badge de l'onglet **SAMURAI** indique **SAM2 standard (SAMURAI absent)** ou **SAMURAI installé, SAM2 en cours**, le bouton indique **Propager par SAM2**, et **SAMURAI / objet** est désactivé avec « Nécessite SAMURAI chargé ».

**Cause** : le fork SAMURAI n'a pas été trouvé dans `backend/ext/samurai_repo/`, son paquet n'est pas installé dans l'environnement Python, ou sa configuration n'a pas pu être chargée. L'application utilise alors SAM2 vidéo standard, qui fonctionne mais sans filtre de Kalman.

**Solution** :

1. Sous Windows, lancez `install_samurai.bat` depuis `Annotation_App/` (accès internet requis) ; sur une machine hors ligne, copiez `backend/ext/samurai_repo/` depuis un bundle et installez son sous-dossier `sam2/` avec `pip install -e`.
2. Redémarrez le backend.
3. Vérifiez `GET /api/samurai/status` et le journal de démarrage du backend, qui indique si le prédicteur vidéo SAMURAI a été chargé.

SAM2 standard reste utilisable en attendant : la différence compte surtout pour les occultations et les croisements d'objets semblables.

## Une propagation semble bloquée au démarrage ou ne s'arrête pas

**Symptôme** : après un clic sur un bouton de propagation, la barre de progression reste à 0 % avec « Démarrage... » longtemps, ou le bouton d'arrêt ne semble pas agir immédiatement.

**Cause** : avant la première frame propagée, SAMURAI et SAM2 préparent la plage : chaque frame est convertie en JPEG 8 bits (LUT appliquée) dans `_tracking_tmp/` du projet, en parallèle. Sur une longue plage lue depuis un montage réseau lent, cette phase peut prendre du temps. La demande d'arrêt est vérifiée entre les frames et pendant la préparation : elle prend effet après la frame en cours. Une frame Detect. très longue (SAM3 sur une grande image) retarde aussi l'arrêt.

**Solution** :

1. Ouvrez la vue **Logs** du panneau Tracks : l'avancement de la préparation et les premières frames y sont affichés, avec les mêmes lignes que le terminal du serveur.
2. Attendez la frame en cours ; l'état passe à « Arrêt en cours... » puis au message final.
3. Pour de longues plages sur un stockage réseau, propagez par morceaux, ou importez la séquence en JPEG pour que la préparation se contente de lier les fichiers.
4. Si rien ne bouge dans les logs pendant plusieurs minutes, cherchez une erreur dans le terminal du backend, puis arrêtez la tâche et redémarrez le backend si besoin.

## Les boîtes n'apparaissent qu'à la fin d'une propagation

**Symptôme** : pendant un passage SAMURAI ou SAM2, le canvas reste sur la même frame et les boîtes n'apparaissent qu'à la fin, ou une seule frame sur plusieurs affiche ses boîtes.

**Cause** : le canvas ne suit la propagation que si **Live temps réel par défaut** est activé dans la section **Interface** des Paramètres. Même alors, le canvas saute au plus une fois par intervalle réglé par **Suivi propagation : cadence du canvas** (150 ms par défaut) : avec un GPU rapide, certaines frames sont sautées à l'écran. Les annotations sont validées en base par lots pendant le passage ; les boîtes live viennent des messages WebSocket, et la base ne redevient la référence qu'après le rechargement final.

**Solution** :

1. Activez **Live temps réel par défaut** dans les Paramètres, section **Interface**, puis sauvegardez.
2. Réglez la cadence du canvas à 150 ms (ou 0 pour suivre chaque résultat GPU).
3. Regardez la timeline : ses cellules deviennent vertes pour chaque frame traitée, quelle que soit la cadence.
4. À la fin du passage, frames, pistes et annotations sont rechargées une fois ; si une frame semble encore vide, quittez-la puis revenez-y.

## Écran gris au démarrage d'une propagation

**Symptôme** : l'espace d'annotation devient gris ou vide au démarrage d'une propagation, parfois avec `Maximum update depth exceeded` ou `drawImage ... width or height of 0` dans la console du navigateur.

**Cause** : deux situations cassaient autrefois la page : le canvas alternait entre les annotations en cache et les annotations live WebSocket d'une même frame, et un onglet VisionNexus masqué ou en cours de redimensionnement signalait une taille de canvas de 0 x 0. La version actuelle empêche les deux (pendant un passage, le WebSocket est la seule source d'annotations du canvas, et les tailles nulles sont ignorées). Un écran gris signale désormais un ancien build du frontend encore en cache, ou une nouvelle erreur différente.

**Solution** :

1. Rechargez la page (`F5`), ou fermez et rouvrez l'onglet Annotation dans VisionNexus pour charger le frontend actuel.
2. Si le problème se reproduit, ouvrez la console de développement (`F12`) et notez la première erreur ; regardez en même temps le journal du backend.
3. Désactivez **Live temps réel par défaut** en contournement : le canvas reste alors immobile pendant le passage et le résultat est rechargé à la fin.

## Les frames se chargent lentement en SSH

**Symptôme** : avec le backend sur une VM distante, changer de frame prend du temps, le curseur saccade, ou le premier affichage d'une frame reste flou plusieurs secondes.

**Cause** : en SSH, chaque image passe par le tunnel et entre en concurrence avec les autres requêtes ; un navigateur ouvre au plus 6 connexions par origine. Le premier affichage d'une grande image jamais vue (PNG 4K, TIFF 16 bits sur un montage réseau) coûte sa taille complète multipliée par la latence. Sans hôte de partage configuré, VisionNexus ne peut pas lire les pixels directement sur le partage SMB.

**Solution** :

1. Configurez l'hôte du partage (menu **Workspace** de la page des projets, ou `--native-share-host` dans VisionNexus) pour que les images soient lues sur le partage plutôt que par le tunnel.
2. Gardez **Réduction preview (480/1600px)** activée dans les Paramètres, **Interface** : le curseur charge alors des aperçus de 480 px et le canvas des images de 1600 px, la pleine résolution n'étant chargée qu'en zoomant.
3. Importez les datasets lourds en JPEG (extraction) plutôt qu'en PNG 4K, ou gardez une qualité JPEG raisonnable.
4. Naviguez avec le curseur et relâchez-le sur la frame cible ; la timeline ne charge jamais de vignettes, et le préchargement ne couvre que quelques voisines au repos.
5. Évitez de lancer imports et propagations pendant que vous parcourez la séquence sur un lien lent.

## Une image grise remplace la frame

**Symptôme** : le canvas affiche une image grise uniforme à la place de la frame, pour une frame ou pour toute une séquence.

**Cause** : le backend envoie une image grise de remplacement quand le fichier de la frame manque : un lien symbolique cassé (le dossier source a été déplacé, renommé ou démonté), ou une frame vidéo pas encore extraite. Cette image de remplacement est marquée non cachable : la vraie image apparaît dès qu'elle devient disponible.

**Solution** :

1. Pour une vidéo en cours d'import, attendez la fin de la barre d'extraction orange ; le canvas demande d'abord l'extraction autour de la frame courante.
2. Pour un dossier serveur, vérifiez que le chemin source de la séquence existe toujours sur la machine du backend et que le partage est monté (`ls` du dossier sur la VM).
3. Si la source a été déplacée, remettez-la à son chemin d'origine, ou recréez le projet en important le nouveau chemin puis en restaurant les annotations depuis la sauvegarde (voir [Procédures](workflows.fr.md)).

## « Dossier introuvable » à l'import d'un chemin serveur sur une VM

**Symptôme** : l'import d'un chemin serveur échoue avec « Dossier introuvable », « Chemin introuvable » ou « Ce chemin n'est pas un dossier », alors que le dossier est visible depuis Windows.

**Cause** : le backend tourne sous Linux et ne connaît que des chemins Linux. Une lettre de lecteur Windows (`Z:\datasets`) ne signifie rien sur la VM. Un chemin UNC (`\\hôte\partage\...`) est traduit en `/<racine>/<partage>/...` à l'aide des racines partagées (`home`, `mnt`, `srv`, `media`, `data`), en essayant chaque racine et en gardant la première qui existe ; si aucune n'existe sur la VM, l'import échoue. Faire glisser un dossier depuis un lecteur réseau Windows fonctionne mais envoie les fichiers au lieu de les référencer.

**Solution** :

1. Utilisez le chemin tel que le voit le backend, par exemple `/srv/datasets/run01`. Cliquez sur **Serveur** dans la fenêtre d'import pour parcourir les dossiers du backend et choisir le bon.
2. Pour les chemins UNC, vérifiez que le nom du partage correspond à un dossier sous l'une des racines partagées sur la VM (par exemple `\\hôte\datasets\run01` exige `/srv/datasets/run01` ou `/mnt/datasets/run01`...).
3. Vérifiez les droits : « Accès refusé à ce dossier » signifie que l'utilisateur du backend ne peut pas lire le dossier.

## Les logs indiquent « REPLI HTTP » au lieu de « chemin NATIF (SMB) »

**Symptôme** : au début d'un passage SAMURAI ou SAM2, la ligne de log `[SAM2Track] apercu temps reel : REPLI HTTP (...)` apparaît au lieu de `chemin NATIF (SMB)`, ou VisionNexus journalise `[app-image] repli HTTP: <raison>` au lieu de `[app-image] lecture native confirmee`. Les images live pendant la propagation sont plus lentes.

**Cause** : le backend n'a pas pu traduire le dossier temporaire des frames en chemin UNC : aucun hôte de partage n'est configuré, ou le dossier du projet est hors des racines partagées (`home`, `mnt`, `srv`, `media`, `data`). Côté client, la lecture directe peut aussi échouer quand le partage n'est pas joignable depuis Windows ou que les identifiants manquent ; après un délai de 1,5 seconde, VisionNexus se replie sur HTTP. La ligne du backend indique seulement la route prévue ; la ligne `[app-image]` indique la route réellement utilisée.

**Solution** :

1. Enregistrez l'hôte du partage dans le menu **Workspace** (ou passez `--native-share-host` depuis VisionNexus), puis lancez un nouveau passage.
2. Vérifiez que le workspace se trouve sous une racine partagée, par exemple `/srv/...` ou `/data/...`, pas sous `/tmp`.
3. Depuis Windows, ouvrez dans l'explorateur le chemin UNC affiché dans le log pour vérifier l'accès et les identifiants.
4. Le repli HTTP garde tout fonctionnel ; seule la vitesse est affectée.

## L'import vidéo échoue

**Symptôme** : l'import d'un `.mp4` ou d'une autre vidéo échoue immédiatement ou pendant l'extraction avec « Erreur scan video », « Erreur extraction » ou `ffmpeg not found` dans le terminal du backend.

**Cause** : l'import vidéo exige ffmpeg et la prise en charge vidéo d'OpenCV dans l'environnement du backend. Un fichier corrompu ou non pris en charge, ou un conteneur à cadence variable, peut aussi interrompre l'extraction.

**Solution** :

1. Vérifiez `ffmpeg -version` dans l'environnement du backend. S'il manque, installez-le (`conda install -c conda-forge ffmpeg`, ou `winget install Gyan.FFmpeg` sous Windows) et redémarrez le backend.
2. Essayez d'ouvrir la vidéo avec un autre lecteur ; réencodez-la avec ffmpeg si besoin.
3. Pour de très longues vidéos, utilisez la décimation (**Décimation des frames vidéo**) pour réduire le nombre de frames.

## La propagation par homographie laisse des boîtes figées ou qui dérivent

**Symptôme** : après **Propager par homographie**, des boîtes restent à la même position sur plusieurs frames alors que la scène bouge, ou glissent lentement hors des objets.

**Cause** : des boîtes figées signifient que l'homographie de ces pas a été rejetée (trop peu d'inliers, ou ratio d'inliers sous le seuil) : les boîtes sont alors recopiées telles quelles. Cela arrive sur des scènes peu texturées, des mouvements de caméra rapides ou une forte parallaxe. Une dérive signifie que les objets bougent d'eux-mêmes : l'homographie ne suit que la caméra.

**Solution** :

1. Consultez les lignes par frame de la vue **Logs** (`kp`, `match`, `inliers`, `ratio`) et utilisez l'onglet **Debug** sur deux frames de la zone problématique.
2. Pour les pas rejetés, baissez légèrement **Ratio inliers** ou montez **Top-K pts** ; pour des résultats bruités, montez **Inliers min.**.
3. Importez la séquence avec **PNG sans perte pour les MP4** ou une qualité JPEG élevée : les artefacts de compression réduisent les correspondances.
4. Pour des objets qui bougent d'eux-mêmes, utilisez plutôt **Flux opt.** ou SAMURAI.

## Les boîtes du flux optique cessent de suivre l'objet

**Symptôme** : avec **Suivre par flux optique**, une boîte cesse de bouger au bout de quelques frames alors que l'objet continue, ou saute sur le fond.

**Cause** : le flux optique a besoin de texture suivable dans la boîte. Quand moins de **Pts min.** points sont suivis (surface uniforme, reflet, changement d'éclairage, flou de bougé, occultation), la boîte est recopiée telle quelle. Un mouvement plus grand que la fenêtre de recherche sur les niveaux de pyramide fait aussi perdre les points.

**Solution** :

1. Montez **Niveaux pyra.** (4 pour de grands déplacements) ou **Fenêtre (px)** (25 à 31 pour une vidéo compressée).
2. Baissez **Pts min.** à 2 ou 3 pour de petits objets.
3. Retracez la boîte sur la première frame où elle s'est arrêtée et relancez depuis là.
4. Pour de longues séquences ou des occultations, utilisez SAMURAI.

## Le backend ne démarre pas

**Symptôme** : le terminal du backend s'arrête au démarrage sur une erreur, et l'interface affiche « Le backend ne répond pas » ou reste vide.

**Cause et solution selon le message** :

- `ModuleNotFoundError: No module named 'sam2'` : SAM2 n'est pas installé dans l'environnement. Installez-le (`pip install git+https://github.com/facebookresearch/segment-anything-2.git`, ou `pip install --no-index --find-links <offline>/wheels/ segment_anything_2` hors ligne).
- `UnicodeEncodeError` au démarrage : la console Windows ne peut pas afficher un caractère. Définissez `PYTHONIOENCODING=utf-8` avant de démarrer uvicorn.
- `Address already in use` / port 8000 occupé : une autre instance tourne. Laissez le lanceur allouer des ports libres, ou trouvez et arrêtez le processus (`netstat -ano | findstr :8000` puis `taskkill /PID <pid> /F` sous Windows).
- `ModuleNotFoundError: No module named 'backend'` : uvicorn a été démarré depuis le mauvais dossier. Démarrez-le depuis `Annotation_App/`.
- Erreurs liées à CUDA ou `torch` : la version installée de PyTorch ne correspond pas au pilote. Vérifiez `nvidia-smi` et `python -c "import torch; print(torch.__version__, torch.version.cuda)"`, puis réinstallez PyTorch pour la bonne version de CUDA.

Côté frontend, `Cannot find module 'vite'` signifie que les dépendances du frontend manquent : lancez `npm install` dans `frontend/` (ou la commande hors ligne avec le cache npm, voir [Configuration](configuration.fr.md)).

## Erreurs « database is locked »

**Symptôme** : une action échoue avec un message contenant `database is locked`, généralement pendant qu'un import ou une propagation écrit de nombreuses annotations.

**Cause** : SQLite n'accepte qu'un écrivain à la fois. L'application utilise SQLite en mode WAL avec une attente de verrou de 30 secondes, ce qui couvre la concurrence normale entre imports, propagations et interface. L'erreur apparaît quand plusieurs processus backend écrivent dans le même `annotation.db` : uvicorn lancé avec `--workers` supérieur à 1, deux instances de l'application lancées sur le même workspace, ou un workspace sur un système de fichiers réseau au verrouillage défaillant.

**Solution** :

1. Lancez un seul worker uvicorn ; n'utilisez jamais `--workers` supérieur à 1.
2. Ne lancez pas deux instances sur le même workspace ; chaque utilisateur doit avoir son propre workspace `annotation_<utilisateur>`.
3. Gardez le workspace (au moins `annotation.db`) sur un disque local de la machine du backend plutôt que sur un partage réseau.
4. Relancez l'action une fois la tâche lourde terminée.

## Le disque du workspace se remplit

**Symptôme** : le disque de la machine du backend se remplit ; la section **Stockage workspace** des Paramètres affiche de grandes tailles.

**Cause** : les exports en mode copie dupliquent chaque image et créent des fichiers ZIP ; les imports vidéo extraient chaque frame ; les aperçus et les versions 8 bits en cache s'accumulent pour les gros datasets 16 bits. Les sauvegardes automatiques sont petites (un JSON par projet, écrasé).

**Solution** :

1. Ouvrez **Paramètres**, section **Stockage workspace**, et videz le dossier des exports une fois les exports copiés ailleurs.
2. Préférez **Liens symboliques pour les images** à l'export et les liens symboliques à l'import : aucune image n'est copiée.
3. Supprimez les dossiers de cache si besoin (`frames_preview/`, `frames_8bit/`, `frames_ai_lut/`, `frames_format specialise_cache/` dans chaque projet) : ils sont reconstruits à la demande.
4. Décimez les vidéos à l'import et utilisez le JPEG plutôt que le PNG sans perte quand la propagation géométrique n'est pas nécessaire.

## Les touches 1 à 9 ne sélectionnent pas de classe

**Symptôme** : appuyer sur une touche chiffre ne change pas la classe active.

**Cause** : une touche chiffre ne sélectionne que la classe dont le raccourci est ce chiffre, affiché à côté du nom de la classe dans l'onglet **Classes**. Une classe sans raccourci ne réagit pas, et l'interface ne permet pas d'en attribuer un (le champ `shortcut_key` d'une classe peut être défini par l'API).

**Solution** : cliquez sur la classe dans l'onglet **Classes** pour la rendre active, ou attribuez un raccourci à la classe par l'API (`PUT /api/projects/{project_id}/classes/{class_id}` avec `shortcut_key`).

## Un lot de détection par texte annote les frames d'une autre séquence

**Symptôme** : après un **Batch** de la barre de détection par texte dans un projet multi-séquences, des annotations apparaissent aussi sur des frames des séquences suivantes, ou le lot traite bien plus de frames que n'en contient la séquence courante.

**Cause** : les champs **De F** / **à F** de la barre de détection par texte prennent des index de frame à l'échelle du projet, à partir de 0, et la fin de la plage vaut par défaut la dernière frame du projet, pas celle de la séquence courante. Le bouton de plage `[F<début>...F<fin>]` affiche ces index globaux.

**Solution** :

1. Avant de cliquer sur **Batch**, ouvrez le bouton de plage et réglez **à F** sur le dernier index global de la séquence courante (la première frame de la séquence plus son nombre de frames, moins 1).
2. Pour nettoyer les frames annotées par erreur, allez sur l'autre séquence, sélectionnez les frames sur la timeline (`Ctrl+clic`, `Maj+clic` ou `Ctrl+A` au-dessus de la timeline) et appuyez sur `Suppr` ; `Ctrl+Z` les restaure si besoin.
