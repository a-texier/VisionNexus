---
app: suite
doc_type: workflows
audience: user
lang: fr
title: Procédures
order: 20
tags: [premier lancement, local, vm, ssh, partage réseau, pipeline, tout arrêter, langue]
sources: [desktop/src/main.ts, desktop/src/sshLauncher.ts, desktop/ui/catalog.html, launcher.py, _lib/launcher_engine.py, rebuild_all.py]
---

# Procédures

## Configurer VisionNexus pour la première fois

Cette procédure renseigne les réglages une fois pour toutes afin que chaque application puisse être lancée.

*Prérequis* : le dépôt `Computer_Vision_App/` est présent sur la machine qui exécutera les applications, avec Python 3.11 ou plus récent et un environnement conda contenant les dépendances des applications, ainsi que Node.js 20 ou plus récent avec les frontends construits (`python rebuild_all.py` à la racine du dépôt s'en charge). Voir [Configuration](configuration.fr.md#prérequis).

1. Lancez `VisionNexusElectron.exe`, ou exécutez `npm start` dans `desktop/`. Le panneau **Parametres** à droite affiche un bandeau orange.
2. Dans **Utilisateur**, saisissez votre vrai login. Évitez `unknown`, `user`, `default`, `none`, `null`, `admin` et `test` : ils sont refusés.
3. Dans **Workspace**, saisissez un dossier pour vos données, par exemple `D:\ws`. Il est créé au premier usage.
4. Dans **Racine Computer_Vision_App**, saisissez le dossier du dépôt, par exemple `C:\Vision\Computer_Vision_App`.
5. Dans **Chemin conda**, saisissez le dossier de l'environnement conda (ou son exécutable Python).
6. Laissez **VM cible** sur **(local, pas de VM)**, puis cliquez sur **Enregistrer**.

*Résultat* : le bandeau devient vert (**Reglages complets -- les apps sont lancables.**) et les tuiles du schéma deviennent cliquables. Cliquez sur **Tutoriel** si vous voulez une visite guidée.

## Lancer une application sur votre propre machine

Cette procédure démarre une application en local et l'ouvre dans un onglet.

*Prérequis* : les réglages sont complets avec **VM cible** sur **(local, pas de VM)**.

1. Cliquez sur une tuile, par exemple **Dataset Explorer**. Son point devient bleu et le panneau **Lancements** s'ouvre.
2. Suivez le journal. Vous devez voir `Ports reels : backend=... frontend=...`, puis un message d'attente pendant que le backend charge ses modèles, puis `Pret -- ouverture de l'onglet.`
3. Quand l'onglet apparaît à côté de **VisionNexus**, travaillez dans l'application comme d'habitude.
4. Pour terminer la session, cliquez sur la croix de l'onglet (ou sur **Stop** dans le panneau **Lancements**).

*Résultat* : l'application a tourné sur des ports libres choisis par le lanceur, a écrit ses données sous `<workspace>\explorer_<utilisateur>`, et ses processus ont été arrêtés à la fermeture de l'onglet. Lancer deux fois la même application n'est pas possible : un second clic sur sa tuile bascule seulement sur l'onglet ouvert.

## Exécuter la suite sur une VM Linux GPU via SSH

Cette procédure exécute les applications sur une machine Linux distante et les affiche sur votre machine Windows.

*Prérequis* : vous pouvez ouvrir `ssh <vm>` depuis un terminal Windows sans saisir de mot de passe (clé ou agent) ; le dépôt, un environnement conda et Node.js sont installés sur la VM ; `python` est trouvé par le shell que `ssh` démarre pour une commande distante. Voir [Configuration](configuration.fr.md#prérequis-de-la-vm-linux-gpu).

1. Saisissez `ssh <vm>` dans un terminal pour vérifier la connexion.
2. Dans **VM(s) connue(s)**, saisissez le nom de la VM tel que `ssh` le comprend, par exemple `vm-gpu-01`. Séparez plusieurs noms par des virgules.
3. Cliquez sur **Enregistrer**, puis choisissez la VM dans **VM cible**.
4. Remplacez **Workspace**, **Racine Computer_Vision_App** et **Chemin conda** par des chemins Linux de la VM, par exemple `/data/ws`, `/home/<utilisateur>/Computer_Vision_App` et `/home/<utilisateur>/miniconda3/envs/IA_env`. Cliquez sur **Enregistrer**.
5. Cliquez sur une tuile. Dans le panneau **Lancements**, vous devez voir `Lancement de ... sur <vm>`, les ports réels, `Client ssh : ...`, puis `Tunnel ouvert (local <port> + <port> -> <vm>).`
6. L'onglet s'ouvre sur `127.0.0.1` à travers le tunnel ; le calcul s'exécute sur la VM.

*Résultat* : l'application tourne sur le matériel de la VM et vous l'utilisez comme si elle était locale. Les mêmes numéros de ports doivent être libres sur votre machine Windows : si le journal signale qu'un port local est déjà occupé, voir [Dépannage](troubleshooting.fr.md#un-port-local-est-déjà-occupé-et-le-tunnel-est-refusé).

## Lire les images sur un partage réseau avec le chemin natif


*Prérequis* : une VM est sélectionnée, et le stockage qui contient vos images est exposé comme un partage (SMB ou équivalent) que votre machine Windows peut joindre, par exemple via un VPN.

1. Dans **Partage reseau natif (optionnel)**, saisissez le nom d'hôte du serveur de partage, par exemple `share-host.example.net`.
2. Cliquez sur **Tester**. Attendez **Joignable** ; si vous lisez **Injoignable**, vérifiez le nom d'hôte et le VPN.
3. Cliquez sur **Enregistrer**.
5. Vérifiez l'onglet : une étiquette **SMB** turquoise signifie que les images sont lues sur le partage. Une étiquette **HTTP** ambre signifie que l'application s'est repliée sur HTTP ; survolez-la pour lire la raison.

*Résultat* : les images sont lues directement sur le partage et le tunnel ne transporte plus que l'interface et les appels d'API. Si le partage échoue à un moment, les images sont récupérées en HTTP à la place, sans que rien ne casse. L'hôte est transmis aux applications pour qu'elles convertissent les chemins Linux en chemins de partage (voir [Concepts](concepts.fr.md#le-chemin-réseau-natif)).

## Enchaîner un pipeline complet à travers les apps

Cette procédure exécute toute la chaîne, d'un jeu d'images à un modèle entraîné et évalué, à travers l'Orchestrator.

*Prérequis* : les réglages sont complets, en mode local ou VM selon votre préférence.

1. Cliquez sur la tuile **Orchestrator** et attendez son onglet.
2. Dans l'Orchestrator, choisissez ou construisez un graphe et cliquez sur **Lancer**. L'Orchestrator lance les sous-applications dont le graphe a besoin ; vous n'avez pas à cliquer sur leurs tuiles.
3. Surveillez le compteur de l'onglet Orchestrator, du type `3/7`. Cliquez dessus et choisissez **Ouvrir (onglet)** pour ouvrir une sous-application active comme onglet, par exemple **Annotation** quand le pipeline attend que vous annotiez.
4. Terminez l'étape manuelle dans la sous-application, revenez à l'onglet Orchestrator et poursuivez l'exécution.
5. Ouvrez **DVC** et **MLflow** depuis le même menu pour inspecter les versions et les expériences produites par l'exécution.

*Résultat* : chaque application a tourné sous votre utilisateur et votre workspace, et les sorties du pipeline se trouvent dans les dossiers de workspace des applications. L'éditeur de graphes, les modèles et les points d'arrêt humains sont documentés dans les [procédures de l'Orchestrator](../Orchestrator_App/docs/workflows.fr.md) ; chaque app a ses propres pages dans la fenêtre **Documentation**. Pour enchaîner les apps à la main, lancez-les une par une avec le même **Utilisateur** et le même **Workspace** et transmettez les dossiers exportés de l'une à la suivante.

## Chercher dans la documentation avec le Docs Assistant

Cette procédure renvoie vers les pages qui décrivent comment allumer la recherche dans la documentation et l'utiliser. Le service est une ressource de calcul : il s'allume depuis la section **Ressources de calcul** de l'accueil ou depuis l'onglet **Demander a la doc** de la fenêtre **Documentation**. Les étapes complètes, y compris le rafraîchissement de l'index après modification de pages de documentation, sont dans les [procédures du Docs Assistant](../Docs_Assistant_App/docs/workflows.fr.md).

## Tout arrêter et libérer les ports

Cette procédure ferme tous les processus démarrés par VisionNexus et nettoie ceux qu'un plantage a laissés derrière lui.

*Prérequis* : aucun.

1. Cliquez sur **Ports**. Le panneau liste les ports locaux et, si une VM est sélectionnée, ceux de la VM.
2. Cliquez sur **Tout arreter** et lisez la confirmation, qui nomme les applications ouvertes. Confirmez.
3. Quand le bouton indique combien d'éléments ont été arrêtés, vérifiez le tableau : les ports connus de la suite doivent avoir disparu.
4. Pour un port encore marqué **a verifier** que vous reconnaissez comme un reste, cliquez sur **Tuer** sur sa ligne. Sur une VM partagée, vérifiez d'abord la colonne **Utilisateur** : ne tuez que vos propres processus.
5. Cliquez sur **Fermer**.

*Résultat* : plus aucune application, aucun tunnel ni aucune ressource de calcul de VisionNexus ne subsiste, en local comme sur la VM.

## Changer la langue de l'interface

Cette procédure change la langue du lanceur et des applications lancées ensuite.

*Prérequis* : aucun.

1. Dans le panneau **Parametres**, cliquez sur **EN** ou **FR** à côté de **Langue des apps**. Le lanceur est traduit aussitôt et le choix est enregistré.
2. Lancez ensuite vos applications : chacune démarre dans cette langue.
3. Pour une application déjà ouverte, utilisez son propre bouton de langue ; elle garde sa propre préférence et ne suit pas le lanceur.
4. Rouvrez la fenêtre **Documentation** si vous la voulez dans la nouvelle langue, ou utilisez ses boutons **EN** et **FR** en haut à droite.

*Résultat* : le lanceur et les applications lancées ensuite utilisent la langue choisie. La visite guidée reste en français.
