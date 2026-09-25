---
app: optuna
doc_type: concepts
audience: user
lang: fr
title: Concepts
order: 30
tags: [etude, trial, sampler, tpe, pruner, espace de recherche, objectif, fanova]
sources: [Optuna_App/backend/core/optuna_runner.py, Optuna_App/backend/api/orchestrator.py, Optuna_App/backend/api/studies.py, Optuna_App/backend/hpo_trial.py, Training_App/backend/services/yolox_catalog.py]
---

# Concepts

## L'optimisation d'hyperparametres dans Optuna App

Un modele apprend ses poids pendant l'entrainement, mais beaucoup de reglages sont choisis avant l'entrainement et jamais appris : le taux d'apprentissage, la probabilite de chaque augmentation, la plage de rotation, le weight decay. Ce sont les hyperparametres. Trouver de bonnes valeurs depend du dataset, et deviner est lent.

L'optimisation d'hyperparametres (HPO) automatise la recherche : elle propose une combinaison de valeurs, entraine un modele avec, mesure un score, et utilise les scores deja observes pour proposer la combinaison suivante. Optuna est la bibliotheque qui pilote cette boucle ; Optuna App lui donne une interface, un stockage par utilisateur, et un lien direct avec les moteurs d'entrainement et l'Orchestrator de la suite.

Les trials HPO sont des entrainements courts (10 epochs par trial par defaut dans le prereglage et dans l'Orchestrator). Ils comparent des reglages ; ils ne produisent pas le modele final. La meilleure combinaison sert ensuite a un entrainement complet dans Training App.

## Etude et son stockage

Une etude est une campagne d'optimisation. Elle est definie par son nom, sa direction (minimize ou maximize), son sampler, son espace de recherche et ses trials. Toutes les etudes d'un utilisateur sont stockees dans la base SQLite Optuna `optuna.db` du workspace.

Une etude conserve aussi des attributs descriptifs enregistres par l'app quand un run demarre : la source (`manual` ou `orchestrator`), le script ou le dataset, la metrique, le nombre de trials demande, le sampler et le pruner, et pour les etudes Orchestrator les identifiants de moteur, taille de modele, graphe, run, noeud et attempt. La page d'etude les lit pour remplir l'apercu du tableau de bord.

La direction est fixee a la creation de l'etude. Lancer une optimisation sur une etude existante reutilise sa direction, quoi que dise la page de lancement. Relancer sur la meme etude lui ajoute de nouveaux trials, et le sampler reutilise tous les resultats precedents, ce qui n'a de sens que si l'objectif, le dataset et l'espace de recherche n'ont pas change.

## Trial et etats de trial

Un trial est une combinaison d'hyperparametres et une execution de l'objectif : un entrainement et un score. Optuna donne a chaque trial un numero, a partir de 0, et l'un de cinq etats :

| Etat | Signification |
|---|---|
| `WAITING` | Planifie, pas encore demarre. |
| `RUNNING` | Le trial s'execute. |
| `COMPLETE` | Une valeur objectif numerique a ete enregistree. Seuls ces trials comptent pour le meilleur trial. |
| `FAIL` | Erreur technique ou resultat invalide (crash, dataset manquant, metrique illisible). L'echec est diagnostique et stocke avec le trial. |
| `PRUNED` | Arrete tot. Dans Optuna App, ceci ne vient jamais d'une decision algorithmique puisque le pruning est desactive. |

La page d'etude ajoute trois qualifications en lecture seule, calculees a l'affichage de la page ; la base de donnees n'est jamais reecrite :

- `INTERRUPTED` : un trial toujours `RUNNING` dans la base depuis plus de 30 minutes alors qu'aucun processus de ce backend ne l'execute (backend redemarre, processus tue). Ce n'est ni un resultat ni un pruning.
- `LEGACY_PRUNED_UNKNOWN` : un trial `PRUNED` sans aucune valeur intermediaire, donc la cause reelle est inconnue. Les trials sautes apres **Arrêter** tombent dans cette categorie.
- `LEGACY_FAILURE_RECOVERED` : un ancien trial prune dont le journal historique montre un echec de chargement du dataset.

## Espace de recherche et distributions de parametres

L'espace de recherche liste les hyperparametres qu'une etude peut changer, chacun avec une distribution :

- `float` : un intervalle continu entre un minimum et un maximum. Avec **log**, les valeurs sont tirees uniformement sur une echelle logarithmique, ce qui convient aux quantites qui couvrent plusieurs ordres de grandeur comme `basic_lr_per_img` (1e-5 a 1e-2).
- `int` : un entier entre deux bornes.
- `categorical` : une valeur parmi une liste fermee, par exemple un nom d'optimiseur.

Chaque trial tire une valeur par parametre. Des bornes trop larges gaspillent le budget de trials et peuvent produire des reglages qui n'entrainent pas du tout ; des bornes trop etroites cachent la meilleure region. Pour les etudes de detection, les plages par defaut viennent du catalogue de moteur de Training App. Pour YOLOX, les parametres reglables sont `basic_lr_per_img`, `min_lr_ratio`, `momentum`, `weight_decay`, `mosaic_prob`, `mixup_prob`, `hsv_prob`, `flip_prob`, `degrees`, `translate` et `shear` ; la selection par defaut est `basic_lr_per_img`, `mosaic_prob` et `degrees`. Un parametre que le moteur ne connait pas est ignore par le trial et liste dans son resultat sous `ignored_params`.

## Objectif, metrique et direction

L'objectif est le nombre unique qui classe les trials. La direction dit si plus haut ou plus bas est meilleur : maximiser une precision, un mAP, une precision ou un rappel ; minimiser une loss ou une latence.

Les etudes de detection utilisent l'une de deux metriques mesurees sur le split de validation a la fin de chaque trial :

- `map50` : mean Average Precision a un IoU de 0,50, tolerante aux boites imprecises.
- `map5095` : moyenne de l'AP sur des seuils d'IoU de 0,50 a 0,95, plus exigeante sur la localisation.

Seule la metrique choisie decide. Si l'objectif est `map50`, deux trials avec le meme `map50` ne sont pas departages par leur `map5095`, meme si les deux valeurs sont affichees dans les resultats du trial. Un trial court mesure aussi un modele loin de la convergence : le classement des reglages est informatif, les valeurs absolues sont plus basses que celles de l'entrainement final.

## Sampler TPE et sa phase de demarrage

Le sampler propose les valeurs de chaque nouveau trial. Optuna App utilise toujours le sampler Tree-structured Parzen Estimator (TPE) d'Optuna.

TPE regarde les trials deja termines, les separe en un groupe de bons resultats et le reste, estime ou chaque groupe est dense dans l'espace de recherche, et propose des valeurs probables dans le bon groupe et improbables dans l'autre, tout en gardant une part d'exploration. Il construit des probabilites a partir d'observations ; il ne comprend pas le modele.

TPE a besoin d'observations d'abord. Les 10 premiers trials forment la phase de demarrage et sont tires au hasard. Les trials echoues, interrompus et anciens prunes ne donnent aucun score, donc ils ne comptent pas. Le tableau de bord montre la phase ("démarrage / exploration initiale" ou "TPE adaptatif") et le nombre de decisions adaptatives, c'est-a-dire les trials termines au-dela du dixieme. Une etude de 10 trials ou moins ne sort jamais de la phase de demarrage : c'est une recherche aleatoire.

## Pruner : pourquoi le pruning est desactive

Un pruner arrete tot un trial quand ses resultats intermediaires sont clairement pires que ceux d'autres trials au meme stade. Pour fonctionner, l'objectif doit rapporter une metrique a chaque epoch (`trial.report(value, step)`) et demander au pruner s'il faut continuer (`trial.should_prune()`).

Les moteurs d'entrainement ne rapportent pas de metriques par epoch a Optuna, donc chaque etude d'Optuna App tourne avec le pruning desactive (`NopPruner` d'Optuna), et le tableau de bord le dit. Activer un pruner median sans valeurs intermediaires n'aurait aucun effet.

En consequence, un etat `PRUNED` ne signifie jamais que l'algorithme a juge un trial mauvais. Une erreur de dataset, une erreur CUDA ou un arret utilisateur est un echec ou une interruption, jamais un pruning.

## Meilleure valeur et meilleurs parametres

Le meilleur trial est le trial `COMPLETE` a l'objectif le plus favorable dans la direction de l'etude. Sa valeur est la meilleure valeur ; ses hyperparametres suggeres sont les meilleurs parametres (`best_params`).

Les meilleurs parametres contiennent seulement les hyperparametres regles. Ils n'incluent pas les reglages fixes du trial (epochs, taille d'image, batch), les metriques secondaires, ni les poids : le checkpoint du meilleur trial vient d'un entrainement court et n'est pas le modele final.

Quand une etude a zero trial `COMPLETE`, il n'y a pas de gagnant officiel ni de meilleurs parametres. La page d'etude separe alors les causes possibles (aucun trial lance, echecs techniques, interruptions) et, pour d'anciennes etudes dont les entrainements ont termine mais dont la valeur a ete perdue, peut montrer des metriques recuperees depuis leur `results.csv`, clairement marquees comme informatives. Elles ne modifient jamais l'etude.

## Importance des parametres avec fANOVA

Le panneau **Importance des paramètres** estime a quel point chaque hyperparametre explique la variation de l'objectif parmi les trials termines, avec l'evaluateur fANOVA d'Optuna (graine fixe 0). Les importances totalisent environ 1.

L'estimation est exploratoire. Elle necessite au moins 5 trials termines avec des valeurs finies, et au moins deux valeurs differentes ; sinon le panneau explique pourquoi il est indisponible. La page avertit quand il y a moins de 20 trials termines, quand TPE est encore en phase de demarrage, et quand la dispersion de l'objectif est sous 0,02, car le classement est alors instable.

Une importance decrit une association dans les trials observes, pas une cause, et pas une direction : une importance haute ne dit pas que des valeurs plus grandes sont meilleures. Utilisez la carte de chaleur et les coordonnees paralleles pour voir quelles valeurs vont avec de bons scores.

## Attempts et tracabilite Orchestrator

Une etude lancee par l'Orchestrator est un attempt d'un noeud HPO dans un run de pipeline. Son nom joint l'id de graphe, l'id de run, l'id de noeud et un id d'attempt aleatoire de 8 caracteres (`<graphe>__<run>__<noeud>__<attempt>`) ; sans information de graphe, le nom est `hpo_<dossier dataset>__<attempt>`. Les memes identifiants sont stockes comme attributs de l'etude et de chaque trial.

Un attempt est immuable : relancer le noeud, ou forker le pipeline dans l'Orchestrator, cree un nouvel attempt et une nouvelle etude, jamais des trials supplementaires dans un ancien. Cela garde chaque resultat lie a exactement un run, un dataset et une configuration, pour que les attempts puissent etre compares plus tard. Le nom lisible d'un graphe n'est pas une identite ; l'id de run l'est.

Supprimer une etude retire ses trials de la base de donnees seulement. Les fichiers de ses trials restent dans `hpo_runs/`.

## Contrat de resultat d'un trial

Chaque trial execute un processus Python separe. Ce qu'il doit retourner depend de la facon dont l'etude a ete lancee.

Pour une etude lancee depuis la page de lancement, le script recoit les arguments fixes, puis chaque hyperparametre comme `--nom valeur`. Il doit imprimer l'objectif comme un nombre brut sur la derniere ligne de sa sortie standard :

```python
import argparse

parser = argparse.ArgumentParser()
parser.add_argument("--lr", type=float)
parser.add_argument("--depth", type=int)
args = parser.parse_args()
score = train_and_evaluate(lr=args.lr, depth=args.depth)
print(score)  # derniere ligne = objectif
```

Si la derniere ligne n'est pas un nombre, l'app cherche dans la sortie une ligne `nom_metrique=valeur`. Un script qui se termine avec un code non nul, qui tourne plus d'une heure, ou dont la valeur ne peut pas etre lue fait echouer le trial.

Pour les etudes Orchestrator, le script de trial `hpo_trial.py` ecrit son resultat de facon atomique dans `result.json` du dossier du trial (statut, objectif, `map50` et `map5095`, chemins de `results.csv` et des poids, parametres ignores). L'objectif est lu depuis ce fichier, pas depuis la sortie console, ce qui evite de perdre des valeurs a cause de problemes d'encodage sous Windows. Le script imprime aussi `map50=valeur` et la valeur sur ses dernieres lignes, ce qui lui permet de satisfaire le contrat ci-dessus quand le prereglage l'utilise.
