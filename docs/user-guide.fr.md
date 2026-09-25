---
app: suite
doc_type: user-guide
audience: user
lang: fr
title: Guide utilisateur
order: 10
tags: [catalogue, tuiles, onglets, dispositions, ports, réglages, lancements, fenêtre documentation, tutoriel]
sources: [desktop/ui/catalog.html, desktop/ui/i18n.js, desktop/ui/docs.html, desktop/ui/tour.js, desktop/src/main.ts, desktop/src/catalog.ts, desktop/src/settings.ts]
---

# Guide utilisateur

## La fenêtre VisionNexus en un coup d'œil

La fenêtre VisionNexus se compose d'une barre du haut et d'un corps. De gauche à droite, la barre du haut contient le logo, le titre, le bouton **Tutoriel**, les menus **Fichier** et **Aide**, la barre d'onglets, puis à droite les quatre boutons de disposition des vues suivis de **Ports**, **Bandeau**, **Logs** et **Documentation**. La barre d'onglets commence toujours par l'onglet **VisionNexus**, qui affiche l'accueil du lanceur ; chaque application ouverte ajoute un onglet à sa suite.

L'accueil est divisé en deux. À gauche, de haut en bas : le schéma des applications, la section **Ressources de calcul** et le panneau **Lancements** (qui n'apparaît qu'après le premier lancement). À droite, le panneau **Parametres** est toujours visible. Quand vous cliquez sur l'onglet d'une application, celle-ci occupe tout le corps et le contenu de l'accueil est masqué jusqu'à ce que vous cliquiez de nouveau sur l'onglet **VisionNexus**.

La langue d'interface du lanceur suit **Langue des apps** dans les réglages. Une seule fenêtre VisionNexus peut tourner à la fois : démarrer le programme une seconde fois ramène la fenêtre existante au premier plan au lieu d'en ouvrir une autre.

## Le schéma des applications et ses tuiles



Toutes les tuiles sont grisées et inactives tant que les réglages sont incomplets. Une tuile est aussi désactivée pendant le lancement de sa propre application, afin qu'un double clic ne démarre jamais deux fois la même application. Le **Docs Assistant** n'apparaît pas dans le schéma : c'est une ressource de calcul, avec sa propre section plus bas.

## Lancer une application depuis une tuile

Cliquez sur une tuile pour lancer l'application. Le panneau **Lancements** s'ouvre sous le schéma, sur l'onglet de cette application, et le point de la tuile devient bleu. VisionNexus démarre `launcher.py` sur la cible (votre machine ou la VM sélectionnée), lit les ports que le lanceur annonce, ouvre des tunnels SSH quand une VM est sélectionnée, attend que le frontend puis le backend répondent, et ouvre enfin l'application dans un nouvel onglet.

Le lancement obéit à des délais : le lanceur doit annoncer ses ports en 60 secondes, le frontend doit répondre en 60 secondes et le backend en 120 secondes (le chargement des modèles peut prendre de 10 à 40 secondes). Si un délai est dépassé, ou si le lanceur s'arrête prématurément, la tuile devient rouge et le panneau **Lancements** en donne la raison.

Cliquer sur la tuile d'une application déjà ouverte ne la démarre pas une seconde fois : VisionNexus bascule sur son onglet ou ramène sa fenêtre détachée au premier plan. Cliquer de nouveau sur la tuile après une erreur ou après la fermeture de l'application la relance. Certains noms sont refusés comme identifiant : `unknown`, `user`, `default`, `none`, `null`, `admin` et `test` ouvrent un avertissement intitulé **Identifiant utilisateur non valable**, car l'identifiant détermine le workspace et la réservation des ports (voir [Concepts](concepts.fr.md#workspaces-et-utilisateurs)).

## Onglets d'application, détachement et rattachement

Chaque application ouverte a un onglet dans la barre, avec un point d'état, son icône et son nom. Une application qui peut lire ses images sur un partage affiche aussi une petite étiquette : **SMB** (turquoise) quand le chemin natif est actif, **HTTP** (ambre) quand elle se replie sur HTTP ; survolez l'étiquette pour lire la raison. Cliquez sur un onglet pour afficher l'application ; cliquez sur l'onglet **VisionNexus** pour revenir à l'accueil du lanceur.

- **Fermer** : la croix à droite de l'onglet arrête l'application et son tunnel. Le lanceur écrit une ligne de fermeture dans le journal.
- **Réordonner** : faites glisser un onglet et déposez-le sur un autre onglet.
- **Détacher** : faites glisser un onglet hors de la barre. L'application passe dans sa propre fenêtre, avec sa propre icône dans la barre des tâches et un titre qui se termine par **Natif** ou **HTTP (repli)** pour les applications qui gèrent le chemin natif. La page n'est pas rechargée.
- **Rattacher** : cliquez sur le bouton en forme de flèche affiché sur l'onglet détaché, ou faites glisser la fenêtre détachée au-dessus de la barre d'onglets et marquez une courte pause.
- **Copier l'URL** et **Ouvrir dans le navigateur** : clic droit sur un onglet. Les deux donnent un lien à usage unique vers l'adresse locale (`http://127.0.0.1:<port>`) de l'application. Ce lien fait entrer un autre navigateur de cet ordinateur avec le jeton de session, puis expire après un usage ou 120 secondes ; copiez-le de nouveau pour en obtenir un autre. Voir [Sécurité](security.fr.md#ouvrir-une-application-dans-un-navigateur-externe).

Fermer la fenêtre détachée arrête l'application, comme la croix d'un onglet attaché.

## Dispositions : deux ou quatre vues

Les quatre petits boutons à droite de la barre du haut choisissent combien d'applications sont visibles en même temps : une seule vue, deux vues côte à côte, deux vues empilées ou quatre vues en grille 2x2. Survolez chaque bouton pour lire son nom (**Une seule vue**, **2 vues cote a cote (gauche/droite)**, **2 vues empilees (haut/bas)**, **4 vues (grille 2x2)**).

Choisir une disposition à plusieurs vues ouvre un écran de composition intitulé **Glissez une app dans chaque volet**. Chaque volet apparaît comme un carré numéroté (**Volet 1**, **Volet 2**...). Un plateau en bas liste les applications attachées : faites glisser une vignette sur un carré, ou cliquez sur une vignette puis sur un carré. Un volet affiche **retirer** pour le vider. Cliquez sur **Valider** pour appliquer ou sur **Annuler** pour garder la disposition précédente. Si aucune application n'est ouverte, le plateau indique **Aucune app ouverte a placer**.

Une fois la disposition active, faites glisser la séparation entre les volets pour les redimensionner ; le ratio reste entre 20 % et 80 %. Un volet vide affiche une indication qui invite à utiliser un bouton de disposition. Le bouton « une seule vue » ramène à une seule application. Les fenêtres détachées ne font jamais partie d'une disposition.

## Menus, boutons de la barre du haut et raccourcis

- **Fichier > Quitter** : ferme VisionNexus. Toutes les applications, tous les tunnels et toutes les ressources de calcul qu'il a lancés sont d'abord arrêtés.
- **Aide > Documentation** : ouvre la fenêtre Documentation, comme le bouton **Documentation**.
- **Aide > Dossier des logs** et le bouton **Logs** : ouvrent le dossier qui contient les fichiers de journal des lancements.
- **Aide > Outils de developpement** : bascule les outils de développement de la fenêtre au premier plan.
- **Bandeau** (ou **Ctrl+B**) : masque ou affiche la barre latérale gauche de l'application affichée, pour gagner quelques pixels sur un petit écran. Un court message apparaît dans l'application. Le bouton agit sur l'onglet attaché actif.
- **Échap** : ferme un menu ouvert, le panneau des ports ou un menu contextuel d'onglet.

Le bouton **Tutoriel** démarre la visite guidée du lanceur (voir la dernière section de cette page).

## Le menu des sous-apps de l'Orchestrator

L'**Orchestrator** lance lui-même ses sous-applications (Annotation, Dataset Explorer...). Pour les rendre accessibles, son onglet affiche un petit compteur du type `2/7` avec un chevron : le nombre de sous-applications actives sur celles que l'Orchestrator connaît. Cliquez dessus pour ouvrir un menu natif.

Le menu commence par **Lancer tout** et le même compteur, puis affiche une ligne par sous-application. Une sous-application active propose **Ouvrir (onglet)**, qui l'ouvre comme un onglet VisionNexus, et **Ouvrir (navigateur)**, qui l'ouvre dans votre navigateur par défaut. Une sous-application arrêtée affiche **Lancer** et une sous-application en cours de démarrage est grisée avec `demarrage...`. Les libellés suivent la langue d'interface (**Launch all**, **Open (tab)**, **Open (browser)**, **Launch** et `starting...` en anglais). Les onglets de sous-applications portent `(Orchestrator)` après le nom ; fermer un tel onglet ne fait que le masquer, et l'application continue de tourner sous l'Orchestrator.

Les liens entre apps qui pointent vers une adresse locale d'une application connue s'ouvrent dans l'onglet VisionNexus correspondant plutôt que dans le navigateur du système.

## Le panneau Lancements et le bouton Stop

Le panneau **Lancements** affiche ce que le lanceur imprime pour chaque application et chaque ressource de calcul. Il a un bouton par élément lancé, avec une pastille colorée (bleue pendant le lancement, verte en fonctionnement, rouge en erreur, grise une fois fermé). Sous les boutons, l'élément sélectionné affiche son nom, un bouton **Stop**, une ligne d'état du type `Annotation -- En cours d'execution` et une zone de journal.

Les lignes du journal montrent chaque phase du lancement : la cible de la commande, le chemin du fichier de journal complet, les ports réels (`Ports reels : backend=... frontend=...`), la version du client SSH, le tunnel, les messages d'attente, puis `Pret -- ouverture de l'onglet.` quand l'onglet s'ouvre. Les erreurs sont préfixées par `[erreur]` ou `[timeout]`, les messages de tunnel par `[tunnel]` et ceux de l'onglet d'application par `[renderer ...]`. Le panneau conserve les 800 dernières lignes par élément ; le journal complet reste sur disque (voir [Configuration](configuration.fr.md#fichier-de-réglages-et-dossiers-de-logs)).

**Stop** arrête proprement l'élément sélectionné, quel que soit son état : il ferme un onglet attaché, ferme une fenêtre détachée, interrompt un lancement en cours (l'état devient **Fenetre fermee**, pas **Erreur**) ou éteint une ressource de calcul. Le bouton est désactivé quand l'élément est inactif ou déjà fermé.

## Le panneau Ports

Le bouton **Ports** ouvre un panneau qui liste les ports TCP en écoute, pour repérer un processus laissé par un plantage avant que les ports ne s'accumulent. Il contient un tableau **Local (cette machine)** et, quand une VM est sélectionnée, un tableau **VM (nom)**. Les colonnes sont **Port**, **Process**, **Utilisateur** et **Statut**. Le panneau se rafraîchit toutes les 10 secondes tant qu'il est ouvert ; **Rafraichir** force un scan.

Dans la colonne **Statut**, un port qui appartient à une application pilotée par VisionNexus affiche son nom et son côté, par exemple le frontend ou le backend d'une application. Un port trouvé dans le registre d'instances partagé sans onglet correspondant affiche **app active**. Tout autre port affiche **a verifier** : il est soit sans rapport avec la suite, soit orphelin. Les ports connus sont triés en premier. Les lignes dont le numéro de processus est connu ont un bouton **Tuer**, qui arrête ce processus et tout son groupe de processus, puis vérifie que le port est libre. Sinon, par exemple pour un processus d'un autre compte, la raison s'affiche en haut du panneau.

**Tout arreter** arrête tout ce que VisionNexus a démarré : onglets ouverts, fenêtres détachées, lancements en cours, ressources de calcul et sous-applications de l'Orchestrator, puis il tue les ports connus en local et sur la VM, entrées du registre à votre nom comprises. Une boîte de confirmation nomme d'abord ce qui va être arrêté, et le résultat, avec les ports qui n'ont pas pu être libérés, s'affiche en haut du panneau. **Nettoyer la VM** arrête vos propres serveurs de la suite sur la VM (`vite`, `uvicorn`, `launcher.py`) qui tournent dans la racine du dépôt, sans toucher à un serveur d'IDE ni à vos autres scripts ; [Sécurité](security.fr.md#arrêter-les-processus-et-nettoyer-la-vm) détaille ce qu'il vise. Les scans locaux utilisent les outils Windows `netstat` et `tasklist` ; les scans de la VM exigent une connexion SSH non interactive fonctionnelle (voir [Configuration](configuration.fr.md#prérequis-de-la-vm-linux-gpu)). **Fermer**, **Échap** ou un clic en dehors du panneau le ferme.

## Réglages : utilisateur, workspace, racine du dépôt et chemin conda

Le panneau **Parametres** à droite contient les champs dont chaque lancement a besoin. Quatre sont obligatoires.

- **Langue des apps** : deux boutons, **EN** et **FR**. En choisir un traduit immédiatement le lanceur et fixe la langue de départ des applications que vous lancez ensuite. Chaque application garde son propre bouton de langue et peut la changer localement.
- **Utilisateur** : votre identifiant dans la suite. Il nomme votre workspace et vos réservations de ports, et il est transmis à chaque lancement sous la forme `--user`. Utilisez votre vrai login, pas un nom partagé.
- **Workspace** (le dossier de travail) : le dossier où toutes les applications écrivent leurs données, par exemple `D:\ws` en local ou `/data/ws` sur une VM. Les applications y créent des dossiers `<app>_<utilisateur>`.
- **Racine Computer_Vision_App** : le dossier du dépôt tel que la machine qui exécute les applications le voit. Une aide sous le champ change avec la cible : un chemin Windows du type `C:\...` sans VM sélectionnée, un chemin Linux du type `/home/...` avec une VM sélectionnée.
- **Chemin conda** : l'environnement Python dans lequel les applications s'exécutent. Il accepte le dossier de l'environnement, son script `activate` ou son exécutable Python. Il est obligatoire même si l'intitulé du champ ne le dit pas.

## Réglages : VM cible et VM connues

Deux champs choisissent l'endroit où les applications s'exécutent.

- **VM(s) connue(s)** : la liste des machines que vous pouvez cibler. Saisissez un seul nom, ou plusieurs séparés par des virgules (`vm-gpu-01, vm-gpu-02`). Chaque nom sert de destination SSH : ce peut être un alias d'hôte de votre `~/.ssh/config` ou une adresse `utilisateur@hôte`.
- **VM cible** : une liste déroulante construite à partir de cette liste, avec **(local, pas de VM)** en première entrée. **(local, pas de VM)** exécute tout sur cette machine ; choisir une VM exécute chaque lancement sur cette VM via SSH. Le choix est enregistré dès que vous le changez.

Basculer entre le mode local et le mode VM change le sens de **Workspace**, **Racine Computer_Vision_App** et **Chemin conda**, qui doivent alors être des chemins de la nouvelle cible. Quand vous cliquez sur **Enregistrer**, la sélection est conservée : le mode local reste local, et une VM sélectionnée le reste tant qu'elle figure dans la liste **VM(s) connue(s)** (sinon la première VM de la liste est sélectionnée). Si des applications démarrent sur une VM alors que vous attendiez le mode local, vérifiez que **VM cible** affiche **(local, pas de VM)**.

## Réglages : partage réseau natif

Le champ **Partage reseau natif (optionnel)** contient le nom d'hôte d'un partage réseau déjà monté côté Windows, par exemple `share-host.example.net`. Il ne compte que pour le travail sur une VM. Quand il est joignable, les applications marquées **SMB** lisent leurs images directement sur le partage au lieu de passer par le tunnel SSH, ce qui est beaucoup plus rapide sur de gros jeux de données.

Cliquez sur **Tester** pour vérifier l'hôte. L'indicateur affiche **Non teste**, **Joignable** ou **Injoignable**. VisionNexus considère l'hôte joignable quand son port SMB (445) répond. Il liste ensuite les noms de partages qu'il sait énumérer sous **Zones accessibles** ; la liste peut être vide quand le serveur n'autorise pas l'énumération, ce qui ne change pas le résultat. Un petit message confirme le test ou explique l'échec, par exemple qu'il faut vérifier le nom d'hôte ou le VPN. L'hôte est aussi testé automatiquement au chargement des réglages.

Laissez le champ vide en cas de doute : rien ne casse, les applications utilisent simplement HTTP. En mode local, le chemin natif est toujours considéré comme actif, car les fichiers sont lus sur le disque local.

## Enregistrer les réglages et le bandeau d'état

Cliquez sur **Enregistrer** pour écrire les réglages dans votre profil Windows. Un bandeau au-dessus des champs indique l'état : un bandeau orange affiche **Renseigne les champs ci-dessous pour pouvoir lancer une app.**, un bandeau vert affiche **Reglages complets -- les apps sont lancables.** Le bandeau vérifie les quatre champs obligatoires (**Utilisateur**, **Workspace**, **Racine Computer_Vision_App**, **Chemin conda**). Tant qu'il n'est pas vert, les tuiles et les interrupteurs des ressources de calcul restent désactivés.

Les boutons de langue et la liste **VM cible** enregistrent leur propre choix immédiatement ; tous les autres champs demandent **Enregistrer**. Les réglages sont stockés par utilisateur Windows et par machine, et survivent donc aux mises à jour de l'application. Leur emplacement est donné dans [Configuration](configuration.fr.md#fichier-de-réglages-et-dossiers-de-logs).

## Ressources de calcul

La section **Ressources de calcul** se trouve sous le schéma. Elle liste des services sans interface, allumés à la demande, qui tournent sur la cible choisie dans les réglages (local ou VM) et n'ouvrent jamais d'onglet. Chaque carte affiche l'icône et le nom du service, une pastille avec sa cible (**Local** ou le nom de la VM), une description d'une ligne, son état et un interrupteur.

Cliquez sur l'interrupteur pour allumer ou éteindre un service. Il est désactivé tant que les réglages sont incomplets et pendant l'arrêt du service. Les lignes de démarrage vont dans le panneau **Lancements**, sous le nom du service, et **Stop** éteint le service. Si la cible sélectionnée change pendant qu'un service tourne, la carte signale qu'il tourne encore sur la cible précédente ; éteignez-le puis rallumez-le pour le déplacer. Allumer un service n'ouvre rien : les autres fenêtres l'utilisent par l'intermédiaire de VisionNexus. Fermer VisionNexus arrête tous les services.

La seule ressource de calcul actuelle est le Docs Assistant ; sa carte, ses états et ses messages sont décrits dans le [guide utilisateur du Docs Assistant](../Docs_Assistant_App/docs/user-guide.fr.md).

## La fenêtre Documentation

Le bouton **Documentation** (ou **Aide > Documentation**) ouvre la fenêtre Documentation. Elle démarre dans la langue du lanceur et possède ses propres boutons **EN** et **FR** en haut à droite ; changer de langue recharge les pages dans cette langue.

La fenêtre a deux onglets. **Docs par app** affiche la documentation : une liste à gauche avec **VisionNexus** en premier, puis chaque app, puis **Docs Assistant**, chacune avec son nombre de pages. Choisissez une entrée, puis une page dans la rangée d'onglets au-dessus du texte (le README vient en premier). Les liens entre pages d'une même entrée fonctionnent dans la fenêtre ; un lien vers la page d'une autre app ouvre cette page dans la même fenêtre, et les liens web s'ouvrent dans votre navigateur. **Demander a la doc** cherche dans toutes les pages à partir d'une question ; il nécessite le Docs Assistant et est décrit dans le [guide utilisateur du Docs Assistant](../Docs_Assistant_App/docs/user-guide.fr.md). Une fois le service lancé, **Actualiser l'index** à côté de son état prend en compte les pages que vous avez modifiées, sans attendre le prochain démarrage.

Les pages sont lues dans le dépôt quand VisionNexus le trouve (en mode local, grâce à **Racine Computer_Vision_App**, ou grâce à un dépôt placé à côté du programme), et dans une copie embarquée dans le programme sinon. Si une entrée affiche un message indiquant qu'aucune documentation n'a été trouvée, vérifiez que **Racine Computer_Vision_App** est un chemin Windows local. Rouvrez la fenêtre ou changez de langue pour recharger des pages que vous avez modifiées. Une barre sous le titre propose **Retour** et **Avance** à travers les pages et recherches visitées, décrite dans le [guide utilisateur du Docs Assistant](../Docs_Assistant_App/docs/user-guide.fr.md).

## Le tutoriel interactif

Le bouton **Tutoriel** démarre une visite guidée du lanceur. Le bouton brille en orange tant que la visite n'a jamais été démarrée sur cet ordinateur. La visite assombrit la page, entoure chaque élément à tour de rôle et l'explique dans une bulle avec une barre de progression, en quatre chapitres : les réglages champ par champ, la grille des applications, la barre du haut, et un vrai lancement d'Annotation qui se termine sur l'onglet qui apparaît.

Utilisez **Suivant** et **Precedent** ou les flèches droite et gauche pour avancer, et **Quitter**, la croix ou **Échap** pour sortir à tout moment ; la page reste utilisable pendant la visite. À l'étape du lancement, **Suivant** clique réellement sur la tuile **Annotation** si les réglages sont complets, et l'application démarre. Le texte et les boutons de la visite suivent la langue d'interface. Le fait que la visite ait été démarrée ou terminée est enregistré dans vos réglages, et vous pouvez la relancer quand vous voulez. Annotation et Dataset Explorer ont leurs propres visites, démarrées par un bouton orange sur leur écran d'accueil.
