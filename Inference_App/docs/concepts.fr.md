---
app: inference
doc_type: concepts
audience: user
lang: fr
title: Concepts
order: 30
tags: [bytetrack, csrt, sot, mot, mAP, évaluation, plugin détecteur]
sources: [Inference_App/backend/inference_core/runner.py, Inference_App/backend/inference_core/bytetrack.py, Inference_App/backend/inference_core/detectors.py, Inference_App/backend/inference_core/evaluation.py, Inference_App/backend/inference_core/models.py]
---

# Concepts

## Les trois modes d'inférence

Inference App lit une source frame par frame et, pour chaque frame, exécute l'un de trois pipelines, choisi par le mode :

- **infer** (Inférence pure) : le détecteur s'exécute sur chaque frame ; chaque détection est dessinée, sans lien entre les frames.
- **mot** (Multi-objet) : le détecteur s'exécute sur chaque frame ; avec le tracker réglé sur **Aucun**, le résultat est identique à l'inférence pure ; avec **ByteTrack**, les détections sont en plus associées en pistes avec un identifiant stable.
- **sot** (Mono-objet par clic) : le détecteur s'exécute une fois, sur la première frame, pour construire la liste des détections cliquables ; celle que vous cliquez amorce un tracker CSRT d'OpenCV, qui s'exécute ensuite seul sur chaque frame suivante.

Les trois modes partagent le même appel au détecteur et le même code de dessin ; ce qui diffère est ce qui arrive à la sortie du détecteur avant qu'elle soit dessinée (voir [Architecture](architecture.fr.md)).

## Le détecteur : YOLOX et les moteurs enfichables

Le détecteur transforme une image en une liste de boîtes, chacune avec une classe, une étiquette et un score de confiance. Inference App fournit un détecteur, **YOLOX**, construit sur exactement le même code d'architecture que Training App (`build_exp`, `load_checkpoint`) : un checkpoint produit par un run Training App se charge ici sans modification, tant que la même taille est sélectionnée.

**Confiance** est le score minimal qu'une détection doit atteindre pour être conservée ; l'augmenter retire les détections plus faibles, moins sûres. **NMS IoU** est le seuil de recouvrement utilisé pour retirer les boîtes en double sur un même objet (suppression non-maximale) : le baisser retire plus de doublons qui se chevauchent, au risque de retirer deux objets réellement distincts mais qui se chevauchent.

D'autres moteurs de détection peuvent être ajoutés sous forme de plugins, découverts de la même façon que les moteurs d'entraînement de Training App mais dans un groupe séparé (`visionnexus.detector_backends`). Un moteur de plugin n'est utilisable dans Inference App que s'il existe aussi comme moteur d'entraînement Training App produisant des poids compatibles, Inference App n'entraînant jamais rien elle-même.

## ByteTrack : conserver une identité entre les frames

ByteTrack relie les détections d'un même objet à travers des frames consécutives en une **piste**, identifiée par un numéro affiché en `#<id>` sur la sortie annotée. Il fonctionne en deux passes par frame :

1. Les détections de haute confiance (score au moins égal au seuil haut) sont appariées aux pistes existantes par recouvrement de boîte ; un appariement met à jour la piste, une détection de haute confiance non appariée au-dessus du seuil de nouvelle piste en démarre une nouvelle.
2. Les détections de faible confiance (entre les seuils bas et haut) sont appariées uniquement aux pistes qui n'ont trouvé aucun appariement de haute confiance à la première passe, ce qui permet à une piste de survivre à une frame où l'objet a été détecté faiblement (occlusion partielle, flou de mouvement) au lieu d'être perdue et renumérotée.

Une piste qui ne trouve aucun appariement pendant plus que la taille du buffer de frames consécutives est abandonnée ; une nouvelle détection du même objet démarre ensuite un nouvel identifiant. Deux objets similaires qui se croisent peuvent aussi échanger leurs identifiants si l'appariement fondé sur le recouvrement choisit le mauvais couplage. ByteTrack ne fait que réassocier des détections que le modèle a déjà trouvées : il ne peut pas récupérer un objet que le détecteur a manqué sur chaque frame.

## CSRT : suivre un objet cliqué

CSRT (Channel and Spatial Reliability Tracking, d'OpenCV) suit l'apparence d'un objet frame par frame sans rappeler le détecteur après l'initialisation. En mode **SOT par clic**, la sortie du détecteur sur la première frame fournit les boîtes candidates ; en cliquer une la sélectionne et transmet sa boîte à CSRT comme position de départ.

CSRT s'adapte à un changement d'apparence modéré et à de courtes occlusions partielles, mais n'a aucune notion de "classe d'objet" ni de "confiance" : une fois qu'il commence à suivre la mauvaise région (après un mouvement rapide, une occlusion complète, ou deux objets similaires qui se croisent), il continue de suivre cette région sans récupération automatique. Il n'y a aucun moyen de resélectionner l'objet en cours de vidéo depuis l'interface ; un suivi SOT perdu doit être relancé depuis une frame où l'objet est clairement visible.

## Évaluation de détection : mAP, précision-rappel, F1 et matrice de confusion

L'évaluation compare les prédictions du modèle sur les images de validation d'un `data.yaml` à leurs labels de vérité terrain YOLO `.txt`, avec une implémentation de métriques indépendante, similaire dans l'esprit à celle de Training App mais sans code partagé, de petites différences numériques entre les valeurs de mAP des deux apps sont donc à prévoir.

- **IoU** (intersection sur union) : le recouvrement entre une boîte prédite et une boîte de vérité terrain ; une prédiction compte comme correcte (un vrai positif) quand son IoU avec une boîte de vérité terrain non appariée de la même classe atteint un seuil.
- **mAP50** : précision moyenne moyennée sur les classes à IoU 0,50 ; indique si les objets sont trouvés avec une boîte à peu près juste.
- **mAP50-95** : la moyenne de cette précision moyenne à dix seuils d'IoU de 0,50 à 0,95 ; récompense aussi les boîtes précises, et constitue le score de qualité principal.
- **Courbe précision-rappel** : précision en fonction du rappel à IoU 0,50, résumant le compromis entre objets manqués et fausses alarmes quand le seuil de confiance varie.
- **Courbe F1** : la moyenne harmonique de la précision et du rappel en fonction du seuil de confiance ; son sommet est un seuil de confiance raisonnable à utiliser pour l'inférence avec ce modèle.
- **Matrice de confusion** : à IoU 0,50 et une confiance fixe de 0,25, quelle classe a été prédite face à quelle classe a été annotée, plus une ligne background (objets manqués) et une colonne background (fausses alarmes).

L'évaluation utilise toujours le split `val` du `data.yaml` ; c'est une mesure fixe et déterministe, contrairement au mAP d'un run Training App qui ne reflète que la dernière epoch évaluée de l'entraînement.

## Chiffres de benchmark : fps et temps par étape

Chaque run d'inférence et chaque benchmark de tracker remonte des chiffres de temps, distincts des chiffres de précision d'une évaluation :

- **fps** (images par seconde, global) : frames traitées divisées par la durée totale du run (temps réel), y compris les entrées/sorties, le dessin et l'écriture du résultat.
- **fps détecteur** / **détecteur ms/frame** : temps passé uniquement dans le détecteur, isolant la vitesse du modèle du reste du pipeline.
- **tracker ms/frame** : temps passé uniquement dans l'étape d'association de ByteTrack ; 0 quand aucun tracker ne s'exécute.

Ces chiffres dépendent du matériel (GPU ou CPU, modèle de GPU), de la taille d'image et de la taille du modèle, et n'ont de sens que comparés à un run sur la même machine et la même source.

## Fonctionnement interne du détecteur et des trackers d'Inference App

Inference App exécute un seul réseau de neurones, YOLOX, et deux trackers qui ne contiennent aucun réseau de neurones. Cette section décrit le chemin exact d'une image, car plusieurs comportements de la sortie en découlent.

### YOLOX à l'inférence : letterbox, décodage, score et suppression des non-maxima

Le réseau est celui décrit dans Training App : un backbone CSPDarknet, un neck d'agrégation de chemins et une tête découplée sans ancres sur trois échelles. À l'inférence, l'image est redimensionnée pour tenir dans la taille de test du modèle en gardant ses proportions, et la zone restante est remplie de gris (letterbox), si bien que rien n'est étiré ; le ratio est mémorisé pour ramener les boîtes sur l'image d'origine. La tête produit, pour chaque cellule des trois cartes, une boîte, un objectness et des probabilités de classe. Le score d'une détection est l'objectness multiplié par la probabilité de sa meilleure classe, et la détection est gardée quand ce score atteint **Confiance**. Les détections qui se recouvrent pour une même classe sont ensuite fusionnées par suppression des non-maxima : la meilleure boîte est gardée et celles dont l'IoU avec elle dépasse **NMS IoU** sont écartées. La suppression se fait par classe, si bien que deux objets de classes différentes au même endroit survivent tous les deux.

Le nombre de classes est lu dans le checkpoint lui-même, ce qui explique qu'un checkpoint issu de Training App se charge sans configuration, et qu'une taille inadaptée à un checkpoint échoue au chargement au lieu de donner de fausses boîtes.

### Le tracker de style ByteTrack : appariement par recouvrement sans modèle de mouvement

Le tracker d'Inference App est une association compacte en deux passes dans l'esprit de ByteTrack, pas l'implémentation de référence complète. À chaque passe, chaque piste est comparée à chaque détection de la même classe, les paires sont classées par IoU, et les meilleures paires sont prises une à une, chaque piste et chaque détection n'étant utilisées qu'une fois, tant que l'IoU dépasse **match_thresh** (0,3 par défaut). La première passe utilise les détections à haute confiance ; celles qui restent sans appariement et atteignent au moins **new_track_thresh** (0,6 par défaut) créent de nouvelles pistes. La seconde passe laisse les détections à faible confiance sauver les pistes qui n'ont rien trouvé à la première.

Il n'y a ni filtre de Kalman ni prédiction de mouvement : une piste est comparée à la dernière boîte qu'elle a reçue, pas à l'endroit où l'objet devrait être maintenant. Cela rend le tracker simple à raisonner et peu coûteux, mais un objet rapide, dont les boîtes ne se recouvrent plus d'une image à l'autre, perd son identité, et une piste ne survit à un trou du détecteur que pendant **track_buffer** images au plus (30 par défaut). Les identités ne dépendent d'ailleurs jamais de l'apparence de l'objet.

### CSRT : un filtre de corrélation entraîné sur la boîte cliquée

CSRT est un tracker classique d'OpenCV sans réseau de neurones. À partir de la boîte choisie à la première image, il apprend un filtre de corrélation, c'est-à-dire un gabarit de l'objet fait de plusieurs canaux de caractéristiques (couleur, gradients), et il pondère les canaux et les pixels de la boîte selon leur fiabilité (fiabilité de canal et spatiale), ce qui lui permet d'ignorer l'arrière-plan à l'intérieur de la boîte. À chaque image, il cherche autour de la position précédente l'endroit où le filtre répond le plus fort, puis met le filtre à jour. Il n'appelle jamais le détecteur, n'a aucune notion de classe ni de confiance, et ne se rétablit pas après une occlusion complète : il continue de suivre la région où la réponse est la plus forte, même quand c'est la mauvaise.
