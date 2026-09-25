---
app: dvc
doc_type: concepts
audience: user
lang: fr
title: Concepts
order: 30
tags: [donnees suivies, pointeur dvc, commit, remote, cache, lineage, trailers]
sources: [DVC_App/backend/core/dvc_runner.py, DVC_App/backend/api/orchestrator.py, DVC_App/backend/api/commits.py, Orchestrator_App/backend/api/graphs.py]
---

# Concepts

## Ce que DVC repond dans cette suite

DVC (Data Version Control) repond a une seule question : quelle version exacte des donnees ou des poids lourds de modele a ete utilisee ? Git seul repond a la question equivalente pour le code et la configuration, mais convient mal aux gros fichiers binaires : committer directement un dataset de plusieurs gigaoctets dans Git gonflerait le repository et ralentirait chaque clone. DVC resout cela en gardant le contenu reel hors de Git et en le suivant plutot via de petits fichiers pointeurs.

Le cadre conceptuel Git versus DVC versus MLflow, et pourquoi la suite utilise les trois ensemble, est explique dans le propre guide MLOps de l'Orchestrator ; cette page couvre seulement le fonctionnement de DVC lui-meme et la facon dont cette app l'utilise.

## Donnees suivies et fichiers pointeurs `.dvc`

Un fichier ou dossier suivi est tout chemin que DVC connait via `dvc add`. L'executer ne commit pas le fichier directement dans Git ; a la place, il calcule un hash du contenu, stocke ce contenu dans le propre cache de DVC, et ecrit un petit fichier pointeur `.dvc` (texte brut, lisible, contenant le hash et le chemin suivi) a cote. C'est ce fichier pointeur, pas les donnees elles-memes, qui est commite dans Git.

C'est pourquoi la page Datasets montre a la fois un chemin et une colonne separee "Fichier DVC" : le chemin est le vrai dossier de dataset ou de modele sur disque, le fichier `.dvc` est le petit pointeur que Git versionne reellement. Le statut d'un fichier (`unchanged`, `modified`, `missing`, `new`) compare le contenu sur disque maintenant a ce que le pointeur courant attend.

## Commits et trailers de lineage

Un commit dans DVC App est un commit Git ordinaire, filtre pour ne garder que ceux qui ont touche au moins un fichier `.dvc`. Chaque commit est une version : quels que soient les fichiers `.dvc` qu'il a ajoutes ou changes, autant de datasets ou de modeles ont recu une nouvelle version a ce point de l'historique. Le hash du commit identifie l'etat exact du code et de la configuration ; le fichier `.dvc` a l'interieur identifie l'etat exact des donnees ou du modele.

Quand un commit est cree depuis le noeud DVC de l'Orchestrator, il porte des trailers Git supplementaires dans son message : `Run-Id`, `Graph-Id`, `Graph-Name`, `Dataset`, `mAP50`, et une ligne `MLflow-Run` par run MLflow correspondant, plus `Parent-Run` quand le pipeline a ete forke. DVC App analyse ces trailers en sens inverse pour montrer les puces colorees sur les pages Historique et Lineage, et la ligne "Utilisé par" sur la page Diff. Un commit fait hors de la suite (ou avec `git commit` directement) n'a simplement aucun trailer ni puce ; rien n'est invente a leur place.

## Remotes, push et pull

Un remote est une destination vers laquelle DVC sait copier du contenu suivi, et depuis laquelle il sait le recuperer : un dossier local ou reseau, ou une URL cloud/SSH. Les commits Git (les fichiers pointeurs) peuvent etre partages via n'importe quel remote ou copie Git normal ; les donnees reelles derriere ces pointeurs sont partagees separement, via un remote DVC, avec `dvc push` et `dvc pull`.

Sans remote configure, push et pull n'ont nulle part ou aller et DVC App bloque l'action avec un message clair plutot que de laisser la commande sous-jacente echouer de facon obscure. Un remote peut etre ajoute directement depuis la page Sync, sans ligne de commande : un simple chemin de dossier devient un remote local (le dossier est cree automatiquement au besoin), tandis qu'une URL comme `s3://...` ou `ssh://...` est transmise telle quelle.

## Cache et usage disque

Le cache de DVC stocke chaque contenu unique une seule fois, adresse par son hash : deux versions qui partagent les memes images ne stockent pas ces images deux fois. Que le dossier de travail (le vrai dossier de dataset que vous voyez et qu'un entrainement lit) soit une deuxieme copie physique de ce cache, ou juste un ensemble de liens qui pointent dessus, depend du mode de liaison du cache :

- **copy** (le defaut historique) : le dossier de travail conserve sa propre copie complete de chaque fichier, doublant l'usage disque par rapport au cache.
- **liens** (hardlink ou reflink, le mode que cette app configure automatiquement pour les repositories de la suite) : les fichiers du dossier de travail pointent vers les memes blocs disque que le cache, donc il n'y a qu'une seule copie physique meme si le fichier apparait aux deux endroits.

Le panneau **Stockage** de la page Sync montre quel mode est actif et permet de convertir retroactivement des fichiers existants, deja copies, vers le mode liens (**Re-lier au cache**) sans rien re-telecharger, puisque le contenu est deja present localement aux deux endroits.

## Lineage avec Git et MLflow

Une seule version suivie se situe a l'intersection de trois systemes, chacun repondant a une question differente : Git repond a quel code et quelle configuration, DVC repond a quelles donnees et poids de modele exacts, et MLflow repond a quelle experience (parametres, metriques, artefacts) ces donnees et ce code ont produite. La suite relie les trois par un identifiant unique partage, l'id de run de l'Orchestrator, porte comme trailer `Run-Id` sur le commit DVC et comme tag `orch_run_id` sur le run MLflow correspondant.

C'est pourquoi un resultat de la page Diff nomme le run qui a "utilise" une revision donnee : il lit le trailer `Run-Id` du commit cible, sans rien deduire du contenu des fichiers lui-meme. Une version sans run enregistre contre elle dans les trailers est montree exactement comme cela, une version non attribuee, plutot que devinee.
