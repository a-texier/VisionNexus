// nodeHelp.ts — contenu du panneau d'AIDE (bouton HELP rouge du NodeConfigPanel).
// Explique chaque paramètre : ce que c'est, les options, l'effet selon la plage.

export interface ParamHelp { name: string; what: string; options?: string; effect?: string }
export interface NodeHelp { intro?: string; params: ParamHelp[] }

export const NODE_HELP: Record<string, NodeHelp> = {
  // ── Inference / Éval ──────────────────────────────────────────────────────
  inference: {
    intro: "Nœud léger : inférence YOLO pure, détection multi-objet avec ByteTrack optionnel, "
         + "ou SOT interactif par clic avec CSRT.",
    params: [
      { name: 'Auto / Manuel', what: 'Mode d\'exécution du nœud.',
        options: 'Auto (inférence/MOT sans écran) · Manuel (ouvre l\'app pour choisir le média et cliquer une cible SOT)',
        effect: 'Manuel = human_gate (le pipeline attend que vous validiez dans l\'app).' },
      { name: 'task = detection', what: 'Détection YOLO seule sur une SÉQUENCE, comparée à un GT (.ver ou dossier .txt YOLO). Pas de data.yaml (réservé au Training).',
        options: 'GT : fichier .ver OU dossier de .txt YOLO par frame',
        effect: 'Sortie : précision / rappel / tp-fp-fn → MLflow.' },
      { name: 'task = tracking', what: 'Détection multi-objet YOLO, avec association ByteTrack optionnelle.',
        effect: 'Sortie : média annoté + temps détecteur, temps tracker et FPS bout en bout.' },
      { name: 'model_path', what: 'Fichier de poids produit par le moteur choisi. Vide = modèle du Training amont ou d\'un nœud Modèle.',
        effect: 'Le moteur voyage avec le checkpoint et peut être fourni par un plugin.' },
      { name: 'tracker_mot', what: 'Tracker multi-objets (plein cadre).',
        options: 'none (inférence YOLO pure) · bytetrack (identités multi-objets)',
        effect: 'ByteTrack fonctionne après le détecteur natif ou un détecteur de plugin.' },
      { name: 'tracker_sot', what: 'Tracker mono-objet déclenché au clic.',
        options: 'csrt (OpenCV, CPU)',
        effect: 'Le clic choisit une détection YOLO sur la première frame, puis CSRT suit cette boîte.' },
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
    intro: "Entraîne un modèle avec le moteur choisi (Training_App, YOLOX par défaut). Auto = REST bloquant ; Manuel = gate (lancez dans l'app).",
    params: [
      { name: 'engine', what: 'Moteur d\'entraînement (Training_App). YOLOX par défaut ; le sélecteur n\'apparaît que si un plugin en fournit d\'autres.', effect: 'Les poids produits ne se rechargent qu\'avec leur moteur : il voyage avec eux (nœud Modèle, Training, MLflow).' },
      { name: 'model_size', what: 'Taille du modèle, dans le catalogue du moteur. Moteur et taille sont figés si un nœud Modèle est branché.',
        options: 'YOLOX : yolox-nano < tiny < s < m < l < x (petit→grand, rapide→précis)' },
      { name: 'epochs', what: 'Nombre de passes sur le dataset (max_epoch).', effect: 'Plus = meilleure convergence mais surapprentissage possible.' },
      { name: 'batch', what: 'Nombre d\'images par pas.', effect: 'Limité par la VRAM. Trop grand = OOM.' },
      { name: 'imgsz', what: 'Taille d\'entrée (px, carré).', options: '640 standard · 1280 petits objets (plus lent)' },
      { name: 'hyperparamètres', what: 'Formulaire propre au moteur choisi (ses clés et ses défauts).', effect: 'Changer de moteur repart de ses défauts : les clés d\'un moteur n\'ont pas de sens pour un autre.' },
      { name: 'basic_lr_per_img (YOLOX)', what: 'Learning rate par image (lr réel = valeur × batch_size).', effect: 'Trop haut = divergence ; trop bas = lent.' },
      { name: 'no_aug_epochs', what: 'Derniers epochs sans mosaic/mixup, pour finir sur des images non déformées.' },
      { name: 'mosaic_prob / mixup_prob / degrees…', what: 'Augmentations de données.', effect: 'Renforcent la généralisation ; trop = artefacts.' },
      { name: 'run_label', what: 'Nom du run (dossier + poids finaux). Ton nom custom pour la sortie.' },
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
    intro: "Étude d'optimisation d'hyperparamètres (TPE, pruning désactivé). Entraîne un modèle par trial avec le moteur choisi (Training_App).",
    params: [
      { name: 'engine', what: 'Moteur entraîné par chaque trial : le même que celui du Training aval, sinon le lancement est refusé. YOLOX par défaut ; le sélecteur n\'apparaît que si un plugin en fournit d\'autres.', effect: 'Les poids produits ne se rechargent qu\'avec leur moteur : il voyage avec eux (nœud Modèle, Training, MLflow).' },
      { name: 'n_trials', what: 'Nombre d\'essais (chaque essai = un entraînement).', effect: 'Plus = meilleure recherche mais coûteux (N trainings).' },
      { name: 'direction', what: 'Sens d\'optimisation de la métrique.', options: 'maximize (mAP) · minimize (loss)' },
      { name: 'metric', what: 'Objectif optimisé.', options: 'map50 · map5095 · recall · precision' },
      { name: 'optimize (espace de recherche)', what: 'Hyperparamètres explorés (cochés).',
        effect: 'Non cochés = valeurs par défaut. TPE échantillonne les cochés dans des plages FIXES, déclarées par le moteur (catalogue hpo_ranges) — il n\'y a PAS de champ min/max ici, seulement le choix binaire "optimisé ou non". Exemples ci-dessous pour YOLOX.' },
      { name: 'Arrêter le pipeline si HPO échoue', what: 'Politique appliquée si aucun trial ne termine avec une métrique exploitable.',
        options: 'coché (défaut) = Training ne démarre pas · décoché = Training démarre sans best_params Optuna',
        effect: 'En fallback, Training conserve exactement les hyperparamètres configurés dans son propre nœud, puis les valeurs par défaut de Training pour les champs absents.' },
      { name: 'basic_lr_per_img', what: 'Learning rate par image.', effect: 'Le plus influent en général — vitesse d\'apprentissage au 1er epoch.' },
      { name: 'min_lr_ratio', what: 'LR minimal en fin de scheduler (fraction du LR de base).', effect: 'Contrôle la décroissance du LR en fin d\'entraînement.' },
      { name: 'momentum', what: 'Momentum SGD.', effect: 'Lisse les mises à jour de gradient — trop haut = oscillations.' },
      { name: 'weight_decay', what: 'Régularisation L2 des poids.', effect: 'Trop haut = sous-apprentissage ; trop bas = surapprentissage.' },
      { name: 'mosaic_prob', what: 'Probabilité d\'augmentation mosaïque (4 images combinées).', effect: 'Aide la généralisation, surtout sur petits datasets.' },
      { name: 'mixup_prob', what: 'Probabilité d\'augmentation mixup (mélange linéaire de 2 images).', effect: 'Régularisation supplémentaire, utile si peu de données.' },
      { name: 'hsv_prob', what: 'Probabilité de jitter HSV (teinte/saturation/valeur).', effect: 'Robustesse aux variations d\'éclairage et de couleur.' },
      { name: 'flip_prob', what: 'Probabilité de flip horizontal.', effect: 'Robustesse à l\'orientation gauche/droite des objets.' },
      { name: 'degrees', what: 'Amplitude de rotation aléatoire (degrés).', effect: 'Utile si les objets peuvent apparaître sous différents angles.' },
      { name: 'translate', what: 'Amplitude de translation aléatoire (fraction de l\'image).', effect: 'Aide à la robustesse au cadrage.' },
      { name: 'shear', what: 'Amplitude de cisaillement aléatoire (degrés, augmentation affine).', effect: 'Aide à généraliser sur des perspectives variées.' },
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
    intro: "Nœud d'ENTRÉE : des poids fournis manuellement (YOLOX .pth par défaut).",
    params: [
      { name: 'engine', what: 'Moteur qui a produit ces poids. YOLOX par défaut ; le sélecteur n\'apparaît que si un plugin en fournit d\'autres.', effect: 'Les poids produits ne se rechargent qu\'avec leur moteur : il voyage avec eux (nœud Modèle, Training, MLflow).' },
      { name: 'model_path', what: 'Chemin du fichier de poids, à l\'extension du moteur (YOLOX : .pth).' },
      { name: 'model_size', what: 'Taille du modèle associée aux poids. Branché sur un Training, FIGE son moteur et sa taille.',
        effect: 'Un best_ckpt.pth yolox-nano ne peut être fine-tuné qu\'en yolox-nano, et par YOLOX — d\'où le gel (les poids ne sont compatibles ni entre tailles ni entre moteurs).' },
    ],
  },

  // ── DVC ────────────────────────────────────────────────────────────────────
  dvc: {
    intro: "Versionne un run reproductible : dataset + best model + snapshot du graphe, en un seul commit git/DVC.",
    params: [
      { name: '« artefact » (port d\'entrée)', what: 'DVC ne verse PAS un type de donnée unique — le port accepte '
          + "n'importe quel résultat produit en amont (Annotation = dataset YOLO, explorer = subset, Training = "
          + 'modèle .pth, Inference/Éval = métriques, Optuna = best params). Peu importe le nœud branché, DVC '
          + 'commite TOUJOURS la même chose : le dataset YOLO (dérivé en remontant jusqu\'à l\'ancêtre Annotation) '
          + '+ le modèle .pth (dérivé en remontant jusqu\'à l\'ancêtre Training, s\'il y en a un) + un snapshot JSON '
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
