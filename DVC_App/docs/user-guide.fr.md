---
app: dvc
doc_type: user-guide
audience: user
lang: fr
title: Guide utilisateur
order: 10
tags: [lineage, datasets, historique, diff, sync, page doc, statut repo]
sources: [DVC_App/frontend/src/App.tsx, DVC_App/frontend/src/pages/LineagePage.tsx, DVC_App/frontend/src/pages/DatasetsPage.tsx, DVC_App/frontend/src/pages/HistoryPage.tsx, DVC_App/frontend/src/pages/DiffPage.tsx, DVC_App/frontend/src/pages/SyncPage.tsx, DVC_App/frontend/src/pages/DocPage.tsx, DVC_App/frontend/src/components/UserBadge.tsx]
---

# Guide utilisateur

## Barre laterale et navigation de DVC App

La barre laterale a gauche de DVC App est toujours visible. Sous le titre de l'app, un bloc de statut du repository montre si le repository existe (coche verte ou croix rouge) et la branche Git courante ; cliquer la ligne de statut deplie un petit panneau avec le chemin exact du repository, et, une fois qu'il existe, si Git et DVC sont initialises et quels remotes sont configures. Quatre entrees suivent : **Lineage** (la page d'accueil), **Diff**, **Sync** et **Doc**. Deux pages supplementaires existent sans entree dans la barre laterale : **Datasets** (`/datasets`) et **Historique** (`/history`, accessible depuis le panneau Lineage d'un run) ; atteignez l'une ou l'autre en tapant son URL directement.

Le badge utilisateur en bas montre le nom d'utilisateur donne par le lanceur et quatre commandes : **Ouvrir workspace** ouvre le dossier du workspace dans l'explorateur de fichiers de la machine qui fait tourner le backend, **Historique des workspaces** liste les workspaces recents de cette app, **Utilisateurs connectes** liste les autres utilisateurs qui font tourner DVC App sur la meme machine, et le bouton de langue bascule entre francais et anglais. Quand l'app est ouverte depuis VisionNexus, VisionNexus impose la langue.

## Page Lineage

La page Lineage est la page d'accueil. Elle construit un graphe depuis l'endpoint de lineage canonique de l'Orchestrator, combine aux commits Git du repository courant, et montre : un dataset source commun, une image par run de pipeline (un fork dessine avec une bordure rose en pointilles, un run parent avec une bordure ciel en pointilles), le subset utilise par chaque run, et, pour chaque run, son noeud de version Git/DVC (le commit qui l'a versionne, ou "non versionne" si aucun n'existe encore) suivi des objets suivis individuels (datasets, modeles, artefacts) que les fichiers `.dvc` de ce commit pointent.

Commandes de la barre d'outils : le champ de recherche filtre par nom, id de run ou dataset ; **Compact/Décompact** replie ou deplie les objets produits de tous les runs a la fois, et un chevron sur une seule image de run fait de meme pour ce run seul ; le bascule liste/graphe passe a une vue en cartes plates des memes donnees ; **Comparer les runs** ouvre la propre page de lineage de l'Orchestrator. Cliquez l'en-tete d'une image de run pour ouvrir son Insight (icone graphique) ou Sandgraph (icone reseau) dans l'Orchestrator App. Cliquez n'importe quel noeud pour ouvrir son panneau de detail a droite, qui montre l'id de run MLOps et des boutons vers la vue de lineage de MLflow, l'Insight et le Sandgraph de l'Orchestrator, et, pour un noeud de version, des liens directs vers **Historique** (filtre sur ce run) et **Diff** (pre-rempli avec ce commit contre son parent).

## Page Datasets

La page Datasets (`/datasets`, sans lien dans la barre laterale) liste chaque fichier ou dossier actuellement suivi par DVC dans le repository : son type (icone dossier ou fichier), son chemin, le fichier pointeur `.dvc` qui le suit, sa taille, son hash (`md5`, 8 premiers caracteres) et un badge de statut (`unchanged`, `modified`, `missing`, `new`). Une banniere au-dessus de la table resume l'etat du repository : une banniere rouge si le statut n'a pas pu etre lu, une banniere ambre avec des compteurs si des fichiers sont modifies ou manquants, ou une banniere verte "tout synchronise" sinon.

## Page Historique

La page Historique montre une timeline verticale des commits Git qui ont touche au moins un fichier `.dvc`, du plus recent au plus ancien, chacun avec son hash court, son auteur, un temps relatif ("il y a 2h"), et ses puces de lineage quand le commit les porte : **Dataset** (vert), **Run** (ambre, l'id de run Orchestrator), **mAP50** (bleu), et un compte de runs MLflow. Cliquez un commit pour deplier la liste des fichiers `.dvc` qu'il a changes. Chaque ligne de commit a aussi un bouton **Diff** (ouvre la page Diff comparant ce commit a son parent) et un bouton **Restaurer**, qui demande confirmation avant de checkout l'etat exact de ce commit dans le dossier de travail.

## Page Diff

La page Diff compare deux revisions. Tapez ou choisissez, dans les deux listes deroulantes alimentees par l'historique des commits, une **Révision A (base)** et une **Révision B (cible)** (hash, `HEAD`, `HEAD~1`, ou un tag), puis cliquez **Calculer le diff**. Un **Résumé métier** apparait en premier : comptes d'images ajoutees et supprimees, et de fichiers d'annotation modifies, plus, quand la revision B est un commit connu, une ligne **Utilisé par** nommant le run Orchestrator et les runs MLflow qui ont utilise cette version, lus depuis les propres trailers du commit plutot que devines. En dessous, la table complete fichier par fichier liste chaque chemin ajoute, supprime, modifie et renomme avec son hash.

## Page Sync

La page Sync execute `dvc push` et `dvc pull`. Un bloc d'explication en haut indique ce que fait chacun et montre le nom et la destination du remote configure ; si aucun n'est configure, un petit formulaire (**Nom**, **Destination**) permet d'en ajouter un directement, un chemin de dossier local ou une URL comme `s3://...`, sans aucune ligne de commande. Deux cartes cote a cote, **DVC Push** et **DVC Pull**, ont chacune leur propre bouton **Push**/**Pull**, un journal defilant en direct de la sortie de la commande sous-jacente, et un bouton **Annuler** qui apparait pendant que la commande tourne. Un panneau **Stockage (dé-duplication)** en bas, calcule a la demande (**Calculer l'usage disque**), montre la taille du cache par rapport a celle du dossier de travail et si le cache est en mode copie ou en mode liens, avec un bouton **Re-lier au cache** pour convertir retroactivement les fichiers existants en liens.

## Page Doc

La page Doc est une courte explication propre a la suite de la facon dont DVC est reellement utilise ici, distincte du guide MLOps general de l'Orchestrator (Git vs DVC vs MLflow). Elle couvre ce que montre reellement chacune des quatre pages, quand pousser plutot que tirer, et un exemple concret qui retrace un commit depuis son hash jusqu'a la version exacte de dataset et de modele qu'il represente, en passant par ses trailers de lineage. Lisez-la une fois en rejoignant un projet qui utilise deja l'Orchestrator de la suite, puisque les noms de trailers qu'elle introduit sont utilises partout dans Lineage, Historique et Diff sans y etre re-expliques.
