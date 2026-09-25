---
app: optuna
doc_type: workflows
audience: user
lang: fr
title: Workflows
order: 20
tags: [etude, prereglage, yolox, arret, best params, diagnostic, orchestrator]
sources: [Optuna_App/frontend/src/pages/StudiesPage.tsx, Optuna_App/frontend/src/pages/LaunchPage.tsx, Optuna_App/frontend/src/components/EnginePreset.tsx, Optuna_App/frontend/src/pages/StudyDetailPage.tsx, Optuna_App/backend/core/optuna_runner.py, Optuna_App/backend/api/orchestrator.py, Orchestrator_App/backend/core/graph_runner.py]
---

# Workflows

## Optimiser un entrainement de detection avec le prereglage moteur

Ce workflow regle les hyperparametres d'un entrainement de detection YOLOX (ou moteur de plugin) sur un dataset YOLO, entierement depuis Optuna App.

*Prerequis* : Training App est installe a cote d'Optuna App ; un dataset YOLO avec un `data.yaml` est accessible depuis la machine du backend (par exemple un export d'Annotation App) ; un GPU est recommande.

1. Sur la page des etudes, cliquez **Nouvelle étude**, tapez un **Nom**, selectionnez **maximize** (le mAP doit etre maximise) et cliquez **Créer**.
2. Cliquez sur l'etude, puis **Lancer une optimisation**.
3. Dans **Optimiser un entraînement de détection**, choisissez le moteur si plusieurs sont listes, la taille du modele dans **Modèle YOLOX**, et gardez **Epochs par trial** bas (10 par defaut).
4. Tapez le chemin absolu du `data.yaml` du dataset dans **Chemin data.yaml** et cliquez **Préremplir l'étude**. Le script, ses arguments fixes, l'espace de recherche du moteur, **Nom de la métrique** `map50` et **Direction** `maximize` sont remplis.
5. Ajustez eventuellement l'**Espace des hyperparamètres** : retirez les parametres que vous ne voulez pas regler, ajoutez-en d'autres depuis le catalogue du moteur (voir [Concepts](concepts.fr.md)), ou resserrez les bornes.
6. Reglez le **Nombre de trials**. En dessous de 10 trials termines, TPE explore encore au hasard ; 20 a 50 trials donnent une recherche mieux informee.
7. Cliquez **Lancer** et observez le panneau **Sortie** : chaque trial imprime ses parametres, puis `map50 = ...` ou un diagnostic d'echec.

*Résultat* : chaque trial entraine un modele dans `hpo_runs/<étude>/trial_<date>_<pid>/` du workspace et l'etude enregistre son mAP50. La page d'etude montre le meilleur trial et le tableau de bord. Si les premiers trials echouent, arretez l'etude et suivez le workflow de diagnostic de cette page avant de depenser plus de temps GPU.

## Optimiser votre propre script d'entrainement

Ce workflow lance une etude sur n'importe quel script Python, par exemple un classifieur ou une boucle d'entrainement personnalisee.

*Prerequis* : un script sur la machine du backend qui accepte ses hyperparametres comme arguments `--nom valeur` et imprime la metrique finale sur la derniere ligne de sa sortie standard (contrat dans [Concepts](concepts.fr.md)) ; le script tourne avec le Python de l'environnement backend.

1. Creez une etude avec **Nouvelle étude**, en choisissant la **Direction** adaptee a la metrique : **minimize** pour une loss, **maximize** pour une precision ou un mAP.
2. Ouvrez l'etude et cliquez **Lancer une optimisation**.
3. Tapez le chemin absolu du script dans **Chemin absolu vers le script Python**.
4. Dans **Espace des hyperparamètres**, ajoutez une ligne par hyperparametre : un nom identique a l'argument du script sans `--`, un type, et les bornes ou les choix. Cochez **log** pour les valeurs qui couvrent plusieurs ordres de grandeur (taux d'apprentissage, weight decay).
5. Tapez le **Nom de la métrique**. Si le script imprime du texte supplementaire apres la metrique, faites-le plutot imprimer une ligne `nom_metrique=valeur`.
6. Reglez **Nombre de trials** et cliquez **Lancer**.

*Résultat* : l'app execute le script une fois par trial avec `python <script> --nom valeur ...`, attend qu'il termine (une heure maximum par trial) et enregistre la valeur analysee. Un trial dont le script se termine en erreur est enregistre comme echoue avec un diagnostic, et l'etude passe au trial suivant.

## Suivre une etude en cours et l'arreter

Ce workflow surveille une optimisation en cours et l'arrete proprement.

*Prerequis* : une optimisation a ete lancee depuis la page de lancement d'Optuna App.

1. Sur la page des etudes, les etudes en cours affichent **En cours** et le compteur a cote de **Études** dans la barre laterale les compte.
2. Ouvrez l'etude : les compteurs, la barre **Progression** et le tableau de bord se rafraichissent toutes les quelques secondes. La page de lancement, si encore ouverte, diffuse le journal complet.
3. Pour arreter, cliquez **Arrêter** sur la page de l'etude ou sur la page de lancement.
4. Attendez que le trial en cours termine : la demande d'arret est verifiee avant chaque nouveau trial et ne tue pas l'entrainement en cours.

*Résultat* : le statut de l'etude revient a **Terminé** (ou **Échec HPO** si rien n'a termine). Les trials planifies mais non executes sont enregistres comme prunes sans aucune valeur intermediaire, donc ils apparaissent avec l'etat `LEGACY_PRUNED_UNKNOWN` et augmentent le compteur **Prunés** ; ils ne portent aucun resultat.

## Lire le resultat d'une etude et reutiliser les meilleurs parametres

Ce workflow transforme une etude terminee en reglages pour l'entrainement final.

*Prerequis* : l'etude a au moins un trial `COMPLETE`.

1. Ouvrez l'etude. Verifiez l'encadre de verdict : **HPO exploitable - meilleur trial officiel #N** confirme qu'un gagnant officiel existe.
2. Lisez la carte **Meilleur trial #N** : la valeur objectif et une tuile par hyperparametre regle.
3. Verifiez la robustesse du resultat sur le tableau de bord : dans **Historique de l'optimisation**, une meilleure valeur atteinte tot et jamais amelioree suggere un paysage plat ; dans **Importance des paramètres**, lisez les avertissements (peu de trials, faible dispersion).
4. Trouvez les fichiers du meilleur trial. Pour une etude Orchestrator, ouvrez **Résultats et artefacts** dans sa ligne : il donne le dossier du trial. Pour une etude lancee avec le prereglage, les dossiers sont sous `hpo_runs/<étude>/` du workspace, un par trial, nomme d'apres l'heure de depart. Dans les deux cas, `results.csv` contient les metriques par epoch et les fichiers de checkpoint les poids de cet entrainement court.
5. Copiez les valeurs des meilleurs parametres dans les hyperparametres de Training App, ou dans le champ `best_params` du noeud Training d'un pipeline Orchestrator, avec le meme moteur et la meme taille de modele.
6. Entrainez avec le nombre complet d'epochs. Les meilleurs parametres decrivent seulement les hyperparametres regles : les fixes (epochs, taille d'image, batch) gardent leurs propres valeurs.

*Résultat* : l'entrainement final part de reglages choisis sur preuve. Les poids du trial court ne sont pas le modele final.

## Diagnostiquer une etude avec des trials echoues

Ce workflow trouve et corrige la cause de trials echoues sans relancer toute l'etude a l'aveugle.

*Prerequis* : une etude montre des trials echoues ou **ÉCHEC HPO officiel - aucun best_params Optuna**.

1. Ouvrez l'etude et lisez l'encadre de verdict rouge. Chaque groupe donne un titre (par exemple "Dataset introuvable ou mal référencé"), le nombre de trials qu'il concerne, la **Cause :** (fin de la sortie d'erreur) et **À faire :**.
2. Corrigez d'abord le groupe le plus frequent : un echec partage par tous les trials est un probleme de configuration (chemin du dataset, dependance manquante, GPU), pas un probleme d'hyperparametre.
3. Pour un detail, ouvrez **Résultats et artefacts** d'un trial echoue et regardez dans son dossier : `stderr.log` et `stdout.log` (etudes Orchestrator) ou le journal de sortie de la page de lancement (etudes autonomes).
4. Verifiez la configuration hors de l'app si besoin : les chemins du `data.yaml`, `nvidia-smi` pour le GPU, l'environnement Python.
5. Relancez. Pour une etude autonome, relancer sur la meme etude lui ajoute des trials ; creez une nouvelle etude si la configuration a beaucoup change, pour que les anciens echecs ne se melangent pas aux nouveaux resultats.

*Résultat* : les trials suivants terminent. Les messages d'erreur specifiques et leurs corrections sont listes dans [Depannage](troubleshooting.fr.md).

## Lancer Optuna depuis un pipeline Orchestrator

Ce workflow utilise Optuna App comme etape HPO d'un pipeline Orchestrator, entre l'export d'annotation et l'entrainement.

*Prerequis* : l'Orchestrator App tourne ; le graphe contient un noeud Optuna HPO connecte apres le dataset (noeud Annotation ou source de dataset) et avant un noeud Training qui utilise le meme moteur.

1. Dans l'Orchestrator, selectionnez le noeud Optuna et configurez-le : mode automatique (active par defaut), nombre de trials (20 par defaut), les hyperparametres a optimiser (vide = la selection par defaut du moteur), et la politique d'echec (arreter le pipeline, par defaut, ou continuer le Training avec ses propres parametres).
2. Lancez le pipeline. L'Orchestrator demarre Optuna App au besoin et l'appelle avec le chemin du dataset du noeud amont ; un export Annotation en `.zip` est extrait une fois dans `hpo_datasets/` du workspace Optuna.
3. Attendez : l'appel ne repond que quand tous les trials sont termines. Chaque trial entraine pendant 10 epochs par defaut, avec une limite de 20 minutes par trial.
4. Suivez l'etude dans Optuna App si vous le souhaitez : elle apparait sur la page des etudes avec les id de graphe et de run, et ses trials se remplissent au fur et a mesure.
5. A la fin, les meilleurs parametres sont fusionnes dans les hyperparametres du noeud Training aval. Si aucun trial n'a termine, le pipeline s'arrete avant Training, ou continue avec les valeurs par defaut du Training quand le noeud l'autorise.
6. En mode manuel, le pipeline attend a la place sur "Optimize hyperparameters (manual)" : lancez vous-meme une etude dans Optuna App, tapez les meilleurs parametres dans le noeud, puis cliquez **Continue** dans l'Orchestrator.

*Résultat* : l'etude `<graphe>__<run>__<noeud>__<attempt>` reste dans le workspace comme trace de l'etape HPO. Relancer le pipeline cree un nouvel attempt et une nouvelle etude, jamais des trials supplementaires dans l'ancienne.
