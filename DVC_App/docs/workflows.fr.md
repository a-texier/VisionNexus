---
app: dvc
doc_type: workflows
audience: user
lang: fr
title: Workflows
order: 20
tags: [commit, remote, push, pull, diff, restaurer, orchestrator]
sources: [DVC_App/frontend/src/pages/LineagePage.tsx, DVC_App/frontend/src/pages/HistoryPage.tsx, DVC_App/frontend/src/pages/DiffPage.tsx, DVC_App/frontend/src/pages/SyncPage.tsx, DVC_App/backend/api/orchestrator.py, Orchestrator_App/backend/api/graphs.py]
---

# Workflows

## Versionner le dataset et le modele d'un run de pipeline depuis l'Orchestrator

Ce workflow transforme la sortie d'un run de pipeline termine en un commit Git + DVC, avec des trailers de lineage qui le relient au run.

*Prerequis* : l'Orchestrator App tourne, un graphe contient un noeud DVC, et au moins un run de ce graphe a termine en produisant un dataset et, en option, un modele entraine.

1. Ouvrez le hub du noeud DVC dans l'Orchestrator (il observe tout le graphe ; il n'est pas branche dans le flux du pipeline lui-meme).
2. Selectionnez le run termine et choisissez quels artefacts versionner : le dataset, les poids du modele, les annotations, les metriques du run, les meilleurs parametres Optuna, et/ou un instantane complet du graphe de pipeline.
3. Confirmez le commit. L'Orchestrator copie les artefacts choisis dans le repository (les exports `.zip` sont extraits automatiquement), execute `dvc add` sur chacun, et cree un commit Git dont le message porte les trailers de lineage (Run-Id, Graph-Id, Dataset, mAP50, MLflow-Run).
4. L'Orchestrator tague ensuite le run MLflow correspondant avec le hash de commit Git et la version de dataset qui en resultent, bouclant la boucle de lineage.

*Résultat* : un nouveau commit apparait sur la page **Historique** de DVC App avec ses puces de lineage, et les fichiers versionnes apparaissent sur **Datasets**. Si rien n'avait reellement change depuis le dernier commit, l'Orchestrator rapporte qu'il a saute le commit plutot que d'en creer un vide.

## Lire ce que contient reellement une version

Ce workflow inspecte un commit Git+DVC pour savoir exactement quelle version de dataset ou de modele il represente avant de la reutiliser.

*Prerequis* : au moins un commit avec des fichiers `.dvc` existe.

1. Ouvrez **Lineage**, trouvez le run dont vous voulez inspecter la version, et cliquez son noeud de version Git/DVC (ou ouvrez **Historique** directement).
2. Lisez les puces de lineage du commit : **Dataset** nomme le dataset, **Run** donne l'id de run Orchestrator, **mAP50** la metrique enregistree au moment du commit.
3. Depliez la ligne du commit pour voir les fichiers `.dvc` exacts qu'il a changes ; chacun est un pointeur vers un dataset ou dossier de modele suivi.
4. Pour l'image complete de ce qui est suivi en ce moment (pas seulement ce qu'un commit a change), ouvrez `/datasets` directement et verifiez la colonne de statut de chaque fichier.

*Résultat* : vous savez quel run a produit une version donnee, sur quel dataset, avec quelle metrique, sans ouvrir le repository sur la machine backend.

## Comparer deux versions avant de decider laquelle garder

Ce workflow repond a "qu'est-ce qui a reellement change entre ces deux versions" en termes d'images et d'annotations, pas seulement de hash de fichiers.

*Prerequis* : au moins deux commits touchant des fichiers `.dvc` existent.

1. Ouvrez **Diff**. Si vous venez du bouton **Diff** d'une ligne de commit ou d'un noeud de version Lineage, les deux revisions sont pre-remplies.
2. Sinon, tapez ou choisissez **Révision A (base)** et **Révision B (cible)** dans les listes deroulantes (alimentees par l'historique des commits), puis cliquez **Calculer le diff**.
3. Lisez d'abord le **Résumé métier** : combien d'images ont ete ajoutees ou retirees, combien de fichiers d'annotation ont change. S'il montre zero pour les trois alors que des fichiers ont quand meme change, le contenu est agrege dans un dossier suivi plutot que suivi fichier par fichier ; verifiez la table de detail en dessous pour les chemins reels.
4. Verifiez **Utilisé par** : si un run a utilise la revision B, il est nomme ici, tire directement des trailers de ce commit ; si rien n'est montre, aucun run n'est enregistre contre cette version, ce qui est indique clairement plutot que devine.
5. Descendez jusqu'a la table fichier par fichier pour la liste exacte des chemins ajoutes, supprimes, modifies et renommes.

*Résultat* : assez d'information pour decider quelle version garder, restaurer, ou transmettre, sans telecharger l'une ou l'autre d'abord.

## Restaurer une ancienne version du dossier de travail

Ce workflow ramene les fichiers de travail du repository exactement a l'etat d'un commit passe.

*Prerequis* : le commit a restaurer est visible sur **Historique**.

1. Ouvrez **Historique** et trouvez le commit a restaurer.
2. Cliquez **Restaurer** sur la ligne de ce commit.
3. Lisez attentivement la boite de confirmation : elle indique que le dossier de travail reviendra exactement a l'etat de ce commit (dataset et modele), et que c'est reversible en restaurant une version plus recente ensuite.
4. Confirmez.

*Résultat* : le backend execute `git checkout <rev>` puis `dvc checkout`, donc les pointeurs suivis et leur contenu reel sur disque correspondent a ce commit. Les listes de datasets et de commits se rafraichissent automatiquement.

## Configurer un remote et synchroniser une version

Ce workflow rend une version commitee localement recuperable depuis une autre machine, comme une VM GPU distante ou le poste d'un collegue.

*Prerequis* : au moins un commit existe ; vous connaissez la destination du remote (un chemin de dossier local/reseau, ou une URL comme `s3://...`, `ssh://...`).

1. Ouvrez **Sync**. Si l'avertissement ambre "Aucun remote DVC configuré" s'affiche, tapez un **Nom** et une **Destination**, puis cliquez **Ajouter le remote** ; une destination de dossier est creee automatiquement si elle n'existe pas encore.
2. Une fois un remote liste, cliquez **Push** sur la carte DVC Push. Observez le journal en direct ; une coche verte et "Push terminé" confirment le succes, une croix rouge et une ligne d'erreur signifient un echec en cours de route.
3. Sur l'autre machine, une fois que DVC App pointe vers le meme repository (clone via Git, avec le meme remote configure), cliquez **Pull** pour recuperer le contenu suivi correspondant au commit checkout.
4. Optionnellement, cliquez **Calculer l'usage disque** pour confirmer que le cache est en mode liens plutot qu'en simple mode copie, ce qui evite une deuxieme copie physique des gros fichiers sur disque.

*Résultat* : le contenu derriere les pointeurs `.dvc` du commit pousse est maintenant disponible depuis le remote, donc toute machine qui y a acces et dont l'historique Git correspond peut reproduire exactement le meme dataset et la meme version de modele.
