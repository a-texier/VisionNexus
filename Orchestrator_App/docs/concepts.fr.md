---
app: orchestrator
doc_type: concepts
audience: user
lang: fr
title: Concepts
order: 30
tags: [free locked, pipeline, point d'arrêt humain, mlflow, dvc, lineage, insight, plans]
sources: [Orchestrator_App/backend/core/graph_runner.py, Orchestrator_App/backend/core/pipeline_runner.py, Orchestrator_App/backend/core/graph_store.py, Orchestrator_App/backend/core/insights.py, Orchestrator_App/backend/api/lineage.py, Orchestrator_App/backend/core/plan_runner.py, Orchestrator_App/frontend/src/nodes/ports.ts]
---

# Concepts

## Nœuds FREE et LOCKED

Un nœud Dataset Explorer, Annotation ou Inference / Eval a deux modes, derives purement de sa connectivite, jamais stockes :

- **FREE** : le nœud n'a aucune arete entrante. Il expose les sorties existantes deja presentes dans le workspace (subsets pour Dataset Explorer, exports pour Annotation, une session interactive pour Inference / Eval) au lieu d'en produire de nouvelles. Aucune etape de pipeline n'est generee pour lui, et sa sous-application n'est pas lancee automatiquement du seul fait que le nœud existe.
- **LOCKED** : le nœud a au moins une arete entrante. Il execute une nouvelle etape de pipeline depuis son entree et produit une sortie fraiche.

Un nœud Dataset Source ou Modèle n'est jamais FREE ni LOCKED : il n'a jamais d'entree par construction et c'est une pure source de valeur. `dataset_source` est toujours traite comme ayant besoin de sa propre etape, quelles que soient les aretes.

Cela compte en pratique car un nœud FREE permet de reutiliser des donnees deja produites, sans repasser par Dataset Explorer ou Annotation : choisissez un subset ou un export existant et connectez-le en aval. Des qu'une arete entre dans un nœud Dataset Explorer ou Annotation, il bascule en LOCKED et le pipeline regenerera sa sortie au prochain run.

## Exécution du pipeline : étapes, dépendances et parallélisme

Lancer un graphe le convertit en `PipelineDef`, une liste plate d'etapes avec des dependances (`depends_on`), en parcourant le graphe dans l'ordre topologique. Chaque id d'etape suit la convention `<node_id>__<action>`, par exemple `a1__exportyolo`. Un seul nœud peut produire plusieurs etapes (Annotation en produit jusqu'a quatre : `project`, `annotate` ou `auto_annotate`, `exportyolo`, `exportver`).

L'executeur lance les etapes niveau par niveau : a chaque niveau, chaque etape dont les dependances ont deja reussi demarre en meme temps. Deux nœuds Training independants alimentes par la meme Annotation tournent donc en parallele, pas l'un apres l'autre. Si une etape echoue, tout ce qui en depend (directement ou transitivement) est marque en echec et ignore, mais les branches sans rapport vont quand meme jusqu'au bout.

Une etape dont la sous-application cible n'est pas encore accessible attend (jusqu'a quatre minutes) plutot que d'echouer immediatement, car l'application peut etre en cours de lancement. Quelques endpoints particulierement longs (entrainement, inference, evaluation, HPO, embedding de dataset, creation de projet) recoivent un delai HTTP beaucoup plus large, car une evaluation ou une auto-annotation sur une machine GPU distante peut facilement depasser les dix minutes par defaut.

## Points d'arrêt humains

Un point d'arret humain est une etape de pipeline sans action automatique : elle met simplement le run en pause et montre une instruction et un lien vers la sous-application concernee. Vous faites le travail a la main la-bas (annoter des images, relire un subset, lancer un entrainement), puis cliquez **Terminé -> Continuer** dans Orchestrator App pour reprendre.

Les points d'arret apparaissent dans plusieurs situations : un nœud Dataset Explorer ou Annotation configure en mode manuel, les verifications "verifier l'embedding" et "valider le subset" d'un run Dataset Explorer automatique, un nœud Training ou Inference / Eval manuel, et une etude Optuna manuelle. Un nœud Annotation ou Dataset Explorer LOCKED en mode manuel exige en plus que vous choisissiez, dans une liste, quel export ou subset deja produit utiliser avant que le point d'arret ne vous laisse continuer - cela existe car un graphe peut etre repris apres des editions, et le pipeline a besoin d'un choix explicite plutot que de deviner depuis un champ qui contient peut-etre deja une valeur par defaut perimee.

## MLflow : un superviseur isolé, pas une étape de pipeline

Le nœud MLflow n'a jamais d'arete et ne produit jamais d'etape de pipeline. Des qu'il en existe un dans le graphe, MLflow App est lancee et maintenue en vie, et elle observe en continu le store MLflow du workspace (une base SQLite locale, sans serveur, pas un serveur heberge). Chaque etape Training et Inference / Eval executee dans un graphe qui a ce nœud logue automatiquement son propre run MLflow, nomme de facon deterministe `<nom du graphe>/<libelle du nœud>`, groupe dans une seule experience MLflow par graphe, pour que les runs d'entrainement, d'evaluation et de HPO d'un meme projet soient ensemble au lieu d'etre disperses dans des experiences separees.

DVC Commit se comporte de la meme facon : c'est un observateur sans port, pas une etape qui consomme un type d'artefact precis. Le type de nœud que vous lui branchiez historiquement ne signifie plus rien puisque le systeme de ports lui a retire tous ses ports - il scanne toutes les sorties du graphe et vous laisse choisir, depuis son propre panneau, lesquelles versionner.

## Nommage des sorties de Dataset Explorer et d'Annotation

Dataset Explorer et Annotation ecrivent tous deux vers des emplacements fixes sous le workspace, jamais dans le dossier propre d'une application : les subsets dans `explorer_<user>/subsets/<nom>/`, et les exports d'annotation dans `annotation_<user>/exports/<nom>.zip` ou `<nom>.ver`. L'Orchestrator ne lit jamais que ces deux dossiers pour decouvrir les "sorties existantes" du mode FREE ; il ne demande jamais a une sous-application par HTTP ce qu'elle a produit.

Le nom d'export d'un nœud Annotation n'est pas forcement son nom de projet : `export_name`, quand il est defini (typiquement en choisissant un export existant en mode FREE ou manuel), prime sur `project_name` pour localiser un dataset sur disque, car un projet nomme `essai_2` pourrait reutiliser un export produit sous le nom `essai_1-yolo`.

## Auto-lancement des sous-applications

Avant de lancer un pipeline, Orchestrator verifie quelles sous-applications les nœuds LOCKED du graphe necessitent et lance celles qui manquent en arriere-plan, une par une plutot que toutes en meme temps - lancer plusieurs sous-applications simultanement (chacune un uvicorn complet plus un serveur de dev Vite, certaines chargeant des modeles GPU) sature la machine et fait echouer par timeout la premiere etape du pipeline en attente d'une application encore en demarrage a froid. Les applications sont lancees dans l'ordre ou le pipeline en a reellement besoin, pour que la premiere etape n'attende jamais derriere une application dont seule une etape ulterieure a besoin. Les nœuds FREE sont exclus de ce calcul, sauf Inference / Eval, qui a toujours besoin de son application disponible pour la session manuelle qu'il peut ouvrir meme sans entree ; les nœuds MLflow et DVC ont toujours besoin de leur application, car ce sont des observateurs permanents quelle que soit la connectivite.

## Run Insight : ce qu'un run a laissé derrière lui

Un Run Insight est l'enregistrement fige d'un run de graphe precis : tout ce que les sous-applications savent sur ce run, rassemble dans un seul paquet juste apres sa fin (et progressivement pendant qu'il tourne, apres chaque etape significative). Il rassemble les statuts des nœuds et le journal des etapes, les courbes d'entrainement epoch par epoch, les etudes Optuna dont le `run_id` correspond exactement a ce run, les runs MLflow tagues avec l'id de ce run, et les commits DVC dont le trailer correspond. Rien ici ne retombe sur "le fichier le plus recent du workspace" : l'Insight d'un fork ne montre jamais par accident les courbes de son parent simplement parce qu'elles se trouvent etre les plus recentes sur le disque.

Une partie de l'Insight est une **checklist de reproductibilite** avec sept verifications independantes et calculees honnetement : code Git committe, instantane du graphe versionne, dataset versionne dans DVC, un run MLflow lie, le fichier modele reellement present sur disque, des artefacts d'analyse presents, et un remote DVC configure. Le run n'est marque reproductible que lorsque les sept sont vraies ; il n'y a pas d'etat "vert" par defaut.

## Lineage : relier les runs à travers tout le workspace

Alors qu'un Run Insight concerne un run, le graphe de Lineage relie tous les runs de tous les graphes du workspace : datasets sources partages, les subsets reellement extraits par chaque run, modeles, etapes MLflow et artefacts produits, plus les relations de fork entre les runs. Un run n'apparait dans la vue par defaut (publiee) que lorsqu'il a un statut terminal et reussi ; les runs echoues et interrompus sont visibles dans la vue d'audit mais masques par defaut, listes a la place dans `excluded_runs`. Un run sans aucune information de lineage est quand meme montre, marque comme non versionne, plutot que de faire echouer toute la page sur un run incomplet.

Un **fork** duplique un graphe (en gardant les memes nœuds dataset et annotation, donc le meme subset et les memes annotations deja produites) et enregistre d'ou il vient : le commit, le dataset, la version DVC et le mAP50 du parent. Forker ne declenche jamais de pull DVC ni de re-telechargement ; cela n'enregistre que la provenance pour la vue de divergence, et vous ajustez les parametres et relancez vous-meme. L'**instantane de comparaison** d'un run est une vue normalisee et stable de son dataset, de ses annotations, des best params HPO (seulement s'ils sont produits par ce run precis, jamais herites d'un parent), des parametres d'entrainement, du modele, des etapes MLflow et des artefacts, utilisee pour comparer deux runs section par section et ne mettre en evidence que ce qui a reellement change.

## Plans d'expériences

Un Plan d'experiences est une liste ordonnee d'etapes ; chaque etape duplique un graphe de base deja construit dans le Sandgraph et applique des surcharges nommees a un petit ensemble d'ids de nœuds standard (`v1` pour Dataset Explorer, `a1` pour Annotation, `t1` pour Training). Lancer un plan n'appelle aucune fonction interne directement : il rejoue, en tache de fond, exactement la sequence qu'un humain ferait a la main via les propres endpoints HTTP de l'application, si bien que toute la logique existante de validation, d'auto-lancement et de point d'arret humain est reutilisee sans changement. Un plan reprend automatiquement chaque point d'arret rencontre, car une serie planifiee d'experiences ne doit jamais rester bloquee a attendre un clic. Le commit DVC est deliberement laisse hors de cette automatisation : un plan produit des runs, et vous choisissez depuis leur propre nœud DVC quelles sorties valent la peine d'etre versionnees.

## Ports typés, entrées obligatoires et entrées exclusives

Chaque nœud declare ses entrees et sorties comme un petit schema, pas juste une liste de types de source acceptes. Cela permet a un nœud comme Training d'avoir trois entrees typees independamment (un dataset obligatoire depuis Annotation, un modele optionnel depuis un nœud Modèle, et des best params optionnels depuis Optuna), chacune avec son propre port et sa propre regle d'acceptation, et permet a Annotation d'exposer deux sorties distinctes (un dataset YOLO complet et une verite terrain `.ver` native) que differents nœuds en aval recuperent automatiquement selon le port auquel ils se connectent.

Deux regles supplementaires gardent les configurations coherentes : des ports **exclusifs** sur le meme nœud ne peuvent jamais etre connectes tous les deux (l'entree images brutes et l'entree dataset YOLO d'Inference / Eval sont exclusives, car le dataset YOLO inclut deja la verite terrain), et un port a **pair requis** n'a de sens qu'aux cotes d'un autre (l'entree GT d'Inference / Eval n'est qu'un simple avertissement, pas une erreur, quand elle est connectee sans entree de sequence, car une verite terrain sans rien a evaluer est inhabituel mais pas interdit). Une entree obligatoire manquante bloque la sauvegarde et le lancement du graphe, sauf sur un nœud FREE, qui en est exempte car il n'a deliberement aucune entree.
