---
app: docs
doc_type: workflows
audience: user
lang: fr
title: Procédures
order: 20
tags: [allumer, vm, poser une question, rafraîchir l'index, reconstruire l'index, langue, éteindre]
sources: [desktop/ui/ask.js, desktop/src/main.ts, Docs_Assistant_App/backend/main.py, Docs_Assistant_App/backend/core/sync.py, Docs_Assistant_App/scripts/download_model.py]
---

# Procédures

## Allumer le Docs Assistant en local

Cette procédure démarre la recherche dans la documentation sur votre propre machine.

*Prérequis* : les réglages de VisionNexus sont complets et **VM cible** est sur **(local, pas de VM)**. Facultatif mais recommandé : le modèle d'embeddings est téléchargé, avec `python scripts/download_model.py` depuis `Docs_Assistant_App/` (voir [Configuration](configuration.fr.md#poids-du-modèle-et-script-de-téléchargement)).

1. Dans la section **Ressources de calcul** de l'onglet d'accueil de VisionNexus, cliquez sur l'interrupteur de la carte **Docs Assistant**. Le panneau **Lancements** s'ouvre sur **Docs Assistant**.
2. Suivez le journal : `Lancement de Docs Assistant (local)...`, puis `Port reel : backend=<port> (pas de frontend)`, puis `Pret.`
3. Attendez que la carte affiche **N passages indexes**. Si elle affiche **Indexation n/N**, la recherche fonctionne déjà et devient plus complète à mesure que l'index se remplit.

*Résultat* : le service tourne sur `127.0.0.1:<port>`, son index est stocké dans `<workspace>/docs_<utilisateur>/index.sqlite`, et l'onglet **Demander a la doc** de la fenêtre Documentation est prêt. Le service cherche dans la documentation du dépôt depuis lequel il tourne.

## Allumer le Docs Assistant avec une VM Linux GPU

Cette procédure fait tourner le service sur la VM, où il utilise le GPU pour le modèle d'embeddings, et l'atteint par un tunnel.

*Prérequis* : le lancement d'applications sur la VM fonctionne déjà (voir la procédure VisionNexus pour exécuter la suite sur une VM) ; le dépôt est déployé sur la VM avec sa documentation ; le modèle d'embeddings est présent dans `Docs_Assistant_App/backend/models/` sur la VM.

1. Choisissez la VM dans **VM cible** et vérifiez que **Racine Computer_Vision_App**, **Workspace** et **Chemin conda** sont des chemins Linux de la VM.
2. Cliquez sur l'interrupteur de la carte **Docs Assistant**. Sa pastille affiche maintenant le nom de la VM.
3. Dans le panneau **Lancements**, attendez `Tunnel ouvert (local <port> -> <vm>).`, puis `Pret.` Le premier démarrage peut prendre une minute : le modèle se charge sur le GPU et l'index est créé ou complété.
4. Vérifiez que la carte affiche le nombre de passages indexés.

*Résultat* : la recherche tourne sur la VM et répond par un seul port redirigé. Elle cherche dans les pages déployées sur la VM : une modification de la documentation doit donc y être présente pour être trouvée. Si vous changez **VM cible** ensuite, le service continue de tourner sur la cible où il a démarré ; éteignez-le puis rallumez-le pour le déplacer.

## Poser une question et ouvrir la réponse

Cette procédure trouve une section de la documentation à partir d'une question et la lit.

*Prérequis* : le Docs Assistant est allumé et la carte affiche **Pret** ou un nombre de passages indexés.

1. Cliquez sur **Documentation** dans la barre du haut de VisionNexus, puis sur l'onglet **Demander a la doc**.
2. Saisissez votre question, en français ou en anglais, dans le champ de recherche, par exemple `comment exporter en YOLO ?`.
3. Si vous voulez, restreignez la recherche : sélectionnez une ou plusieurs apps sous **Apps**, choisissez **Utilisateur** ou **Developpeur** sous **Public**, ou changez le filtre **Langue**. Une fois une recherche faite, chaque changement la répète aussitôt.
4. Cliquez sur **Chercher**. Les résultats apparaissent sous forme de cartes, avec le nombre de résultats et le mode de recherche au-dessus. Si un avis indique qu'aucune section ne répond vraiment à la question, reformulez avec des mots de l'interface ou élargissez les filtres.
5. Cliquez sur la carte qui semble la bonne. L'onglet **Docs par app** s'ouvre sur la page, défilée jusqu'à la section.
6. Si vous préférez la lire dans l'autre langue, revenez en arrière et cliquez sur **Meme section en francais** ou **Meme section en anglais** sous la carte.

*Résultat* : vous lisez la section exacte de la documentation qui répond à la question. Pour chercher de nouveau avec d'autres mots, revenez à l'onglet **Demander a la doc** : votre dernière question est conservée.

## Rafraîchir l'index pour que les pages modifiées soient trouvées

Cette procédure fait prendre en compte par la recherche les pages de documentation que vous avez ajoutées ou modifiées.

*Prérequis* : les pages sont enregistrées dans le dépôt depuis lequel le service tourne (sur la VM s'il tourne là-bas). Les deux fichiers de langue d'une page gardent la même suite de titres, vérifiée avec `python tools/docs/lint_docs.py --all`.

1. Éteignez le **Docs Assistant** avec son interrupteur, puis rallumez-le. Chaque démarrage commence par une synchronisation.
2. Surveillez l'état : **Indexation n/N** compte les fichiers modifiés, puis les passages à calculer. Seuls les fichiers dont le contenu a changé sont relus, et seuls leurs passages sont recalculés.
3. Quand la carte affiche de nouveau le nombre de passages, cherchez une phrase que vous avez écrite.

*Résultat* : les sections nouvelles et modifiées sont trouvables, les pages supprimées disparaissent de l'index, et les pages inchangées ne coûtent rien. Sans redémarrage, une synchronisation peut aussi être demandée avec `POST /index/sync` sur le port du service (indiqué dans le journal de lancement par `Port reel`) ; elle rend la main aussitôt et s'exécute en arrière-plan. La fenêtre actuelle n'a pas de bouton pour cela.

## Reconstruire l'index de zéro

Cette procédure force la réindexation complète : elle jette l'index et le reconstruit, par exemple quand les résultats paraissent incohérents après des modifications manuelles du fichier d'index.

*Prérequis* : aucun. Une reconstruction est plus longue qu'un rafraîchissement, puisque chaque passage est recalculé.

1. Le service étant allumé, envoyez `POST /index/rebuild` sur le port du service. Il répond 202 et démarre en arrière-plan ; il répond 409 si une synchronisation est déjà en cours, auquel cas attendez sa fin.
2. Surveillez **Indexation n/N** jusqu'au retour du nombre de passages.

*Résultat* : les passages et leurs embeddings ont été supprimés puis reconstruits à partir de la documentation. Sans service en marche, supprimer `<workspace>/docs_<utilisateur>/index.sqlite` a le même effet : le démarrage suivant installe l'index de départ s'il y en a un, puis synchronise. Changer de modèle d'embeddings reconstruit les vecteurs de lui-même, une seule fois, et une mise à jour du service qui change la structure de l'index fait de même : l'ancien index est supprimé au démarrage puis reconstruit depuis les pages.

## Changer la langue de recherche

Cette procédure change la langue dans laquelle la recherche regarde et celle dans laquelle les résultats sont affichés.

*Prérequis* : l'onglet **Demander a la doc** est ouvert, le service est prêt, et une recherche a été faite.

1. Laissez **Langue** sur **Les deux**, le choix par défaut, pour chercher dans toutes les pages. Les résultats s'affichent dans la langue de votre question, et une section qui existe dans les deux langues n'apparaît qu'une fois, dans cette langue. Quand la question ne tranche pas, par exemple un mot-clé seul comme `SAM2`, la langue de la fenêtre Documentation est utilisée.
2. Pour ne chercher que dans une langue, cliquez sur **FR** ou **EN** sous **Langue**. La recherche en cours est répétée aussitôt, seules les pages de cette langue sont cherchées, et les résultats s'affichent tous dans celle-ci.
3. Cliquez sur **Les deux** pour revenir au choix par défaut. La recherche est de nouveau répétée.
4. Pour changer la langue de toute la fenêtre, utilisez ses boutons **EN** et **FR** en haut à droite : la fenêtre recharge les pages dans cette langue et répète votre dernière recherche. Cela ne change pas le filtre **Langue**, sauf qu'un choix manuel **FR** ou **EN** revient à **Les deux**.

*Résultat* : avec **Les deux**, les résultats suivent la langue dans laquelle vous écrivez ; avec **FR** ou **EN**, ils viennent uniquement des pages de cette langue. Une question dans une langue peut quand même trouver des pages dans l'autre, puisque le modèle comprend les deux, et le lien **Meme section en francais** ou **Meme section en anglais** ouvre la jumelle.

## Éteindre le Docs Assistant

Cette procédure arrête le service et libère son port.

*Prérequis* : le service est allumé.

1. Cliquez sur l'interrupteur de la carte, ou de la barre de l'onglet **Demander a la doc**. **Stop** dans le panneau **Lancements** fait la même chose.
2. Attendez **Eteint**.

*Résultat* : le processus et son tunnel sont arrêtés, l'index reste sur le disque pour le prochain démarrage, et le port est libéré. Fermer VisionNexus arrête aussi le service.
