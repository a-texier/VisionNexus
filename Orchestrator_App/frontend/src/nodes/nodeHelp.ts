// nodeHelp.ts — contenu du panneau d'AIDE (bouton HELP rouge du NodeConfigPanel).
// Explique chaque paramètre : ce que c'est, les options, l'effet selon la plage.

export interface ParamHelp { name: string; what: string; options?: string; effect?: string }
export interface NodeHelp { intro?: string; params: ParamHelp[] }

export const NODE_HELP: Record<string, NodeHelp> = {
  // ── Inference / Éval ──────────────────────────────────────────────────────
  inference: {
    intro: "Nœud unifié : acquisition (FREE), ou détection/tracking (LOCKED). En Auto = headless "
         + "ou command (rejeu cmd_send) ; en Manuel = session interactive dans l'app.",
    params: [
      { name: 'Auto / Manuel', what: 'Mode d\'exécution du nœud.',
        options: 'Auto (headless/command, sans écran) · Manuel (interactif, ouvre l\'app pour le SOT/MOT à la main)',
        effect: 'Manuel = human_gate (le pipeline attend que vous validiez dans l\'app).' },
      { name: 'task = detection', what: 'Détection YOLO seule sur une SÉQUENCE, comparée à un GT (.ver ou dossier .txt YOLO). Pas de data.yaml (réservé au Training).',
        options: 'GT : fichier .ver OU dossier de .txt YOLO par frame',
        effect: 'Sortie : précision / rappel / tp-fp-fn → MLflow.' },
      { name: 'task = tracking', what: 'Tracker sur une séquence (MOT, + SOT si fichier commandes).',
        effect: 'Sortie : vidéo annotée + benchmark (MOTA/IDF1 si GT).' },
      { name: 'model_path', what: 'Chemin du .pt à utiliser. Vide = modèle du Training amont (arête) ou d\'un nœud Modèle.',
        effect: 'Détermine le détecteur YOLO. Vide + aucun amont = best.pt le plus récent.' },
      { name: 'cmd_file (cmd_send)', what: 'Fichier .txt de clics rejoués (frame,x,y). Vide = MOT seul, rempli = test SOT+MOT.',
        options: 'vide → mode headless · rempli → mode command (rejeu déterministe)',
        effect: 'Permet de rejouer une session SOT identique (repro).' },
      { name: 'tracker_mot', what: 'Tracker multi-objets (plein cadre).',
        options: 'custom_kalman (léger CPU) · bytetrack · botsort (GMC) · boosttrack (ECC+Mahalanobis) · none (SOT pur)',
        effect: 'none = pas de MOT, uniquement SOT sur clic (detector_roi obligatoire).' },
      { name: 'tracker_sot', what: 'Tracker mono-objet déclenché au clic.',
        options: 'dummy (suit la track MOT) · csrt (DCF CPU) · tracking_tophat (Top-Hat IR) · dimp/ostrack/sam2 (GPU)',
        effect: 'GPU requis pour dimp/ostrack/sam2 (2–8 GB VRAM).' },
      { name: 'n_targets', what: 'Nombre de cibles SOT simultanées.',
        options: '1 (clic gauche) · 2 (clic gauche = cible 1 magenta, clic droit = cible 2 orange)' },
      { name: 'annotation_file (GT)', what: 'Vérité terrain (.ver ou YOLO .txt) pour calculer les métriques. '
          + 'Si un nœud Annotation est branché directement sur ce port (au lieu de Training), laissez ce champ '
          + 'vide : il est dérivé automatiquement du split choisi ci-dessous (labels/).',
        effect: 'Sans GT : benchmark de vitesse seul. Avec GT : MOTA/IDF1 (tracking) ou précision/rappel (détection).' },
      { name: 'gt_split (Annotation branchée)', what: 'Annotation exporte un data.yaml COMPLET (train + val + test) — le '
          + 'Training consomme les 3 splits, mais Inference évalue sur UN SEUL split à la fois (séquence + GT ponctuels). '
          + 'Ce sélecteur choisit lequel des 3 dossiers ({export}/train|val|test/{images,labels}) alimente la séquence et le GT.',
        options: 'train (voir le sur-apprentissage) · val (défaut, éval standard) · test (jeu jamais vu par le training)',
        effect: 'Sans nœud Annotation branché ici, ce sélecteur n\'apparaît pas (séquence/GT restent manuels ou hérités d\'un dataset_source).' },
      { name: 'compute_metrics', what: 'Active le calcul MOTA/IDF1 (nécessite un GT).' },
      { name: 'light_render', what: 'Rendu ultra-rapide (bboxes seules, zéro texte/traîne).',
        options: 'true (défaut, bench/stream) · false (complet : légende, IDs, traîne, HUD)',
        effect: 'true économise ~3–5 ms/frame ; false pour l\'analyse visuelle.' },
      { name: 'save_video / save_frames', what: 'Sauver la vidéo MP4 / chaque frame annotée.',
        effect: 'save_frames = écriture disque lourde (~500 Ko/frame PNG).' },
      { name: 'frame_ext', what: 'Format des frames sauvées.', options: 'png (sans perte) · jpg (compressé, bande passante)' },
      { name: 'trail', what: 'Longueur de la traîne de trajectoire (frames). 0 = désactivé.' },
      { name: 'start/stop_frame_idx', what: 'Fenêtre de frames traitées (retest sur une zone). -1 = jusqu\'à la fin.' },
      { name: 'device', what: 'Périphérique PyTorch pour les trackers GPU.', options: 'cuda · cpu' },
      { name: 'fps', what: 'Fréquence cible (Hz) — pilote le temps d\'attente du loader.' },
      { name: 'conf_thresh / iou_thresh / img_size (YOLO)', what: 'Détection : seuil de confiance, seuil NMS, taille réseau.',
        effect: 'conf bas = plus de détections (et de faux positifs). imgsz haut = plus précis, plus lent.' },
    ],
  },

  // ── Training ──────────────────────────────────────────────────────────────
  training: {
    intro: "Entraîne un YOLO (Ultralytics). Auto = REST bloquant ; Manuel = gate (lancez dans l'app).",
    params: [
      { name: 'yolo_version / model_size', what: 'Architecture et taille du modèle. Figées si un nœud Modèle est branché.',
        options: 'yolov8/9/10/11 · n < s < m < l < x (petit→grand, rapide→précis)' },
      { name: 'epochs', what: 'Nombre de passes sur le dataset.', effect: 'Plus = meilleure convergence mais surapprentissage possible.' },
      { name: 'batch', what: 'Nombre d\'images par pas.', effect: 'Limité par la VRAM. Trop grand = OOM.' },
      { name: 'imgsz', what: 'Taille d\'entrée (px, carré).', options: '640 standard · 1280 petits objets (plus lent)' },
      { name: 'lr0 / lrf', what: 'Learning rate initial / final (fraction).', effect: 'lr0 trop haut = divergence ; trop bas = lent.' },
      { name: 'patience', what: 'Early-stopping : epochs sans amélioration avant arrêt.' },
      { name: 'mosaic / mixup / degrees…', what: 'Augmentations de données.', effect: 'Renforcent la généralisation ; trop = artefacts.' },
      { name: 'run_label', what: 'Nom du run (dossier + best.pt). Ton nom custom pour la sortie.' },
    ],
  },

  // ── Annotation ────────────────────────────────────────────────────────────
  annotation: {
    intro: "Crée un projet d'annotation et exporte au format YOLO (train/val/test). Full Auto = IA (SAM3/GDINO). "
         + "Une SEULE sortie physique (le dossier YOLO exporté), mais DEUX usages en aval selon le nœud branché : "
         + "vers Training → tout le data.yaml (3 splits) sert à l'entraînement. Vers Inference/Éval → un split "
         + "unique (choisi sur le nœud Inference) sert de séquence + GT pour l'évaluation. Rien à configurer ici "
         + "pour ça, c'est le nœud AVAL (Inference) qui choisit son split.",
    params: [
      { name: 'Mode', what: 'Type de projet.', options: 'sequence (vidéo/optional_format, onglet Tracks) · random (images indépendantes)' },
      { name: 'Full Automatique (IA)', what: 'Annote sans intervention via un modèle open-vocabulary.',
        effect: 'false = gate humaine (vous annotez dans l\'app).' },
      { name: 'ai_model', what: 'Modèle d\'auto-annotation.', options: 'sam3 (masques) · grounding_dino (boîtes texte)' },
      { name: 'ai_text (prompt)', what: 'Classes à détecter en langage naturel.', options: 'ex: "car. person. tree."' },
      { name: 'ai_threshold (box_threshold)', what: 'Score minimum des boîtes retenues.',
        effect: 'Bas = plus de détections + faux positifs ; haut = plus strict.' },
      { name: 'split_train/val/test', what: 'Répartition de l\'export YOLO (dossiers {export}/train|val|test/{images,labels}).',
        effect: 'Somme = 1.0 (test optionnel). Training lit les 3 ; Inference/Éval n\'en lit qu\'un (gt_split).' },
    ],
  },

  // ── Optuna ────────────────────────────────────────────────────────────────
  optuna: {
    intro: "Étude d'optimisation d'hyperparamètres (TPE + pruning). Entraîne un YOLO par trial.",
    params: [
      { name: 'n_trials', what: 'Nombre d\'essais (chaque essai = un entraînement).', effect: 'Plus = meilleure recherche mais coûteux (N trainings).' },
      { name: 'direction', what: 'Sens d\'optimisation de la métrique.', options: 'maximize (mAP) · minimize (loss)' },
      { name: 'metric', what: 'Objectif optimisé.', options: 'map50 · map5095 · recall · precision' },
      { name: 'optimize (espace de recherche)', what: 'Hyperparamètres explorés (cochés).',
        effect: 'Non cochés = valeurs par défaut. TPE échantillonne les cochés dans des plages FIXES, définies côté Optuna App (DEFAULT_RANGES) — il n\'y a PAS de champ min/max ici, seulement le choix binaire "optimisé ou non" pour chaque hyperparamètre ci-dessous.' },
      { name: 'Arrêter le pipeline si HPO échoue', what: 'Politique appliquée si aucun trial ne termine avec une métrique exploitable.',
        options: 'coché (défaut) = Training ne démarre pas · décoché = Training démarre sans best_params Optuna',
        effect: 'En fallback, Training conserve exactement les hyperparamètres configurés dans son propre nœud, puis les valeurs par défaut de Training pour les champs absents.' },
      { name: 'lr0', what: 'Learning rate initial.', effect: 'Le plus influent en général — vitesse d\'apprentissage au 1er epoch.' },
      { name: 'lrf', what: 'Learning rate final (fraction de lr0, via le scheduler).', effect: 'Contrôle la décroissance du LR en fin d\'entraînement.' },
      { name: 'momentum', what: 'Momentum SGD/Adam.', effect: 'Lisse les mises à jour de gradient — trop haut = oscillations.' },
      { name: 'weight_decay', what: 'Régularisation L2 des poids.', effect: 'Trop haut = sous-apprentissage ; trop bas = surapprentissage.' },
      { name: 'box', what: 'Poids de la loss de régression des boîtes (IoU).', effect: 'Monte = priorise la précision de localisation vs classification.' },
      { name: 'cls', what: 'Poids de la loss de classification.', effect: 'Monte = priorise la bonne classe vs la bonne boîte.' },
      { name: 'dfl', what: 'Poids de la Distribution Focal Loss (affinage des bords de boîte).', effect: 'Impact fin sur la précision de localisation.' },
      { name: 'mosaic', what: 'Probabilité d\'augmentation mosaïque (4 images combinées).', effect: 'Aide la généralisation, surtout sur petits datasets.' },
      { name: 'mixup', what: 'Probabilité d\'augmentation mixup (mélange linéaire de 2 images).', effect: 'Régularisation supplémentaire, utile si peu de données.' },
      { name: 'scale', what: 'Amplitude du zoom aléatoire (augmentation).', effect: 'Aide à généraliser sur des objets de tailles variées.' },
      { name: 'degrees', what: 'Amplitude de rotation aléatoire (degrés).', effect: 'Utile si les objets peuvent apparaître sous différents angles.' },
      { name: 'translate', what: 'Amplitude de translation aléatoire (fraction de l\'image).', effect: 'Aide à la robustesse au cadrage.' },
      { name: 'best_params (mode manuel)', what: 'Params saisis à la main après une étude dans l\'app.',
        options: 'format clé=valeur, séparés par virgules, ou JSON', effect: 'Transitent par l\'arête → fusionnés dans le Training aval.' },
    ],
  },

  // ── Dataset Explorer ──────────────────────────────────────────────────────────────
  explorer: {
    intro: "Crée un subset sémantique par requête CLIP, ou expose un subset existant (FREE).",
    params: [
      { name: 'query (requête sémantique)', what: 'Texte décrivant les images voulues (embeddings CLIP).', options: 'ex: "night dark road car headlight"' },
      { name: 'top_k', what: 'Nombre d\'images sélectionnées (les plus proches de la requête).' },
      { name: 'Full Automatique (CLIP)', what: 'true = sélection auto par requête ; false = sélection manuelle dans le Playground.' },
    ],
  },

  // ── Dataset Source (input) ─────────────────────────────────────────────────
  dataset_source: {
    intro: "Nœud d'ENTRÉE : un dossier d'images source. Alimente explorer, Annotation ou Inference.",
    params: [
      { name: 'dataset_name', what: 'Identifiant du dataset (repris comme subset/projet en aval).' },
      { name: 'dataset_path', what: 'Chemin absolu vers le dossier d\'images (zéro copie).' },
      { name: 'n_clusters', what: 'Nombre de clusters CLIP pour la visualisation (explorer).' },
    ],
  },

  // ── Model (input) ──────────────────────────────────────────────────────────
  model: {
    intro: "Nœud d'ENTRÉE : un modèle YOLO .pt fourni manuellement.",
    params: [
      { name: 'model_path', what: 'Chemin du fichier .pt (poids).' },
      { name: 'yolo_version / model_size', what: 'Architecture du .pt. Branché sur un Training, FIGE sa version/taille.',
        effect: 'Un best.pt v8n ne peut être fine-tuné qu\'en v8n — d\'où le gel.' },
    ],
  },

  // ── DVC ────────────────────────────────────────────────────────────────────
  dvc: {
    intro: "Versionne un run reproductible : dataset + best model + snapshot du graphe, en un seul commit git/DVC.",
    params: [
      { name: '« artefact » (port d\'entrée)', what: 'DVC ne verse PAS un type de donnée unique — le port accepte '
          + "n'importe quel résultat produit en amont (Annotation = dataset YOLO, explorer = subset, Training = "
          + 'modèle .pt, Inference/Éval = métriques, Optuna = best params). Peu importe le nœud branché, DVC '
          + 'commite TOUJOURS la même chose : le dataset YOLO (dérivé en remontant jusqu\'à l\'ancêtre Annotation) '
          + '+ le modèle .pt (dérivé en remontant jusqu\'à l\'ancêtre Training, s\'il y en a un) + un snapshot JSON '
          + 'du graphe entier (nodes+edges) pour pouvoir tout rejouer plus tard.',
        effect: 'Le TYPE du nœud branché ne change rien au comportement — il sert juste à fixer où DVC se place dans la chaîne (généralement en bout, après Inference/Éval).' },
      { name: 'commit_message', what: 'Message du commit git/DVC.' },
    ],
  },

  // ── MLflow (superviseur) ───────────────────────────────────────────────────
  mlflow: {
    intro: "Nœud SUPERVISEUR : aucun branchement. Observe le store MLflow du workspace.",
    params: [{ name: '(aucun paramètre)', what: 'Chaque Training/Inference logue un run {graphe}/{nœud} automatiquement.' }],
  },
}
