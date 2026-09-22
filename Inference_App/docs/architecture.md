# Architecture

L'application suit un flux court et explicite :

```text
fichier/dossier -> lecteur OpenCV -> détecteur YOLO -> sortie annotée
                                             |-> ByteTrack (MOT optionnel)
clic initial -> détection choisie -> CSRT OpenCV (SOT)
```

## Modes

### Inférence pure

Le détecteur traite chaque frame. Aucune identité temporelle n'est créée. Ce
mode permet de mesurer et d'inspecter le modèle sans surcouche de tracking.

### Multi-objet

Sans tracker, le mode affiche toutes les détections YOLO. Avec ByteTrack, les
détections passent par une association en deux étapes : les détections fortes
créent et mettent à jour les pistes, les détections plus faibles peuvent
maintenir une piste existante.

### SOT par clic

YOLO détecte les objets de la première frame. Le clic sélectionne la meilleure
boîte qui contient ce point. Cette boîte initialise le tracker CSRT d'OpenCV ;
les frames suivantes ne relancent pas le détecteur.

## Moteurs

`detectors.py` expose une sortie unique : une liste de boîtes `xyxy`, score,
classe et libellé. YOLOX est résolu depuis le moteur natif de Training App afin
d'éviter une seconde copie de l'architecture. Les moteurs optionnels sont
chargés par le groupe `visionnexus.detector_backends`.

## Évaluation

`evaluation.py` lit un `data.yaml` YOLO et les fichiers d'annotations `.txt`.
Les prédictions sont appariées au ground truth pour les seuils IoU 0.50 à 0.95.
Chaque run produit `metrics.json`, `pr_curve.png`, `f1_curve.png` et
`confusion_matrix.png`.

Pour ByteTrack, le run rapporte aussi le coût du détecteur, le coût de
l'association et les FPS bout en bout. Des métriques d'identité telles que MOTA
ou IDF1 exigent un jeu de vérité terrain avec identifiants de pistes ; elles ne
sont pas inventées à partir de simples labels YOLO.

