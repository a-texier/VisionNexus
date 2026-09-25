---
app: inference
doc_type: troubleshooting
audience: both
lang: fr
title: Dépannage
order: 50
tags: [erreurs, cuda, csrt, checkpoint, évaluation, orchestrateur]
sources: [Inference_App/backend/main.py, Inference_App/backend/inference_core/media.py, Inference_App/backend/inference_core/detectors.py, Inference_App/backend/inference_core/runner.py, Inference_App/backend/inference_core/models.py, Inference_App/backend/inference_core/evaluation.py]
---

# Dépannage

## "source introuvable" en lisant un média

**Symptôme** : cliquer sur **Lire le média** affiche une erreur contenant "source introuvable" ou "le dossier ne contient aucune image prise en charge".

**Cause** : `POST /api/media/inspect` vérifie le chemin sur la machine du backend : un fichier ou dossier manquant, ou un dossier sans aucune image d'une extension prise en charge (`.bmp`, `.jpeg`, `.jpg`, `.png`, `.tif`, `.tiff`), échoue avant que quoi que ce soit soit chargé. Un chemin valide sur votre poste ne veut rien dire quand le backend tourne sur une VM distante.

**Solution** :

1. Vérifiez le chemin tel que le voit le backend, pas votre poste.
2. Pour une source dossier, vérifiez qu'il contient directement des fichiers image d'une extension prise en charge (pas de recherche récursive dans les sous-dossiers).
3. Pour une source fichier unique, vérifiez que l'extension est l'une de `.avi`, `.m4v`, `.mkv`, `.mov`, `.mp4`, `.webm` (vidéo) ou les extensions image ci-dessus.

## "format non pris en charge" pour un fichier qui semble valide

**Symptôme** : **Lire le média** ou **Lancer** échoue avec "format non pris en charge : <extension>".

**Cause** : l'extension du fichier ne figure pas dans la liste fixe des extensions prises en charge par l'application (voir l'entrée précédente), même si le fichier lui-même est un média valide et lisible sous un autre conteneur ou une autre extension (par exemple `.gif`, `.flv`, `.wmv`).

**Solution** : convertissez ou renommez le fichier vers une extension prise en charge avant de l'utiliser ; réencoder une vidéo avec ffmpeg en `.mp4` résout généralement le problème.

## Le run échoue avec une erreur de chargement de checkpoint

**Symptôme** : **Lancer** ou **Évaluer** échoue avec un message mentionnant `state_dict`, `size mismatch`, ou une autre erreur de `torch.load`.

**Cause** : **Fichier de poids** ne pointe pas vers un checkpoint YOLOX compatible avec la taille sélectionnée dans **Architecture**, ou le nombre de classes du checkpoint ne correspond pas à ce qui est attendu. `YoloxDetector` déduit le nombre de classes directement de la couche de classification du checkpoint, puis exige que `class_names` (issu de `config.yaml`) soit soit vide (des étiquettes génériques `class_0`, `class_1`... sont utilisées), soit exactement de cette longueur.

**Solution** :

1. Vérifiez que **Architecture** correspond à la taille avec laquelle le checkpoint a été entraîné (un checkpoint `yolox-m` chargé en `yolox-s` a des formes de couches majoritairement incompatibles).
2. Si `class_names` est défini dans **Config YAML**, vérifiez que sa longueur correspond au nombre de classes sur lequel le checkpoint a été entraîné ; videz-le pour utiliser des étiquettes génériques le temps du diagnostic.
3. Vérifiez que le fichier est un vrai checkpoint YOLOX (de Training App ou d'une publication officielle YOLOX), pas un fichier d'un autre framework enregistré avec une extension `.pth`.

## Mémoire GPU insuffisante (CUDA out of memory) pendant un run ou une évaluation

**Symptôme** : **Lancer** ou **Évaluer** échoue avec un message contenant `CUDA out of memory`.

**Cause** : le modèle à la taille **Architecture** et à la résolution d'image courantes ne tient plus dans la mémoire du GPU, souvent parce qu'un autre processus (un run Training App, un autre run Inference App, un autre utilisateur) utilise déjà le GPU.

**Solution** :

1. Vérifiez avec `nvidia-smi` sur la machine du backend si un autre processus utilise déjà la mémoire GPU.
2. Choisissez une taille **Architecture** plus petite, ou réglez `device: cpu` dans **Config YAML** (plus lent, mais sans limite de VRAM).
3. Évitez de lancer un run Training App et un run Inference App en même temps sur le même GPU.

## Le run SOT échoue avec "le clic SOT ne touche aucune detection"

**Symptôme** : démarrer un run en mode **SOT par clic** échoue avec "le clic SOT ne touche aucune detection sur la premiere frame".

**Cause** : le clic sur l'aperçu n'est pas tombé à l'intérieur d'une boîte trouvée par le détecteur sur la première frame ; le point doit être strictement à l'intérieur d'une boîte détectée, pas seulement proche de l'objet.

**Solution** :

1. Visez mentalement plus précisément sur l'aperçu avant de cliquer, ou cliquez plus près du centre de l'objet.
2. Baissez **Confiance** pour que plus de détections (plus faibles) apparaissent sur la première frame, offrant plus de zone cliquable.
3. Si l'objet n'est vraiment pas détecté sur la première frame, choisir une autre frame de départ n'est pas possible depuis l'interface ; utilisez plutôt **Multi-objet** avec ByteTrack, qui ne nécessite pas de clic initial.

## L'objet suivi en mode SOT dérive vers la mauvaise région

**Symptôme** : en mode **SOT par clic**, la boîte mise en évidence se déplace progressivement ou brusquement sur l'arrière-plan ou un autre objet, et ne se rétablit jamais.

**Cause** : CSRT n'a aucune notion de classe d'objet ni de confiance ; une fois qu'il perd l'objet d'origine (mouvement rapide, occlusion complète, un objet visuellement similaire qui croise sa trajectoire), il continue de suivre la région qui correspond le mieux à son modèle d'apparence interne, sans récupération automatique (voir [Concepts](concepts.fr.md)).

**Solution** : il n'y a aucun moyen de resélectionner l'objet en cours de run ; si la dérive survient tôt, relancez le run et cliquez sur une frame plus proche du moment où l'objet devient suivable, ou passez à **Multi-objet** avec ByteTrack, qui redétecte l'objet à chaque frame au lieu de suivre une simple apparence.

## L'évaluation échoue avec "aucune image trouvee pour le split" ou "la cle 'names' est absente"

**Symptôme** : **Évaluer** échoue avec "aucune image trouvee pour le split 'val'" ou "la cle 'names' est absente du data.yaml".

**Cause** : le `data.yaml` fourni n'a soit aucune clé `val`, soit son entrée `val` (un dossier, une liste `.txt` d'images, ou un chemin d'image unique) ne résout vers aucune image lisible une fois combinée avec `path` (ou le dossier du `data.yaml` lui-même quand `path` est absent) ; ou le fichier n'a aucune clé `names`. L'évaluation ne lit jamais que le split `val`, jamais `train` ni `test`.

**Solution** :

1. Ouvrez le `data.yaml` et vérifiez qu'il a à la fois `val` (ou `path` plus une entrée `val` qui s'y résout) et `names`.
2. Vérifiez que les images référencées par `val` existent réellement au chemin résolu, du point de vue du backend.
3. Si seuls `train` et `test` sont peuplés, faites pointer temporairement `val` vers un sous-ensemble annoté pour lancer une évaluation.

## L'évaluation se termine mais chaque image obtient un mAP de 0

**Symptôme** : **Évaluer** se termine sans erreur, mais **mAP50** et **mAP50-95** sont tous deux à 0, ou très proches de 0.

**Cause** : les labels de vérité terrain ne sont pas trouvés pour les images de validation. Les labels sont cherchés en remplaçant le dernier segment `images` du chemin de chaque image par `labels` et en gardant le même nom de fichier avec l'extension `.txt` (par exemple `.../images/val/0001.jpg` -> `.../labels/val/0001.txt`) ; un chemin d'image sans segment `images`, ou des fichiers de labels suivant une convention de nommage différente, produisent silencieusement zéro vérité terrain pour chaque image plutôt qu'une erreur.

**Solution** :

1. Vérifiez que le dataset suit la convention `images/<split>/...` et `labels/<split>/...`, dossier miroir pour dossier.
2. Vérifiez qu'au moins un fichier de labels `.txt` non vide existe à côté (dans l'emplacement `labels/` miroir) d'une image de validation.
3. Vérifiez que **Architecture** et **Fichier de poids** sont bien le bon modèle pour ce dataset ; un modèle mal apparié peut aussi obtenir un score proche de 0 avec une vérité terrain correcte.

## Le nœud Orchestrator d'inférence ou d'évaluation échoue

**Symptôme** : le nœud Inference d'un pipeline Orchestrator échoue avec "echec inference: ..." ou "echec evaluation: ...", ou "sequence_dir requis pour le benchmark tracker" / "data_yaml requis pour l'evaluation detection".

**Cause** : `POST /api/orchestrator/infer` requiert toujours `sequence_dir` ; `POST /api/orchestrator/evaluate` requiert `data_yaml` pour une évaluation de détection et `sequence_dir` pour un benchmark de tracker. Un pipeline dont les nœuds amont n'ont pas résolu l'un de ces champs (un nœud Training pas encore terminé, un export d'annotation manquant) envoie une valeur vide et l'appel est rejeté avant que toute inférence ne démarre.

**Solution** :

1. Vérifiez que les nœuds amont (Training, Annotation, une source de dataset) se sont terminés et ont bien produit le chemin attendu par le nœud Inference.
2. Vérifiez les paramètres résolus du nœud dans la vue de pipeline de l'Orchestrator avant de l'exécuter ; un placeholder non résolu y est généralement visible.
3. Relancez le nœud une fois la dépendance amont corrigée ; le nœud Inference lui-même ne nécessite pas de configuration séparée pour cette classe d'échec.

## Le backend ne démarre pas

**Symptôme** : le terminal du backend s'arrête avec une erreur au démarrage, et l'interface n'affiche rien ou "le backend ne répond pas".

**Cause et solution selon le message** :

- `ModuleNotFoundError: No module named 'yolox'` : `inference_core/detectors.py::YoloxDetector` importe le code YOLOX embarqué depuis `Training_App/backend/vendor/yolox/` ; vérifiez que `Training_App/` existe à côté d'`Inference_App/` dans le dépôt.
- `RuntimeError: CSRT indisponible : installez opencv-contrib-python` : la version d'OpenCV installée n'a pas le tracker CSRT (nécessaire uniquement pour le mode **SOT par clic**) ; installez `opencv-contrib-python` (ou `opencv-contrib-python-headless` sur un backend sans interface) à la place du paquet de base `opencv-python`.
- `Address already in use` / port 8065 occupé : une autre instance tourne déjà. Laissez le lanceur allouer un port libre, ou trouvez et arrêtez le processus (`netstat -ano | findstr :8065` puis `taskkill /PID <pid> /F` sur Windows).
- Erreurs liées à CUDA ou `torch` : la version de PyTorch installée ne correspond pas au pilote. Vérifiez `nvidia-smi` et `python -c "import torch; print(torch.__version__, torch.version.cuda)"`, puis réinstallez PyTorch pour la bonne version de CUDA.

Pour le frontend, `Cannot find module 'vite'` signifie que les dépendances du frontend manquent : lancez `npm install` dans `frontend/`.
