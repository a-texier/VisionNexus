---
app: inference
doc_type: user-guide
audience: user
lang: fr
title: Guide utilisateur
order: 10
tags: [interface, onglet inférence, onglet évaluation, onglet config, modes]
sources: [Inference_App/frontend/src/App.tsx, Inference_App/frontend/src/components/LanguageToggle.tsx, Inference_App/frontend/src/i18n/translate.ts, Inference_App/config/defaults.yaml]
---

# Guide utilisateur

## En-tête et panneau d'entrées partagé

Inference App est une page unique avec un en-tête et deux zones : une barre latérale gauche d'entrées partagées par chaque onglet, et le contenu de l'onglet à droite.

L'en-tête affiche la marque **Inference** et trois boutons d'onglets : **Inférence**, **Évaluation** et **Config YAML**. Le bouton à l'extrémité droite affiche la langue courante (**EN** ou **FR**) ; cliquez dessus pour changer. Quand l'application est ouverte depuis VisionNexus, la langue choisie dans VisionNexus est appliquée au chargement et le bouton ne change que la fenêtre courante ; hors VisionNexus, le choix est enregistré dans `settings.json` du workspace (voir [Configuration](configuration.fr.md)).

La barre latérale, visible sur chaque onglet, contient :

- **Source image, vidéo ou dossier** : le chemin du média à lire, tel que le voit le backend (par exemple `/srv/data/video.mp4` sur une VM distante). Cliquez sur **Lire le média** pour le charger ; le résultat alimente l'aperçu de l'onglet **Inférence**.
- **Fichier de poids** : le chemin du checkpoint du modèle, tel que le voit le backend (par exemple un fichier `.pth` produit par Training App).
- **Moteur** : une liste déroulante des moteurs de détection disponibles (`GET /api/capabilities`, filtrée à ceux marqués disponibles). `yolox` est toujours présent ; les autres entrées viennent de plugins installés.
- **Architecture** : un champ texte libre pour la taille du modèle (par exemple `yolox-s`), correspondant au catalogue du moteur. C'est un champ texte, pas une liste déroulante : saisissez la chaîne de taille exacte.
- **Confiance** et **NMS IoU** : deux champs numériques (0 à 1, pas de 0,05) appliqués à chaque run et évaluation.

Ces champs sont préremplis depuis `config/defaults.yaml` du workspace au chargement de la page (voir [Configuration](configuration.fr.md)) ; les valeurs que vous modifiez ici sont utilisées immédiatement pour le run suivant mais ne sont pas enregistrées tant que vous n'utilisez pas l'onglet **Config YAML**.

## Onglet Inférence : modes et exécution du modèle

L'onglet **Inférence** exécute le modèle sur la source chargée dans la barre latérale.

Trois boutons de mode choisissent ce qui arrive à chaque frame :

- **Inférence pure** ("YOLO uniquement") : le détecteur s'exécute sur chaque frame ; aucune identité n'est conservée entre les frames.
- **Multi-objet** ("YOLO + tracker optionnel") : le détecteur s'exécute sur chaque frame ; une ligne **Tracker** apparaît avec **Aucun** (détections seules) et **ByteTrack** (ajoute un identifiant d'objet stable par piste).
- **SOT par clic** ("YOLO initialise CSRT") : le détecteur s'exécute une fois sur la première frame ; cliquez sur un objet détecté dans l'aperçu pour le sélectionner, puis le tracker CSRT d'OpenCV le suit sur chaque frame suivante sans rappeler le détecteur.

Sous les boutons de mode, l'aperçu affiche la première frame de la source chargée. En mode **SOT par clic**, cliquer sur l'image place un marqueur en croix au point cliqué et sélectionne la détection sous-jacente ; un message de remplacement s'affiche à la place de l'aperçu tant qu'aucune source n'a été lue. Sous l'aperçu, une ligne de texte donne le type de média, la largeur, la hauteur, le nombre de frames et la fréquence d'images.

Cliquez sur **Lancer** (désactivé tant qu'une source n'est pas chargée, que les poids ne sont pas définis, ou, en mode SOT, qu'aucun clic n'a été fait) pour démarrer le run ; le bouton affiche "Traitement..." pendant le calcul. À la fin, un panneau de résultat affiche :

- Quatre chiffres : le nombre de **frames** traitées, les **fps global**, le temps **détecteur** par frame (ms) et le temps **tracker** par frame (ms, 0 sans tracker).
- Le résultat lui-même : une vidéo lisible si la source a produit une vidéo, ou l'image annotée sinon, tous deux servis depuis le dossier de sortie du run.

Une erreur (source illisible, poids manquants, clic SOT qui ne touche aucune détection) s'affiche dans un bandeau rouge au-dessus des boutons de mode.

## Onglet Évaluation : mesurer un modèle face à un dataset

L'onglet **Évaluation** calcule les métriques de détection standard sur le split `val` d'un dataset YOLO, en utilisant le même **Fichier de poids**, **Moteur** et **Architecture** que l'onglet **Inférence**, ainsi que les mêmes **Confiance** et **NMS IoU**.

1. Saisissez le chemin d'un fichier `data.yaml` (tel que le voit le backend) dans le champ **data.yaml**.
2. Cliquez sur **Évaluer** (désactivé tant qu'un chemin `data.yaml` et un chemin de poids ne sont pas tous deux définis) ; le bouton affiche "Évaluation..." pendant le calcul.
3. Le résultat affiche quatre chiffres (**mAP50**, **mAP50-95**, le nombre d'**images**, et **fps**) et trois graphiques : une courbe précision-rappel, une courbe F1 en fonction de la confiance, et une matrice de confusion.

L'évaluation utilise toujours le split `val` du `data.yaml` donné ; il n'y a pas moyen de choisir un autre split depuis l'interface (voir [Référence API](api-reference.fr.md) pour l'option sous-jacente). Le sens de chaque métrique et graphique est dans [Concepts](concepts.fr.md).

## Onglet Config YAML : modifier la configuration enregistrée

L'onglet **Config YAML** modifie le texte YAML brut qu'Inference App conserve pour le workspace courant, les mêmes valeurs qui préremplissent la barre latérale au chargement de la page.

1. La zone de texte affiche le YAML courant (chargé depuis `config.yaml` du workspace, ou les défauts embarqués si rien n'a encore été enregistré).
2. Modifiez n'importe quel champ directement dans le texte YAML ; le schéma est décrit dans [Configuration](configuration.fr.md).
3. Cliquez sur **Enregistrer et appliquer**. Le fichier est validé (il doit s'analyser comme un objet YAML) ; en cas de succès, les champs de la barre latérale (**Moteur**, **Architecture**, mode, tracker, **Confiance**, **NMS IoU**) sont mis à jour immédiatement selon les valeurs enregistrées.

Une erreur de syntaxe YAML, ou un document qui n'est pas un objet, s'affiche dans le bandeau d'erreur rouge et rien n'est enregistré. Le fichier `config/defaults.yaml` embarqué (pas cet onglet) est aussi ce que l'Orchestrator lit pour construire son propre formulaire de nœud Inference ; voir [Workflows](workflows.fr.md) pour exécuter l'application depuis un pipeline.
