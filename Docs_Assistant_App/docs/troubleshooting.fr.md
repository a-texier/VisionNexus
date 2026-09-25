---
app: docs
doc_type: troubleshooting
audience: both
lang: fr
title: Dépannage
order: 50
tags: [modèle absent, index vide, mots-clés seuls, injoignable, délai dépassé, première requête lente, erreur de synchronisation]
sources: [Docs_Assistant_App/backend/core/search.py, Docs_Assistant_App/backend/core/rerank.py, Docs_Assistant_App/backend/core/store.py, Docs_Assistant_App/backend/core/embedder.py, Docs_Assistant_App/backend/core/sync.py, Docs_Assistant_App/backend/main.py, desktop/ui/ask.js, desktop/src/services.ts]
---

# Dépannage

Les avis qui viennent du service sont écrits en français ; ils sont cités tels que le service les envoie. Les messages du lanceur affichés dans le panneau d'erreur sont dans la langue de la fenêtre.

## Un avis indique que le modèle d'embeddings est introuvable

**Symptôme** : les résultats sont marqués **mots-cles** et un avis ambre affiche `Modele d'embeddings introuvable dans <dossier> (manque : ...). Lancez python scripts/download_model.py une fois en ligne. Mots-cles seuls.`

**Cause** : le dossier du modèle `Docs_Assistant_App/backend/models/<nom du modèle>/` (ou celui donné par `DOCS_ASSISTANT_MODEL_DIR`) ne contient pas tout ce dont le modèle a besoin. Le message liste ce qui manque parmi `config.json`, `model.safetensors` et `tokenizer.json`. Sur une VM, le modèle doit se trouver sur la VM, pas seulement sur votre machine.

**Solution** : téléchargez le modèle avec `python scripts/download_model.py` depuis `Docs_Assistant_App/` sur une machine avec accès à Internet, et copiez le dossier sur la machine qui exécute le service si c'en est une autre. Éteignez puis rallumez le service. La recherche par mots-clés continue de fonctionner entre-temps.

## Un avis indique que le modèle est en cours de chargement

**Symptôme** : l'avis affiche `Modele d'embeddings en cours de chargement : mots-cles seuls pour le moment.` ou `Aucun vecteur dans l'index pour l'instant (indexation en cours) : mots-cles seuls.`

**Cause** : le service vient de démarrer. Le modèle, environ 470 Mo, est chargé en arrière-plan après la synchronisation, et la première recherche le demande aussi. Avant qu'il soit chargé, ou avant que les premiers vecteurs existent, seuls les mots-clés sont utilisés.

**Solution** : attendez une dizaine de secondes, davantage sur un processeur ou une VM lente. Une recherche faite pendant le chargement du modèle est répétée d'elle-même dès qu'il est prêt, et la ligne d'information revient à **semantique + mots-cles** ; avec l'avis sur les vecteurs manquants, cherchez de nouveau quand **Indexation** est terminée. Si le modèle ne devient jamais prêt, voir la section sur un modèle qui ne se charge pas.

## Le modèle ne se charge pas

**Symptôme** : la recherche reste en mode mots-clés, et l'état de l'index affiche un message `Chargement du modele en echec : <erreur>`, ou un avis `Recherche vectorielle indisponible (<type d'erreur> : <détail>). Mots-cles seuls.`

**Cause** : les fichiers sont présents mais inutilisables : poids abîmés ou partiels, aucun périphérique CUDA alors qu'il a été demandé avec `DOCS_ASSISTANT_DEVICE`, ou mémoire GPU insuffisante parce que d'autres tâches l'utilisent.

**Solution** : lisez l'erreur dans le message. Téléchargez de nouveau le modèle si un fichier est corrompu. Définissez `DOCS_ASSISTANT_DEVICE=cpu` pour tourner sur le processeur, ou libérez de la mémoire GPU, puis éteignez et rallumez le service.

## L'index est vide ou la carte n'affiche aucun passage

**Symptôme** : les recherches ne renvoient rien quelle que soit la question, les boutons de filtre n'affichent aucune app, ou la carte reste sur **Pret** sans nombre de passages.

**Cause** : aucune documentation n'a été indexée. Raisons typiques : `DOCS_ASSISTANT_DOCS_ROOT` pointe vers un dossier sans `docs/docs_manifest.json`, le dépôt sur la VM n'a pas les dossiers de documentation, ou la synchronisation a échoué avec une erreur du type `Sources de doc illisibles (<racine>) : ...`, qui apparaît comme dernière erreur de l'état de l'index.

**Solution** : vérifiez que le dépôt depuis lequel le service tourne contient `docs/docs_manifest.json` et les dossiers de documentation des apps. Corrigez le chemin ou copiez les dossiers manquants, puis éteignez et rallumez le service. Si un fichier d'index a été abîmé, supprimez `<workspace>/docs_<utilisateur>/index.sqlite` pendant que le service est éteint.

## Des pages nouvelles ou modifiées ne sont pas trouvées

**Symptôme** : une page que vous venez d'écrire n'apparaît pas dans les résultats, ou une ancienne formulation apparaît encore.

**Cause** : l'index n'est rafraîchi qu'au démarrage du service, ou sur une demande de synchronisation. Autres raisons : le service tourne sur une VM dont la copie du dépôt n'a pas encore votre modification, la page n'est pas dans le dossier de documentation d'une source listée avec `indexed` dans le manifest, ou le fichier n'est pas de l'UTF-8 valide et a été ignoré avec un avertissement.

**Solution** : éteignez et rallumez le service et surveillez **Indexation n/N** jusqu'au retour du nombre de passages ; faites-le sur la machine qui exécute le service. Vérifiez l'emplacement du fichier, son encodage et le manifest. Voir les [procédures](workflows.fr.md#rafraîchir-lindex-pour-que-les-pages-modifiées-soient-trouvées).

## Les résultats viennent de la mauvaise langue

**Symptôme** : une question française renvoie des sections anglaises, ou l'inverse, ou moins de résultats que prévu, ou une page dont vous savez qu'elle existe dans une langue n'est pas trouvée.

**Cause** : le filtre **Langue** vaut **Les deux** par défaut : toutes les pages sont cherchées et chaque section est montrée une fois, dans la langue de la question. Le service reconnaît cette langue d'après les mots courants et les accents de la question ; un mot-clé seul comme `SAM2`, ou une question très courte ou mélangée, ne tranche pas, et la langue de la fenêtre Documentation est alors utilisée. Si vous avez choisi **FR** ou **EN** sous **Langue**, seule cette langue est cherchée et affichée : un mot anglais ne correspond pas à une page française par mots-clés, et une section qui n'existe que dans l'autre langue n'est pas trouvée. Changer la langue de la fenêtre avec ses propres boutons **EN** et **FR** ramène un choix manuel **FR** ou **EN** à **Les deux**.

**Solution** : choisissez **Les deux** sous **Langue**, et écrivez la question avec quelques mots entiers pour que sa langue soit reconnue. Pour lire une section dans l'autre langue, utilisez les liens **Meme section en francais** et **Meme section en anglais** de la carte. Gardez les deux fichiers de langue d'une page sur la même suite de titres, sinon les liens entre jumeaux pointent vers la mauvaise section.

## Les résultats n'ont aucun rapport avec ma question

**Symptôme** : un avis ambre au-dessus des résultats affiche **Aucune section ne repond vraiment a cette question. Voici les plus proches : reformule avec les mots de l'interface (nom d'un bouton, d'une option) ou elargis les filtres.**, ou les barres de pertinence des cartes sont courtes et les cartes ne répondent pas à la question.

**Cause** : aucun passage n'est assez proche de la question. Soit la documentation ne la couvre pas, soit la question emploie des mots que la documentation n'emploie pas, soit les filtres écartent l'app ou le public qui a la réponse. Les sections les plus proches sont listées malgré tout, la liste n'est donc jamais vide ; l'avis prévient seulement que ce n'est probablement pas la réponse. L'avis ne s'affiche pas en mode mots-clés seuls, où la proximité ne peut pas être mesurée.

**Solution** : reformulez avec les mots que l'interface emploie, comme le nom exact d'un bouton, d'un onglet ou d'une option, et nommez l'app dans la question (`Dataset Explorer`, `Training`). Élargissez les filtres : **Toutes** sous **Apps**, **Tous** sous **Public**, **Les deux** sous **Langue**. Vérifiez que l'app attendue figure parmi les boutons **Apps** ; une source qui n'est pas indexée n'y figure pas. Si la réponse manque vraiment dans la documentation, rien de tout cela n'aide et la page doit être écrite.

## La recherche indique que le service est injoignable ou dépasse le délai

**Symptôme** : un message rouge affiche **Service injoignable : il s'est peut-etre arrete, ou le tunnel est coupe.** ou **Le service ne repond pas (delai depasse).**

**Cause** : le processus du service s'est terminé (la machine s'est mise en veille, la VM a redémarré, un plantage), le tunnel SSH est tombé, ou le service est occupé : une recherche qui dure plus de 10 secondes est abandonnée. La barre d'état est rafraîchie après l'échec et affiche en général **Eteint** ou **Erreur**.

**Solution** : rallumez le service depuis la carte ou l'onglet **Demander a la doc**, puis cherchez de nouveau. Si cela se répète sur une VM, vérifiez le réseau et les messages de tunnel du panneau **Lancements**. Les problèmes de démarrage comme un port occupé ou un tunnel en échec sont traités dans le [dépannage](../../docs/troubleshooting.fr.md#le-docs-assistant-ne-sallume-pas) de VisionNexus.

## La première recherche est lente ou n'est pas sémantique

**Symptôme** : la première question après un démarrage prend du temps ou répond en mode **mots-cles**, et les suivantes sont rapides.

**Cause** : le modèle se charge une fois par démarrage, après la synchronisation ; un démarrage sans index de départ doit aussi calculer d'abord chaque passage. Il en va de même après une mise à jour qui change la structure de l'index : le service supprime l'ancien index et le reconstruit depuis les pages au démarrage, en quelques secondes sur un GPU. Voir [Concepts](concepts.fr.md#pourquoi-le-premier-démarrage-peut-être-plus-long).

**Solution** : attendez que la carte affiche le nombre de passages ; une recherche par mots-clés seuls est répétée d'elle-même quand le modèle est prêt. Pour raccourcir le premier démarrage sur une machine neuve, fournissez un index de départ construit avec le même modèle (voir [Configuration](configuration.fr.md#construire-lindex-de-départ)).

## L'état de l'index affiche une erreur de synchronisation

**Symptôme** : l'état de l'index affiche une dernière erreur du type `Embeddings interrompus : <type> : <détail>` ou un nom d'exception et son message, alors que la recherche fonctionne encore.

**Cause** : la synchronisation s'est arrêtée en cours de route. Quand les embeddings sont interrompus, par exemple par une erreur de mémoire, les passages sont stockés et trouvables par mots-clés, mais certains n'ont pas encore de vecteur. D'autres erreurs viennent des sources de documentation ou du disque.

**Solution** : corrigez la cause nommée dans le message et éteignez puis rallumez le service : la synchronisation suivante ne calcule que ce qui manque. L'avis d'**indexation** reste jusqu'à sa fin.

## Une demande de reconstruction est refusée

**Symptôme** : `POST /index/rebuild` répond HTTP 409 `Une synchronisation est deja en cours.`

**Cause** : une synchronisation ou une reconstruction (une réindexation forcée) est déjà en cours, et une seule s'exécute à la fois.

**Solution** : attendez la fin de **Indexation n/N**, puis renvoyez la demande.
