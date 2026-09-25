---
app: optuna
doc_type: troubleshooting
audience: both
lang: fr
title: Depannage
order: 50
tags: [erreurs, diagnostic, dataset, cuda, timeout, metrique illisible, training app]
sources: [Optuna_App/backend/core/diagnostics.py, Optuna_App/backend/core/optuna_runner.py, Optuna_App/backend/api/orchestrator.py, Optuna_App/backend/api/studies.py]
---

# Depannage

## Une etude affiche "ÉCHEC HPO officiel - aucun best_params Optuna"

**Symptome** : la page d'etude affiche un encadre rouge "ÉCHEC HPO officiel - aucun best_params Optuna" avec une liste de groupes d'echec, et aucune carte de meilleur trial.

**Cause** : tous les trials de l'etude se sont termines en `FAIL` (ou `INTERRUPTED`), donc Optuna a zero trial `COMPLETE` et ne peut pas selectionner de gagnant. L'encadre rouge regroupe deja les echecs par cause racine : chaque groupe a un titre, les trials qu'il touche, une **Cause :** et un **À faire :**.

**Solution** :

1. Ouvrez d'abord le groupe avec le plus de trials : une cause partagee par tous les trials est presque toujours un probleme de configuration, pas un probleme d'hyperparametre.
2. Suivez **À faire :** ; les cas specifiques ci-dessous donnent les corrections sous-jacentes.
3. Ouvrez **Résultats et artefacts** d'un trial echoue pour le texte d'erreur brut si le resume ne suffit pas.
4. Relancez seulement apres la correction ; relancer sur la meme etude lui ajoute des trials.

## "Dataset introuvable ou mal référencé"

**Symptome** : le code de diagnostic est `dataset_missing` ; le trial echoue avant qu'aucune sortie d'entrainement apparaisse.

**Cause** : `data.yaml` n'a pas ete trouve au chemin donne, ou ses cles `path`/`train`/`val` pointent vers des dossiers qui n'existent pas sur la machine du backend. Pour le prereglage de detection, le champ **Chemin data.yaml** doit etre un chemin tel que vu par le backend, pas par votre machine locale.

**Solution** :

1. Verifiez le chemin absolu tape dans **Chemin data.yaml** (ou dans les arguments fixes de votre propre script).
2. Ouvrez `data.yaml` et verifiez que `path`, `train` et `val` resolvent vers des dossiers `images/` et `labels/` existants une fois combines.
3. Pour une etude Orchestrator, confirmez que le noeud amont a produit un export YOLO ; un export `.zip` est extrait une fois dans `hpo_datasets/<nom>/` du workspace et reutilise.

## "Mémoire GPU insuffisante" (CUDA out of memory)

**Symptome** : le code de diagnostic est `cuda_oom` ; le trial echoue au milieu d'un epoch d'entrainement.

**Cause** : la taille de batch ou d'image du moteur, combinee a la taille de modele choisie dans le prereglage, ne tient pas dans la VRAM disponible. Plusieurs trials ou apps partageant le meme GPU en meme temps aggravent cela.

**Solution** :

1. Choisissez une taille de modele plus petite dans **Modèle YOLOX** (ou le champ equivalent d'un autre moteur).
2. Reduisez la taille de batch ou d'image si votre script les expose comme hyperparametres.
3. Fermez les autres processus GPU (Training App, Inference App, une autre etude en cours) avant de lancer.

## "CUDA ou pilote GPU indisponible"

**Symptome** : le code de diagnostic est `cuda_unavailable` ; tous les trials echouent immediatement, meme un trial minimal.

**Cause** : le pilote NVIDIA est absent ou trop ancien, ou la version de PyTorch installee ne correspond pas a la version de CUDA, donc aucun trial ne peut meme demarrer l'entrainement sur le GPU.

**Solution** :

1. Executez `nvidia-smi` sur la machine du backend ; s'il echoue, corrigez d'abord le pilote.
2. Verifiez que PyTorch a ete installe avec le support CUDA (`python -c "import torch; print(torch.cuda.is_available())"` dans l'environnement `IA_env`).
3. Si le GPU ne peut vraiment pas etre utilise, forcez le CPU dans votre propre script pour au moins valider le reste du pipeline ; le prereglage de detection attend un GPU.

## "Poids ou modèle introuvable"

**Symptome** : le code de diagnostic est `model_missing`.

**Cause** : la taille de modele demandee n'a pas de poids de depart en cache, ou un chemin `--weights` personnalise n'existe pas.

**Solution** :

1. Verifiez la taille de modele selectionnee dans le prereglage par rapport aux tailles listees par `GET /api/orchestrator/engines`.
2. Laissez Training App telecharger ou construire ses poids par defaut une fois hors d'une etude, puis relancez.
3. Pour un checkpoint de depart personnalise, confirmez que le chemin `--weights` (ou l'argument fixe equivalent sur votre propre script) est un chemin absolu lisible depuis la machine backend, pas depuis votre poste Windows local.

## "Trial trop long ou bloqué" (timeout)

**Symptome** : le code de diagnostic est `timeout` ; un trial disparait du journal sans metrique finale apres une longue attente.

**Cause** : le trial a depasse sa limite de temps : 20 minutes pour une etude Orchestrator (`trial_timeout_s`, configurable sur le noeud) ou 1 heure pour une etude lancee depuis la page de lancement. Un dataset tres volumineux, trop d'epochs par trial, ou un DataLoader bloque peuvent tous en etre la cause.

**Solution** :

1. Verifiez `results.csv` du trial avant d'augmenter le timeout : si les epochs progressaient normalement, le trial etait simplement trop lent pour la limite ; s'il n'a jamais demarre, le processus etait bloque.
2. Baissez **Epochs par trial**, la taille du dataset pour les trials, ou la taille du modele.
3. Sous Windows, confirmez que `workers` vaut `0` (le defaut de l'app) ; un nombre de workers DataLoader non nul est une cause frequente de gel silencieux avant le premier epoch.

## "Métrique objectif illisible" (erreur d'analyse de la metrique)

**Symptome** : le code de diagnostic est `metric_parse` ; le trial semble pourtant avoir tourne.

**Cause** : pour une etude autonome, le script n'a pas imprime un nombre brut sur la derniere ligne de sa sortie, et aucune ligne `nom_metrique=valeur` n'a ete trouvee non plus. Pour une etude Orchestrator, `result.json` etait manquant ou invalide.

**Solution** :

1. Verifiez que le dernier `print(...)` de votre script est exactement la valeur numerique, sans rien d'autre sur cette ligne.
2. Si le script continue a logger apres avoir calcule la metrique, imprimez `nom_metrique=valeur` comme ligne de repli plutot que de compter sur la toute derniere ligne.
3. Verifiez que **Nom de la métrique** sur la page de lancement correspond a la cle utilisee dans cette ligne de repli.

## "Dépendance Python manquante"

**Symptome** : le code de diagnostic est `dependency_missing` ; l'erreur mentionne `ModuleNotFoundError` ou `ImportError`.

**Cause** : un package utilise par le script ou par le moteur d'entrainement n'est pas installe dans l'environnement Python qui fait tourner le backend (`IA_env` par defaut).

**Solution** :

1. Activez le meme environnement que le backend et installez le package manquant.
2. Redemarrez le backend : un package installe pendant qu'il tourne n'est pas pris en compte.
3. Si le module manquant appartient a un plugin de moteur d'entrainement plutot qu'a votre propre script, confirmez que le plugin est installe dans le meme environnement que Training App, puisqu'Optuna App importe le catalogue de moteurs a travers lui.

## Le prereglage d'entrainement de detection n'apparait pas sur la page de lancement

**Symptome** : ouvrir **Lancer une optimisation** ne montre aucun panneau **Optimiser un entraînement de détection**, seulement les champs de script generiques.

**Cause** : le backend n'a pas pu importer les moteurs d'entrainement de Training App. Cela arrive quand Training App n'est pas installe a cote d'Optuna App, ou quand `GET /api/orchestrator/engines` renvoie une liste `engines` vide avec un `error`.

**Solution** :

1. Ouvrez directement `http://localhost:<port-backend>/api/orchestrator/engines` et lisez le champ `error`.
2. Confirmez que `Training_App/backend/services/trainer_backend.py` existe au chemin relatif attendu a cote de `Optuna_App/`.
3. Les etudes sur votre propre script n'ont pas besoin de Training App et fonctionnent quand meme sans ce panneau.

## Les logs du trial s'arretent de se mettre a jour sur la page de lancement

**Symptome** : le panneau **Sortie** de la page de lancement se fige alors que le statut de l'etude sur la page d'etude change encore.

**Cause** : le flux de logs (`GET /api/studies/{name}/logs`) est un fetch direct vers le port du backend, contournant deliberement le proxy Vite, qui bufferise les evenements envoyes par le serveur. Un onglet navigateur ferme, une interruption reseau, ou un redemarrage du backend casse cette connexion sans casser l'etude elle-meme.

**Solution** :

1. Rechargez la page de lancement : le flux de logs se reconnecte et rejoue depuis le curseur courant.
2. Consultez plutot la page d'etude ; ses compteurs et son tableau de bord se rafraichissent independamment du flux de logs et refletent l'etat reel.
3. Si le backend a ete redemarre, l'etat de run en memoire (le badge "En cours", le buffer de log en direct) est perdu, mais les trials deja enregistres dans `optuna.db` ne le sont pas.
