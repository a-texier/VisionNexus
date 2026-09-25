---
app: training
doc_type: troubleshooting
audience: both
lang: fr
title: Dépannage
order: 50
tags: [erreurs, cuda, mlflow, dataset, reload, orchestrateur, poids]
sources: [Training_App/backend/services/training_service.py, Training_App/backend/services/trainer_backend.py, Training_App/backend/services/yolox_dataset.py, Training_App/backend/services/yolox_trainer.py, Training_App/backend/routers/training.py, Training_App/backend/routers/orchestrator.py, Training_App/backend/database.py]
---

# Dépannage

## Le lancement est refusé avec "data.yaml introuvable"

**Symptôme** : cliquer sur **Lancer** affiche une erreur "data.yaml introuvable : '<chemin>'" et le run n'est jamais créé.

**Cause** : `POST /api/training/start` vérifie que le chemin saisi dans **Chemin data.yaml** existe sur la machine du backend avant toute autre chose. Un chemin valide sur votre poste ne veut rien dire quand le backend tourne sur une VM distante : seuls les chemins accessibles au backend sont vérifiés.

**Solution** :

1. Vérifiez le chemin tel que le voit le backend, pas votre poste : avec une VM distante, utilisez son propre chemin (par exemple `/srv/datasets/run01/data.yaml`), pas un chemin Windows.
2. Vérifiez que le fichier existe à ce chemin exact (`data.yaml`, pas le dossier du dataset).
3. Si le dataset provient d'un export Annotation App, copiez le chemin affiché à la fin de l'export, puis ajoutez `/data.yaml`.

## Le lancement est refusé avec "model_size invalide" ou une erreur de poids

**Symptôme** : **Lancer** affiche "model_size invalide pour le moteur '<moteur>' : ..." ou "Poids '<fichier>' incompatibles avec le moteur '<moteur>' (extensions attendues : ...)".

**Cause** : la taille ou les poids de départ ne correspondent pas au catalogue du moteur choisi. Cette vérification a lieu avant le démarrage du run, pour ne pas gaspiller de temps GPU sur une requête vouée à l'échec. Les poids ne sont vérifiés que par extension de fichier : un fichier `.pth` qui n'est pas un vrai checkpoint YOLOX passe ce contrôle mais échoue quand le checkpoint est réellement chargé (voir l'entrée suivante).

**Solution** :

1. Vérifiez **Taille** dans le panneau modèle : elle doit être l'un des boutons affichés pour le **Moteur** courant.
2. Vérifiez l'extension de **Poids de depart (optionnel)** : `.pth` pour YOLOX, une autre extension pour un moteur de plugin (voir son catalogue dans `GET /api/training/models?engine=<nom>`).
3. Si vous avez changé de moteur après avoir saisi un chemin de poids, videz le champ : les tailles et extensions du moteur précédent ne s'appliquent pas au nouveau.

## Le run échoue immédiatement avec une erreur de chargement de checkpoint

**Symptôme** : le run passe à **Erreur** quelques secondes après le démarrage, avec un message mentionnant `state_dict`, `size mismatch`, `Unpickling error` ou une erreur similaire de `torch.load`.

**Cause** : **Poids de depart (optionnel)** pointe vers un fichier `.pth` qui n'est pas un checkpoint YOLOX de la taille sélectionnée (un checkpoint d'une architecture très différente, un téléchargement corrompu, ou un checkpoint enregistré par une autre version de PyTorch aux structures internes incompatibles).

**Solution** :

1. Vérifiez que le fichier a bien été produit par YOLOX (un run précédent de Training App, ou une publication officielle YOLOX), pas par un autre framework enregistré avec la même extension.
2. Vérifiez que la taille sélectionnée dans le formulaire correspond à celle avec laquelle le checkpoint a été entraîné ; une taille différente rend incompatibles la plupart des couches en forme, pas seulement quelques-unes (voir [Concepts](concepts.fr.md), section *Poids de départ : entraînement depuis zéro ou fine-tuning*).
3. Retéléchargez le fichier s'il peut être corrompu (téléchargement partiel, copie interrompue vers la machine du backend).

## Mémoire GPU insuffisante (CUDA out of memory) pendant un run

**Symptôme** : le run passe à **Erreur** avec un message contenant `CUDA out of memory` ou `OutOfMemoryError`, parfois seulement après quelques epochs.

**Cause** : le batch d'images à la **Taille image** courante, avec les activations du réseau, ne tient plus dans la mémoire du GPU. Des tailles plus grandes (`yolox-l`, `yolox-x`), un **Batch size** plus élevé ou une **Taille image** plus élevée augmentent tous la mémoire utilisée. D'autres processus sur le même GPU (un autre utilisateur, un run Inference App, un second run Training App) réduisent ce qui est disponible.

**Solution** :

1. Baissez d'abord **Batch size** ; c'est le levier le plus direct sur la mémoire.
2. Baissez **Taille image**, ou choisissez une taille de modèle plus petite.
3. Vérifiez avec `nvidia-smi` sur la machine du backend si un autre processus utilise déjà le GPU.
4. Activez **FP16 (mixed precision)** pour réduire la mémoire à précision comparable, sur un GPU qui le supporte.
5. Évitez de lancer deux entraînements, ou un entraînement et une évaluation Inference App, en même temps sur le même GPU.

## Le run redémarre tout seul et perd sa progression

**Symptôme** : un run en cours disparaît ou repart de zéro, sans erreur affichée dans l'interface ; le terminal du backend montre un rechargement uvicorn.

**Cause** : le backend a été lancé avec `--reload` (le comportement par défaut des lanceurs sans `--no-reload`), qui redémarre tout le processus dès qu'un fichier Python de l'app change sur le disque. Un run est un thread en arrière-plan de ce processus : il est perdu au redémarrage, ainsi que les événements pas encore lus par l'interface. Un fichier `.py` touché par un éditeur, un `git checkout`, ou un autre processus qui écrit dans le dossier du backend peut déclencher cela même sans modification de code intentionnelle.

**Solution** :

1. Pour les longs entraînements, lancez avec `--no-reload` (`python launcher.py --app training ... --no-reload`, ou le même indicateur sur `Training_App/launcher.py`).
2. Évitez de modifier les fichiers du backend pendant qu'un long run est en cours.
3. Après un redémarrage involontaire, le run reste à son dernier état enregistré dans l'**Historique** (généralement toujours **En cours**, jamais mis à jour) ; supprimez-le et relancez-en un nouveau.

## Un run reste "En attente" et ne démarre jamais l'entraînement

**Symptôme** : un run apparaît dans l'**Historique** à l'état **En attente** et ne passe jamais à **En cours**.

**Cause** : `start_training` n'a pas trouvé le run en base juste après sa création, ou le processus du backend a redémarré entre la création de la ligne en base et le démarrage du thread en arrière-plan (voir l'entrée précédente). C'est rare et signale un redémarrage du backend ou un problème de base de données à ce moment précis.

**Solution** :

1. Vérifiez le terminal du backend pour une trace d'erreur autour du moment de création du run.
2. Vérifiez que `training.db` du workspace n'est pas sur un partage réseau au verrouillage fragile (voir [Configuration](configuration.fr.md)).
3. Supprimez le run bloqué et relancez-en un nouveau ; une occurrence isolée ne vaut généralement pas la peine d'être investiguée davantage.

## Les métriques restent vides dans Progression ou dans les courbes du run

**Symptôme** : le panneau **Progression** affiche le compteur d'epochs et les pertes mais aucune tuile `metrics/mAP50(B)` ; le tableau de l'**Historique** affiche "-" pour mAP50 même après plusieurs epochs ; les courbes du détail du run restent vides.

**Cause** : YOLOX n'évalue le modèle que toutes les **Intervalle eval (ép.)** epochs (10 par défaut), plus pendant les dernières epochs sans augmentation. Les epochs entre deux évaluations ne remontent que les pertes, par conception (voir [Concepts](concepts.fr.md), section *Epochs, intervalle d'évaluation et dernières epochs sans augmentation*). Le graphique d'évolution du mAP n'apparaît qu'à partir de deux epochs évaluées.

**Solution** :

1. Attendez la prochaine évaluation, ou vérifiez **Intervalle eval (ép.)** dans le groupe **Entrainement** des hyperparamètres avant de lancer un run où vous voulez un retour fréquent.
2. Pour un run de test court, baissez **Intervalle eval (ép.)** à 1 pour que chaque epoch soit évaluée.
3. Si **Epochs** est inférieur à **Intervalle eval (ép.)**, seule l'epoch finale est évaluée : les métriques n'apparaissent qu'à la toute fin.

## Les graphiques d'analyse manquent ou montrent un ancien modèle

**Symptôme** : la section **Analyse du modèle** d'un run terminé affiche "Aucun plot d'analyse (run non terminé ou plots désactivés)." alors que le run est **Terminé**, ou les prédictions de **Validation** semblent plus anciennes que le modèle final.

**Cause** : les graphiques sont écrits dans `artifacts/` du dossier du run uniquement aux epochs d'évaluation ; un run arrêté avant sa première évaluation, ou dont le dossier a été déplacé ou supprimé, n'a rien à montrer. `val_batch0_pred.jpg` est régénéré à chaque évaluation mais pas après la fin du run, il reflète donc le modèle de la dernière évaluation, qui peut être une epoch antérieure à la finale si le mAP50-95 a ensuite baissé (le fichier lui-même est toujours écrasé, son contenu vient simplement de cette dernière évaluation).

**Solution** :

1. Vérifiez que le run a atteint au moins une évaluation (epoch courante au moins égale à **Intervalle eval (ép.)**, ou le run a atteint sa dernière epoch).
2. Vérifiez que le dossier du run (`runs/<nom du run>/`) existe toujours sur la machine du backend ; un dossier supprimé ou déplacé casse la galerie même si le run reste dans l'**Historique**.
3. Comparez l'epoch des graphiques (visible dans `results.csv` du dossier du run) avec l'epoch finale si une correspondance exacte compte.

## "engine_error" affiché à la place des graphiques d'analyse

**Symptôme** : la section **Analyse du modèle** affiche un message orange à la place de tout graphique, ou `GET /api/training/<nom du run>/artifacts` renvoie un champ `engine_error`.

**Cause** : le run a été entraîné avec un moteur de plugin qui n'est plus installé (plugin retiré, bibliothèque manquante), donc son catalogue (qui indique où vivent les graphiques) ne peut pas être lu.

**Solution** :

1. Réinstallez ou réparez le plugin de moteur utilisé par le run (voir [Configuration](configuration.fr.md), section *Installer un plugin de moteur d'entraînement*).
2. Vérifiez `GET /api/capabilities` : le moteur doit être listé avec `"available": true`.
3. Si le moteur ne peut pas être restauré, les poids du run peuvent rester utilisables directement (le fichier lui-même ne dépend pas de l'installation du plugin), mais la galerie et l'inférence best/worst cases restent indisponibles.

## L'étape Orchestrator pour Training expire ou ne continue jamais

**Symptôme** : un pipeline Orchestrator reste bloqué longtemps sur le nœud Training, ou l'étape automatique remonte un message de timeout ("Entrainement encore en cours (timeout attente)").

**Cause** : `POST /api/orchestrator/train` attend que le run atteigne **Terminé**, **Erreur** ou **Arrêté** avant de répondre (mode bloquant, par défaut), pendant au plus `TRAINING_ORCH_MAX_WAIT_S` secondes (90 minutes par défaut). Un entraînement long (beaucoup d'epochs, un gros modèle, un GPU lent) peut dépasser cette fenêtre ; l'appel renvoie alors un message "encore en cours" au lieu du résultat final, et l'étape Orchestrator n'obtient pas les poids attendus.

**Solution** :

1. Pour les longs entraînements pilotés par l'Orchestrator, augmentez `TRAINING_ORCH_MAX_WAIT_S` sur le processus de Training App avant d'exécuter le pipeline.
2. Autre option, réglez `TRAINING_ORCH_BLOCKING=0` pour que l'appel réponde dès le démarrage du run, et interrogez `GET /api/orchestrator/run-status?run_name=...` depuis l'extérieur ; cela ne s'applique qu'à des intégrations personnalisées, pas à l'exécuteur de pipeline de l'Orchestrator App lui-même, qui attend le comportement bloquant.
3. Vérifiez directement l'**Historique** : si le run a atteint **Terminé**, l'entraînement a réussi même si l'appel Orchestrator a expiré.

## Erreurs "database is locked"

**Symptôme** : une action échoue avec un message contenant `database is locked`, généralement quand plusieurs runs écrivent en base en même temps.

**Cause** : `training.db` est un fichier SQLite ; SQLite accepte un nombre limité d'écrivains simultanés. Plusieurs processus backend qui écrivent dans le même fichier (deux instances de lanceur pointées sur le même workspace, un workspace placé sur un partage réseau au verrouillage fragile) augmentent le risque de cette erreur.

**Solution** :

1. Ne lancez jamais deux instances du backend sur le même workspace ; chaque utilisateur doit avoir son propre workspace `training_<user>`.
2. Gardez le workspace, ou au moins `training.db`, sur un disque local de la machine du backend plutôt que sur un partage réseau.
3. Réessayez l'action ; un verrou transitoire pendant une écriture courte se résout généralement de lui-même.

## Le backend ne démarre pas

**Symptôme** : le terminal du backend s'arrête avec une erreur au démarrage, et l'interface n'affiche rien ou "le backend ne répond pas".

**Cause et solution selon le message** :

- `ModuleNotFoundError: No module named 'yolox'` : le code YOLOX embarqué n'est pas dans le chemin Python ; démarrez uvicorn depuis `Training_App/` (pas depuis un sous-dossier), c'est ainsi que `backend/services/yolox_model.py` ajoute `backend/vendor/yolox/` à `sys.path`.
- `ModuleNotFoundError: No module named 'pycocotools'` (ou `thop`, `loguru`, `tabulate`) : une dépendance du code YOLOX embarqué manque dans l'environnement ; installez-la (voir [Configuration](configuration.fr.md)).
- `Address already in use` / port 8064 occupé : une autre instance tourne déjà. Laissez le lanceur allouer un port libre, ou trouvez et arrêtez le processus (`netstat -ano | findstr :8064` puis `taskkill /PID <pid> /F` sur Windows).
- Erreurs liées à CUDA ou `torch` : la version de PyTorch installée ne correspond pas au pilote. Vérifiez `nvidia-smi` et `python -c "import torch; print(torch.__version__, torch.version.cuda)"`, puis réinstallez PyTorch pour la bonne version de CUDA.

Pour le frontend, `Cannot find module 'vite'` signifie que les dépendances du frontend manquent : lancez `npm install` dans `frontend/`.
