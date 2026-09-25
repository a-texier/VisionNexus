---
app: annotation
doc_type: readme
audience: both
lang: fr
title: Annotation App
order: 0
tags: [annotation, segmentation, suivi, sam2, samurai, yolo, dataset]
sources: [Annotation_App/backend/main.py, Annotation_App/launcher.py, _lib/launcher_engine.py, Annotation_App/frontend/src/App.tsx]
---

# Annotation App

## Ce que fait Annotation App

Annotation App est l'outil d'annotation de la suite Computer Vision. Elle transforme des images brutes, des dossiers d'images et des vidéos en datasets annotés prêts pour l'entraînement : boîtes englobantes, polygones et pistes d'objets, organisés par classe et par séquence.

Vous pouvez annoter à la main, ou laisser des modèles d'IA faire l'essentiel du travail et relire leur résultat :

- **Outils manuels** : rectangle (boîte englobante) et polygone, avec annuler/rétablir, copier/coller et une liste des annotations de la frame.
- **Points SAM2 et SAM Auto** : cliquez sur un objet pour obtenir un masque précis, ou segmentez une frame entière automatiquement.
- **Détection par texte** : tapez `voiture. personne.` et Grounding DINO ou SAM3 trouve tous les objets correspondants, sur une frame ou sur une plage de frames.
- **Suivi vidéo** : annotez une frame, puis propagez les boîtes ou les masques dans la séquence avec SAMURAI ou SAM2, l'homographie (XFeat ou SIFT), le flux optique, ou la détection par texte suivie d'un appariement par centroïde.
- **Relecture** : une timeline compacte montre les frames annotées, des pistes montrent où chaque objet a été suivi, et un bloc ou une piste entière se supprime en un clic.
- **Export** : YOLO (détection et segmentation), COCO JSON, ou le format texte natif `.ver`, un dossier ou un fichier par séquence.

L'application est conçue pour des datasets lourds (des milliers de frames, imagerie 16 bits ou infrarouge) et pour un usage distant : le backend et les modèles peuvent tourner sur une VM Linux avec GPU pendant que l'interface tourne sur un poste Windows dans le lanceur VisionNexus, les pixels des frames étant lus directement sur le partage réseau.

## Place d'Annotation App dans la chaîne de la suite

Annotation App se situe entre la sélection des données et l'entraînement des modèles dans la suite Computer Vision :

1. **Dataset Explorer** sélectionne et exporte un sous-ensemble d'images.
2. **Annotation App** crée un projet à partir de ce sous-ensemble (ou de n'importe quel dossier, vidéo ou chemin de partage), l'annote et exporte un dataset.
3. **Training App** entraîne un détecteur ou un segmenteur sur le dataset YOLO ou COCO exporté ; **Optuna App** optimise ses hyperparamètres.
4. **Inference App** exécute le modèle entraîné, et **MLflow App** et **DVC App** tracent les runs et les versions de données.

L'**Orchestrator App** peut piloter automatiquement les premières étapes : elle demande à Annotation App de créer un projet à partir d'un sous-ensemble de Dataset Explorer, attend que vous annotiez, puis déclenche l'export YOLO dans son propre workspace. Annotation App fonctionne aussi seule, sans aucune autre app lancée.

Chaque utilisateur dispose d'un workspace isolé (`annotation_<utilisateur>` sous la racine des workspaces) qui contient la base de données, les projets, les sauvegardes et les exports. L'arborescence exacte est décrite dans la section *Arborescence du workspace sur disque* de [Configuration](configuration.fr.md).

## Démarrage rapide en cinq étapes

Ce démarrage rapide suppose que l'application est installée et lancée depuis VisionNexus (ou avec `python launcher.py --app annotation --workspace <racine> --user <nom>` depuis la racine de la suite). Pour l'installation, voir [Configuration](configuration.fr.md).

1. Sur la page des projets, cliquez sur **Nouveau projet**, saisissez un nom, choisissez **Séquence Image** pour une vidéo ou un dossier d'images ordonné (ou **Image Random** pour des images sans lien entre elles), puis cliquez sur **Créer**.
2. Dans l'espace d'annotation, cliquez sur **Importer**, déposez un dossier ou une vidéo sur le premier emplacement (ou tapez un chemin serveur comme `/srv/datasets/run01`), puis cliquez sur le bouton d'import en bas de la fenêtre. L'import se fait en tâche de fond.
3. Ouvrez l'onglet **Classes** à droite, cliquez sur **+**, créez une classe et sélectionnez-la pour en faire la classe active.
4. Appuyez sur `R`, tracez une boîte autour d'un objet, puis ouvrez l'onglet **Tracks** à gauche et cliquez sur **Propager par SAMURAI** pour le suivre dans la séquence.
5. Cliquez sur **Exporter**, choisissez **YOLO**, **COCO JSON** ou **.ver**, puis cliquez sur **Exporter**.

Le tutoriel interactif (bouton **Tutoriel interactif** de la page des projets) déroule les mêmes étapes sur un projet de démonstration en une dizaine de minutes.

## Pages de la documentation d'Annotation App

La documentation d'Annotation App est découpée en neuf pages. Les pages utilisateur viennent en premier, les pages développeur en dernier.

- [Guide utilisateur](user-guide.fr.md) : visite écran par écran de chaque page, panneau, bouton et raccourci, et quand s'en servir.
- [Procédures](workflows.fr.md) : tâches complètes de bout en bout en étapes numérotées, de la création d'un projet à l'export d'un dataset ou à l'utilisation depuis un pipeline Orchestrator.
- [Concepts](concepts.fr.md) : projets, séquences, frames, pistes et classes, et une explication simple de chaque algorithme (SAM2, SAMURAI, Grounding DINO, SAM3, homographie, flux optique), avec ses points forts et ses limites.
- [Configuration](configuration.fr.md) : installation (en ligne et hors ligne), poids des modèles, commandes de lancement, ports, variables d'environnement, arborescence du workspace, et chaque option de la fenêtre **Paramètres**.
- [Dépannage](troubleshooting.fr.md) : problèmes connus décrits par leur symptôme, avec cause et solution.
- [Architecture](architecture.fr.md) : composants backend et frontend, modèle de tâches et WebSocket, stockage, chaîne de chargement des images et ses caches, et invariants à ne pas casser.
- [Référence API](api-reference.fr.md) : endpoints HTTP et WebSocket regroupés par domaine.
- [Carte du code](code-map.fr.md) : où vit chaque fonctionnalité dans le code et où la modifier.
