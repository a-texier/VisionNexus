---
app: dvc
doc_type: troubleshooting
audience: both
lang: fr
title: Depannage
order: 50
tags: [erreurs, repo introuvable, commande dvc, remote, push, pull, lineage]
sources: [DVC_App/backend/core/dvc_runner.py, DVC_App/backend/api/orchestrator.py, DVC_App/backend/api/sync.py, DVC_App/backend/api/datasets.py, DVC_App/frontend/src/pages/LineagePage.tsx]
---

# Depannage

## La barre laterale affiche "Repo introuvable" et les pages retournent 503

**Symptome** : le statut de repository de la barre laterale montre une croix rouge, et Datasets, Historique, Diff ou Sync rapportent une erreur 503.

**Cause** : `DVC_REPO_PATH` ne pointe pas vers un dossier contenant a la fois un sous-dossier `.git` et `.dvc`. C'est attendu et pas une erreur avant le premier commit : le repository est cree automatiquement la premiere fois que `POST /api/orchestrator/commit` s'execute, ou vous pouvez en initialiser un vous-meme hors de l'app.

**Solution** :

1. Ouvrez `http://localhost:<port-backend>/health` ou le panneau de statut deplie de la barre laterale pour voir le `repo_path` exact que DVC App regarde.
2. Si un repository devrait deja exister a cet endroit, confirmez que `DVC_REPO_PATH` (ou le workspace et l'utilisateur utilises pour lancer l'app) correspond a celui reellement peuple.
3. Si aucun n'existe encore, lancez un commit depuis le noeud DVC de l'Orchestrator (voir [Workflows](workflows.fr.md)) ; l'app n'exige jamais de `git init`/`dvc init` manuel.

## "Commande introuvable" ou un push/pull echoue immediatement

**Symptome** : une operation echoue avec "Commande introuvable : dvc" (ou `git`), alors que `dvc` et `git` fonctionnent bien depuis un terminal normal.

**Cause** : le backend est demarre par le lanceur sans le dossier `Scripts/` (Windows) ou `bin/` de l'environnement conda dans son `PATH`, donc l'executable `dvc` nu est introuvable meme si le module Python est installe. `core/dvc_runner.py::_run()` et `api/sync.py::_dvc_args()` contournent tous deux ce probleme en remplacant un argument `dvc` en tete par `sys.executable -m dvc` ; un package genuinement manquant, ou un binaire `git` totalement absent du `PATH` systeme (cette substitution ne s'applique pas a `git`), fait quand meme apparaitre cette erreur.

**Solution** :

1. Confirmez que `dvc` est bien installe dans le meme environnement que le backend : activez-le et executez `python -m dvc --version`.
2. Confirmez que `git` est installe et sur le `PATH` systeme du compte qui fait tourner le backend ; DVC App ne contourne pas un binaire `git` manquant comme il le fait pour `dvc`.
3. Si vous avez modifie `dvc_runner.py` ou `sync.py`, gardez la substitution `sys.executable -m dvc` ; revenir a un appel `dvc` nu reintroduit exactement cette panne.

## Push ou Pull dit qu'aucun remote n'est configure

**Symptome** : cliquer **Push** ou **Pull** sur la page Sync montre immediatement "Aucun remote DVC configuré. Ajoutez-en un..." au lieu de s'executer.

**Cause** : `dvc remote list` n'a rien retourne pour ce repository. Push et pull sont bloques avant meme de tenter la commande sous-jacente, puisque ni l'un ni l'autre n'a d'endroit ou envoyer ou recuperer du contenu sans remote.

**Solution** :

1. Ajoutez un remote directement depuis la page Sync : un simple chemin de dossier devient un remote local (cree automatiquement s'il n'existe pas), ou tapez une URL comme `s3://...`/`ssh://...` pour un remote cloud.
2. Si un remote devrait deja etre configure (par exemple apres avoir clone un repository existant), verifiez `.dvc/config` et `.dvc/config.local` dans le repository pour une section `[remote "..."]` ; un remote ajoute hors de cette app par un mecanisme different de `dvc remote add` peut ne pas etre pris en compte si le fichier de config est malforme.

## Un fichier affiche "missing" sur la page Datasets

**Symptome** : un fichier ou dossier suivi a le badge de statut `missing` alors que vous vous attendez a ce qu'il soit present.

**Cause** : son pointeur `.dvc` existe dans le repository (donc DVC le connait), mais le contenu reel qu'il pointe n'est pas present sur disque a ce chemin. Cela arrive apres un `git clone` frais sans `dvc pull` correspondant, apres que le cache a ete vide, ou si le fichier a ete supprime directement du dossier de travail.

**Solution** :

1. Executez **Pull** sur la page Sync si un remote est configure et que le contenu devrait etre recuperable depuis lui.
2. Si aucun remote n'a encore ce contenu (il n'a jamais ete pousse), le fichier ne peut etre restaure que depuis l'endroit ou il a ete produit a l'origine (re-export depuis Annotation App, re-entrainement dans Training App, etc.).
3. Confirmez d'abord que vous etes sur le bon commit (voir **Historique**) : un fichier peut etre legitimement absent parce qu'une revision differente, plus ancienne ou plus recente, est actuellement checkout.

## Diff ne montre aucune image/annotation changee mais le resume dit que quelque chose a change

**Symptome** : le **Résumé métier** de la page Diff montre 0 pour images ajoutees, images supprimees et annotations changees, alors que la table fichier par fichier en dessous n'est pas vide.

**Cause** : le resume metier ne compte que les extensions de fichiers individuelles qu'il reconnait (images, fichiers d'etiquettes `.txt`) parmi les entrees de diff rapportees par DVC. Quand un dataset est suivi comme un seul dossier plutot que comme de nombreux fichiers suivis individuellement, `dvc diff` peut rapporter le hash de repertoire du dossier comme une seule entree changee sans lister chaque image a l'interieur par chemin, donc les compteurs d'images/annotations ne trouvent rien a compter meme si du contenu reel a change.

**Solution** :

1. Lisez la note affichee sous le resume ("Ce diff ne touche pas d'images/annotations directement...") et verifiez la table fichier par fichier pour le chemin reellement change (typiquement le dossier suivi lui-meme).
2. Pour obtenir un diff par image plutot que par dossier, le dataset devrait etre suivi avec des appels `dvc add` plus granulaires ; c'est une propriete de la facon dont le dataset a ete versionne, pas quelque chose d'ajustable depuis la page Diff elle-meme.

## Un commit n'a pas ses puces de lineage (Dataset, Run, mAP)

**Symptome** : un commit apparait sur **Historique** avec ses fichiers `.dvc` mais sans puces de lineage colorees, et aucun run n'est nomme sur la ligne "Utilisé par" de la page Diff pour lui.

**Cause** : le commit a ete fait sans les trailers Git que l'Orchestrator ecrit normalement (`Run-Id`, `Graph-Id`, `Dataset`, `mAP50`, `MLflow-Run`). C'est attendu pour tout commit fait hors du noeud DVC de l'Orchestrator, par exemple directement avec `git commit` sur la machine backend, ou un commit anterieur a la fonctionnalite de trailers de lineage.

**Solution** :

1. Ce n'est pas un bug a corriger sur un commit existant : les trailers sont ecrits une fois, au moment du commit, et DVC App ne les reconstruit ni ne les devine jamais apres coup.
2. Pour les futurs commits du meme type d'artefact, utilisez le noeud DVC de l'Orchestrator plutot que de commiter manuellement, pour que les trailers soient ecrits automatiquement.
