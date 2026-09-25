---
app: optuna
doc_type: user-guide
audience: user
lang: fr
title: Guide utilisateur
order: 10
tags: [etudes, page etude, lancement, tableau de bord, trials, prereglage]
sources: [Optuna_App/frontend/src/App.tsx, Optuna_App/frontend/src/pages/StudiesPage.tsx, Optuna_App/frontend/src/pages/StudyDetailPage.tsx, Optuna_App/frontend/src/pages/LaunchPage.tsx, Optuna_App/frontend/src/components/StudyDashboard.tsx, Optuna_App/frontend/src/components/EnginePreset.tsx, Optuna_App/frontend/src/pages/HPOLearnPage.tsx, Optuna_App/frontend/src/components/UserBadge.tsx]
---

# Guide utilisateur

## Barre laterale et navigation d'Optuna App

La barre laterale a gauche d'Optuna App est toujours visible. Elle contient quatre entrees et le badge utilisateur.

- **Études** ouvre la page des etudes, la page d'accueil de l'app. Un petit compteur indigo a cote indique combien d'etudes sont en cours dans ce backend en ce moment (rafraichi toutes les 5 secondes).
- **Comprendre HPO** ouvre une introduction interactive a l'optimisation d'hyperparametres, decrite dans la section *Page Comprendre HPO* de ce guide.
- **Documentation** ouvre cette documentation dans l'app.
- **Paramètres** ouvre une page provisoire sans aucun reglage pour l'instant.

Certaines entrees de la barre laterale et quelques panneaux restent affiches en francais meme quand la langue de l'interface est l'anglais : le tableau de bord d'analyse d'une etude et le prereglage d'entrainement de detection de la page de lancement. Ce guide les cite tels qu'affiches.

Le badge utilisateur en bas montre le nom d'utilisateur donne par le lanceur et quatre boutons : **Ouvrir workspace** ouvre le dossier du workspace dans l'explorateur de fichiers de la machine qui fait tourner le backend, **Historique des workspaces** liste les workspaces recents de cette app, **Utilisateurs connectes** liste les autres utilisateurs qui font tourner Optuna App sur la meme machine, et le bouton de langue bascule entre francais et anglais. Quand l'app est ouverte depuis VisionNexus, VisionNexus impose la langue.

## Page des etudes

La page des etudes liste chaque etude stockee dans la base du workspace, qu'elle ait ete creee a la main ou par l'Orchestrator. L'en-tete montre le nombre d'etudes, un bouton de rafraichissement et **Nouvelle étude**. La liste se rafraichit toute seule toutes les 15 secondes.

Chaque ligne montre :

- **Nom** : le nom de l'etude. Pour une etude lancee par l'Orchestrator, une seconde ligne montre la metrique, l'id de graphe et l'id de run.
- **Statut** : **En cours** (au moins un trial en cours ou en attente), **Terminé** (au moins un trial termine), **Échec HPO** (des trials existent mais aucun n'a termine) ou **Vide** (aucun trial pour l'instant).
- **Direction** : `minimize` ou `maximize`.
- **Trials C/F/P** : le nombre de trials termines, echoues et prunes.
- **Meilleure val.** : la meilleure valeur objectif, ou un tiret.

Cliquez une ligne pour ouvrir la page de l'etude. L'icone poubelle supprime l'etude et tous ses trials apres confirmation ; les fichiers ecrits par les trials dans `hpo_runs/` restent sur disque.

La fenetre **Nouvelle étude** demande un **Nom** et une **Direction** (`minimize` par defaut) et cree une etude vide. Le nom doit etre unique dans le workspace ; un nom en double affiche "Erreur lors de la création (nom déjà utilisé ?)". Choisissez la direction avec soin : elle ne peut pas etre changee ensuite, et le champ **Direction** de la page de lancement ne l'ecrase pas (voir [Depannage](troubleshooting.fr.md)).

## Page d'etude : en-tete, verdict et compteurs

La page d'etude s'ouvre quand vous cliquez une etude. Sa barre du haut contient **Retour aux études**, un bouton de rafraichissement, **Arrêter** pendant qu'une optimisation lancee depuis cette app est en cours, et **Lancer une optimisation**. Sous le nom de l'etude, une ligne dit si l'etude a ete lancee depuis Optuna App ou depuis un noeud Orchestrator ("Étude lancée depuis un nœud Sandgraph").

Un encadre de verdict suit le tableau de bord d'analyse :

- **HPO exploitable - meilleur trial officiel #N** en vert quand au moins un trial a termine.
- **Étude en cours - aucun résultat officiel sélectionnable pour le moment** en bleu tant qu'aucun trial n'a termine.
- **ÉCHEC HPO officiel - aucun best_params Optuna** en rouge quand des trials existent mais qu'aucun n'a termine. L'encadre liste alors les echecs regroupes par cause racine : titre, numero et liste des trials, **Cause :** et **À faire :**. Un echec partage par tous les trials apparait une seule fois, donc vous le corrigez une seule fois. Pour d'anciennes etudes dont les entrainements se sont termines mais dont la valeur a ete perdue, l'encadre peut aussi montrer un candidat historique recupere, marque comme informatif et jamais transforme en trial termine.

Six compteurs montrent les trials **Planifiés**, **Finalisés**, **Réussis**, **Échoués**, **Prunés** et **Interrompus**. Pendant qu'une optimisation lancee depuis cette app tourne, une barre **Progression** apparait sous les compteurs.

La page d'etude rafraichit son statut toutes les 2 secondes et son analyse toutes les 5 secondes pendant que l'etude tourne, et toutes les 10 a 30 secondes sinon.

## Page d'etude : tableau de bord d'analyse

Le tableau de bord d'analyse se trouve entre l'en-tete et l'encadre de verdict. Ses panneaux sont affiches en francais.

- **Comment cette étude Optuna fonctionne** : le cycle d'optimisation, la phase du sampler (demarrage ou TPE adaptatif, avec le nombre de decisions adaptatives observees) et six cellules : dataset ou script, nombre de trials, direction, metrique objectif, sampler et pruner. Un avertissement apparait quand le nombre de trials demande ne peut pas sortir de la phase de demarrage de TPE.
- **Espace de recherche** : une carte par hyperparametre avec son type, sa distribution, ses bornes ou choix, et un repere dore a la valeur du meilleur trial.
- **Historique de l'optimisation** : un point par trial termine et une ligne verte pour la meilleure valeur atteinte jusque-la.
- **Distribution de l'objectif** : histogramme des valeurs terminees avec meilleur, moyenne, mediane et pire.
- **Interaction entre paramètres** : une grille 7 x 7 de l'objectif moyen pour deux parametres numeriques choisis dans les listes **X** et **Y**. Les cases vides restent vides.
- **Évolution de l'exploration TPE** : les valeurs proposees pour un parametre trial apres trial, avec un bouton **Lecture** pour les rejouer.
- **Importance des paramètres** : importance fANOVA de chaque parametre, avec ses avertissements. Necessite au moins 5 trials termines avec des valeurs differentes (voir [Concepts](concepts.fr.md)).
- **Trials et pruning** : comptes des trials termines, prunes, en cours et echoues, et le statut du pruner.
- **Coordonnées parallèles** : une ligne par trial termine (les 80 derniers) sur jusqu'a six parametres numeriques et l'objectif, colores du pire au meilleur.

## Page d'etude : meilleur trial et table des trials

Sous les compteurs, la carte **Meilleur trial #N** montre la meilleure valeur objectif et une tuile par hyperparametre avec sa valeur. Ce sont les valeurs a copier dans Training App ou dans le champ `best_params` d'un noeud Training de l'Orchestrator.

La table **Tous les trials** liste chaque trial, du plus recent au plus ancien :

- **#** : numero du trial.
- **État** : le badge d'etat effectif (`COMPLETE`, `FAIL`, `PRUNED`, `RUNNING`, `WAITING`, `INTERRUPTED`, `LEGACY_PRUNED_UNKNOWN`, `LEGACY_FAILURE_RECOVERED`). Les etats sont expliques dans [Concepts](concepts.fr.md).
- **Résultat observé** : "objectif officiel = valeur" pour un trial termine, "training récupéré · non officiel" avec les metriques recuperees pour un ancien trial, ou "aucune métrique".
- **Paramètres** : les quatre premiers parametres. Quand le trial a echoue, une ligne rouge "Cause regroupée dans le verdict de l'étude" renvoie vers l'encadre de verdict.
- **Durée** : du debut a la fin du trial.

Quand un trial a des fichiers ou des metriques, le lien **Résultats et artefacts** ouvre la source de la metrique, les metriques (`map50`, `map5095`) et le dossier du trial sur disque.

## Page Lancer une optimisation

La page de lancement s'ouvre depuis **Lancer une optimisation** sur une page d'etude. Elle configure et lance une optimisation de l'etude courante avec un script qui tourne sur la machine du backend, et diffuse en direct le journal resultant une fois l'etude en cours. Le bouton de retour en haut ramene a la page d'etude sans rien arreter de ce qui tourne deja : quitter la page de lancement n'annule jamais une optimisation, puisqu'elle continue de tourner sur le backend independamment de l'onglet du navigateur. Les trois panneaux ci-dessous remplissent cette page de haut en bas : un prereglage optionnel, le script et ses trials, puis l'espace de recherche avec les commandes de lancement.

### Prereglage d'entrainement de detection

Le panneau **Optimiser un entraînement de détection** remplit toute la page pour optimiser un entrainement de detection avec un moteur de Training App. Il apparait seulement quand le backend trouve Training App et au moins un moteur exploitable.

- **Moteur** : montre seulement quand plusieurs moteurs sont disponibles (YOLOX est integre, d'autres moteurs viennent de plugins).
- **Modèle YOLOX** : la taille du modele du moteur (`nano`, `tiny`, `s`, `m`, `l`, `x` pour YOLOX ; `s` par defaut).
- **Epochs par trial** : epochs de chaque trial, 10 par defaut. Gardez-le bas : les trials ne font que comparer des reglages.
- **Chemin data.yaml** : chemin absolu du `data.yaml` d'un dataset YOLO, tel que vu par le backend.

**Préremplir l'étude** s'active des qu'un chemin est tape. Il remplit le script avec le script de trial de l'app (`backend/hpo_trial.py`), les arguments fixes (dataset, moteur, taille, epochs, metrique `map50`, un `--runs_dir` sous `hpo_runs/<etude>`), l'espace de recherche par defaut du moteur, **Nom de la métrique** `map50` et **Direction** `maximize`. Tout reste modifiable ensuite.

### Script d'objectif, trials et metrique

Le panneau **Script d'objectif** decrit ce que chaque trial execute.

- **Chemin absolu vers le script Python** : le script, sur la machine du backend. Il recoit chaque hyperparametre comme `--nom_param valeur` et doit imprimer la metrique sur la derniere ligne de sa sortie (voir le contrat de trial dans [Concepts](concepts.fr.md)).
- **Arguments fixes (avant les hyperparamètres)** : montre seulement apres un prereglage ; **Retirer** les efface.
- **Nombre de trials** : 20 par defaut.
- **Nom de la métrique** : `value` par defaut. Il etiquette le journal, et sert de repli quand la derniere ligne n'est pas un nombre : l'app cherche alors une ligne `nom_metrique=valeur`.
- **Direction** : `minimize` ou `maximize`. Elle est enregistree avec le run, mais une etude existante garde la direction choisie a sa creation.

### Espace des hyperparametres, lancement et sortie

Le panneau **Espace des hyperparamètres** contient une ligne par hyperparametre : un nom, un type (`float`, `int` ou `categorical`), puis **min** et **max** avec une case **log** pour les types numeriques, ou une liste de valeurs separees par des virgules pour `categorical`. **Ajouter** ajoute une ligne, l'icone poubelle en retire une. Une ligne avec un nom vide, une borne manquante ou un minimum non inferieur au maximum bloque le lancement avec "Paramètre ... invalide - vérifiez les champs".

**Lancer** demarre l'optimisation en arriere-plan et affiche "Optimisation en cours...". Le panneau **Sortie** diffuse le journal : une ligne par trial avec ses parametres, la valeur de la metrique ou le diagnostic d'echec (**ÉCHEC**, cause et action), et des lignes de statut. **Arrêter** demande l'arret de l'optimisation ; le trial en cours termine d'abord. Vous pouvez quitter la page : l'optimisation continue sur le backend et son etat reste visible sur la page de l'etude.

## Page Comprendre HPO

La page **Comprendre HPO** est une introduction interactive autonome pour les utilisateurs nouveaux a l'optimisation d'hyperparametres. Elle ne lit ni ne modifie aucune etude.

Elle explique ce que sont les hyperparametres, ce qu'est un trial, et compare grid search, random search et TPE. Trois parties interactives aident a construire l'intuition : des curseurs qui construisent une configuration exemple de `lr`, `mosaic` et `scale` (avec une echelle logarithmique pour le taux d'apprentissage), une animation de la facon dont TPE concentre ses propositions apres une phase de demarrage, et une etude simulee de 18 trials que vous pouvez rejouer pas a pas pour observer le meilleur score s'ameliorer. Une derniere partie explique la difference entre le sampler (quoi essayer ensuite) et le pruner (faut-il continuer un trial).

Toutes les valeurs de cette page sont un exemple pedagogique fixe. Le comportement reel de l'app est decrit dans [Concepts](concepts.fr.md).
