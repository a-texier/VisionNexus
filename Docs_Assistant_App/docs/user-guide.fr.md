---
app: docs
doc_type: user-guide
audience: user
lang: fr
title: Guide utilisateur
order: 10
tags: [carte du catalogue, demander à la doc, filtres, résultats, langue jumelle, mode mots-clés, indexation]
sources: [desktop/ui/ask.js, desktop/ui/ask-render.js, desktop/ui/docs.html, desktop/ui/catalog.html, desktop/ui/i18n.js, desktop/src/services.ts]
---

# Guide utilisateur

## La carte Docs Assistant dans le catalogue

La carte **Docs Assistant** se trouve dans la section **Ressources de calcul** de l'onglet d'accueil de VisionNexus. De gauche à droite, elle affiche l'icône du service, son nom, une pastille avec la cible sur laquelle il tourne (**Local** ou le nom de la VM sélectionnée), une description d'une ligne, son état, et un interrupteur à droite.

L'interrupteur allume et éteint le service. Il est désactivé tant que les réglages de VisionNexus sont incomplets (son info-bulle indique alors **Renseigne les Parametres avant d'allumer une ressource.**) et pendant l'arrêt du service. La ligne d'état, avec un point coloré, affiche :

- **Eteint** : le service ne tourne pas.
- **Demarrage...** : le lanceur le démarre. Le premier démarrage sur une VM peut prendre une minute.
- **Pret** : le service répond et l'index n'est pas encore connu.
- **Indexation n/N** : il lit la documentation. `n` compte des fichiers de documentation pendant la lecture des pages et des passages pendant leur calcul d'embeddings. La recherche reste disponible pendant ce temps.
- **N passages indexes** : l'état de fonctionnement normal, avec la taille de l'index.
- **Arret...** et **Erreur** : arrêt en cours, ou échec. En cas d'erreur, un message rouge sous l'état donne la cause, dans la langue de la fenêtre, et le survoler affiche en infobulle les dernières lignes de la sortie du lanceur quand il y en a. Un nouveau clic sur l'interrupteur relance.

Tant que le service démarre ou est prêt, le bouton **Documentation** de la barre du haut devient orange et un bouton orange **Ouvrir la documentation** apparaît sur la carte, à gauche de l'interrupteur : il ouvre la fenêtre Documentation directement sur l'onglet **Demander a la doc**. Les deux disparaissent quand le service est éteint.

Si vous changez la **VM cible** pendant que le service tourne, un avis sous l'état indique qu'il tourne encore sur la cible précédente et qu'il faut l'éteindre puis le rallumer pour le déplacer. Les lignes de démarrage apparaissent dans le panneau **Lancements** sous **Docs Assistant**, où **Stop** éteint aussi le service.

## L'onglet Demander a la doc

Ouvrez la fenêtre **Documentation** avec le bouton **Documentation**, puis cliquez sur l'onglet **Demander a la doc**. Une barre en haut reprend le service : icône, nom, pastille de cible, état et le même interrupteur. Ce qui apparaît sous la barre dépend de l'état du service.

- **Éteint** : un panneau intitulé **Docs Assistant est eteint** explique que la recherche dans la doc est un service qui tourne sur la cible de calcul choisie et affiche **Cible :** avec son nom. Cliquez sur **Allumer** pour le démarrer.
- **Démarrage** : un indicateur d'attente et **Demarrage du service...**, avec l'indication que sur une VM le premier démarrage peut prendre une minute.
- **Arrêt** : **Arret du service...**.
- **Erreur** : **Le service a rencontre un probleme**, le message dans la langue de la fenêtre, et un bouton **Reessayer**. Quand le lanceur n'a jamais annoncé son port ou que le service s'est arrêté de lui-même, un bloc repliable **Derniere sortie du lanceur** sous le message affiche les dernières lignes écrites par le lanceur, telles quelles (elles ne sont pas traduites) ; ouvrez-le pour voir la cause technique.
- **Prêt** : le formulaire de recherche, les filtres et les résultats apparaissent.

La fenêtre garde le même état que la carte du catalogue : allumer le service depuis l'un ou l'autre met les deux à jour en même temps.

## Poser une question

Quand le service est prêt, saisissez votre question dans le champ sous l'onglet et cliquez sur **Chercher**, ou appuyez sur Entrée. Écrivez-la comme vous la poseriez à un collègue, par exemple `comment exporter en YOLO ?`, ou saisissez quelques mots exacts comme le nom d'un bouton. La question peut être en français ou en anglais, quelle que soit la langue des pages. Elle est limitée à 500 caractères et demande au moins deux caractères : en dessous, la fenêtre affiche **Ecris au moins 2 caracteres.** et ne lance pas de recherche.

Pendant la recherche, la ligne d'information affiche **Recherche...**. À la fin, la ligne indique le nombre de résultats, la durée en millisecondes et le mode : **semantique + mots-cles** dans le cas normal, **mots-cles** quand le modèle d'embeddings n'est pas encore disponible. Au plus huit résultats sont renvoyés, et au plus deux par page de documentation, pour qu'une longue page ne remplisse pas toute la liste. Si vous lancez une seconde recherche avant la réponse de la première, seule la réponse la plus récente est affichée.

## Filtrer par app, public et langue

Trois filtres se trouvent sous le champ de recherche. Modifier l'un d'eux répète aussitôt la recherche en cours avec les nouveaux filtres, dès qu'une recherche a été faite ; il n'est pas nécessaire de cliquer de nouveau sur **Chercher**.

- **Apps** : un bouton par source qui a du contenu indexé (VisionNexus, chaque app, Docs Assistant), plus **Toutes**. Sélectionnez-en une ou plusieurs pour y restreindre la recherche ; **Toutes** efface la sélection. Une source dont les pages ne sont pas indexées n'apparaît pas.
- **Public** : **Tous**, **Utilisateur** ou **Developpeur**. Les pages écrites pour les deux publics correspondent à **Utilisateur** et à **Developpeur**. Les pages développeur sont l'architecture, la référence API et la carte du code ; les pages utilisateur sont le guide utilisateur, les procédures et les concepts ; le README, la configuration et le dépannage s'adressent aux deux.
- **Langue** : **FR**, **EN** ou **Les deux**. **Les deux** est le choix par défaut : toutes les pages sont cherchées, quelle que soit la langue de la question ou de la fenêtre. Les résultats s'affichent dans la langue de votre question : le service reconnaît le français ou l'anglais d'après les mots et les accents de la question, et quand une section existe dans les deux langues il renvoie la version dans cette langue, une seule fois. Quand la question ne tranche pas, par exemple un mot-clé seul comme `SAM2`, c'est la langue de la fenêtre Documentation qui décide. Choisissez **FR** ou **EN** pour ne chercher que dans les pages de cette langue ; les résultats s'affichent alors tous dans celle-ci. Choisissez **Les deux** pour revenir au choix par défaut.

Changer la langue de la fenêtre avec ses propres boutons **EN** et **FR** ne transforme pas **Les deux** en un autre choix, mais répète votre dernière recherche, car la langue de la fenêtre sert de repli aux questions qui ne tranchent pas. Un choix manuel **FR** ou **EN** revient alors à **Les deux**.

## Lire les cartes de résultat

Chaque résultat est une carte qui affiche, de haut en bas :

- l'icône et le nom de la source (par exemple **Annotation**), un badge **FR** ou **EN** pour la langue de la section, et une petite barre de pertinence : elle indique à quel point la section est proche de votre question, de 0 à 100 %, mesuré par le modèle sémantique, et la survoler affiche le pourcentage (**Pertinence** suivi de la valeur). La barre ne dépend pas des autres résultats : une meilleure réponse faible donne une barre courte. Quand la pertinence ne peut pas être mesurée, par exemple pour un résultat trouvé uniquement par mots-clés, la barre est à moitié pleine et l'infobulle indique **Classement (pertinence non mesuree)** ;
- le titre de la page de documentation, et dessous le chemin de titres qui mène à la section, par exemple le nom de la page puis le nom de la section ;
- un extrait de la section, la phrase qui correspond le mieux à vos mots, avec les mots correspondants surlignés quels que soient leurs accents ou leurs majuscules.

Cliquez n'importe où sur la carte pour ouvrir la section. La fenêtre bascule sur l'onglet **Docs par app**, sélectionne la source et la page, défile jusqu'à la section exacte et la met en évidence un instant. Si la section est dans une autre langue que la fenêtre, la langue de la fenêtre change avec elle.

## Ouvrir la même section dans l'autre langue

Sous une carte, un lien **Meme section en francais** ou **Meme section en anglais** apparaît quand la section existe aussi dans l'autre langue, ce qui est le cas de chaque page des jeux de documentation. Cliquez dessus pour ouvrir la section jumelle : la fenêtre change de langue et défile jusqu'au titre correspondant. Ce lien vous permet de lire une réponse française à une question anglaise, ou l'inverse, sans répéter la recherche.

Les sections jumelles sont appariées par leur position dans la page : une section française et sa jumelle anglaise portent donc toujours le même numéro de titre. C'est pourquoi les deux langues d'une page doivent garder la même suite de titres.

## Avis au-dessus des résultats : mots-clés seuls, faible confiance et indexation

Trois avis peuvent apparaître au-dessus des résultats. Tous sont ambre et aucun ne bloque la recherche.

L'avis **mots-clés seuls** apparaît quand le modèle d'embeddings est absent ou en cours de chargement. Le service classe alors uniquement par mots exacts, et la ligne d'information indique **mots-cles**. Le message vient du service et en explique la raison : fichiers du modèle introuvables (avec la commande qui les télécharge), modèle en cours de chargement en arrière-plan, ou aucun vecteur dans l'index pour l'instant. Si le service n'en donne pas, la fenêtre affiche **Recherche par mots-cles seulement pour le moment (le modele semantique se charge).** Le modèle met une dizaine de secondes à se charger après l'allumage du service. Une recherche faite pendant ce laps de temps tombe dans ce mode, et la fenêtre la répète d'elle-même dès que le modèle est prêt : les résultats passent à **semantique + mots-cles** sans que vous ayez à chercher de nouveau.

L'avis de **faible confiance** affiche **Aucune section ne repond vraiment a cette question. Voici les plus proches : reformule avec les mots de l'interface (nom d'un bouton, d'une option) ou elargis les filtres.** Il apparaît quand aucun passage n'est assez proche de votre question, ce qui est typique d'une question que la documentation ne couvre pas. Les sections les plus proches sont tout de même listées, mais ce n'est probablement pas ce qu'il vous faut. Reformulez avec les mots que l'interface emploie, comme le nom d'un bouton ou d'une option, ou élargissez les filtres. Une requête d'un ou deux mots exacts que contiennent les pages ne le déclenche pas. L'avis ne s'affiche pas en mode mots-clés seuls, où la confiance ne peut pas être mesurée.

L'avis d'**indexation** affiche **Indexation en cours (n/N) : la recherche reste disponible, les resultats peuvent etre incomplets.** Il apparaît pendant que le service lit la documentation, par exemple juste après un démarrage. Les pages pas encore traitées manquent dans les résultats jusqu'à sa fin.

## Résultats vides et messages d'erreur

Quand rien ne correspond, la fenêtre affiche **Aucun resultat pour "votre question".** avec un conseil : essayez moins de mots ou un mot exact de l'interface (nom d'un bouton ou d'une option), puis élargissez les filtres à toutes les apps, tous les publics et les deux langues. Une question de moins de deux caractères n'est pas envoyée : la fenêtre demande au moins deux caractères.

Quand la requête échoue, un message rouge remplace les résultats :

- **Service injoignable : il s'est peut-etre arrete, ou le tunnel est coupe.** : le service ou le tunnel SSH a disparu. La barre d'état est rafraîchie et affiche en général **Eteint** ou **Erreur**.
- **Le service ne repond pas (delai depasse).** : aucune réponse après 10 secondes.
- **Requete refusee : ...** : la question ou un filtre a été refusé, par exemple une question de plus de 500 caractères.
- **Erreur du service : ...** : le service a répondu par une erreur HTTP, avec son détail.
- **Erreur inattendue : ...** : tout le reste.

Les causes et les remèdes sont dans le [dépannage](troubleshooting.fr.md).

## Naviguer entre les résultats et les pages

Une barre sous le titre de la fenêtre Documentation garde la trace de ce que vous avez consulté, pour aller et venir entre les questions et les pages sans relancer de recherche.

- **Retour** et **Avance** (ou `Alt+Gauche` et `Alt+Droite`, ou les boutons précédent et suivant de la souris) parcourent les vues visitées : chaque recherche avec ses résultats, et chaque page ou section ouverte. Revenir à une recherche restaure ses résultats, sa question et ses filtres sans interroger de nouveau le service.
- Quand une page a été ouverte depuis une carte de résultat, la barre affiche aussi **Retour aux resultats**, la position (**Resultat 2 / 8**), le titre de la section, et **Resultat precedent** et **Resultat suivant** (ou `Alt+Haut` et `Alt+Bas`). Ils ouvrent le résultat voisin de la même recherche, pour lire les meilleures réponses l'une après l'autre. Suivre un lien dans une page, choisir une autre page ou une autre app met fin à ce mode.
- Sous le champ de question, **Questions recentes** liste vos huit dernières questions. Cliquez sur l'une pour la reposer, ou sur **Effacer** pour vider la liste. La liste reste sur cet ordinateur.

Une nouvelle question posée après un retour supprime les vues qui étaient devant, comme dans un navigateur web.
