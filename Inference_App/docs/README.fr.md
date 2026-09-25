---
app: inference
doc_type: readme
audience: both
lang: fr
title: Inference App
order: 0
tags: [inférence, yolox, tracking, bytetrack, évaluation, mAP]
sources: [Inference_App/backend/main.py, Inference_App/frontend/src/App.tsx, _lib/launcher_engine.py]
---

# Inference App

## Ce que fait Inference App

Inference App exécute un modèle YOLO entraîné sur une image, une vidéo ou un dossier d'images, et mesure la qualité du modèle. Elle est volontairement compacte et autonome : une page, trois modes, un moteur de détection intégré.

- **Inférence pure** : exécute le détecteur sur chaque frame, sans aucun tracker par-dessus, pour inspecter et mesurer le modèle lui-même.
- **Multi-objet (MOT)** : le même détecteur, avec un passage d'association ByteTrack facultatif qui maintient une identité stable par objet d'une frame à l'autre.
- **Mono-objet (SOT) par clic** : cliquez sur une détection de la première frame ; le tracker CSRT d'OpenCV suit ensuite cet objet sans rappeler le détecteur.
- **Évaluation de détection** : mAP50, mAP50-95, une courbe précision-rappel, une courbe F1 et une matrice de confusion, calculées sur le split de validation d'un dataset YOLO.
- **Moteur YOLOX intégré**, réutilisant le code d'architecture de Training App, un checkpoint entraîné là-bas se charge donc ici sans modification. D'autres moteurs de détection peuvent être ajoutés sous forme de plugins.

L'interface lit et écrit le média, le chemin des poids et le dataset d'évaluation comme de simples chemins sur la machine du backend ; rien n'est téléversé par le navigateur.

## Place d'Inference App dans le pipeline de la suite

Inference App est la dernière étape du pipeline de détection dans la suite Computer Vision :

1. **Annotation App** produit un dataset annoté ; **Training App** y entraîne un modèle YOLOX (ou d'un moteur de plugin).
2. **Inference App** exécute ce modèle entraîné sur de nouvelles images ou vidéos, avec ou sans tracking, et l'évalue face à un jeu de validation.
3. **MLflow App** et **DVC App** suivent les runs et datasets utilisés en chemin ; l'**Orchestrator App** peut enchaîner annotation, entraînement et inférence automatiquement.

Inference App n'a pas de workspace d'état partagé au-delà de ses propres sorties de run : elle prend un chemin de poids et un chemin de source, et écrit ses résultats dans son propre dossier `runs/`. Voir [Configuration](configuration.fr.md) pour l'arborescence du workspace.

## Démarrage rapide en cinq étapes

Ce démarrage rapide suppose que l'application est installée et lancée depuis VisionNexus, ou avec `python launcher.py --app inference --workspace <racine> --user <nom>` depuis la racine de la suite (voir [Configuration](configuration.fr.md)).

1. Dans **Source image, vidéo ou dossier**, saisissez le chemin d'une vidéo, d'une image ou d'un dossier d'images accessible au backend, puis cliquez sur **Lire le média**.
2. Dans **Fichier de poids**, saisissez le chemin d'un checkpoint YOLOX `.pth` (par exemple le meilleur modèle d'un run Training App) ; laissez **Moteur** sur `yolox` et **Architecture** sur la taille correspondante (`yolox-s` par défaut).
3. Choisissez un mode : **Inférence pure**, **Multi-objet** (avec **ByteTrack** en option), ou **SOT par clic** (puis cliquez sur l'objet dans l'aperçu).
4. Cliquez sur **Lancer** et attendez le résultat : l'image ou la vidéo annotée, plus les chiffres d'images par seconde.
5. Pour mesurer le modèle plutôt que l'exécuter, ouvrez l'onglet **Évaluation**, saisissez le chemin d'un `data.yaml`, et cliquez sur **Évaluer**.

## Pages de documentation d'Inference App

La documentation d'Inference App est répartie en neuf pages. Les pages utilisateur viennent d'abord, les pages développeur ensuite.

- [Guide utilisateur](user-guide.fr.md) : les trois onglets de l'interface, champ par champ.
- [Workflows](workflows.fr.md) : tâches complètes en étapes numérotées, d'une première inférence à une évaluation pilotée par l'Orchestrator.
- [Concepts](concepts.fr.md) : modes d'inférence, ByteTrack, CSRT, métriques de détection et contrat des plugins de moteur, expliqués simplement.
- [Configuration](configuration.fr.md) : installation, commandes de lancement, ports, variables d'environnement, arborescence du workspace et schéma de `config.yaml`.
- [Dépannage](troubleshooting.fr.md) : problèmes connus classés par symptôme, avec cause et solution.
- [Architecture](architecture.fr.md) : composants, contrat des détecteurs, pipelines d'inférence et d'évaluation, et invariants à ne pas casser.
- [Référence API](api-reference.fr.md) : endpoints HTTP, y compris le contrat Orchestrator.
- [Carte du code](code-map.fr.md) : où se trouve chaque fonction dans le code et où la modifier.
