---
app: orchestrator
doc_type: workflows
audience: user
lang: fr
title: Procédures
order: 20
tags: [templates, mode free, mode locked, fork, dvc, mlops, plans, scénarios]
sources: [Orchestrator_App/frontend/src/pages/ExperimentsPage.tsx, Orchestrator_App/frontend/src/pages/SandgraphPage.tsx, Orchestrator_App/frontend/src/pages/PlansPage.tsx, Orchestrator_App/backend/core/graph_runner.py, Orchestrator_App/backend/api/graphs.py, Orchestrator_App/run_all_scenarios.py]
---

# Procédures

## Construire un graphe de zéro et le lancer

Cette procedure cree une experience vide et assemble a la main la chaine utile la plus courte.

*Prerequis* : Orchestrator App est ouvert sur la page **Sandgraph** ; les sous-applications n'ont pas besoin de tourner deja.

1. Cliquez sur **Nouvelle expérience** (barre du haut, ou sur le canvas vide).
2. Glissez **Dataset Source** depuis la barre d'outils sur le canvas, cliquez dessus et remplissez **Chemin (dossier)** avec le dossier d'images a charger, et **Nom du dataset**.
3. Glissez **Dataset Explorer**, connectez **Dataset Source** dessus, et reglez **Requête sémantique** et **top_k**.
4. Glissez **Annotation**, connectez **Dataset Explorer** dessus. Gardez **Manuel (annoter dans l'app)** pour un premier run, ou basculez sur **Full Automatique (IA)** et remplissez le modele IA et le prompt texte.
5. Glissez **DVC Commit** n'importe ou sur le canvas (aucune connexion necessaire).
6. Cliquez **Sauvegarder**, corrigez toute erreur de validation affichee, puis cliquez **Lancer**.

*Résultat* : les sous-applications necessaires se lancent automatiquement ; le pipeline s'execute nœud par nœud, s'arretant a chaque point d'arret humain jusqu'a ce que vous cliquiez **Terminé -> Continuer**. A la fin, la fenetre **Chaîne terminée** s'ouvre avec un raccourci vers le nœud DVC.

## Utiliser le template Entraînement rapide

Cette procedure part du template **Entraînement rapide** : la chaine la plus courte, sans evaluation ni HPO.

*Prerequis* : Orchestrator App est ouvert sur la page **Expériences**.

1. Sous **Templates prédéfinis** > **Scénarios mainstream**, trouvez **Entraînement rapide** et cliquez **Utiliser ce template**.
2. Le Sandgraph s'ouvre avec cinq nœuds deja connectes : Dataset Source -> Dataset Explorer -> Annotation -> Training -> DVC Commit, plus un nœud MLflow superviseur isole.
3. Ouvrez le nœud **Dataset Source** et mettez un vrai **Chemin (dossier)** (le template part avec un chemin vide).
4. Ajustez la requete, le prompt d'annotation et les epochs d'entrainement si besoin, puis cliquez **Lancer**.

*Résultat* : un dataset est embeddé, un subset est cree par requete CLIP, les images sont annotees automatiquement avec Grounding DINO, un modele est entraine, et MLflow logue le run. DVC est present mais rien n'est versionne tant que vous n'utilisez pas son nœud.

## Utiliser le template Chaîne standard

Cette procedure ajoute une etape d'evaluation apres l'entrainement, pour que le mAP rapporte soit mesure, pas seulement la metrique de fin d'entrainement.

*Prerequis* : meme chose que la procedure Entraînement rapide.

1. Utilisez le template **Chaîne standard**.
2. Le graphe ajoute un nœud **Inference / Eval** apres Training, avec **task = detection** et **gt_split = val**, connecte a la fois a Training (pour le modele) et a Annotation (pour la verite terrain).
3. Remplissez le chemin du dataset, puis **Lancer**.

*Résultat* : apres l'entrainement, le nœud Inference / Eval reevalue le modele sur le split `val` avec `model.val()` et rapporte mAP50, mAP50-95, precision, rappel, une courbe PR, une courbe F1 et une matrice de confusion. C'est la chaine recommandee pour un modele que vous comptez garder.

## Utiliser le template Chaîne + HPO Optuna

Cette procedure cherche de bons hyperparametres avant l'entrainement final.

*Prerequis* : meme chose que la procedure Entraînement rapide. Attendez-vous a plusieurs entrainements a la suite (chaque essai Optuna est un entrainement complet), prevoyez donc assez de temps.

1. Utilisez le template **Chaîne + HPO Optuna**.
2. Le graphe insere un nœud **Optuna HPO** entre Annotation et le Training final : Annotation alimente a la fois l'etude Optuna (dataset) et le nœud Training (dataset) directement, et Optuna alimente Training avec **best params**.
3. Verifiez le nombre d'essais et l'espace de recherche sur le nœud Optuna, puis **Lancer**.

*Résultat* : Optuna lance ses essais (echantillonneur TPE), les meilleurs parametres sont fusionnes dans les hyperparametres du Training final au moment de l'execution, et seul ce training final est evalue et loggue comme resultat "propre".

## Explorer un dataset a la main avant d'annoter

Cette procedure utilise le template **Exploration dataset** pour inspecter un dataset dans le playground de Dataset Explorer avant de s'engager sur une requete de subset automatique.

*Prerequis* : un dossier d'images accessible depuis la machine du backend.

1. Utilisez le template **Exploration dataset**. Il contient seulement un nœud Dataset Source connecte a un nœud Dataset Explorer en mode manuel (**Full Automatique (CLIP)** decoche).
2. Reglez le chemin du dataset et cliquez **Lancer**.
3. Le pipeline s'arrete au point d'arret humain **Créer subset "..." manuellement**. Cliquez **Ouvrir Dataset Explorer**, parcourez les clusters CLIP et la recherche semantique dans le Playground, et creez-y un subset.
4. Revenez au Sandgraph et cliquez **Terminé -> Continuer**.

*Résultat* : un subset existe dans `explorer_<user>/subsets/`, pret a etre repris plus tard par un nœud Annotation FREE ou un autre nœud Dataset Explorer dans un nouveau graphe.

## Re-entraîner depuis un export d'annotation existant (Annotation FREE)

Cette procedure entraine un nouveau modele depuis des annotations deja exportees, sans retoucher a Dataset Explorer.

*Prerequis* : un export YOLO existe deja dans `annotation_<user>/exports/` (produit par un run precedent ou par un export manuel depuis Annotation App).

1. Utilisez le template **Re-train depuis annotation existante**, ou glissez un nœud **Annotation** seul sans arete entrante.
2. Le nœud Annotation est FREE : sa carte liste les exports disponibles dans le workspace. Cliquez **Choisir une annotation existante**, puis choisissez l'export `.ver` ou YOLO voulu.
3. Ajustez le nœud Training (moteur, taille, epochs), puis cliquez **Lancer**.

*Résultat* : aucune etape Dataset Explorer ni d'annotation ne s'execute ; le Training demarre directement depuis l'export choisi. C'est le moyen le plus rapide d'essayer de nouveaux hyperparametres sur des donnees deja annotees.

## Annoter depuis un subset existant (Dataset Explorer FREE)

Cette procedure reutilise un subset deja cree dans Dataset Explorer, en sautant le chargement du dataset et la requete CLIP.

*Prerequis* : un subset existe deja dans `explorer_<user>/subsets/` (voir "Explorer un dataset a la main avant d'annoter" ci-dessus, ou tout run precedent).

1. Utilisez le template **Annotation depuis subset existant**, ou glissez un nœud **Dataset Explorer** seul sans arete entrante.
2. Le nœud Dataset Explorer est FREE : cliquez **Choisir un subset existant** et choisissez le subset par son nom.
3. Connectez-le a un nœud **Annotation** (LOCKED, puisqu'il a maintenant une arete entrante) et configurez le mode d'annotation.
4. Cliquez **Lancer**.

*Résultat* : le pipeline saute directement a la creation du projet et a l'annotation ; aucune etape Dataset Explorer n'est generee et Dataset_Explorer_App n'est pas auto-lancee, seules Annotation_App et (si present) DVC/MLflow le sont.

## Forker un run pour essayer de nouveaux paramètres sur les mêmes données

Cette procedure relance une experience avec des parametres differents en gardant exactement le meme dataset et les memes annotations qu'un run de reference.

*Prerequis* : un run termine avec un Insight genere (MLOps > Insights, ou le detail InsightsPage d'un run).

1. Ouvrez l'Insight du run (MLOps > Insights, cliquez le run dans la liste).
2. Cliquez **Fork this run**.
3. Un nouveau graphe s'ouvre, nomme `<original> - fork de <run_id>`. Un bandeau indigo **Fork de <run>** apparait sous la barre du haut, listant chaque parametre qui differe du parent (aucun au depart, puisque rien n'a encore change).
4. Editez les parametres a tester (par exemple `epochs`, `basic_lr_per_img`, ou le moteur d'entrainement). Observez le bandeau : si vous changez un parametre d'entrainement mais pas `project_name` ni `run_label`, c'est attendu (le dataset reste identique) ; si vous changez `query` ou `subset_name` sur les nœuds Dataset Explorer/Annotation sans renommer la sortie, l'avertissement rouge vous dit que le run reutiliserait silencieusement l'artefact existant.
5. Cliquez **Lancer**.

*Résultat* : le graphe forke reutilise les memes nœuds dataset et annotation (meme subset, memes annotations), donc aucune re-annotation n'a lieu ; seuls les nœuds en aval que vous avez changes produisent de nouvelles sorties. L'Insight du nouveau run enregistre `forked_from` avec le commit, le dataset et le mAP50 du parent, et le graphe Lineage montre l'arete de fork entre les deux runs.

## Promouvoir un graphe expérimental en suivi MLOps

Cette procedure transforme un graphe sans suivi DVC/MLflow en un graphe versionne et traçable.

*Prerequis* : un graphe existant, avec ou sans historique de runs.

1. Ouvrez le graphe dans le Sandgraph. S'il n'a ni nœud MLflow ni nœud DVC, la barre du haut affiche **Experimental** avec un lien **Track in MLOps**.
2. Cliquez dessus (ou sur le badge ambre **Suivi incomplet , compléter** si un seul des deux nœuds est present).
3. Le nœud manquant (ou les deux) est ajoute automatiquement au graphe, positionne sous les nœuds existants, et le graphe est sauvegarde.

*Résultat* : le badge devient vert (**MLOps**). Chaque futur run de ce graphe logue desormais dans MLflow et peut etre versionne depuis le nœud DVC ; le statut MLOps du graphe pilote aussi le badge montre sur son Insight dans les sous-onglets Lineage et Insights. Aucun run n'est lance et rien n'est versionne par cette seule action.

## Versionner un run terminé dans DVC

Cette procedure versionne le dataset, le modele et l'instantane du graphe d'un run deja termine.

*Prerequis* : un graphe qui a termine un run (statut **done**) et qui contient un nœud DVC Commit.

1. Cliquez le nœud DVC Commit pour ouvrir son panneau (il s'ouvre automatiquement a la fin d'un run via la fenetre **Chaîne terminée**).
2. Cliquez **rafraîchir** si la liste d'artefacts semble perimee.
3. Cochez les artefacts a versionner : le dataset YOLO, les annotations GT, le meilleur modele, les meilleurs params Optuna, les metriques, et/ou l'instantane du graphe. Seuls les artefacts marques comme produits (pas "pas encore produit") peuvent etre coches.
4. Editez **Message de commit** si besoin.
5. Cliquez **Créer une version DVC (Git + cache DVC)**.

*Résultat* : un commit Git est cree avec des trailers (`Run-Id`, `Graph-Id`, `Dataset`, `mAP50`, `MLflow-Run`), les artefacts coches sont enregistres dans le cache DVC et pousses vers le remote si un est configure, et les runs MLflow de ce run Orchestrator recoivent en retour les tags `git_commit` et `dataset_version`. Le panneau affiche alors **Versionné** avec le hash du commit, et le bouton devient **Run déjà versionné**.

## Planifier et lancer une série d'expériences

Cette procedure automatise "dupliquer un graphe de base, changer deux ou trois parametres, relancer", repete pour plusieurs variantes.

*Prerequis* : au moins un graphe de base deja construit et sauvegarde dans le Sandgraph (un pipeline complet, ou un graphe de reutilisation FREE tel que Annotation FREE -> Training).

1. Ouvrez **MLOps** > **Plans**, cliquez **Nouveau plan**.
2. Pour chaque variante, cliquez **Ajouter une étape** : choisissez le **graphe de base**, tapez un libelle d'etape, et remplissez les champs de surcharge a changer (**Subset**, **Projet annot.**, **Nb images**, **Seuil annot.**, **Epochs**, **LR par image**, **Batch**, **Run label**). Laissez un champ vide pour garder la valeur du graphe de base.
3. Cliquez **Enregistrer**, puis **Lancer le plan**.
4. Observez le bloc de progression : chaque etape duplique son graphe de base, applique les surcharges, lance le pipeline, et reprend automatiquement tout point d'arret humain rencontre (un plan ne reste jamais bloque a vous attendre).

*Résultat* : un nouveau graphe par etape, chacun avec son propre historique de runs, son mAP50, sa version DVC et son commit Git une fois generes. Rien n'est committe dans DVC automatiquement ; parcourez les resultats dans le sous-onglet **Lineage** et versionnez ceux que vous voulez garder depuis leur propre nœud DVC.

## Scénarios de test : modes FREE et LOCKED de bout en bout

Ces cinq scenarios sont la suite de test de reference pour le comportement FREE/LOCKED et la chaine complete du pipeline. Ils correspondent aux templates proposes sur la page **Expériences** (SC1 a SC4) plus un cinquieme, un scenario en eventail pilote uniquement via l'API (`run_all_scenarios.py`).

### SC1 : exploration depuis un subset existant (Dataset Explorer FREE)

*Prerequis* : un subset nomme `night_dark` existe deja dans `explorer_<user>/subsets/`.

1. Utilisez le template **Annotation depuis subset existant** (ou construisez-le : Dataset Explorer FREE -> Annotation LOCKED -> DVC).
2. Sur le nœud Dataset Explorer FREE, selectionnez `night_dark`.
3. Connectez-le a Annotation, configurez-le, et lancez.

*Résultat* : aucune etape de pipeline n'est generee pour Dataset Explorer, Dataset_Explorer_App n'est pas auto-lancee, et le run va directement a la creation du projet d'annotation depuis le subset existant.

### SC2 : training depuis une annotation existante (Annotation FREE)

*Prerequis* : un export nomme `annot_v2` existe deja dans `annotation_<user>/exports/`.

1. Utilisez le template **Re-train depuis annotation existante** (ou construisez-le : Annotation FREE -> MLflow -> DVC).
2. Sur le nœud Annotation FREE, selectionnez `annot_v2`.
3. Connectez-le en aval et lancez.

*Résultat* : un pipeline partiel s'execute ; Annotation_App n'est pas auto-lancee pour un nouveau projet, seulement pour lire l'export existant.

### SC3 : pipeline automatisé avec validation humaine

*Prerequis* : un Dataset Source avec un chemin valide.

1. Construisez Dataset Source -> Dataset Explorer LOCKED -> Annotation LOCKED (`full_auto=true`, modele IA SAM3, prompt `"Cars"`) -> MLflow -> DVC.
2. Lancez le graphe.

*Résultat* : le pipeline vous guide a travers un point d'arret humain a chaque etape critique (verifier l'embedding, valider le subset, entrainer, HPO si present), tandis que le reste s'execute automatiquement.

### SC4 : pipeline entièrement manuel

*Prerequis* : meme chose que SC3.

1. Construisez la meme chaine que SC3 mais avec `full_auto=false` sur le nœud Annotation.
2. Lancez le graphe.

*Résultat* : l'Orchestrator agit purement comme observateur et connecteur ; chaque action (creation de subset, annotation) est pilotee a la main dans les sous-applications, avec un point d'arret humain au lieu de l'etape d'annotation automatique.

### SC5 : dataset nocturne, trois trainings, HPO et DVC

*Prerequis* : un chemin de dataset pour une source nocturne/voitures ; ce scenario se lance normalement via `run_all_scenarios.py`, pas construit a la main.

1. Construisez Dataset Source -> Dataset Explorer LOCKED (requete "night") -> Annotation manuelle -> trois nœuds Training avec des hyperparametres distincts (`t1` : yolov8n lr=1e-2, `t2` : yolov8s lr=1e-3, `t3` : yolov8n avec augmentation mosaic) -> un point d'arret de verification MLflow -> Optuna HPO -> un quatrieme Training (`t_best`) utilisant les best params du HPO -> une verification MLflow finale -> DVC.
2. `t_best` derive son `dataset_path` en remontant ses ancetres (son parent direct est le nœud Optuna, mais le dataset vient du nœud Annotation plus haut dans la chaine).
3. Lancez le graphe ; resolvez chaque point d'arret (verifier l'embedding, valider le subset, annoter, les deux verifications MLflow) au fur et a mesure.

*Résultat* : trois trainings configures independamment plus un training ajuste par HPO loguent tous dans la meme experience MLflow, et DVC peut versionner le resultat final. Ce scenario exerce a la fois l'eventail (plusieurs nœuds Training depuis une Annotation) et la resolution d'ancetres multi-sauts.
